'use strict';

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

function debugPath(env, home) {
  env = env || process.env;
  home = home || os.homedir();
  if (env.CACHE_FIX_DEBUG_LOG) return path.resolve(env.CACHE_FIX_DEBUG_LOG);
  var root = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  return path.join(root, 'cache-fix-debug.log');
}

function selectedPath(env, home) {
  var setup = null;
  try { setup = require('./product-setup').read(); } catch (error) { setup = null; }
  var sources = setup
    ? require('./product-setup').normalizeSources(setup)
    : require('./cache-fix-usage-adapter').enabledSources(null, env);
  if (!sources?.cache_fix) return null;
  return setup?.cache_fix_debug ? path.resolve(setup.cache_fix_debug) : debugPath(env, home);
}

function fixName(message) {
  var rules = [
    [/resume message relocation/i, 'resume_relocation'],
    [/tool order stabilization/i, 'tool_sort'],
    [/fingerprint stabilized/i, 'fingerprint'],
    [/stripped \d+ images?/i, 'image_strip'],
    [/\bTTL injected\b/i, 'ttl_injection'],
    [/identity normalized/i, 'identity_normalize'],
    [/output efficiency section rewritten/i, 'output_efficiency'],
    [/git-status stripped/i, 'git_status_strip'],
    [/CWD\/paths normalized/i, 'cwd_normalize'],
    [/session-start-normalize/i, 'session_start_normalize'],
    [/tool-use-input-normalize/i, 'tool_use_input_normalize'],
    [/smoosh-normalized/i, 'smoosh_normalize'],
    [/smoosh-split/i, 'smoosh_split'],
    [/continue-trailer-strip/i, 'continue_trailer_strip'],
    [/deferred-tools-restore/i, 'deferred_tools_restore'],
    [/reminder-strip/i, 'reminder_strip'],
    [/cache_control_normalize/i, 'cache_control_normalize'],
    [/cache_control_sticky/i, 'cache_control_sticky']
  ];
  for (var rule of rules) if (rule[0].test(message)) return rule[1];
  return null;
}

function parseLine(line) {
  var text = String(line || '');
  if (!text.startsWith('[')) return null;
  var timestampEnd = text.indexOf(']');
  if (timestampEnd < 2) return null;
  var messageStart = timestampEnd + 1;
  while (messageStart < text.length && /\s/.test(text[messageStart])) messageStart++;
  if (messageStart >= text.length) return null;
  var timestamp = new Date(text.slice(1, timestampEnd));
  if (!Number.isFinite(timestamp.getTime())) return null;
  var message = text.slice(messageStart);
  var kind = 'info';
  if (message.startsWith('APPLIED:')) kind = 'applied';
  else if (message.startsWith('SKIPPED:')) kind = 'skipped';
  else if (message.startsWith('cache-fix health:')) kind = 'health';
  else if (/^(PROMPT SIZE|CACHE TTL|MICROCOMPACT|BUDGET WARNING|FALSE RATE LIMIT):/.test(message)) kind = 'monitoring';
  var ttl = /CACHE TTL:\s+tier=(\S+)\s+create=(\d+)\s+read=(\d+)\s+hit=([\d.]+)%/.exec(message);
  return {
    ts: timestamp.toISOString(),
    date: timestamp.toISOString().slice(0, 10),
    hour: timestamp.getUTCHours(),
    kind: kind,
    fix: fixName(message),
    message: message,
    cache_ttl: ttl ? {
      tier: ttl[1],
      creation_tokens: Number(ttl[2]),
      read_tokens: Number(ttl[3]),
      hit_rate: Number(ttl[4]) / 100
    } : null
  };
}

function parseFile(file) {
  var days = {};
  var text = fs.readFileSync(file, 'utf8');
  for (var line of text.split(/\r?\n/)) {
    var event = parseLine(line);
    if (!event) continue;
    var day = days[event.date] || (days[event.date] = {
      source: 'claude-code-cache-fix-debug',
      source_file: file,
      applied_total: 0,
      skipped_total: 0,
      events: [],
      hourly: Array.from({ length: 24 }, function (_, hour) {
        return { hour: hour, applied: 0, skipped: 0, fixes: {}, cache_read_tokens: 0, cache_creation_tokens: 0, cache_hit_rate: null };
      }),
      health_latest: null
    });
    day.events.push(event);
    var bucket = day.hourly[event.hour];
    if (event.kind === 'applied') {
      day.applied_total++;
      bucket.applied++;
      if (event.fix) bucket.fixes[event.fix] = (bucket.fixes[event.fix] || 0) + 1;
    } else if (event.kind === 'skipped') {
      day.skipped_total++;
      bucket.skipped++;
    } else if (event.kind === 'health') {
      day.health_latest = event.message.slice('cache-fix health:'.length).trim();
    }
    if (event.cache_ttl) {
      bucket.cache_read_tokens += event.cache_ttl.read_tokens;
      bucket.cache_creation_tokens += event.cache_ttl.creation_tokens;
      bucket.cache_hit_rate = event.cache_ttl.hit_rate;
    }
  }
  return days;
}

function collect(env, home) {
  var file = selectedPath(env || process.env, home || os.homedir());
  if (!file) return { file: null, days: {} };
  try {
    if (!fs.statSync(file).isFile()) return { file: file, days: {} };
    return { file: file, days: parseFile(file) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { file: file, days: {} };
    throw error;
  }
}

module.exports = {
  debugPath: debugPath,
  selectedPath: selectedPath,
  fixName: fixName,
  parseLine: parseLine,
  parseFile: parseFile,
  collect: collect
};
