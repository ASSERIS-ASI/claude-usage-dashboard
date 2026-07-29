/**
 * @asseris-module       Dashboard Server
 * @asseris-description  Module-level annotation placeholder for Dashboard Server.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-core
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 */
// Claude Code Token Usage Dashboard — standalone, zero runtime dependencies.
// Usage: node dashboard.js [--port=3333] [--refresh=SECONDS] [--no-cache]
// --refresh = voller Daten-Scan + SSE (Standard 180s, Minimum 60s). Kurze Werte lesen alle JSONL unnötig oft neu ein.
// CLAUDE_USAGE_WALK_SLICE=N (5–500): größer = schnellere Projektbaum-Ermittlung, kleiner = responsiver direkt nach Start (Default 40 readdir/Tick).
// Tages-Cache: derived state directory (Vortage). Bei passender jsonl-Anzahl nur noch „heute“ aus JSONL.
// Vollscan erzwingen: CLAUDE_USAGE_NO_CACHE=1  oder  Cache-Datei löschen / neue .jsonl-Datei ändert die Anzahl.
// full_jsonl-Grund im Log: siehe scan-Zeile "day_cache_miss …". Identischen JSONL-Scan (Fingerprint mtime+size) standardmaessig ueberspringen wenn unveraendert — sonst bei vielen .jsonl Dauer-„Loading …/N“ + hohe Last. Abschalten: CLAUDE_USAGE_SKIP_IDENTICAL_SCAN=0
// Marketplace POST-Timeout ms: CLAUDE_USAGE_MARKETPLACE_TIMEOUT_MS (3000-120000, Default 12000).
// Backfill-Pause zwischen GitHub-Release-Tags ms: CLAUDE_USAGE_GITHUB_BACKFILL_DELAY_MS (0-5000, Default 0).
// Session-turns Disk-Cache (optional): CLAUDE_USAGE_SESSION_TURNS_CACHE_DIR=~/.cache/…  — JSON {fingerprint,result} pro Tag;
//   vorab füllen: python3 ops/scripts/quality/session-turns-warm-cache.py --out-dir …

var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var serviceLog = require('./infra/service-logger');
var serverHelpers = require('./app/server-helpers');
/** Sonar S2486: every catch must reference the exception (non-empty handling). */
function logOptionalErr(err) {
  serviceLog.debug('ignored', err?.message ? err.message : String(err));
}

