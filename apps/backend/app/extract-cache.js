'use strict';
/**
 * @asseris-module       Extract Cache
 * @asseris-description  Pre-extracts JSONL records into ~150-byte mini-records on disk
 *                       (~/.claude/usage-dashboard-extract.json) so subsequent scans skip
 *                       multi-KB JSON.parse rounds on unchanged content.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Usage Scan Orchestrator
 * @asseris-emits        ~/.claude/usage-dashboard-extract.json file
 * @asseris-consumes     JSONL files, mini-record schema
 *
 * extract-cache.js — Pre-extract JSONL records into lightweight mini-records.
 *
 * Eliminates repeated JSON.parse of multi-KB JSONL records (message content,
 * tools, prompts). Stores only the ~150 bytes per record the dashboard needs.
 *
 * Cache file: ~/.claude/usage-dashboard-extract.json
 *
 * Usage:
 *   var ec = require('./extract-cache');
 *   var cache = ec.load();                       // load from disk (or empty)
 *   var result = ec.sync(cache, taggedFiles);     // sync against JSONL manifest
 *   ec.save(cache);                               // persist to disk
 *   var records = ec.getRecordsForFile(cache, f);  // get mini-records
 */
var fs = require('node:fs');
var path = require('node:path');

var HOME = process.env.HOME || process.env.USERPROFILE || '';
var EXTRACT_STATE_DIR = process.env.CLAUDE_USAGE_STATE_DIR ||
  path.join(HOME, '.claude');
var CACHE_FILE = path.join(EXTRACT_STATE_DIR, 'usage-dashboard-extract.json');
var CACHE_VERSION = 1;

// ── Signal detection (mirrored from dashboard-server.js) ────────────────

function scanLineHitLimit(line) {
  if (line.includes('rate_limit')) return true;
  if (line.includes('RateLimit')) return true;
  if (line.includes('rate limit')) return true;
  if (line.includes('"status":429')) return true;
  if (line.includes('"status_code":429')) return true;
  if (line.includes('429') && line.includes('error')) return true;
  if (line.includes('overloaded')) return true;
  if (line.includes('Too Many Requests')) return true;
  if (line.includes('session') && line.includes('limit')) return true;
  return false;
}

