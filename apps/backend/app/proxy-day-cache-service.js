'use strict';
/**
 * @asseris-module       Proxy Day Cache Service
 * @asseris-description  Immutable per-day proxy aggregate cache — mirrors the
 *                       session-turns historical day-cache pattern. Historical days
 *                       are parsed once, persisted to disk keyed on a file fingerprint,
 *                       and served as instant HITs; only the volatile tail (yesterday +
 *                       today) is re-parsed. Powers Grafana-style date-range queries
 *                       and the periodic 31d window parse.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Proxy NDJSON Parser, Scan Roots (Usage), Service Logger
 * @asseris-called-by    Dashboard Server, Usage Routes, Proxy Cache Service
 * @asseris-emits        per-day proxy aggregate cache snapshots (~/.claude/proxy-day-cache)
 * @asseris-consumes     proxy-YYYY-MM-DD.ndjson files
 *
 * Usage:
 *   var proxyDayCacheService = require('./proxy-day-cache-service')(opts);
 */
var fs = require('fs');
var path = require('path');
var storagePaths = require('../domain/usage/storage-paths');

module.exports = function createProxyDayCacheService(opts) {
  var serviceLog                      = opts.serviceLog;
  var logOptionalErr                  = opts.logOptionalErr;
  var parseProxyNdjsonFiles           = opts.parseProxyNdjsonFiles;
  var collectProxyNdjsonFiles         = opts.collectProxyNdjsonFiles;
  var filterProxyFilesForDateRange    = opts.filterProxyFilesForDateRange;
  var buildTaggedJsonlFingerprintSync = opts.buildTaggedJsonlFingerprintSync;
  var getProxyLogDir                  = opts.getProxyLogDir;
  var expandUserPath                  = opts.expandUserPath;

  // { [dateKey]: { fingerprint, result } } — result may be null (gap day).
  var _dayCache = Object.create(null);
  var __undatedActiveWarned = false;

  function isNoCache() {
    return process.env.CLAUDE_USAGE_NO_CACHE === '1' || process.env.CLAUDE_USAGE_NO_CACHE === 'true';
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function shiftDateKey(dateKey, days) {
    return new Date(Date.parse(dateKey + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }

  function resolveProxyDayCacheDir() {
    var raw = String(process.env.CLAUDE_USAGE_PROXY_DAY_CACHE_DIR || '').trim();
    if (raw === '0' || raw === 'off' || raw === 'false') return '';
    if (!raw) {
      return path.join(storagePaths.stateDir(), 'proxy-day-cache');
    }
    try {
      var ex = expandUserPath(raw);
      if (ex) return ex;
    } catch (error) { logOptionalErr(error); }
    try {
      return path.resolve(raw);
    } catch (e1) {
      return '';
    }
  }

  // Returns { result } on a fingerprint-matching hit (result may be null for
  // a cached gap day), or null when there is no usable disk entry.
  function tryLoadProxyDayDiskCache(dateKey, fp) {
    var dir = resolveProxyDayCacheDir();
    if (!dir) return null;
    var f = path.join(dir, dateKey + '.json');
    try {
      var o = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!o || typeof o !== 'object') return null;
      if (o.fingerprint !== fp) return null;
      if (o.result !== null && (!o.result || o.result.date !== dateKey)) return null;
      return { result: o.result };
    } catch (e) {
      return null;
    }
  }

  function saveProxyDayDiskCache(dateKey, fp, result) {
    var dir = resolveProxyDayCacheDir();
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

  function warnOnceOnActiveUndatedFiles(files) {
    if (__undatedActiveWarned) return;
    var cutoff = Date.now() - 86400000;
    for (var f of files) {
      if (/(\d{4}-\d{2}-\d{2})[^\\/]*\.ndjson$/.test(String(f))) continue;
      try {
        if (fs.statSync(f).mtimeMs >= cutoff) {
          __undatedActiveWarned = true;
          serviceLog.warn('proxy-day-cache', 'actively written undated file degrades day caching to rebuild-per-request: ' + f);
          return;
        }
      } catch (error) { logOptionalErr(error); }
    }
  }

  /**
   * Compact aggregate for one day. Returns the day object, or null when the
   * available files contain no records for that date (the null is cached too,
   * so gap days don't re-parse on every request).
   */
  function getProxyDayCached(dateKey) {
    var noCache = isNoCache();
    var t0 = Date.now();
    var today = todayKey();
    var cached = noCache ? null : _dayCache[dateKey];
    // Frozen-day fast path: a day is immutable once the following day's file
    // has stopped growing — by D+2 that is always true.
    if (cached && dateKey <= shiftDateKey(today, -2)) {
      return cached.result;
    }
    var files = filterProxyFilesForDateRange(collectProxyNdjsonFiles(), dateKey, dateKey);
    if (!files.length) return null;
    warnOnceOnActiveUndatedFiles(files);
    var fp = buildTaggedJsonlFingerprintSync(files);
    if (cached && cached.fingerprint === fp) return cached.result;
    var fromDisk = noCache ? null : tryLoadProxyDayDiskCache(dateKey, fp);
    if (fromDisk) {
      _dayCache[dateKey] = { fingerprint: fp, result: fromDisk.result };
      return fromDisk.result;
    }
    var parsed = parseProxyNdjsonFiles({ files: files, latestDayFull: false });
    var day = null;
    for (var pd of parsed.proxy_days) {
      if (pd.date === dateKey) { day = pd; break; }
    }
    serviceLog.info('proxy-day-cache', 'date=' + dateKey + (noCache ? ' NO_CACHE REBUILD ' : ' REBUILD ') +
      files.length + ' files → ' + (day ? day.requests + ' requests' : 'gap') + ' (' + (Date.now() - t0) + 'ms)');
    if (!noCache) {
      _dayCache[dateKey] = { fingerprint: fp, result: day };
      saveProxyDayDiskCache(dateKey, fp, day);
    }
    return day;
  }

  /** Inclusive range of compact day aggregates. */
  function getProxyDaysRange(fromKey, toKey) {
    var proxyDays = [];
    var daysMissing = [];
    for (var k = fromKey; k <= toKey; k = shiftDateKey(k, 1)) {
      var day = getProxyDayCached(k);
      if (day) proxyDays.push(day);
      else daysMissing.push(k);
    }
    return { proxy_days: proxyDays, days_missing: daysMissing };
  }

  /**
   * Drop-in replacement for parseProxyNdjsonFiles() on the periodic 31d
   * window parse: frozen days come from the day cache (disk HITs after the
   * first build), only the volatile tail (yesterday + today) is parsed fresh
   * with full latest-day buffers. Output shape is identical.
   */
  function parseProxyWindowCached() {
    var parseMaxDays = Number(process.env.PROXY_PARSE_MAX_DAYS) > 0
      ? Number(process.env.PROXY_PARSE_MAX_DAYS) : 31;
    var today = todayKey();
    var yesterday = shiftDateKey(today, -1);
    var fromKey = shiftDateKey(today, -(parseMaxDays - 1));
    var t0 = Date.now();

    var frozenDays = [];
    var hits = 0;
    for (var k = fromKey; k < yesterday; k = shiftDateKey(k, 1)) {
      var inMem = !!_dayCache[k];
      var day = getProxyDayCached(k);
      if (day) frozenDays.push(day);
      if (inMem) hits++;
    }

    var allFiles = collectProxyNdjsonFiles();
    var tailFiles = filterProxyFilesForDateRange(allFiles, yesterday, today);
    var tailParsed = parseProxyNdjsonFiles({ files: tailFiles });
    var tailDays = tailParsed.proxy_days.filter(function (d) { return d.date >= yesterday; });

    var windowFiles = filterProxyFilesForDateRange(allFiles, fromKey, today);
    serviceLog.info('proxy-day-cache', 'window ' + parseMaxDays + 'd: ' + frozenDays.length +
      ' frozen days (' + hits + ' mem-hits) + ' + tailDays.length + ' volatile (' + (Date.now() - t0) + 'ms)');
    return {
      proxy_days: frozenDays.concat(tailDays),
      proxy_log_dir: getProxyLogDir(),
      proxy_files: windowFiles.length,
      generated: new Date().toISOString()
    };
  }

  return {
    getProxyDayCached: getProxyDayCached,
    getProxyDaysRange: getProxyDaysRange,
    parseProxyWindowCached: parseProxyWindowCached,
    resolveProxyDayCacheDir: resolveProxyDayCacheDir,
    get _dayCache() { return _dayCache; }
  };
};
