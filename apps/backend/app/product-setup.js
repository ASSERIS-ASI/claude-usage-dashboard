'use strict';

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var storagePaths = require('../domain/usage/storage-paths');

function stateDir() {
  return storagePaths.stateDir();
}

function setupFile() {
  return path.join(stateDir(), 'setup.json');
}

function defaultCacheFixPath() {
  if (process.env.CACHE_FIX_USAGE_LOG) return path.resolve(process.env.CACHE_FIX_USAGE_LOG);
  var root = process.env.CLAUDE_CONFIG_DIR ?
    path.resolve(process.env.CLAUDE_CONFIG_DIR) :
    path.join(os.homedir(), '.claude');
  return path.join(root, 'usage.jsonl');
}

function defaultMeterPath() {
  if (process.env.CLAUDE_METER_LOG) return path.resolve(process.env.CLAUDE_METER_LOG);
  var root = process.env.CLAUDE_CONFIG_DIR ?
    path.resolve(process.env.CLAUDE_CONFIG_DIR) :
    path.join(os.homedir(), '.claude');
  return path.join(root, 'claude-meter.jsonl');
}

function defaultCacheFixDebugPath() {
  if (process.env.CACHE_FIX_DEBUG_LOG) return path.resolve(process.env.CACHE_FIX_DEBUG_LOG);
  var root = process.env.CLAUDE_CONFIG_DIR ?
    path.resolve(process.env.CLAUDE_CONFIG_DIR) :
    path.join(os.homedir(), '.claude');
  return path.join(root, 'cache-fix-debug.log');
}

var DEFAULT_MODEL_COLORS = Object.freeze({
  haiku: '#a855f7',
  opus: '#8C6A3F',
  sonnet: '#f59e0b',
  fable: '#ec4899'
});

var DEFAULT_SOURCES = Object.freeze({
  claude_jsonl: true,
  cache_fix: false,
  meter: false
});

function modelColors(value) {
  var source = value && typeof value === 'object' ? value : {};
  var result = {};
  for (var family of Object.keys(DEFAULT_MODEL_COLORS)) {
    var candidate = String(source[family] || '');
    result[family] = /^#[0-9a-f]{6}$/i.test(candidate)
      ? candidate
      : DEFAULT_MODEL_COLORS[family];
  }
  return result;
}

function sourcesFromLegacyMode(mode) {
  if (mode === 'cache-fix') {
    return { claude_jsonl: true, cache_fix: true, meter: false };
  }
  if (mode === 'meter') {
    return { claude_jsonl: true, cache_fix: false, meter: true };
  }
  if (mode === 'combined') {
    return { claude_jsonl: true, cache_fix: true, meter: true };
  }
  if (mode === 'local') {
    return { ...DEFAULT_SOURCES };
  }
  return null;
}

function normalizeSources(value) {
  var configured = value?.sources;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    return {
      claude_jsonl: true,
      cache_fix: configured.cache_fix === true,
      meter: configured.meter === true
    };
  }
  return sourcesFromLegacyMode(value?.mode);
}

function legacyMode(sources) {
  if (sources.cache_fix && sources.meter) return 'combined';
  if (sources.cache_fix) return 'cache-fix';
  if (sources.meter) return 'meter';
  return 'local';
}

function sourceEnabled(setup, source) {
  var sources = normalizeSources(setup);
  return sources ? sources[source] === true : false;
}

