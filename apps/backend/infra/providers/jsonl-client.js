'use strict';
/**
 * @asseris-module       JSONL Client
 * @asseris-description  Local provider that reads aggregated usage scan results from disk
 *                       (written by the jsonl-agent) — keeps dashboard-server free of the
 *                       in-process scan. Reload-on-notify pattern.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server
 * @asseris-emits        in-memory usage cache snapshot
 * @asseris-consumes     jsonl-agent disk cache files
 *
 * jsonl-client.js — Local JSONL Scan Result Provider.
 *
 * Reads scan results written by the jsonl-agent from disk cache.
 * Used by the dashboard server to load pre-computed usage data
 * without running the scan in-process.
 *
 * Pattern: identical to usage-client.js — disk cache → reload on notify.
 */
var fs = require('node:fs');
var path = require('node:path');
var HOME = require('../../domain/usage/scan-roots').HOME;

var JSONL_STATE_DIR = process.env.CLAUDE_USAGE_STATE_DIR ||
  path.join(HOME, '.claude');
var JSONL_SCAN_DISK_CACHE = path.join(JSONL_STATE_DIR, 'usage-dashboard-scan.json');

// In-memory cache (module-scoped singleton)
var scanCache = { data: null, fetchedAt: 0 };

// Disk-Cache laden (sofort verfuegbar, kein Netzwerk noetig)
try {
  var diskData = JSON.parse(fs.readFileSync(JSONL_SCAN_DISK_CACHE, 'utf8'));
  if (diskData.data) {
    scanCache.data = diskData.data;
    scanCache.fetchedAt = diskData.fetchedAt || 0;
  }
} catch (error) { /* intentional — no cache yet */ }

/** Reload memory cache from disk (called by provider-notify route). */
function reloadFromDisk() {
  try {
    var raw = JSON.parse(fs.readFileSync(JSONL_SCAN_DISK_CACHE, 'utf8'));
    if (raw.data) {
      scanCache.data = raw.data;
      scanCache.fetchedAt = raw.fetchedAt || Date.now();
      return true;
    }
  } catch (error) { /* intentional */ }
  return false;
}

module.exports = {
  JSONL_SCAN_DISK_CACHE: JSONL_SCAN_DISK_CACHE,
  scanCache: scanCache,
  reloadFromDisk: reloadFromDisk
};