var gitExecFileTrimmed = serverHelpers.gitExecFileTrimmed;
var __appVersion = (function () {
  return serverHelpers.resolveAppVersion(path.join(__dirname, '..', '..'));
})();
var dashboardHttp = require('./server/dashboard-http');
var usageScanRoots = require('./domain/usage/scan-roots');
var HOME = usageScanRoots.HOME;
var BASE = usageScanRoots.BASE;
var getScanRoots = usageScanRoots.getScanRoots;
var scanRootsCacheKey = usageScanRoots.scanRootsCacheKey;
var walkJsonl = usageScanRoots.walkJsonl;
var collectTaggedJsonlFiles = usageScanRoots.collectTaggedJsonlFiles;
var buildTaggedJsonlFingerprintSync = usageScanRoots.buildTaggedJsonlFingerprintSync;
var buildSplitFingerprint = usageScanRoots.buildSplitFingerprint;
var collectTaggedJsonlFilesAsync = usageScanRoots.collectTaggedJsonlFilesAsync;
var forEachJsonlLineSync = usageScanRoots.forEachJsonlLineSync;
var sessionTurnsCore = require('./domain/usage/session-turns-core');
var benchmarkSessionTurns = require('./app/benchmark-session-turns');
var extractCache = require('./app/extract-cache');
var proxyNdjsonParser = require('./app/proxy-ndjson-parser');
// __extractCache, __extractCacheLoaded: owned by usage-scan-orchestrator.js (Phase 12b)
var getProxyLogDir = usageScanRoots.getProxyLogDir;
var collectProxyNdjsonFiles = usageScanRoots.collectProxyNdjsonFiles;
var hitLimitMod = require('./domain/usage/hit-limit');
var scanLineHitLimit = hitLimitMod.scanLineHitLimit;
var CACHE_READ_FORENSIC_THRESH = hitLimitMod.CACHE_READ_FORENSIC_THRESH;
var sessionSignalsMod = require('./domain/usage/session-signals');
var emptySessionSignals = sessionSignalsMod.emptySessionSignals;
var bumpSessionSignals = sessionSignalsMod.bumpSessionSignals;
var bumpHourSessionSignals = sessionSignalsMod.bumpHourSessionSignals;
var mergeHourSignalsInto = sessionSignalsMod.mergeHourSignalsInto;
var classifyJsonlSessionSignals = sessionSignalsMod.classifyJsonlSessionSignals;
var bucketsMod = require('./domain/usage/buckets');
var emptySecurityPostures = bucketsMod.emptySecurityPostures;
var mergeSecurityPosturesInto = bucketsMod.mergeSecurityPosturesInto;
var emptyVersionStats = bucketsMod.emptyVersionStats;
var emptyHostSlice = bucketsMod.emptyHostSlice;
var emptyDailyBucket = bucketsMod.emptyDailyBucket;
var mergeHoursInto = bucketsMod.mergeHoursInto;
var mergeTopSessionSignalsInto = bucketsMod.mergeTopSessionSignalsInto;
var mergeHostSliceInto = bucketsMod.mergeHostSliceInto;
var mergeStopReasons = bucketsMod.mergeStopReasons;
var mergeEntrypointsInto = bucketsMod.mergeEntrypointsInto;
var mergeVersionStatsInto = bucketsMod.mergeVersionStatsInto;
var mergeDayBucketInto = bucketsMod.mergeDayBucketInto;
var dayCacheMod = require('./domain/usage/day-cache-schema');
var USAGE_DAY_CACHE_VERSION = dayCacheMod.USAGE_DAY_CACHE_VERSION;
var USAGE_DAY_CACHE_FILE = dayCacheMod.USAGE_DAY_CACHE_FILE;
var readUsageDayCache = dayCacheMod.readUsageDayCache;
var writeUsageDayCache = dayCacheMod.writeUsageDayCache;
var forensicsMod = require('./domain/usage/forensics');
var computeForensicForDay = forensicsMod.computeForensicForDay;
var usageSnapshot = require('./app/build-usage-snapshot');
var processJsonlFile = usageSnapshot.processJsonlFile;
var targetDayBucket = usageSnapshot.targetDayBucket;
var buildUsageResult = usageSnapshot.buildUsageResult;
var hostSliceToApi = usageSnapshot.hostSliceToApi;
var hostSliceFromRow = usageSnapshot.hostSliceFromRow;
var rowToDailyEntry = usageSnapshot.rowToDailyEntry;
var normalizeCliSemver = usageSnapshot.normalizeCliSemver;
var semverCmp = usageSnapshot.semverCmp;
var extractCliVersion = usageSnapshot.extractCliVersion;
var extractEntrypoint = usageSnapshot.extractEntrypoint;
var isClaudeModel = usageSnapshot.isClaudeModel;
var unionHourKeyCount = usageSnapshot.unionHourKeyCount;
var displayPathForUi = usageSnapshot.displayPathForUi;
var displayScannedFileLine = usageSnapshot.displayScannedFileLine;
var applyJsonlGapVersionChanges = usageSnapshot.applyJsonlGapVersionChanges;
var buildLimitSourceNote = usageSnapshot.buildLimitSourceNote;
var buildLimitSourceNoteEn = usageSnapshot.buildLimitSourceNoteEn;
var classifySecurityPosture = usageSnapshot.classifySecurityPosture;
var bumpSecurityPostures = usageSnapshot.bumpSecurityPostures;
var parseAllUsageSync = usageSnapshot.parseAllUsageSync;
var proxySnapshot = require('./app/build-proxy-snapshot');
var dayCacheStore = require('./infra/files/day-cache-store');
var JSONL_TODAY_INDEX_VERSION = dayCacheStore.JSONL_TODAY_INDEX_VERSION;
var JSONL_TODAY_INDEX_FILE = dayCacheStore.JSONL_TODAY_INDEX_FILE;
var TODAY_INDEX_DISABLED = dayCacheStore.TODAY_INDEX_DISABLED;
var readJsonlTodayIndexDisk = dayCacheStore.readJsonlTodayIndexDisk;
var writeJsonlTodayIndexDisk = dayCacheStore.writeJsonlTodayIndexDisk;
var invalidateJsonlTodayIndexDisk = dayCacheStore.invalidateJsonlTodayIndexDisk;
var layoutStore = require('./infra/files/layout-store');
var outageClient = require('./infra/providers/outage-client');
var outageCache = outageClient.outageCache;
var getOutageDaysMap = outageClient.getOutageDaysMap;
var releasesClient = require('./infra/providers/github-releases-client');
var releasesCache = releasesClient.releasesCache;
var RELEASES_CACHE = releasesClient.RELEASES_CACHE;
var syncGithubTokenFromBrowserRequest = releasesClient.syncGithubTokenFromBrowserRequest;
var githubApiRequestHeaders = releasesClient.githubApiRequestHeaders;
var isSafeGithubReleaseTagParam = releasesClient.isSafeGithubReleaseTagParam;
var persistReleasesCacheToDisk = releasesClient.persistReleasesCacheToDisk;
var httpsFetchGithubReleaseByTag = releasesClient.httpsFetchGithubReleaseByTag;
var backfillReleaseBodiesForDashboardDays = releasesClient.backfillReleaseBodiesForDashboardDays;
var refreshReleasesCache = releasesClient.refreshReleasesCache;
var shouldFetchGithubReleasesFromNetwork = releasesClient.shouldFetchGithubReleasesFromNetwork;
var maybeRefreshReleasesCacheOnStartup = releasesClient.maybeRefreshReleasesCacheOnStartup;
var getReleasesMap = releasesClient.getReleasesMap;
var enrichVersionChangeNotes = releasesClient.enrichVersionChangeNotes;
var buildReleaseStabilityData = releasesClient.buildReleaseStabilityData;
var buildGitHubVersionTimelineItems = releasesClient.buildGitHubVersionTimelineItems;
var isoToUtcYmd = releasesClient.isoToUtcYmd;
var isoToLocalYmd = releasesClient.isoToLocalYmd;
var jsonlClient = require('./infra/providers/jsonl-client');
var marketplaceClient = require('./infra/providers/marketplace-client');
var MARKETPLACE_CACHE = marketplaceClient.MARKETPLACE_CACHE;
var marketplaceVersionsCache = marketplaceClient.marketplaceVersionsCache;
var snapshotMarketplaceRowsForScan = marketplaceClient.snapshotMarketplaceRowsForScan;
var mergeMarketplaceRowsPreferNewer = marketplaceClient.mergeMarketplaceRowsPreferNewer;
var applyExtensionVersionMarkers = marketplaceClient.applyExtensionVersionMarkers;
var buildExtensionTimelineApiResponse = marketplaceClient.buildExtensionTimelineApiResponse;
// Route modules: loaded by apps/backend/server/index.js

