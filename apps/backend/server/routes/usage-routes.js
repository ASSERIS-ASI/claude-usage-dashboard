'use strict';

var path = require('path');
var URL = typeof globalThis.URL === 'function' ? globalThis.URL : require('url').URL;
var quotaDivisor = require('../../domain/usage/quota-divisor');
var addonAdapter = require('../../domain/addons/addon-adapter');
var productSetupModel = require('../../app/product-setup');

/**
 * @asseris-module       Usage Routes
 * @asseris-description  Primary read-API for the dashboard — /api/usage (full snapshot),
 *                       /api/proxy-usage, /api/extension-timeline, /api/quota-divisor
 *                       (#203 analysis), /api/session-turns and /api/i18n-bundles.
 *                       Serves analytics consumed by every chart in the UI.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        output
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Session Turns Service, Proxy Cache Service, Cache Update Service
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        /api/usage JSON, /api/proxy-usage JSON, /api/quota-divisor JSON, /api/session-turns JSON, /api/i18n-bundles JSON
 * @asseris-consumes     cached usage data, proxy NDJSON, session-turns cache, quota divisor line processor
 *
 * Usage-related route handlers:
 *   /api/usage, /api/extension-timeline, /api/i18n-bundles,
 *   /api/proxy-usage, /api/quota-divisor,
 *   /api/session-turns,
 *   /api/proxy-usage-range, /api/usage-range (Grafana-style date-range picker)
 *
 * deps: getCachedData, buildExtensionTimelineApiResponse, buildI18nBundles,
 *       getProxyCache, refreshProxyCache,
 *       collectProxyNdjsonFiles, forEachJsonlLineSync, createQuotaDivisorLineProcessor,
 *       calendarPrevDateYmd, q5CarryoverTotalsFromPairs, logOptionalErr,
 *       getSessionTurnsCached, _sessionTurnsCache, serviceLog
 */
