/**
 * @asseris-module       Jsonl Agent
 * @asseris-description  Canonical runtime jsonl-agent implementation.
 * @asseris-pillar       sensor
 * @asseris-domain       agent-process
 * @asseris-stage        core
 */
/**
 * jsonl-agent.js — Standalone background agent for JSONL scanning.
 * Canonical path: apps/backend/runtime/jsonl-agent.js
 * Stage 16 hard-cut: root scripts wrapper removed.
 *
 * Runs independently of the dashboard server. Handles:
 *   - Periodic JSONL scan (fingerprint → worker thread → day cache)
 *   - Writes scan result to disk cache
 *   - Notifies dashboard via POST /api/provider-notify { source: 'jsonl' }
 *
 * This agent replaces the in-process scan that previously ran inside
 * dashboard-server.js. The dashboard becomes a pure HTTP/SSE server.
 *
 * Usage:
 *   node start.js                          (spawned automatically)
 *   node apps/backend/runtime/jsonl-agent.js
 *   node apps/backend/entrypoints/jsonl-agent.js
 *
 * Environment:
 *   CLAUDE_USAGE_DASHBOARD_URL             (default: http://localhost:3333)
 *   CLAUDE_USAGE_JSONL_AGENT_PORT          (default: 3335)
 *   CLAUDE_USAGE_SCAN_INTERVAL_SEC         (default: 180, min: 60)
 *   CLAUDE_USAGE_PARSE_START_DELAY_MS      (default: 2000)
 *   CLAUDE_USAGE_NO_CACHE                  (force full scan)
 */

var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');

var serviceLog = require('../infra/service-logger');

// ── Config ──────────────────────────────────────────────────────────────

var DASHBOARD_URL = process.env.CLAUDE_USAGE_DASHBOARD_URL || 'http://localhost:3333';
while (DASHBOARD_URL.endsWith('/')) DASHBOARD_URL = DASHBOARD_URL.slice(0, -1);
var AGENT_PORT = (function () {
  var raw = process.env.CLAUDE_USAGE_JSONL_AGENT_PORT;
  if (raw == null || String(raw).trim() === '') return 3335;
  var n = Number.parseInt(String(raw).trim(), 10);
  if (Number.isNaN(n) || n < 0 || n > 65535) return 3335;
  return n;
})();

var REFRESH_SEC = 180;
(function () {
  var e = process.env.CLAUDE_USAGE_SCAN_INTERVAL_SEC;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 60) REFRESH_SEC = n;
})();

var PARSE_START_DELAY_MS = 2000;
(function () {
  var e = process.env.CLAUDE_USAGE_PARSE_START_DELAY_MS;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 120000) PARSE_START_DELAY_MS = n;
})();

var SCAN_PARTIAL_EMIT_MIN_MS = 1500;
(function () {
  var e = process.env.CLAUDE_USAGE_SCAN_PARTIAL_MIN_MS;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 400 && n <= 60000) SCAN_PARTIAL_EMIT_MIN_MS = n;
})();

// ── Domain modules (same as dashboard-server.js used to load) ───────────

var usageScanRoots = require('../domain/usage/scan-roots');
var storagePaths = require('../domain/usage/storage-paths');
var HOME = usageScanRoots.HOME;
var collectTaggedJsonlFilesAsync = usageScanRoots.collectTaggedJsonlFilesAsync;
var buildSplitFingerprint = usageScanRoots.buildSplitFingerprint;
var scanRootsCacheKey = usageScanRoots.scanRootsCacheKey;
var forEachJsonlLineSync = usageScanRoots.forEachJsonlLineSync;
var displayPathForUi = require('../app/build-usage-snapshot').displayPathForUi;

var bucketsMod = require('../domain/usage/buckets');
var emptyDailyBucket = bucketsMod.emptyDailyBucket;

var dayCacheMod = require('../domain/usage/day-cache-schema');
var USAGE_DAY_CACHE_VERSION = dayCacheMod.USAGE_DAY_CACHE_VERSION;
var readUsageDayCache = dayCacheMod.readUsageDayCache;
var writeUsageDayCache = dayCacheMod.writeUsageDayCache;
var USAGE_DAY_CACHE_FILE = dayCacheMod.USAGE_DAY_CACHE_FILE;