// __lastScanJsonlFingerprint, __lastStableFingerprint, __lastVolatileFingerprint:
// owned by usage-scan-orchestrator.js (Phase 12b)

var PORT = 3333;
var HOST = process.env.CLAUDE_USAGE_HOST || '127.0.0.1';
var REFRESH_SEC = 180;
(function () {
  var e = process.env.CLAUDE_USAGE_SCAN_INTERVAL_SEC;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 60) REFRESH_SEC = n;
})();
/** Erster JSONL-Scan erst nach dieser Verzögerung (ms), wenn Shell+Assets vorgeladen sind — damit Browser zuerst HTML/CSS/JS bedienen kann. 0–120000, Default 2000. */
var PARSE_START_DELAY_MS = 2000;
(function () {
  var e = process.env.CLAUDE_USAGE_PARSE_START_DELAY_MS;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 120000) PARSE_START_DELAY_MS = n;
})();
process.argv.forEach(function(a) {
  var m = a.match(/--port=(\d+)/);
  if (m) PORT = Number.parseInt(m[1]);
  var h = a.match(/--host=(.+)$/);
  if (h) HOST = h[1].trim();
  var r = a.match(/--refresh=(\d+)/);
  if (r) REFRESH_SEC = Math.max(60, Number.parseInt(r[1]));
  var lv = a.match(/--log-level=(.+)$/);
  if (lv) process.env.CLAUDE_USAGE_LOG_LEVEL = lv[1].trim();
  var lf = a.match(/--log-file=(.+)$/);
  if (lf) process.env.CLAUDE_USAGE_LOG_FILE = lf[1].trim();
  if (a === '--no-cache') process.env.CLAUDE_USAGE_NO_CACHE = '1';
});
serviceLog.refreshFromEnv();