function read() {
  try {
    var value = JSON.parse(fs.readFileSync(setupFile(), 'utf8'));
    var sources = normalizeSources(value);
    if (!sources) return null;
    return {
      ...value,
      sources: sources,
      mode: legacyMode(sources)
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

function status() {
  var setup = read();
  var sources = setup?.sources || { ...DEFAULT_SOURCES };
  var cacheFixPath = setup?.cache_fix_usage || defaultCacheFixPath();
  var meterPath = setup?.meter_usage || defaultMeterPath();
  var cacheFixDebugPath = setup?.cache_fix_debug || defaultCacheFixDebugPath();
  return {
    configured: !!setup,
    mode: setup ? legacyMode(sources) : null,
    sources: sources,
    enabled_sources: Object.keys(sources).filter(function (source) {
      return sources[source] === true;
    }),
    subscription: setup?.subscription || null,
    language: setup?.language || null,
    log_roots: setup?.log_roots || [],
    include_subagents: setup?.include_subagents === true,
    model_colors: modelColors(setup?.model_colors),
    cache_fix_usage: cacheFixPath,
    cache_fix_detected: fs.existsSync(cacheFixPath),
    cache_fix_debug: cacheFixDebugPath,
    cache_fix_debug_detected: fs.existsSync(cacheFixDebugPath),
    meter_usage: meterPath,
    meter_detected: fs.existsSync(meterPath),
    supported_sources: ['claude_jsonl', 'cache_fix', 'meter']
  };
}

function write(input) {
  var sources = normalizeSources(input);
  if (!sources) {
    var invalid = new Error('sources must select Claude JSONL and may enable Cache Fix and Claude Code Meter');
    invalid.code = 'INVALID_SOURCES';
    throw invalid;
  }
  var subscription = String(input?.subscription || '').toLowerCase();
  if (!['pro', 'max5', 'max20', 'api'].includes(subscription)) {
    var invalidSubscription = new Error('subscription must be pro, max5, max20 or api');
    invalidSubscription.code = 'INVALID_SUBSCRIPTION';
    throw invalidSubscription;
  }
  var language = String(input?.language || '').toLowerCase();
  if (!['de', 'en', 'ko'].includes(language)) {
    var invalidLanguage = new Error('language must be de, en or ko');
    invalidLanguage.code = 'INVALID_LANGUAGE';
    throw invalidLanguage;
  }
  var cacheFixPath = input.cache_fix_usage ?
    path.resolve(String(input.cache_fix_usage)) :
    defaultCacheFixPath();
  var meterPath = input.meter_usage ?
    path.resolve(String(input.meter_usage)) :
    defaultMeterPath();
  var cacheFixDebugPath = input.cache_fix_debug ?
    path.resolve(String(input.cache_fix_debug)) :
    defaultCacheFixDebugPath();
  var logRoots = Array.isArray(input.log_roots) ? input.log_roots : [];
  logRoots = Array.from(new Set(logRoots.map(function (root) {
    return path.resolve(String(root));
  }).filter(function (root) {
    try { return fs.statSync(root).isDirectory(); } catch (error) { return false; }
  })));
  var setup = {
    version: 2,
    mode: legacyMode(sources),
    sources: sources,
    subscription: subscription,
    language: language,
    cache_fix_usage: cacheFixPath,
    cache_fix_debug: cacheFixDebugPath,
    meter_usage: meterPath,
    log_roots: logRoots,
    include_subagents: input.include_subagents === true,
    model_colors: modelColors(input.model_colors),
    updated_at: new Date().toISOString()
  };
  fs.mkdirSync(stateDir(), { recursive: true });
  var target = setupFile();
  var temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(setup, null, 2), 'utf8');
  fs.renameSync(temporary, target);
  process.env.CLAUDE_USAGE_SOURCE_MODE = legacyMode(sources);
  process.env.CLAUDE_USAGE_CACHE_FIX_ENABLED = sources.cache_fix ? '1' : '0';
  process.env.CLAUDE_USAGE_METER_ENABLED = sources.meter ? '1' : '0';
  if (sources.cache_fix) process.env.CACHE_FIX_USAGE_LOG = cacheFixPath;
  if (sources.cache_fix) process.env.CACHE_FIX_DEBUG_LOG = cacheFixDebugPath;
  if (sources.meter) process.env.CLAUDE_METER_LOG = meterPath;
  return status();
}

module.exports = {
  stateDir: stateDir,
  setupFile: setupFile,
  defaultCacheFixPath: defaultCacheFixPath,
  defaultMeterPath: defaultMeterPath,
  defaultCacheFixDebugPath: defaultCacheFixDebugPath,
  normalizeSources: normalizeSources,
  sourceEnabled: sourceEnabled,
  read: read,
  status: status,
  write: write
};
