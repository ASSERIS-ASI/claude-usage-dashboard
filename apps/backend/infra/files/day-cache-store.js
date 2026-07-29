'use strict';
/**
 * @asseris-module       Day Cache Store
 * @asseris-description  File-I/O for per-day aggregated usage snapshots and the today-index —
 *                       atomic tmp+rename writes, schema validation via day-cache-schema,
 *                       used by jsonl-agent (writer) and dashboard (reader).
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Day Cache Schema, Scan Roots (Usage)
 * @asseris-called-by    Dashboard Server, JSONL Agent
 * @asseris-emits        per-day cache files, today-index, atomic write commits
 * @asseris-consumes     ~/.claude day-cache directory contents
 *
 * day-cache-store.js — Day-Cache und Today-Index File-I/O.
 *
 * Re-exportiert day-cache-schema.js (Phase 1) und ergaenzt Today-Index-Funktionen.
 */
var fs = require('node:fs');
var path = require('node:path');
var dayCacheMod = require('../../domain/usage/day-cache-schema');
var HOME = require('../../domain/usage/scan-roots').HOME;

// ── Today-Index ──────────────────────────────────────────────────────────

var JSONL_TODAY_INDEX_VERSION = 1;
var TODAY_INDEX_STATE_DIR = process.env.CLAUDE_USAGE_STATE_DIR ||
  path.join(HOME, '.claude');
var JSONL_TODAY_INDEX_FILE = path.join(TODAY_INDEX_STATE_DIR, 'usage-dashboard-jsonl-today-index.json');
var TODAY_INDEX_DISABLED =
  process.env.CLAUDE_USAGE_NO_TODAY_INDEX === '1' || process.env.CLAUDE_USAGE_NO_TODAY_INDEX === 'true';

function readJsonlTodayIndexDisk() {
  try {
    return JSON.parse(fs.readFileSync(JSONL_TODAY_INDEX_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJsonlTodayIndexDisk(payload) {
  var dir = path.dirname(JSONL_TODAY_INDEX_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (error) { /* intentional */ }
  var tmp = JSONL_TODAY_INDEX_FILE + '.tmp';
  var body = JSON.stringify(payload);
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, JSONL_TODAY_INDEX_FILE);
  } catch (e1) {
    fs.writeFileSync(JSONL_TODAY_INDEX_FILE, body, 'utf8');
  }
}

function invalidateJsonlTodayIndexDisk() {
  try {
    if (fs.existsSync(JSONL_TODAY_INDEX_FILE)) fs.unlinkSync(JSONL_TODAY_INDEX_FILE);
  } catch (error) { /* intentional */ }
}

module.exports = {
  // Re-export from day-cache-schema (Phase 1)
  USAGE_DAY_CACHE_VERSION: dayCacheMod.USAGE_DAY_CACHE_VERSION,
  USAGE_DAY_CACHE_FILE: dayCacheMod.USAGE_DAY_CACHE_FILE,
  readUsageDayCache: dayCacheMod.readUsageDayCache,
  writeUsageDayCache: dayCacheMod.writeUsageDayCache,
  // Today-Index
  JSONL_TODAY_INDEX_VERSION: JSONL_TODAY_INDEX_VERSION,
  JSONL_TODAY_INDEX_FILE: JSONL_TODAY_INDEX_FILE,
  TODAY_INDEX_DISABLED: TODAY_INDEX_DISABLED,
  readJsonlTodayIndexDisk: readJsonlTodayIndexDisk,
  writeJsonlTodayIndexDisk: writeJsonlTodayIndexDisk,
  invalidateJsonlTodayIndexDisk: invalidateJsonlTodayIndexDisk
};