// ── Outage disk cache path (used in state-paths display + deps) ──────────
var OUTAGE_DISK_CACHE = outageClient.OUTAGE_DISK_CACHE;

// SCAN_FILES_PER_TICK, SCAN_PARTIAL_EMIT_MIN_MS: moved to app/usage-scan-orchestrator.js (Phase 19)

var localCalendarTodayStr = serverHelpers.localCalendarTodayStr;
function buildDashboardStatePaths() {
  return serverHelpers.buildDashboardStatePaths({
    day_cache: USAGE_DAY_CACHE_FILE,
    jsonl_today_index: JSONL_TODAY_INDEX_FILE,
    extract_cache: extractCache.CACHE_FILE,
    releases: RELEASES_CACHE,
    marketplace: MARKETPLACE_CACHE,
    outage: OUTAGE_DISK_CACHE
  }, displayPathForUi);
}

var DASHBOARD_SCRIPT_DIR = path.join(__dirname, '..', '..');

// ── HTML/Template Build (Phase 12a: extracted to apps/backend/server/html/dashboard-html.js) ──
var htmlService = require('./server/html/dashboard-html')({
  DASHBOARD_SCRIPT_DIR: DASHBOARD_SCRIPT_DIR,
  serviceLog: serviceLog,
  logOptionalErr: logOptionalErr,
  gitExecFileTrimmed: gitExecFileTrimmed,
  buildLimitSourceNote: buildLimitSourceNote,
  buildLimitSourceNoteEn: buildLimitSourceNoteEn,
  localCalendarTodayStr: localCalendarTodayStr,
  buildDashboardStatePaths: buildDashboardStatePaths,
  REFRESH_SEC: REFRESH_SEC
});
var getDashboardHtml = htmlService.getDashboardHtml;
var buildI18nBundles = htmlService.buildI18nBundles;
var makeStubCachedData = htmlService.makeStubCachedData;


// ── Live Data Cache + SSE ────────────────────────────────────────────────

var cachedData = makeStubCachedData();
var sseClients = [];

// ── Cache Update Service (Phase 19: extracted to app/cache-update-service.js) ──
// Instantiated after proxyCacheService + sessionTurnsService (see below).
// Provides: broadcastSse, _onOutageFetched, applyJsonlScanCache and
//           reapplyExtensionMarkersOnCachedDataAndBroadcast
var cacheUpdateService; // forward declaration — initialized after service deps are ready
var broadcastSse, _onOutageFetched, applyJsonlScanCache, reapplyExtensionMarkersOnCachedDataAndBroadcast;

// ── Service initialization ────────────────────────────────────────────
var sessionTurnsService = require('./app/session-turns-service')({
  serviceLog: serviceLog,
  logOptionalErr: logOptionalErr,
  sessionTurnsCore: sessionTurnsCore,
  collectTaggedJsonlFiles: collectTaggedJsonlFiles,
  buildTaggedJsonlFingerprintSync: buildTaggedJsonlFingerprintSync,
  forEachJsonlLineSync: forEachJsonlLineSync,
  usageScanRoots: usageScanRoots,
  getExtractCache: function () { return scanOrchestrator ? scanOrchestrator.getExtractCache() : { cache: null, loaded: false }; }
});

// ── Proxy Cache Service (extracted from dashboard-server.js) ─────────
var parseProxyNdjsonFiles = proxyNdjsonParser.parseProxyNdjsonFiles;
var computeQ5Consumption = proxyNdjsonParser.computeQ5Consumption;
var computeCutImpacts = proxyNdjsonParser.computeCutImpacts;

// ── Proxy Day Cache (immutable per-day aggregates, session-turns pattern) ──
var proxyDayCacheService = require('./app/proxy-day-cache-service')({
  serviceLog: serviceLog,
  logOptionalErr: logOptionalErr,
  parseProxyNdjsonFiles: parseProxyNdjsonFiles,
  collectProxyNdjsonFiles: collectProxyNdjsonFiles,
  filterProxyFilesForDateRange: usageScanRoots.filterProxyFilesForDateRange,
  buildTaggedJsonlFingerprintSync: buildTaggedJsonlFingerprintSync,
  getProxyLogDir: usageScanRoots.getProxyLogDir,
  expandUserPath: usageScanRoots.expandUserPath
});
// Opt-in swap of the periodic window parse onto the day cache (PROXY_DAY_CACHE=1).
// Flip to default-on after parity bake-in.
var __useProxyDayCacheParse = process.env.PROXY_DAY_CACHE === '1';

