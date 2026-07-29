'use strict';
/**
 * @asseris-module       Session Turns Service
 * @asseris-description  Per-session turn-level token data caching and building — drives
 *                       the Session Activity heatmap and M(t)-per-session chart. Two-pass
 *                       JSONL scan with disk cache keyed on date+fingerprint.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Session Turns Core, Scan Roots
 * @asseris-called-by    Usage Routes, Dashboard Server
 * @asseris-emits        per-day session-turns cache snapshots
 * @asseris-consumes     local JSONL files
 *
 * Extracted from dashboard-server.js as part of Phase 12c modularization.
 *
 * Usage:
 *   var sessionTurnsService = require('./session-turns-service')(opts);
 */
var fs = require('fs');
var path = require('path');

module.exports = function createSessionTurnsService(opts) {
  var serviceLog             = opts.serviceLog;
  var logOptionalErr         = opts.logOptionalErr;
  var sessionTurnsCore       = opts.sessionTurnsCore;
  var collectTaggedJsonlFiles = opts.collectTaggedJsonlFiles;
  var buildTaggedJsonlFingerprintSync = opts.buildTaggedJsonlFingerprintSync;
  var forEachJsonlLineSync   = opts.forEachJsonlLineSync;
  var usageScanRoots         = opts.usageScanRoots;
  var getExtractCache        = opts.getExtractCache; // lazy getter: () => { cache, loaded }

  var _sessionTurnsCache = Object.create(null);
  var IDLE_SESSION_PRELOAD_MS = (function () {
    var ev = String(process.env.CLAUDE_USAGE_IDLE_SESSION_PRELOAD_MS || '').trim();
    if (ev === '0' || ev === 'off' || ev === 'false') return 0;
    var n = Number.parseInt(ev, 10);
    return !Number.isNaN(n) && n > 0 ? n : 0;
  })();
  var __sessionTurnsIdlePreloadScheduled = false;

  function resolveSessionTurnsCacheDir() {
    var raw = String(process.env.CLAUDE_USAGE_SESSION_TURNS_CACHE_DIR || '').trim();
    if (raw === '0' || raw === 'off' || raw === 'false') return '';
    if (!raw) {
      var home = process.env.USERPROFILE || process.env.HOME || require('node:os').homedir();
      if (!home) return '';
      return path.join(home, '.claude', 'session-turns-cache');
    }
    try {
      var ex = usageScanRoots.expandUserPath(raw);
      if (ex) return ex;
    } catch (error) { logOptionalErr(error); }
    try {
      return path.resolve(raw);
    } catch (e1) {
      return '';
    }
  }

  function tryLoadSessionTurnsDiskCache(dateKey, fp) {
    var dir = resolveSessionTurnsCacheDir();
    if (!dir) return null;
    var f = path.join(dir, dateKey + '.json');
    try {
      var raw = fs.readFileSync(f, 'utf8');
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      if (o.fingerprint !== fp) return null;
      var r = o.result;
      if (!r || r.date !== dateKey || !Array.isArray(r.sessions)) return null;
      return r;
    } catch (e) {
      return null;
    }
  }

  function saveSessionTurnsDiskCache(dateKey, fp, result) {
    var dir = resolveSessionTurnsCacheDir();
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      var tmp = path.join(dir, dateKey + '.json.tmp');
      var dst = path.join(dir, dateKey + '.json');
      fs.writeFileSync(tmp, JSON.stringify({ fingerprint: fp, result: result }), 'utf8');
      fs.renameSync(tmp, dst);
    } catch (e) {
      logOptionalErr(e);
    }
  }

  function getSessionTurnsCached(dateKey) {
    var noCache = process.env.CLAUDE_USAGE_NO_CACHE === '1' || process.env.CLAUDE_USAGE_NO_CACHE === 'true';
    var t0 = Date.now();
    var today = new Date().toISOString().slice(0, 10);
    var cached = noCache ? null : _sessionTurnsCache[dateKey];
    if (cached && dateKey < today) {
      serviceLog.info('session-turns', 'date=' + dateKey + ' historical HIT (0ms)');
      return cached.result;
    }
    var collected = collectTaggedJsonlFiles();
    var fp = buildTaggedJsonlFingerprintSync(collected.tagged);
    var fpMs = Date.now() - t0;
    var fromDisk = tryLoadSessionTurnsDiskCache(dateKey, fp);
    if (fromDisk) {
      serviceLog.info('session-turns', 'date=' + dateKey + ' DISK cache HIT (' + (Date.now() - t0) + 'ms)');
      if (!noCache) _sessionTurnsCache[dateKey] = { result: fromDisk, fingerprint: fp };
      return fromDisk;
    }
    if (cached?.fingerprint === fp) {
      serviceLog.info('session-turns', 'date=' + dateKey + ' fingerprint HIT (' + fpMs + 'ms stat)');
      return cached.result;
    }
    var result;
    var usedCache = false;
    var ec = getExtractCache();
    if (ec.loaded && ec.cache) {
      result = sessionTurnsCore.buildSessionTurnsFromCache(dateKey, ec.cache);
      usedCache = true;
    } else {
      result = buildSessionTurnsForDateWithCollected(dateKey, collected.tagged);
    }
    var totalMs = Date.now() - t0;
    var sessions = result?.sessions ? result.sessions.length : 0;
    var turns = result?.total_turns ? result.total_turns : 0;
    serviceLog.info('session-turns', 'date=' + dateKey + (noCache ? ' NO_CACHE REBUILD ' : ' REBUILD ') + (usedCache ? '[extract-cache] ' : '') + collected.tagged.length + ' files → ' + sessions + ' sessions, ' + turns + ' turns (' + totalMs + 'ms, fp=' + fpMs + 'ms)');
    if (!noCache) {
      _sessionTurnsCache[dateKey] = { result: result, fingerprint: fp };
      saveSessionTurnsDiskCache(dateKey, fp, result);
    }
    return result;
  }

  function pass1CollectSessionsForDayWindowFromFiles(dateKeys, files) {
    return sessionTurnsCore.pass1CollectSessionsForDayWindowFromFiles(dateKeys, files, forEachJsonlLineSync);
  }

  function finalizeSessionTurnsForDate(dateKey, allSessions) {
    return sessionTurnsCore.finalizeSessionTurnsForDate(dateKey, allSessions);
  }

  function buildSessionTurnsForDateWithCollected(dateKey, tagged) {
    return sessionTurnsCore.buildSessionTurnsForDateWithCollected(dateKey, tagged, forEachJsonlLineSync);
  }

  function populateSessionTurnsCacheForDates(dateKeys, collectedTagged, fp) {
    var noCache = process.env.CLAUDE_USAGE_NO_CACHE === '1' || process.env.CLAUDE_USAGE_NO_CACHE === 'true';
    var allSessions;
    var ec = getExtractCache();
    if (ec.loaded && ec.cache) {
      allSessions = sessionTurnsCore.pass1FromExtractCache(dateKeys, ec.cache);
    } else {
      allSessions = sessionTurnsCore.pass1CollectSessionsForDayWindowFromFiles(dateKeys, collectedTagged, forEachJsonlLineSync);
    }
    var stByDate = {};
    for (var dk of dateKeys) {
      var result = sessionTurnsCore.finalizeSessionTurnsForDate(dk, allSessions);
      stByDate[dk] = result;
      if (!noCache) {
        _sessionTurnsCache[dk] = { result: result, fingerprint: fp };
        saveSessionTurnsDiskCache(dk, fp, result);
      }
    }
    return stByDate;
  }

  function scheduleIdlePreloadIfNeeded(scanOk) {
    if (!scanOk || IDLE_SESSION_PRELOAD_MS <= 0 || __sessionTurnsIdlePreloadScheduled) return;
    __sessionTurnsIdlePreloadScheduled = true;
    setTimeout(function () {
      try {
        var preloadDay = new Date().toISOString().slice(0, 10);
        var pt0 = Date.now();
        getSessionTurnsCached(preloadDay);
        serviceLog.info('session-turns', 'idle preload date=' + preloadDay + ' (' + (Date.now() - pt0) + 'ms)');
      } catch (pe) {
        serviceLog.warn('session-turns', 'idle preload failed: ' + (pe.message || pe));
      }
    }, IDLE_SESSION_PRELOAD_MS);
  }

  return {
    getSessionTurnsCached: getSessionTurnsCached,
    resolveSessionTurnsCacheDir: resolveSessionTurnsCacheDir,
    populateSessionTurnsCacheForDates: populateSessionTurnsCacheForDates,
    scheduleIdlePreloadIfNeeded: scheduleIdlePreloadIfNeeded,
    get _sessionTurnsCache() { return _sessionTurnsCache; },
    IDLE_SESSION_PRELOAD_MS: IDLE_SESSION_PRELOAD_MS
  };
};