function classifySignals(line, rec) {
  var tags = [];
  var seen = Object.create(null);
  function add(tag) { if (!seen[tag]) { seen[tag] = true; tags.push(tag); } }

  var lower = String(line).toLowerCase();
  if (/(?:^|[^\w-])--continue(?:[^\w-]|$)/.test(lower) || /["']--continue["']/.test(line)) add('continue');
  if (/(?:^|[^\w-])--resume(?:[^\w-]|$)/.test(lower) || /["']--resume["']/.test(line)) add('resume');
  if (/user_cancel|user_cancelled|user\s*interrupt|interrupted|unterbrochen|stream\s*abort|cancellation|cancelled\s*request/.test(lower)) add('interrupt');
  if (rec?.message?.stop_reason) {
    var sr = String(rec.message.stop_reason).toLowerCase();
    if (sr.includes('cancel') || sr === 'user_abort') add('interrupt');
  }
  if (/retrying|will\s*retry|retries\s+exhausted|exponential\s*backoff|auto-?retry|retry\s+attempt/.test(lower)) add('retry');
  if (/\b429\b/.test(lower) && /retry|rate|limit|overloaded|throttl|too\s+many/.test(lower)) add('retry');
  if (rec && rec.error) {
    try {
      var ej = JSON.stringify(rec.error).toLowerCase();
      if (/retry|429|rate|throttl|overloaded/.test(ej)) add('retry');
      if (/interrupt|cancel|abort/.test(ej)) add('interrupt');
    } catch (error) { /* intentional */ }
  }
  if (/["']is_truncated["']\s*:\s*true|["']truncated["']\s*:\s*true/.test(line)) add('truncated');
  if (rec && rec.type === 'system' && rec.subtype === 'api_error') add('api_error');
  return tags;
}

// ── Model normalization ─────────────────────────────────────────────────

var MODEL_DATE_SUFFIX_RE = /-\d{8}$/;
function normalizeModel(m) {
  return m ? String(m).replace(MODEL_DATE_SUFFIX_RE, '') : '';
}

// ── JSONL line reader (identical to usage-scan-roots.js) ────────────────

var StringDecoder = require('node:string_decoder').StringDecoder;

function forEachLineSync(filePath, cb) {
  var fd;
  try { fd = fs.openSync(filePath, 'r'); } catch (e) { return; }
  var buf = Buffer.alloc(1024 * 1024);
  var decoder = new StringDecoder('utf8');
  var leftover = '';
  try {
    var bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length)) > 0) {
      var chunk = leftover + decoder.write(buf.slice(0, bytesRead));
      var lines = chunk.split('\n');
      leftover = lines.pop() || '';
      for (var ln of lines) {
        if (ln.length) cb(ln);
      }
    }
    if (leftover.length) cb(leftover);
  } finally {
    fs.closeSync(fd);
  }
}

// ── Extract one JSONL file into mini-records ────────────────────────────

function extractFile(filePath) {
  var records = [];
  var stats = { total: 0, extracted: 0, skipped: 0, errors: 0 };

  forEachLineSync(filePath, function (line) {
    stats.total++;
    var rec;
    try { rec = JSON.parse(line); } catch (e) { stats.errors++; return; }

    // Signal detection runs on ALL record types (uses raw line)
    var signals = classifySignals(line, rec);
    var hitLimit = scanLineHitLimit(line);

    // Only extract assistant records with usage
    var ts = rec.timestamp;
    if (!ts || typeof ts !== 'string' || ts.length < 19) { stats.skipped++; return; }

    var usage = rec.message?.usage;
    var model = rec.message?.model;

    // For non-assistant or system records: still capture signals
    if (rec.isSidechain) { stats.skipped++; return; }

    var inp = usage ? (usage.input_tokens || 0) : 0;
    var out = usage ? (usage.output_tokens || 0) : 0;
    var cr  = usage ? (usage.cache_read_input_tokens || 0) : 0;
    var cc  = usage ? (usage.cache_creation_input_tokens || 0) : 0;

    var mini = {
      ts: ts,
      tp: rec.type || '',
      sid: rec.sessionId || '',
      inp: inp,
      out: out,
      cr: cr,
      cc: cc,
      mod: normalizeModel(model),
      sr: rec.message?.stop_reason || '',
      ver: rec.version || rec.cli_version || rec.claude_code_version || rec.extension_version || '',
      ep: rec.entrypoint || '',
      sig: signals.length ? signals : undefined,
      hl: hitLimit || undefined
    };

    records.push(mini);
    stats.extracted++;
  });

  return { records: records, stats: stats };
}

// ── Cache operations ────────────────────────────────────────────────────

function load() {
  try {
    var raw = fs.readFileSync(CACHE_FILE, 'utf8');
    var data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) return emptyCache();
    return data;
  } catch (e) {
    return emptyCache();
  }
}

function emptyCache() {
  return { version: CACHE_VERSION, files: {} };
}

function save(cache) {
  try {
    var dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (e) {
    // Non-fatal: next run will rebuild
  }
}

/**
 * Sync cache against current JSONL file manifest.
 * @param {object} cache - loaded cache object
 * @param {Array<{path:string, label?:string}>} taggedFiles - JSONL files to process
 * @returns {{ hit: number, miss: number, removed: number, totalRecords: number }}
 */
function sync(cache, taggedFiles) {
  var result = { hit: 0, miss: 0, removed: 0, totalRecords: 0 };
  var currentPaths = {};

  for (var tf of taggedFiles) {
    var fp = typeof tf === 'string' ? tf : tf.path;
    currentPaths[fp] = true;

    var stat;
    try { stat = fs.statSync(fp); } catch (e) { continue; }

    var entry = cache.files[fp];
    if (entry && entry.mtimeMs === stat.mtimeMs && entry.size === stat.size) {
      // Cache hit — file unchanged
      result.hit++;
      result.totalRecords += entry.records.length;
      continue;
    }

    // Cache miss — re-extract
    var extracted = extractFile(fp);
    cache.files[fp] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      label: typeof tf === 'string' ? 'local' : (tf.label || 'local'),
      isSub: fp.includes('subagent'),
      records: extracted.records
    };
    result.miss++;
    result.totalRecords += extracted.records.length;
  }

  // Remove entries for deleted files
  for (var key in cache.files) {
    if (!Object.hasOwn(cache.files, key)) continue;
    if (!currentPaths[key]) {
      delete cache.files[key];
      result.removed++;
    }
  }

  return result;
}

/**
 * Get mini-records for a file path.
 */
function getRecords(cache, filePath) {
  var entry = cache.files[filePath];
  return entry ? entry.records : [];
}

/**
 * Get file metadata (label, isSub).
 */
function getFileMeta(cache, filePath) {
  var entry = cache.files[filePath];
  return entry ? { label: entry.label, isSub: entry.isSub } : { label: 'local', isSub: false };
}

/**
 * Get all records across all files.
 * @returns {Array<{rec: object, label: string, isSub: boolean}>}
 */
function getAllRecords(cache) {
  var all = [];
  for (var fp in cache.files) {
    if (!Object.hasOwn(cache.files, fp)) continue;
    var entry = cache.files[fp];
    var label = entry.label || 'local';
    var isSub = entry.isSub || false;
    for (var rec of entry.records) {
      all.push({ rec: rec, label: label, isSub: isSub });
    }
  }
  return all;
}

module.exports = {
  load: load,
  save: save,
  sync: sync,
  getRecords: getRecords,
  getFileMeta: getFileMeta,
  getAllRecords: getAllRecords,
  extractFile: extractFile,
  CACHE_FILE: CACHE_FILE
};
