'use strict';

/**
 * @asseris-module       Addon Adapter
 * @asseris-description  Declares the optional third-party add-ons, finds their
 *                       artifacts wherever they were dropped, and reports what
 *                       was found.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 */

/**
 * Cache Fix, Claude Code Meter and compatible request logs are add-ons: the
 * product neither ships nor produces them. Knowledge about where each artifact
 * lives was scattered across the setup model, the usage adapter and the debug
 * adapter, so every one of them had to be taught about a new location
 * separately — and a file dropped one directory over went unnoticed.
 *
 * This module owns that knowledge instead. It declares each add-on with the
 * artifacts it writes, searches the places those files realistically sit, and
 * answers with what exists. Callers ask which artifact an add-on has, they do
 * not construct paths.
 */

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var storagePaths = require('../usage/storage-paths');

var ADDONS = [
  {
    id: 'cache_fix',
    // The name the add-on uses for itself — the same string it writes into the
    // source field of its records, so the setup and the evidence agree.
    label: 'claude-code-cache-fix',
    // What each artifact carries, read from the add-on's own writer. A
    // capability belongs to the artifact, not to the add-on: enabling an
    // add-on whose file is absent delivers nothing, and a chart that needs a
    // capability nobody delivers is unavailable rather than empty.
    artifacts: {
      usage: {
        file: 'usage.jsonl', env: 'CACHE_FIX_USAGE_LOG', setupKey: 'cache_fix_usage',
        source: 'claude-code-cache-fix', provides: ['tokens', 'cache', 'ttl', 'quota']
      },
      debug: {
        file: 'cache-fix-debug.log', env: 'CACHE_FIX_DEBUG_LOG', setupKey: 'cache_fix_debug',
        provides: ['fixes']
      },
      // Only the proxy mode writes this, only with the request-log extension
      // enabled, and only to a path chosen through CACHE_FIX_REQUEST_LOG —
      // there is no default name to look for, so it is found by configuration
      // alone.
      timing: {
        file: 'cache-fix-request-log.ndjson', env: 'CACHE_FIX_REQUEST_LOG',
        setupKey: 'cache_fix_timing', provides: ['latency']
      }
    }
  },
  {
    id: 'meter',
    label: 'claude-code-meter',
    artifacts: {
      usage: {
        file: 'claude-meter.jsonl', env: 'CLAUDE_METER_LOG', setupKey: 'meter_usage',
        source: 'claude-code-meter', provides: ['tokens', 'cache', 'quota', 'session', 'model_mismatch']
      }
    }
  },
  {
    id: 'request_ndjson',
    label: 'proxy',
    artifacts: {
      // A directory of daily files rather than a single artifact. Both names
      // are in the field, so both are searched.
      logs: {
        directories: ['proxy-logs', 'anthropic-proxy-logs'], env: 'ANTHROPIC_PROXY_LOG_DIR',
        setupKey: 'request_log_dir', match: /\.ndjson$/,
        provides: ['tokens', 'cache', 'ttl', 'quota', 'latency', 'status', 'clients', 'session']
      }
    }
  }
];

/**
 * A path that is not there is an answer; a path that cannot be read is a
 * fault. Both used to arrive as the same empty result, which turned a
 * permission problem into a silent "no add-on installed". These two helpers
 * keep the distinction: absence is reported, anything else is raised.
 */
var ABSENT = new Set(['ENOENT', 'ENOTDIR']);

function listEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (ABSENT.has(error.code) || error.code === 'EACCES') return [];
    throw error;
  }
}

function statOf(candidate) {
  try {
    return fs.statSync(candidate);
  } catch (error) {
    if (ABSENT.has(error.code) || error.code === 'EACCES') return null;
    throw error;
  }
}

function claudeRoot(env, home) {
  if (env.CLAUDE_CONFIG_DIR) return path.resolve(env.CLAUDE_CONFIG_DIR);
  return path.join(home || os.homedir(), '.claude');
}

/**
 * Where an artifact can realistically sit: next to the Claude configuration,
 * where the add-ons write by default, and in the product's own state
 * directory, where reconstructed or imported artifacts get placed.
 */
function searchRoots(env, home) {
  var roots = [claudeRoot(env, home)];
  var state = storagePaths.stateDir(env);
  if (state && !roots.includes(state)) roots.push(state);
  return roots;
}

/** Directories that never hold add-on artifacts but are expensive to walk. */
var SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'session-turns', 'proxy-day-cache', 'shell-snapshots',
  'projects', 'transcripts', 'file-history', 'backups', 'plans', 'todos'
]);
var SEARCH_DEPTH = 4;

/**
 * Walk a root for a named artifact. Probing a handful of fixed paths is not a
 * search: an artifact one directory deeper — a dated fixture folder, an import
 * drop — stayed invisible while the file sat right there. Depth is bounded and
 * bulky directories are skipped so this stays cheap enough to run on every
 * status call.
 */
function walkFor(root, fileName, depth) {
  var found = [];
  for (var entry of listEntries(root)) {
    var full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth <= 0 || SKIP_DIRECTORIES.has(entry.name)) continue;
      found = found.concat(walkFor(full, fileName, depth - 1));
    } else if (entry.name === fileName) {
      found.push(full);
    }
  }
  return found;
}