var proxyCacheService = require('./app/proxy-cache-service')({
  serviceLog: serviceLog,
  parseProxyNdjsonFiles: __useProxyDayCacheParse
    ? proxyDayCacheService.parseProxyWindowCached
    : parseProxyNdjsonFiles,
  // Offload the FULL ndjson parse to a worker thread — it blocked the event loop and made
  // the dashboard :3333 unresponsive (readiness/Traefik timeouts → 502). The cheap day-cache
  // tail parser stays synchronous (null worker path → sync).
  proxyParseWorkerPath: __useProxyDayCacheParse
    ? null
    : path.join(__dirname, 'app', 'proxy-parse-worker.js')
});
var refreshProxyCache = proxyCacheService.refreshProxyCache;
var __proxyCache = proxyCacheService;

// ── Cache Update Service (extracted Phase 19) ──────────────────────────
cacheUpdateService = require('./app/cache-update-service')({
  serviceLog: serviceLog,
  getOutageDaysMap: getOutageDaysMap,
  buildReleaseStabilityData: buildReleaseStabilityData,
  getCachedData: function () { return cachedData; },
  setCachedData: function (d) { cachedData = d; },
  getSseClients: function () { return sseClients; },
  refreshProxyCache: function () { refreshProxyCache(); },
  getProxyCache: function () { return __proxyCache; },
  scanOrchestrator: null, // set after scanOrchestrator is created
  applyExtensionVersionMarkers: applyExtensionVersionMarkers,
  applyJsonlGapVersionChanges: applyJsonlGapVersionChanges,
  enrichVersionChangeNotes: enrichVersionChangeNotes
});
broadcastSse = cacheUpdateService.broadcastSse;
_onOutageFetched = cacheUpdateService.onOutageFetched;
applyJsonlScanCache = cacheUpdateService.applyJsonlScanCache;
reapplyExtensionMarkersOnCachedDataAndBroadcast = cacheUpdateService.reapplyExtensionMarkers;

// The worker-based proxy parse lands asynchronously — synchronous callers attach the
// last-good snapshot; when the worker completes, re-attach the fresh snapshot to
// cachedData and rebroadcast so the proxy view is current one cycle later.
proxyCacheService._setOnRefreshed(function () {
  var pc = proxyCacheService.getProxyCache();
  if (pc && pc.data && cachedData) cachedData.proxy = pc.data;
  if (typeof broadcastSse === 'function') broadcastSse();
});

var scanOrchestrator = require('./app/usage-scan-orchestrator')({
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
  buildReleaseStabilityData: buildReleaseStabilityData,
  backfillReleaseBodiesForDashboardDays: backfillReleaseBodiesForDashboardDays,
  snapshotMarketplaceRowsForScan: snapshotMarketplaceRowsForScan,
  mergeMarketplaceRowsPreferNewer: mergeMarketplaceRowsPreferNewer,
  getOutageDaysMap: getOutageDaysMap,
  applyExtensionVersionMarkers: applyExtensionVersionMarkers,
  enrichVersionChangeNotes: enrichVersionChangeNotes,
  getReleasesMap: getReleasesMap,
  outageCache: outageCache,
  buildDashboardStatePaths: buildDashboardStatePaths,
  localCalendarTodayStr: localCalendarTodayStr,
  REFRESH_SEC: REFRESH_SEC,
  SCAN_WORKER_PATH: path.join(__dirname, 'app', 'scan-worker.js'),
  makeStubCachedData: makeStubCachedData,
  getCachedData: function () { return cachedData; },
  setCachedData: function (d) { cachedData = d; },
  broadcastSse: broadcastSse,
  refreshProxyCache: function () { refreshProxyCache(); },
  getProxyCache: function () { return __proxyCache; },
  sessionTurnsService: sessionTurnsService
});
var runScanAndBroadcast = scanOrchestrator.runScanAndBroadcast;
// Wire scanOrchestrator back into cacheUpdateService (circular dep resolved via late binding)
cacheUpdateService._setScanOrchestrator(scanOrchestrator);