function register(deps) {
  var getCachedData = deps.getCachedData;
  var buildExtensionTimelineApiResponse = deps.buildExtensionTimelineApiResponse;
  var buildI18nBundles = deps.buildI18nBundles;
  var getProxyCache = deps.getProxyCache;
  var refreshProxyCache = deps.refreshProxyCache;
  var collectProxyNdjsonFiles = deps.collectProxyNdjsonFiles;
  var forEachJsonlLineSync = deps.forEachJsonlLineSync;
  var createQuotaDivisorLineProcessor = deps.createQuotaDivisorLineProcessor;
  var calendarPrevDateYmd = deps.calendarPrevDateYmd;
  var q5CarryoverTotalsFromPairs = deps.q5CarryoverTotalsFromPairs;
  var logOptionalErr = deps.logOptionalErr;
  var getSessionTurnsCached = deps.getSessionTurnsCached;
  var _sessionTurnsCache = deps._sessionTurnsCache;
  var serviceLog = deps.serviceLog;
  var proxyDayCacheService = deps.proxyDayCacheService;

  var RANGE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var RANGE_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache'
  };
  function rangeShiftKey(dateKey, days) {
    return new Date(Date.parse(dateKey + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }

  // Validates from/to query params; responds 400 + returns null on bad input.
  function parseRangeParams(req, res) {
    var u = new URL(req.url, 'http://localhost');
    var from = u.searchParams.get('from') || '';
    var to = u.searchParams.get('to') || '';
    var today = new Date().toISOString().slice(0, 10);
    if (!RANGE_DATE_RE.test(from) || !RANGE_DATE_RE.test(to) || from > to) {
      res.writeHead(400, RANGE_HEADERS);
      res.end(JSON.stringify({ error: 'bad_range' }));
      return null;
    }
    if (to > today) to = today;
    if (from > to) {
      res.writeHead(400, RANGE_HEADERS);
      res.end(JSON.stringify({ error: 'bad_range' }));
      return null;
    }
    var maxDays = Number(process.env.PROXY_RANGE_MAX_DAYS) > 0
      ? Number(process.env.PROXY_RANGE_MAX_DAYS) : 366;
    var span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (span > maxDays) {
      res.writeHead(400, RANGE_HEADERS);
      res.end(JSON.stringify({ error: 'range_too_large', max_days: maxDays }));
      return null;
    }
    return { from: from, to: to, span: span };
  }

  function handle(pathname, req, res) {
    if (pathname === '/api/usage') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      });
      // What the selected add-ons can deliver, alongside the data itself, so a
      // chart can classify itself instead of being special-cased by source.
      var setupForCapabilities = productSetupModel.read();
      res.end(JSON.stringify({
        ...getCachedData(),
        capabilities: addonAdapter.capabilities(
          setupForCapabilities?.sources || {},
          { setup: setupForCapabilities }
        )
      }));
      return true;
    }

    if (pathname === '/api/extension-timeline') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      });
      res.end(JSON.stringify(buildExtensionTimelineApiResponse()));
      return true;
    }

    if (pathname === '/api/i18n-bundles') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildI18nBundles()));
      return true;
    }

    if (pathname === '/api/proxy-usage') {
      var proxyCache = getProxyCache();
      if (!proxyCache.data) refreshProxyCache();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      });
      res.end(JSON.stringify(proxyCache.data));
      return true;
    }

    if (pathname === '/api/quota-divisor') {
      return handleQuotaDivisor(req, res);
    }

    if (pathname === '/api/session-turns') {
      return handleSessionTurns(req, res);
    }

    if (pathname === '/api/proxy-usage-range') {
      return handleProxyUsageRange(req, res);
    }

    if (pathname === '/api/usage-range') {
      handleUsageRange(req, res);
      return true;
    }

    return false;
  }

  // ── /api/proxy-usage-range — compact per-day aggregates from the day
  // cache (pod-side data source for Grafana-style range queries; also works
  // standalone wherever local NDJSON exists). Aggregates only, never raw
  // files — payload is N×~35KB compact days.
  function handleProxyUsageRange(req, res) {
    var range = parseRangeParams(req, res);
    if (!range) return true;
    if (!proxyDayCacheService) {
      res.writeHead(503, RANGE_HEADERS);
      res.end(JSON.stringify({ error: 'day_cache_unavailable' }));
      return true;
    }
    // Async with a yield between days: a cold multi-month build must not
    // block the proxy event loop (same liveness-probe rationale as the
    // /api/debug/proxy-logs session-turns batch).
    (async function () {
      var t0 = Date.now();
      var proxyDays = [];
      var daysMissing = [];
      for (var k = range.from; k <= range.to; k = rangeShiftKey(k, 1)) {
        var day = proxyDayCacheService.getProxyDayCached(k);
        if (day) proxyDays.push(day);
        else daysMissing.push(k);
        await new Promise(function (r) { setImmediate(r); });
      }
      serviceLog.info('usage-range', 'proxy-usage-range ' + range.from + '..' + range.to +
        ' → ' + proxyDays.length + ' days, ' + daysMissing.length + ' missing (' + (Date.now() - t0) + 'ms)');
      res.writeHead(200, RANGE_HEADERS);
      res.end(JSON.stringify({
        from: range.from,
        to: range.to,
        proxy_days: proxyDays,
        days_missing: daysMissing,
        generated: new Date().toISOString()
      }));
    })().catch(function (err) {
      serviceLog.error('usage-range', 'proxy-usage-range failed: ' + (err.message || err));
      if (!res.headersSent) res.writeHead(500, RANGE_HEADERS);
      if (!res.writableEnded) res.end(JSON.stringify({ error: err.message || String(err) }));
    });
    return true;
  }

  // ── /api/usage-range — browser-facing range query on the local dashboard.
  // Per-day resolution order: live snapshot → local day cache → days_missing.
  function handleUsageRange(req, res) {
    var range = parseRangeParams(req, res);
    if (!range) return;
    var t0 = Date.now();
    var snapshot = getCachedData() || {};
    var days = (snapshot.days || []).filter(function (d) {
      return d.date >= range.from && d.date <= range.to;
    });

    var snapProxyDays = {};
    var pc = getProxyCache();
    var snapList = (pc.data && pc.data.proxy_days) || [];
    for (var sd of snapList) snapProxyDays[sd.date] = sd;

    var proxyDayByKey = {};
    var missing = [];
    var sources = { snapshot: 0, local_cache: 0 };
    for (var k = range.from; k <= range.to; k = rangeShiftKey(k, 1)) {
      if (snapProxyDays[k]) {
        proxyDayByKey[k] = snapProxyDays[k];
        sources.snapshot++;
        continue;
      }
      var localDay = proxyDayCacheService ? proxyDayCacheService.getProxyDayCached(k) : null;
      if (localDay) {
        proxyDayByKey[k] = localDay;
        sources.local_cache++;
        continue;
      }
      missing.push(k);
    }

    function respond(daysMissing) {
      var keys = Object.keys(proxyDayByKey).sort(function (left, right) {
        return left.localeCompare(right);
      });
      var proxyDays = keys.map(function (dk) { return proxyDayByKey[dk]; });
      serviceLog.info('usage-range', 'usage-range ' + range.from + '..' + range.to +
        ' → ' + proxyDays.length + ' proxy_days (snapshot=' + sources.snapshot +
        ' local=' + sources.local_cache +
        ') missing=' + daysMissing.length + ' (' + (Date.now() - t0) + 'ms)');
      res.writeHead(200, RANGE_HEADERS);
      res.end(JSON.stringify({
        from: range.from,
        to: range.to,
        days: days,
        proxy_days: proxyDays,
        days_missing: daysMissing,
        sources: sources,
        generated: new Date().toISOString()
      }));
    }

    respond(missing);
  }

  function handleQuotaDivisor(req, res) {
    // Per-request quota divisor analysis: correlates token costs with q5 deltas
    var qdUrl = new URL(req.url, 'http://localhost');
    var qdDate = qdUrl.searchParams.get('date'); // optional: single day
    var proxyCache = getProxyCache();
    if (!proxyCache.data) refreshProxyCache();

    // Per-model token pricing is resolved inside quota-divisor via response_model.
    // PRICE here is only the FALLBACK for records whose model isn't recognized.
    // This dashboard does NOT calculate real billing — absolute $ values are illustrative.
    // The ratios (CV, median, trend) are scale-invariant; only the Y-axis label changes.
    var PRICE = quotaDivisor.MODEL_PRICING.opus;

    // Re-parse proxy logs to get per-request q5 + full token data
    var proxyFiles = collectProxyNdjsonFiles();
    var requestPairs = []; // { date, ts, q5, q5_prev, delta, cost, tokens }

    for (var pf of proxyFiles) {
      var qfDate = path.basename(pf).replace('proxy-', '').replace('.ndjson', '');
      if (qdDate && qfDate !== qdDate) continue;
      try {
        forEachJsonlLineSync(pf, createQuotaDivisorLineProcessor(PRICE, qfDate, requestPairs));
      } catch (error) { logOptionalErr(error); }
    }

    var carryoverQ5 = null;
    if (qdDate) {
      var prevYmd = calendarPrevDateYmd(qdDate);
      if (prevYmd) {
        for (var pfCar of proxyFiles) {
          var qfDateCar = path.basename(pfCar).replace('proxy-', '').replace('.ndjson', '');
          if (qfDateCar !== prevYmd) continue;
          var prevPairsCar = [];
          try {
            forEachJsonlLineSync(pfCar, createQuotaDivisorLineProcessor(PRICE, qfDateCar, prevPairsCar));
          } catch (error) { logOptionalErr(error); }
          if (prevPairsCar.length) {
            var carSums = q5CarryoverTotalsFromPairs(prevPairsCar);
            carryoverQ5 = { actual: carSums.actual, ideal: carSums.ideal, from_date: prevYmd };
          }
          break;
        }
      }
    }

    // Aggregate by date
    var byDate = {};
    for (var pair of requestPairs) {
      if (!byDate[pair.date]) byDate[pair.date] = { pairs: [], divisors: [], costs: [], deltas: [] };
      byDate[pair.date].pairs.push(pair);
      byDate[pair.date].divisors.push(pair.implied_divisor);
      byDate[pair.date].costs.push(pair.cost);
      byDate[pair.date].deltas.push(pair.delta);
    }

    var dateSummaries = [];
    var dateKeys = Object.keys(byDate).sort(function (a, b) {
      return a.localeCompare(b);
    });
    for (var dkey of dateKeys) {
      var bd = byDate[dkey];
      var divs = bd.divisors.slice().sort(function(a, b) { return a - b; });
      var totalCost = bd.costs.reduce(function(s, c) { return s + c; }, 0);
      var totalDelta = bd.deltas.reduce(function(s, d) { return s + d; }, 0);
      dateSummaries.push({
        date: dkey,
        request_pairs: bd.pairs.length,
        weighted_divisor: totalDelta > 0 ? Math.round(totalCost / totalDelta * 100) / 100 : null,
        median_divisor: divs.length > 0 ? divs[Math.floor(divs.length / 2)] : null,
        p10_divisor: divs.length >= 10 ? divs[Math.floor(divs.length * 0.1)] : divs[0] || null,
        p90_divisor: divs.length >= 10 ? divs[Math.floor(divs.length * 0.9)] : divs[divs.length - 1] || null,
        total_cost: Math.round(totalCost * 100) / 100,
        total_q5_delta: Math.round(totalDelta * 10000) / 10000
      });
    }

    var qdResult = {
      pricing: PRICE,
      pricing_per_model: quotaDivisor.MODEL_PRICING,
      pricing_note: 'cost is resolved per response_model (pricing_per_model); records with an unrecognized model fall back to pricing (Opus).',
      note: 'implied_divisor = API_cost / q5_delta. If constant, quota is a simple linear mapping of cost.',
      requested_date: qdDate || null,
      no_proxy_logs: !!(qdDate && requestPairs.length === 0),
      date_summaries: dateSummaries,
      request_pairs: requestPairs.length > 2000 ? requestPairs.slice(0, 2000) : requestPairs,
      truncated: requestPairs.length > 2000,
      carryover_q5: carryoverQ5
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(qdResult));
    return true;
  }

  function handleSessionTurns(req, res) {
    var stUrl = new URL(req.url, 'http://localhost');
    var stDate = stUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    var stCachedLocal = _sessionTurnsCache[stDate];
    if (stCachedLocal) {
      serviceLog.info('session-turns', 'GET /api/session-turns?date=' + stDate + ' → 0ms (memory cache)');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      });
      res.end(JSON.stringify(stCachedLocal.result));
    } else {
      res.writeHead(202, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({ sessions: [], total_turns: 0, building: true }));
      setImmediate(function () {
        var stT0 = Date.now();
        getSessionTurnsCached(stDate);
        serviceLog.info('session-turns', 'GET /api/session-turns?date=' + stDate +
          ' → ' + (Date.now() - stT0) + 'ms (background build)');
      });
    }
    return true;
  }

  return { handle: handle };
}

module.exports = { register: register };
