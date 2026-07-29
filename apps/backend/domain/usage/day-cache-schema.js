/**
 * @asseris-module       Day Cache Schema
 * @asseris-description  Module-level annotation placeholder for Day Cache Schema.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 */
var fs = require('node:fs');
var path = require('node:path');
var usageScanRoots = require('./scan-roots');
var HOME = usageScanRoots.HOME;

var USAGE_DAY_CACHE_VERSION = 7; // bumped: entrypoints per version in version_stats
var USAGE_STATE_DIR = process.env.CLAUDE_USAGE_STATE_DIR ||
  path.join(HOME, '.claude');
var USAGE_DAY_CACHE_FILE = path.join(USAGE_STATE_DIR, 'usage-dashboard-days.json');

function readUsageDayCache() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_DAY_CACHE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeUsageDayCache(payload) {
  var dir = path.dirname(USAGE_DAY_CACHE_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (error) { /* intentional */ }
  var tmp = USAGE_DAY_CACHE_FILE + '.tmp';
  var body = JSON.stringify(payload);
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, USAGE_DAY_CACHE_FILE);
  } catch (e) {
    fs.writeFileSync(USAGE_DAY_CACHE_FILE, body, 'utf8');
  }
}

/** Convert a day-cache row to an internal daily bucket (CLI/forensics path). */
function cacheDayToDailyBucket(cd) {
  var sessionSignals = require('./session-signals');
  var ss = cd.session_signals && typeof cd.session_signals === 'object' ? cd.session_signals : null;
  var sig = sessionSignals.emptySessionSignals();
  if (ss) {
    sig.continue = ss.continue || 0;
    sig.resume = ss.resume || 0;
    sig.retry = ss.retry || 0;
    sig.interrupt = ss.interrupt || 0;
    sig.truncated = ss.truncated || 0;
    sig.api_error = ss.api_error || 0;
  }
  return {
    input: cd.input || 0,
    output: cd.output || 0,
    cache_read: cd.cache_read || 0,
    cache_creation: cd.cache_creation || 0,
    calls: cd.calls || 0,
    sub_calls: cd.sub_calls || 0,
    sub_cache: cd.sub_cache || 0,
    sub_output: cd.sub_output || 0,
    hours: cd.hours || {},
    hit_limit: cd.hit_limit || 0,
    models: cd.models || {},
    session_signals: sig
  };
}

module.exports = {
  USAGE_DAY_CACHE_VERSION: USAGE_DAY_CACHE_VERSION,
  USAGE_DAY_CACHE_FILE: USAGE_DAY_CACHE_FILE,
  readUsageDayCache: readUsageDayCache,
  writeUsageDayCache: writeUsageDayCache,
  cacheDayToDailyBucket: cacheDayToDailyBucket
};