var debugCacheService = require('./app/debug-cache-service')({
  logOptionalErr: logOptionalErr,
  collectTaggedJsonlFiles: collectTaggedJsonlFiles,
  collectProxyNdjsonFiles: collectProxyNdjsonFiles,
  collectCacheFixUsageFiles: function () {
    return require('./app/cache-fix-usage-adapter').collect(process.env, HOME);
  },
  displayPathForUi: displayPathForUi,
  extractCache: extractCache,
  USAGE_DAY_CACHE_FILE: USAGE_DAY_CACHE_FILE,
  JSONL_TODAY_INDEX_FILE: JSONL_TODAY_INDEX_FILE,
  RELEASES_CACHE: RELEASES_CACHE,
  OUTAGE_DISK_CACHE: OUTAGE_DISK_CACHE,
  MARKETPLACE_CACHE: MARKETPLACE_CACHE,
  resolveSessionTurnsCacheDir: sessionTurnsService.resolveSessionTurnsCacheDir
});
var collectDebugCacheFilesPayload = debugCacheService.collectDebugCacheFilesPayload;
var debugPathAllowedForRead = debugCacheService.debugPathAllowedForRead;

/**
 * Nach listen: Dashboard-HTML cachen, CSS/JS einmal async einlesen.
 * JSONL-Scan laeuft jetzt im jsonl-agent — Dashboard laedt nur den Disk-Cache.
 */