/** Directories under a root that carry files matching the artifact pattern. */
function walkForDirectories(root, names, match, depth) {
  var found = [];
  for (var entry of listEntries(root)) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    var full = path.join(root, entry.name);
    if (names.includes(entry.name) && directoryHasMatch(full, match)) found.push(full);
    if (depth > 0) found = found.concat(walkForDirectories(full, names, match, depth - 1));
  }
  return found;
}

function newestOf(paths) {
  var best = null;
  var bestTime = -1;
  for (var candidate of paths) {
    var stats = statOf(candidate);
    if (stats && stats.mtimeMs > bestTime) { bestTime = stats.mtimeMs; best = candidate; }
  }
  return best;
}

function isFile(candidate) {
  var stats = statOf(candidate);
  return stats !== null && stats.isFile();
}

function directoryHasMatch(directory, match) {
  for (var entry of listEntries(directory)) {
    if (!match || match.test(entry.name)) return true;
  }
  return false;
}

function definitionOf(addonId, artifactKey) {
  for (var addon of ADDONS) {
    if (addon.id !== addonId) continue;
    return addon.artifacts[artifactKey] || null;
  }
  return null;
}

/**
 * Resolve one artifact. A path the user configured wins when it exists; an
 * environment override comes next; otherwise the known locations are searched.
 * Returns null when nothing is there — the caller must not invent a path.
 */
function find(addonId, artifactKey, options) {
  options = options || {};
  var env = options.env || process.env;
  var home = options.home || os.homedir();
  var setup = options.setup || null;
  var definition = definitionOf(addonId, artifactKey);
  if (!definition) return null;

  var configured = setup && definition.setupKey ? setup[definition.setupKey] : null;
  var candidates = [];
  if (configured) candidates.push(path.resolve(String(configured)));
  if (definition.env && env[definition.env]) candidates.push(path.resolve(env[definition.env]));
  for (var root of searchRoots(env, home)) {
    if (definition.file) candidates.push(path.join(root, definition.file));
    for (var directory of definition.directories || []) candidates.push(path.join(root, directory));
  }

  for (var candidate of candidates) {
    if (definition.directories) {
      if (directoryHasMatch(candidate, definition.match)) return candidate;
    } else if (isFile(candidate)) {
      return candidate;
    }
  }

  // Nothing at the expected places: search. The newest match wins, because a
  // rebuilt artifact should take precedence over an older copy left behind.
  for (var searchRoot of searchRoots(env, home)) {
    var hits = definition.directories
      ? walkForDirectories(searchRoot, definition.directories, definition.match, SEARCH_DEPTH)
      : walkFor(searchRoot, definition.file, SEARCH_DEPTH);
    var newest = newestOf(hits);
    if (newest) return newest;
  }
  return null;
}

/**
 * The path an artifact would take if it existed — for display and defaults.
 * A configured path is shown even when it holds nothing, because replacing it
 * with a discovered one would show the user a path they never entered.
 */
function defaultPath(addonId, artifactKey, options) {
  options = options || {};
  var env = options.env || process.env;
  var home = options.home || os.homedir();
  var setup = options.setup || null;
  var definition = definitionOf(addonId, artifactKey);
  if (!definition) return null;
  if (setup && definition.setupKey && setup[definition.setupKey]) {
    return path.resolve(String(setup[definition.setupKey]));
  }
  if (definition.env && env[definition.env]) return path.resolve(env[definition.env]);
  var root = claudeRoot(env, home);
  if (definition.file) return path.join(root, definition.file);
  return path.join(root, definition.directories[0]);
}

/** What each add-on currently has, for the setup surface. */
function status(options) {
  var result = {};
  for (var addon of ADDONS) {
    var artifacts = {};
    for (var key of Object.keys(addon.artifacts)) {
      var found = find(addon.id, key, options);
      artifacts[key] = {
        path: found || defaultPath(addon.id, key, options),
        detected: found !== null
      };
    }
    result[addon.id] = { label: addon.label, artifacts: artifacts };
  }
  return result;
}

/**
 * Everything the selected sources can deliver. The base source is always on,
 * so its own capabilities are part of the answer.
 */
var BASE_CAPABILITIES = ['tokens', 'session'];

function capabilities(enabled, options) {
  var available = new Set(BASE_CAPABILITIES);
  for (var addon of ADDONS) {
    if (enabled?.[addon.id] !== true) continue;
    for (var key of Object.keys(addon.artifacts)) {
      var definition = addon.artifacts[key];
      if (!definition.provides || !find(addon.id, key, options)) continue;
      for (var capability of definition.provides) available.add(capability);
    }
  }
  return Array.from(available).sort(function (left, right) {
    return left.localeCompare(right);
  });
}

/** Evidence files an enabled add-on contributes, with their source label. */
function evidenceSources(enabled, options) {
  var selected = [];
  for (var addon of ADDONS) {
    if (enabled?.[addon.id] !== true) continue;
    for (var key of Object.keys(addon.artifacts)) {
      var definition = addon.artifacts[key];
      if (!definition.source) continue;
      var file = find(addon.id, key, options);
      if (file) selected.push({ file: file, source: definition.source });
    }
  }
  return selected;
}

module.exports = {
  ADDONS: ADDONS,
  find: find,
  defaultPath: defaultPath,
  status: status,
  capabilities: capabilities,
  evidenceSources: evidenceSources
};