var dayCacheStore = require('../infra/files/day-cache-store');
var JSONL_TODAY_INDEX_VERSION = dayCacheStore.JSONL_TODAY_INDEX_VERSION;
var JSONL_TODAY_INDEX_FILE = dayCacheStore.JSONL_TODAY_INDEX_FILE;
var TODAY_INDEX_DISABLED = dayCacheStore.TODAY_INDEX_DISABLED;
var readJsonlTodayIndexDisk = dayCacheStore.readJsonlTodayIndexDisk;

var usageSnapshot = require('../app/build-usage-snapshot');
var buildUsageResult = usageSnapshot.buildUsageResult;
var rowToDailyEntry = usageSnapshot.rowToDailyEntry;

var extractCache = require('../app/extract-cache');

// Enrichment: read from disk caches (written by provider-agent)
var outageClient = require('../infra/providers/outage-client');
var releasesClient = require('../infra/providers/github-releases-client');
var marketplaceClient = require('../infra/providers/marketplace-client');

var JSONL_STATE_DIR = storagePaths.stateDir();
var JSONL_SCAN_DISK_CACHE = path.join(JSONL_STATE_DIR, 'usage-dashboard-scan.json');
storagePaths.migrateLegacyFileIfMissing(JSONL_SCAN_DISK_CACHE, 'usage-dashboard-scan.json');

// ── Helpers ─────────────────────────────────────────────────────────────