function primeDashboardAndScheduleFirstScan() {
  try {
    getDashboardHtml();
  } catch (primeErr) {
    serviceLog.warn(
      'server',
      'dashboard prime: ' + (primeErr?.message ? primeErr.message : String(primeErr))
    );
  }
  // Pre-warm asset reads (non-blocking)
  fs.readFile(path.join(DASHBOARD_SCRIPT_DIR, 'public', 'css', 'dashboard.css'), 'utf8', function () {});
  fs.readFile(path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'dashboard.client.js'), 'utf8', function () {});
  // Load JSONL scan from disk cache (jsonl-agent may have run before dashboard)
  if (jsonlClient.reloadFromDisk() && jsonlClient.scanCache.data) {
    applyJsonlScanCache(jsonlClient.scanCache);
    serviceLog.info('jsonl', 'scan loaded from disk cache (' + (jsonlClient.scanCache.data?.days?.length || 0) + ' days)');
  } else {
    serviceLog.info('jsonl', 'no scan disk cache — waiting for jsonl-agent');
    cachedData.agent_pending = true;
    broadcastSse();
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────


/** One log record (one timestamp); body lines follow on newlines without repeated prefixes. */
function logBenchmarkReportBlock(reportText) {
  serviceLog.info('session-turns-bench', reportText);
}

var quotaDivisor = require('./domain/usage/quota-divisor');
var createQuotaDivisorLineProcessor = quotaDivisor.createQuotaDivisorLineProcessor;
var calendarPrevDateYmd = quotaDivisor.calendarPrevDateYmd;
var q5CarryoverTotalsFromPairs = quotaDivisor.q5CarryoverTotalsFromPairs;

// ── Route module registration ──
var deps;
(function registerRouteModules() {
  deps = {
    // Core server state
    getCachedData: function () { return cachedData; },
    sseClients: sseClients,
    broadcastSse: broadcastSse,
    serviceLog: serviceLog,
    logOptionalErr: logOptionalErr,

    // Stores & clients
    layoutStore: layoutStore,
    releasesClient: releasesClient,
    marketplaceClient: marketplaceClient,

    // Server orchestration functions
    reapplyExtensionMarkersOnCachedDataAndBroadcast: reapplyExtensionMarkersOnCachedDataAndBroadcast,
    runScanAndBroadcast: runScanAndBroadcast,
    refreshProxyCache: refreshProxyCache,
    getProxyCache: function () { return __proxyCache; },
    getLastJsonlScanCompletedAt: scanOrchestrator.getLastJsonlScanCompletedAt,
    resetScanFingerprints: scanOrchestrator.resetScanFingerprints,

    // Usage modules
    buildExtensionTimelineApiResponse: buildExtensionTimelineApiResponse,
    buildI18nBundles: buildI18nBundles,
    collectProxyNdjsonFiles: collectProxyNdjsonFiles,
    collectTaggedJsonlFiles: collectTaggedJsonlFiles,
    forEachJsonlLineSync: forEachJsonlLineSync,
    buildTaggedJsonlFingerprintSync: buildTaggedJsonlFingerprintSync,
    buildSplitFingerprint: buildSplitFingerprint,
    displayPathForUi: displayPathForUi,
    USAGE_DAY_CACHE_FILE: USAGE_DAY_CACHE_FILE,
    JSONL_TODAY_INDEX_FILE: JSONL_TODAY_INDEX_FILE,

    // Quota-divisor + session-turns helpers
    createQuotaDivisorLineProcessor: createQuotaDivisorLineProcessor,
    calendarPrevDateYmd: calendarPrevDateYmd,
    q5CarryoverTotalsFromPairs: q5CarryoverTotalsFromPairs,
    getSessionTurnsCached: sessionTurnsService.getSessionTurnsCached,
    _sessionTurnsCache: sessionTurnsService._sessionTurnsCache,
    populateSessionTurnsCacheForDates: sessionTurnsService.populateSessionTurnsCacheForDates,

    // Date-range queries (Grafana-style picker)
    proxyDayCacheService: proxyDayCacheService,
    // Debug-specific deps
    collectDebugCacheFilesPayload: collectDebugCacheFilesPayload,
    debugPathAllowedForRead: debugPathAllowedForRead,
    REFRESH_SEC: REFRESH_SEC,
    __appVersion: __appVersion,
    benchmarkSessionTurns: benchmarkSessionTurns,
    logBenchmarkReportBlock: logBenchmarkReportBlock,
    DEBUG_CACHE_FILE_VIEW_MAX_BYTES: debugCacheService.DEBUG_CACHE_FILE_VIEW_MAX_BYTES,
    rbac: null
  };

  deps.__deps_built = true;
})();

// ── HTTP Server (composition root in apps/backend/server/index.js) ──
var serverModule = require('./server/index');
var server = serverModule.createServer({
  deps: deps,
  dashboardHttp: dashboardHttp,
  DASHBOARD_SCRIPT_DIR: DASHBOARD_SCRIPT_DIR,
  syncGithubTokenFromBrowserRequest: syncGithubTokenFromBrowserRequest,
  serviceLog: serviceLog,
  getDashboardHtml: getDashboardHtml,
  providerRouteDeps: {
    serviceLog: serviceLog,
    outageClient: outageClient,
    releasesClient: releasesClient,
    marketplaceClient: marketplaceClient,
    jsonlClient: jsonlClient,
    onOutageReloaded: _onOutageFetched,
    onReleasesReloaded: function () {
      enrichVersionChangeNotes(cachedData?.days || []);
      broadcastSse();
    },
    onMarketplaceReloaded: function () {
      reapplyExtensionMarkersOnCachedDataAndBroadcast('provider_agent_notify');
    },
    onJsonlReloaded: function (cache) {
      applyJsonlScanCache(cache);
    }
  }
});

server.listen(PORT, HOST, function () {
  serviceLog.info('dashboard-server', 'Claude Usage Dashboard running at http://' + HOST + ':' + PORT);
  serviceLog.info('dashboard-server', 'Voller Scan alle ' + REFRESH_SEC + 's (--refresh=N, min 60; oder CLAUDE_USAGE_SCAN_INTERVAL_SEC)');
  serviceLog.info('dashboard-server', 'Erster Scan startet nach Dashboard-Vorlauf +' + PARSE_START_DELAY_MS + ' ms (CLAUDE_USAGE_PARSE_START_DELAY_MS); danach inkrementell per SSE.');
  serviceLog.info('boot', 'Press Ctrl+C to stop.');
  serviceLog.info(
    'server',
    'listen port=' +
      PORT +
      ' host=' +
      HOST +
      ' refresh_sec=' +
      REFRESH_SEC +
      ' parse_start_delay_ms=' +
      PARSE_START_DELAY_MS +
      ' log_level=' +
      (process.env.CLAUDE_USAGE_LOG_LEVEL || 'info') +
      (process.env.CLAUDE_USAGE_LOG_FILE ? ' log_file=' + process.env.CLAUDE_USAGE_LOG_FILE : '')
  );
  primeDashboardAndScheduleFirstScan();
  // Provider fetches delegated to provider-agent; disk caches load locally.
  serviceLog.info('providers', 'external metadata fetches delegated to provider-agent');
});

setInterval(refreshProxyCache, REFRESH_SEC * 1000);
