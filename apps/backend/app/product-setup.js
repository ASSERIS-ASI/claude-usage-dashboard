'use strict';

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

function stateDir() {
  return process.env.CLAUDE_USAGE_STATE_DIR ||
    path.join(os.homedir(), '.claude', 'usage-dashboard-product');
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

function read() {
  try {
    var value = JSON.parse(fs.readFileSync(setupFile(), 'utf8'));
    if (!['local', 'cache-fix', 'meter'].includes(value?.mode)) return null;
    return value;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

function status() {
  var setup = read();
  var cacheFixPath = setup?.cache_fix_usage || defaultCacheFixPath();
  var meterPath = setup?.meter_usage || defaultMeterPath();
  var cacheFixDebugPath = setup?.cache_fix_debug || defaultCacheFixDebugPath();
  return {
    configured: !!setup,
    mode: setup?.mode || null,
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
    supported_modes: ['local', 'cache-fix', 'meter']
  };
}

function write(input) {
  var mode = input?.mode;
  if (!['local', 'cache-fix', 'meter'].includes(mode)) {
    var invalid = new Error('mode must be local, cache-fix or meter');
    invalid.code = 'INVALID_MODE';
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
    version: 1,
    mode: mode,
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
  process.env.CLAUDE_USAGE_SOURCE_MODE = mode;
  if (mode === 'cache-fix') process.env.CACHE_FIX_USAGE_LOG = cacheFixPath;
  if (mode === 'cache-fix') process.env.CACHE_FIX_DEBUG_LOG = cacheFixDebugPath;
  if (mode === 'meter') process.env.CLAUDE_METER_LOG = meterPath;
  return status();
}

module.exports = {
  stateDir: stateDir,
  setupFile: setupFile,
  defaultCacheFixPath: defaultCacheFixPath,
  defaultMeterPath: defaultMeterPath,
  defaultCacheFixDebugPath: defaultCacheFixDebugPath,
  read: read,
  status: status,
  write: write
};
