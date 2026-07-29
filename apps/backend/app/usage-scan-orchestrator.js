'use strict';
/**
 * @asseris-module       Usage Scan Orchestrator
 * @asseris-description  Incremental JSONL scan engine — fingerprint-based skip tiers,
 *                       worker-thread dispatch, day-cache management, extract-cache sync.
 *                       Owns the pipeline from "files on disk" → "snapshot ready".
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Scan Worker, Day Cache Store, Extract Cache, Build Usage Snapshot
 * @asseris-called-by    Dashboard Server, JSONL Agent
 * @asseris-emits        usage snapshot via callback, day-cache writes, extract-cache writes
 * @asseris-consumes     tagged JSONL file list, day-cache and extract-cache files
 *
 * Extracted from dashboard-server.js as part of Phase 12b modularization.
 *
 * Usage:
 *   var scanOrchestrator = require('./usage-scan-orchestrator')(opts);
 */
var path = require('path');

module.exports = function createUsageScanOrchestrator(opts) {
  var serviceLog               = opts.serviceLog;
  var logOptionalErr           = opts.logOptionalErr;
  var collectTaggedJsonlFilesAsync = opts.collectTaggedJsonlFilesAsync;
  var buildSplitFingerprint    = opts.buildSplitFingerprint;
  var readUsageDayCache        = opts.readUsageDayCache;
  var writeUsageDayCache       = opts.writeUsageDayCache;
  var USAGE_DAY_CACHE_VERSION  = opts.USAGE_DAY_CACHE_VERSION;
  var readJsonlTodayIndexDisk  = opts.readJsonlTodayIndexDisk;
  var JSONL_TODAY_INDEX_VERSION = opts.JSONL_TODAY_INDEX_VERSION;
  var TODAY_INDEX_DISABLED     = opts.TODAY_INDEX_DISABLED;
  var scanRootsCacheKey        = opts.scanRootsCacheKey;
  var rowToDailyEntry          = opts.rowToDailyEntry;
  var emptyDailyBucket         = opts.emptyDailyBucket;
  var buildUsageResult         = opts.buildUsageResult;
  var extractCache             = opts.extractCache;
  var buildReleaseStabilityData = opts.buildReleaseStabilityData;
  var backfillReleaseBodiesForDashboardDays = opts.backfillReleaseBodiesForDashboardDays;
  var snapshotMarketplaceRowsForScan = opts.snapshotMarketplaceRowsForScan;
  var mergeMarketplaceRowsPreferNewer = opts.mergeMarketplaceRowsPreferNewer;
  var getOutageDaysMap         = opts.getOutageDaysMap;
  var applyExtensionVersionMarkers = opts.applyExtensionVersionMarkers;
  var enrichVersionChangeNotes = opts.enrichVersionChangeNotes;
  var getReleasesMap           = opts.getReleasesMap;
  var outageCache              = opts.outageCache;
  var buildDashboardStatePaths = opts.buildDashboardStatePaths;
  var localCalendarTodayStr    = opts.localCalendarTodayStr;
  var REFRESH_SEC              = opts.REFRESH_SEC;
  var SCAN_PARTIAL_EMIT_MIN_MS = (function () {
    var e = process.env.CLAUDE_USAGE_SCAN_PARTIAL_MIN_MS;
    if (!e) return opts.SCAN_PARTIAL_EMIT_MIN_MS || 1500;
    var n = Number.parseInt(e, 10);
    return (!Number.isNaN(n) && n >= 400 && n <= 60000) ? n : 1500;
  })();
  var SCAN_WORKER_PATH         = opts.SCAN_WORKER_PATH;
  var makeStubCachedData       = opts.makeStubCachedData;

  // Lazy getters for cross-service deps (avoid circular init)
  var getCachedData            = opts.getCachedData;
  var setCachedData            = opts.setCachedData;
  var broadcastSse             = opts.broadcastSse;
  var refreshProxyCache        = opts.refreshProxyCache;
  var getProxyCache            = opts.getProxyCache;
  var sessionTurnsService      = opts.sessionTurnsService; // lazy ref

  // ── Scan state (owned by this module) ──────────────────────────
  var scanInProgress = false;
  var scanQueued = false;
  var __lastScanJsonlFingerprint = '';
  var __lastStableFingerprint = '';
  var __lastVolatileFingerprint = '';
  var __lastJsonlScanCompletedAt = '';
  var __extractCache = null;
  var __extractCacheLoaded = false;

  function buildUsageResultServer(daily, fileCount, filePaths, roots, buildOpts) {
    var enrichment = {
      outageDaysMap: getOutageDaysMap(),
      releaseStability: buildReleaseStabilityData(),
      applyExtensionVersionMarkers: applyExtensionVersionMarkers,
      enrichVersionChangeNotes: enrichVersionChangeNotes,
      getReleasesMap: getReleasesMap,
      outageCache: outageCache,
      buildStatePaths: buildDashboardStatePaths,
      marketplaceRows: buildOpts?.marketplaceRows
    };
    return buildUsageResult(daily, fileCount, filePaths, roots, enrichment);
  }

  function parseAllUsageIncremental(done, onProgress) {
    setImmediate(function () {
    collectTaggedJsonlFilesAsync(function (err, coll) {
    if (err) {
      done(err, null);
      return;
    }
    try {
    var tagged = coll.tagged;
    var roots = coll.roots;
    var splitFp = buildSplitFingerprint(tagged);
    var scanFpForPersist = splitFp.full;
    var skipIdentRaw = String(process.env.CLAUDE_USAGE_SKIP_IDENTICAL_SCAN || '').trim().toLowerCase();
    var skipIdentScan = skipIdentRaw !== '0' && skipIdentRaw !== 'false' && skipIdentRaw !== 'off' && skipIdentRaw !== 'no';
    var cachedData = getCachedData();

    // ── Tier 1: Full skip — nothing changed at all ──
    if (
      skipIdentScan &&
      splitFp.stable === __lastStableFingerprint &&
      splitFp.volatile === __lastVolatileFingerprint &&
      cachedData?.days?.length > 0 &&
      !cachedData.scan_error
    ) {
      serviceLog.info('scan', 'skip parse identical jsonl fingerprint files=' + tagged.length);
      try {
        var cloneSkip = JSON.parse(JSON.stringify(cachedData));
        cloneSkip.generated = new Date().toISOString();
        cloneSkip.scanning = false;
        delete cloneSkip.scan_progress;
        done(null, cloneSkip);
      } catch (eSk) {
        done(eSk, null);
      }
      return;
    }

    // ── Tier 2: Only volatile (today) files changed ──
    var tier2InMemory = false;
    if (
      skipIdentScan &&
      splitFp.stable === __lastStableFingerprint &&
      __lastStableFingerprint !== '' &&
      cachedData?.days?.length > 0 &&
      !cachedData.scan_error
    ) {
      tier2InMemory = true;
      serviceLog.info('scan', 'stable_fp_match volatile_only — skip disk cache read files=' + tagged.length);
    }

    var frozenMpRows = snapshotMarketplaceRowsForScan();
    var rootsKey = scanRootsCacheKey(roots);
    var noDayCache =
      process.env.CLAUDE_USAGE_NO_CACHE === '1' || process.env.CLAUDE_USAGE_NO_CACHE === 'true';
    var todayStr = localCalendarTodayStr();
    var useTodayOnly = false;

    if (tier2InMemory) {
      useTodayOnly = true;
    } else {
      var cache = !noDayCache ? readUsageDayCache() : null;
      if (
        cache?.version === USAGE_DAY_CACHE_VERSION &&
        tagged.length === cache.jsonl_file_count &&
        cache.scan_roots_key === rootsKey &&
        Array.isArray(cache.days) &&
        cache.days.length > 0
      ) {
        useTodayOnly = true;
      } else {
        var missParts = [];
        if (noDayCache) missParts.push('CLAUDE_USAGE_NO_CACHE');
        if (!cache) missParts.push('no_disk_day_cache_or_unreadable');
        else {
          if (cache.version !== USAGE_DAY_CACHE_VERSION) {
            missParts.push('cache_version want=' + USAGE_DAY_CACHE_VERSION + ' got=' + (cache.version != null ? cache.version : 'null'));
          }
          if (cache.jsonl_file_count !== tagged.length) {
            missParts.push('jsonl_count cache=' + cache.jsonl_file_count + ' tagged=' + tagged.length);
          }
          if (cache.scan_roots_key !== rootsKey) {
            missParts.push('scan_roots_key_mismatch');
          }
          if (!Array.isArray(cache.days) || cache.days.length === 0) {
            missParts.push('cache_days_empty');
          }
        }
        serviceLog.info('scan', 'day_cache_miss full_jsonl — ' + missParts.join(' | '));
      }
    }

    var daily = {};
    if (useTodayOnly && tier2InMemory) {
      for (var cd of cachedData.days) {
        if (cd.date === todayStr) continue;
        daily[cd.date] = rowToDailyEntry(cd);
      }
      daily[todayStr] = emptyDailyBucket();
    } else if (useTodayOnly) {
      for (var cd2 of cache.days) {
        if (cd2.date === todayStr) continue;
        daily[cd2.date] = rowToDailyEntry(cd2);
      }
      daily[todayStr] = emptyDailyBucket();
    }

    var onlyArg = useTodayOnly ? todayStr : null;
    var todayIndexCtx = null;
    if (useTodayOnly && !TODAY_INDEX_DISABLED) {
      var rawIdx = readJsonlTodayIndexDisk();
      var idxOk =
        rawIdx?.version === JSONL_TODAY_INDEX_VERSION &&
        rawIdx.calendar_day === todayStr &&
        rawIdx.jsonl_file_count === tagged.length &&
        rawIdx.scan_roots_key === rootsKey &&
        rawIdx.files &&
        typeof rawIdx.files === 'object';
      todayIndexCtx = {
        files: idxOk ? rawIdx.files : {},
        out: {},
        skipped: 0,
        read: 0,
        valid: idxOk
      };
    }
    var fullScanTodayIndexOut = !useTodayOnly && !TODAY_INDEX_DISABLED ? {} : null;
    var scanT0 = Date.now();
    serviceLog.info(
      'scan',
      'parse start jsonl_files=' +
        tagged.length +
        ' mode=' +
        (useTodayOnly ? 'today_jsonl+day_cache' : 'full_jsonl') +
        ' scan_roots=' +
        roots.length
    );
    var { Worker } = require('node:worker_threads');
    var worker = new Worker(SCAN_WORKER_PATH);
    serviceLog.info('scan', 'worker started for ' + tagged.length + ' files');

    worker.on('message', function (msg) {
      if (msg.type === 'progress') {
        if (typeof onProgress === 'function') {
          try {
            onProgress({
              daily: msg.daily || daily,
              tagged: tagged,
              roots: roots,
              fi: msg.fi,
              useTodayOnly: useTodayOnly,
              todayStr: todayStr,
              marketplaceRows: frozenMpRows
            });
          } catch (error) { logOptionalErr(error); }
        }
      } else if (msg.type === 'done') {
        try {
          var workerDaily = msg.daily;
          var mergedMpForFinal = mergeMarketplaceRowsPreferNewer(frozenMpRows);
          var result = buildUsageResultServer(workerDaily, tagged.length, tagged, roots, {
            marketplaceRows: mergedMpForFinal.length ? mergedMpForFinal : frozenMpRows
          });
          result.calendar_today = todayStr;
          result.day_cache_mode = useTodayOnly ? 'heute-jsonl+vortage-cache' : 'vollstaendiger-jsonl-scan';
          result.day_cache_mode_en = useTodayOnly
            ? 'today JSONL + past days from cache'
            : 'full JSONL scan';
          if (!noDayCache) {
            try {
              writeUsageDayCache({
                version: USAGE_DAY_CACHE_VERSION,
                jsonl_file_count: tagged.length,
                scan_roots_key: rootsKey,
                days: result.days,
                saved: new Date().toISOString()
              });
              serviceLog.info('cache', 'day_cache written days=' + (result.days ? result.days.length : 0) + ' jsonl_count=' + tagged.length);
            } catch (we) {
              serviceLog.error('cache', 'day_cache write failed: ' + (we.message || we));
            }
          }
          serviceLog.info('scan', 'parse done ms=' + (Date.now() - scanT0) + ' files=' + tagged.length + ' result_days=' + (result.days ? result.days.length : 0) + ' (worker)');
          try {
            var ecT0 = Date.now();
            if (!__extractCache) __extractCache = extractCache.load();
            var ecResult = extractCache.sync(__extractCache, tagged);
            if (ecResult.miss > 0) extractCache.save(__extractCache);
            __extractCacheLoaded = true;
            serviceLog.info('extract_cache', 'hit=' + ecResult.hit + ' miss=' + ecResult.miss + ' removed=' + ecResult.removed + ' records=' + ecResult.totalRecords + ' (' + (Date.now() - ecT0) + 'ms)');
          } catch (ecErr) {
            serviceLog.warn('extract_cache', 'sync failed: ' + (ecErr.message || ecErr));
          }
          __lastScanJsonlFingerprint = scanFpForPersist;
          __lastStableFingerprint = splitFp.stable;
          __lastVolatileFingerprint = splitFp.volatile;
          done(null, result);
        } catch (errFinal) {
          done(errFinal, null);
        }
      } else if (msg.type === 'error') {
        done(new Error(msg.message), null);
      }
    });

    worker.on('error', function (errWorker) {
      serviceLog.error('scan', 'worker error: ' + (errWorker.message || errWorker));
      done(errWorker, null);
    });

    worker.postMessage({
      tagged: tagged,
      daily: daily,
      onlyDate: onlyArg,
      todayStr: todayStr
    });
    } catch (eColl) {
      done(eColl, null);
    }
    });
    });
  }

  function handleUsageScanParseSuccess(data) {
    data.refresh_sec = REFRESH_SEC;
    data.scanning = false;
    delete data.scan_progress;
    if (data.scan_error) delete data.scan_error;
    setCachedData(data);
    refreshProxyCache();
    var proxyCache = getProxyCache();
    var cachedData = getCachedData();
    if (proxyCache.data) cachedData.proxy = proxyCache.data;
    cachedData.release_stability = buildReleaseStabilityData();
    __lastJsonlScanCompletedAt = data.generated || new Date().toISOString();
  }

  function handleUsageScanParseError(e) {
    serviceLog.error('scan', 'parse failed: ' + (e?.message ? e.message : String(e)));
    var msg = e?.message ? e.message : String(e);
    var cachedData = getCachedData();
    if (!cachedData?.days || cachedData.days.length === 0) {
      setCachedData(makeStubCachedData());
    }
    getCachedData().scanning = false;
    getCachedData().scan_error = msg;
  }

  function finalizeUsageScanIncremental(err, data) {
    var scanOk = false;
    try {
      if (err) throw err;
      handleUsageScanParseSuccess(data);
      scanOk = true;
    } catch (e) {
      handleUsageScanParseError(e);
    } finally {
      scanInProgress = false;
      broadcastSse();
      if (sessionTurnsService) sessionTurnsService.scheduleIdlePreloadIfNeeded(scanOk);
      if (scanOk && getCachedData()?.days?.length) {
        backfillReleaseBodiesForDashboardDays(getCachedData().days, function () {
          getCachedData().generated = new Date().toISOString();
          broadcastSse();
        }, serviceLog);
      }
      if (scanQueued) {
        scanQueued = false;
        runScanAndBroadcast();
      }
    }
  }

  function runScanAndBroadcast() {
    if (scanInProgress) {
      scanQueued = true;
      return;
    }
    scanInProgress = true;
    var lastPartialEmitMs = 0;
    function applyIncrementalProgress(state) {
      var now = Date.now();
      if (now - lastPartialEmitMs < SCAN_PARTIAL_EMIT_MIN_MS) return;
      lastPartialEmitMs = now;
      var cachedData = getCachedData();
      if (!cachedData) return;
      cachedData.scanning = true;
      cachedData.scan_progress = { done: state.fi, total: state.tagged.length };
      cachedData.generated = new Date().toISOString();
      broadcastSse();
    }
    parseAllUsageIncremental(finalizeUsageScanIncremental, applyIncrementalProgress);
  }

  return {
    runScanAndBroadcast: runScanAndBroadcast,
    getLastJsonlScanCompletedAt: function () { return __lastJsonlScanCompletedAt; },
    resetScanFingerprints: function () { __lastScanJsonlFingerprint = ''; __lastStableFingerprint = ''; __lastVolatileFingerprint = ''; },
    isScanInProgress: function () { return scanInProgress; },
    getExtractCache: function () { return { cache: __extractCache, loaded: __extractCacheLoaded }; }
  };
};