function logOptionalErr(err) {
  serviceLog.debug('ignored', err?.message ? err.message : String(err));
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function localCalendarTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function buildDashboardStatePaths() {
  return {
    day_cache: displayPathForUi(USAGE_DAY_CACHE_FILE),
    jsonl_today_index: displayPathForUi(JSONL_TODAY_INDEX_FILE),
    extract_cache: displayPathForUi(extractCache.CACHE_FILE)
  };
}

// ── Stub cachedData (agent-local, not shared with dashboard) ────────────

var _lastScanResult = null;

function makeStubCachedData() {
  return {
    days: [],
    parsed_files: 0,
    generated: new Date().toISOString(),
    refresh_sec: REFRESH_SEC,
    scanning: true,
    calendar_today: localCalendarTodayStr()
  };
}

var cachedData = makeStubCachedData();

// ── Scan Orchestrator (same module, different wiring) ───────────────────

var scanOrchestrator = require('../app/usage-scan-orchestrator')({
  serviceLog: serviceLog,
  logOptionalErr: logOptionalErr,
  collectTaggedJsonlFilesAsync: collectTaggedJsonlFilesAsync,
  buildSplitFingerprint: buildSplitFingerprint,
  readUsageDayCache: readUsageDayCache,
  writeUsageDayCache: writeUsageDayCache,
  USAGE_DAY_CACHE_VERSION: USAGE_DAY_CACHE_VERSION,
  readJsonlTodayIndexDisk: readJsonlTodayIndexDisk,
  JSONL_TODAY_INDEX_VERSION: JSONL_TODAY_INDEX_VERSION,
  TODAY_INDEX_DISABLED: TODAY_INDEX_DISABLED,
  scanRootsCacheKey: scanRootsCacheKey,
  rowToDailyEntry: rowToDailyEntry,
  emptyDailyBucket: emptyDailyBucket,
  buildUsageResult: buildUsageResult,
  extractCache: extractCache,
  buildReleaseStabilityData: releasesClient.buildReleaseStabilityData,
  backfillReleaseBodiesForDashboardDays: releasesClient.backfillReleaseBodiesForDashboardDays,
  snapshotMarketplaceRowsForScan: marketplaceClient.snapshotMarketplaceRowsForScan,
  mergeMarketplaceRowsPreferNewer: marketplaceClient.mergeMarketplaceRowsPreferNewer,
  getOutageDaysMap: outageClient.getOutageDaysMap,
  applyExtensionVersionMarkers: marketplaceClient.applyExtensionVersionMarkers,
  enrichVersionChangeNotes: releasesClient.enrichVersionChangeNotes,
  getReleasesMap: releasesClient.getReleasesMap,
  outageCache: outageClient.outageCache,
  buildDashboardStatePaths: buildDashboardStatePaths,
  localCalendarTodayStr: localCalendarTodayStr,
  REFRESH_SEC: REFRESH_SEC,
  SCAN_PARTIAL_EMIT_MIN_MS: SCAN_PARTIAL_EMIT_MIN_MS,
  SCAN_WORKER_PATH: path.join(__dirname, '..', 'app', 'scan-worker.js'),
  makeStubCachedData: makeStubCachedData,
  getCachedData: function () { return cachedData; },
  setCachedData: function (d) { cachedData = d; },
  broadcastSse: function () {
    _broadcastSeq++;
    if (cachedData?.scan_progress) {
      _scanProgress = {
        done: cachedData.scan_progress.done || 0,
        total: cachedData.scan_progress.total || 0
      };
    }
  },
  refreshProxyCache: function () { /* no-op — proxy cache handled by dashboard */ },
  getProxyCache: function () { return { data: null }; },
  sessionTurnsService: null
});

var runScanAndBroadcast = scanOrchestrator.runScanAndBroadcast;

// ── Wrap scan: write disk cache + notify dashboard ──────────────────────

var _originalRunScan = runScanAndBroadcast;
var _broadcastSeq = 0;
var _scanInProgress = false;
var _scanProgress = null;
var _lastScanAt = null;
var _lastScanFiles = 0;

function runScanAndNotify() {
  if (String(process.env.ASSERIS_PRODUCT || '').toLowerCase() === 'dashboard') {
    try {
      if (!require('../app/product-setup').read()) {
        serviceLog.info('jsonl-agent', 'setup pending — scan not started');
        return;
      }
    } catch (error) {
      serviceLog.warn('jsonl-agent', 'setup state unavailable — scan not started');
      return;
    }
  }
  if (_scanInProgress) {
    serviceLog.info('jsonl-agent', 'scan already in progress — skipping');
    return;
  }
  _scanInProgress = true;
  _scanProgress = { done: 0, total: 0 };
  serviceLog.info('jsonl-agent', 'starting scan');

  // broadcastSse() is called twice by the orchestrator:
  //   1st: after scan parse completes (scanInProgress=false)
  //   2nd: after GitHub backfill enriches release data
  // We wait for the 2nd call so the disk cache includes enriched data.
  var seqAtStart = _broadcastSeq;
  var scanStartedAt = Date.now();

  _originalRunScan();

  // Wait for scan completion + backfill (2 broadcastSse calls)
  var pollInterval = setInterval(function () {
    if (scanOrchestrator.isScanInProgress()) return;
    // After scan completes, wait for 2nd broadcast (backfill done) or timeout
    // Skip backfill wait if no days — backfill never runs with 0 days
    var broadcasts = _broadcastSeq - seqAtStart;
    var noData = !(cachedData?.days?.length);
    serviceLog.debug('jsonl-agent', 'poll: broadcasts=' + broadcasts + ' noData=' + noData + ' elapsed=' + (Date.now() - scanStartedAt) + 'ms');
    if (!noData && broadcasts < 2) {
      // Backfill still running — but cap wait at 30s
      if (Date.now() - scanStartedAt > 30000) {
        serviceLog.info('jsonl-agent', 'backfill wait timeout — notifying with current data');
      } else {
        return;
      }
    }
    clearInterval(pollInterval);
    _scanInProgress = false;
    _scanProgress = null;

    var result = cachedData;
    _lastScanAt = Date.now();
    _lastScanFiles = result?.parsed_files || 0;

    if (!result?.days?.length) {
      // No data yet (init-sync pending) — write empty cache to disk so reloadFromDisk() succeeds,
      // then notify dashboard so agent_pending is cleared and init-sync splash appears.
      try {
        var dir0 = path.dirname(JSONL_SCAN_DISK_CACHE);
        if (!fs.existsSync(dir0)) fs.mkdirSync(dir0, { recursive: true });
        var emptyCache = result || { days: [], parsed_files: 0, scanning: false };
        emptyCache.scanning = false;
        fs.writeFileSync(JSONL_SCAN_DISK_CACHE, JSON.stringify({ data: emptyCache, fetchedAt: _lastScanAt }), 'utf8');
        serviceLog.info('jsonl-agent', 'scan done — 0 days, empty cache written, notifying dashboard for init-sync state');
      } catch (error_) {
        serviceLog.warn('jsonl-agent', 'scan done — 0 days, disk write failed: ' + (error_.message || error_));
      }
      notifyDashboard();
      return;
    }

    var daysLen = result.days.length;

    // Write to disk cache
    try {
      var dir = path.dirname(JSONL_SCAN_DISK_CACHE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(JSONL_SCAN_DISK_CACHE, JSON.stringify({
        data: result,
        fetchedAt: _lastScanAt
      }), 'utf8');
      serviceLog.info('jsonl-agent', 'scan done days=' + daysLen + ' files=' + _lastScanFiles + ' disk=' + JSONL_SCAN_DISK_CACHE);
    } catch (we) {
      serviceLog.error('jsonl-agent', 'disk write failed: ' + (we.message || we));
    }

    notifyDashboard();
  }, 200);
}

// ── Notify Dashboard ────────────────────────────────────────────────────

var { notifyDashboard: _notifyDashboard } = require('../infra/notify-dashboard');
var isSameOriginRequest = require('../server/security-headers').isSameOriginRequest;

function notifyDashboard() {
  _notifyDashboard(DASHBOARD_URL, 'jsonl', serviceLog);
}

// ── HTTP Server (trigger + status) ──────────────────────────────────────

var agentServer = http.createServer(function (req, res) {
  var responseHeaders = { 'Content-Type': 'application/json' };
  if (!isSameOriginRequest(req)) {
    res.writeHead(403, responseHeaders);
    res.end(JSON.stringify({ ok: false, error: 'cross_origin_request_rejected' }));
    return;
  }

  if (req.url === '/trigger' && req.method === 'POST') {
    serviceLog.info('jsonl-agent', 'trigger received — starting scan');
    res.writeHead(200, responseHeaders);
    res.end(JSON.stringify({ ok: true, message: 'scan_triggered' }));
    runScanAndNotify();
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, responseHeaders);
    res.end(JSON.stringify({
      ok: true,
      agent: 'jsonl-agent',
      dashboard: DASHBOARD_URL,
      scan_in_progress: _scanInProgress,
      scan_progress: _scanProgress,
      last_scan: _lastScanAt ? new Date(_lastScanAt).toISOString() : null,
      last_scan_files: _lastScanFiles,
      interval_sec: REFRESH_SEC
    }));
    return;
  }

  res.writeHead(404, responseHeaders);
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});
agentServer.on('error', function (err) {
  serviceLog.error('jsonl-agent', 'server error: ' + (err?.code || '') + ' ' + (err?.message || err));
  process.exit(1);
});

// ── Startup ─────────────────────────────────────────────────────────────

serviceLog.info('jsonl-agent', 'starting');
serviceLog.info('jsonl-agent', 'dashboard: ' + DASHBOARD_URL);
serviceLog.info('jsonl-agent', 'agent port: ' + AGENT_PORT);
serviceLog.info('jsonl-agent', 'interval: ' + REFRESH_SEC + 's');
serviceLog.info('jsonl-agent', 'parse start delay: ' + PARSE_START_DELAY_MS + 'ms');

agentServer.listen(AGENT_PORT, '127.0.0.1', function () {
  serviceLog.info('jsonl-agent', 'listening on http://127.0.0.1:' + AGENT_PORT + ' (POST /trigger, GET /status)');
});

// Initial scan + recurring
setTimeout(runScanAndNotify, PARSE_START_DELAY_MS);
setInterval(runScanAndNotify, REFRESH_SEC * 1000);

serviceLog.info('jsonl-agent', 'running — Ctrl+C to stop');
