/**
 * @asseris-module       Dashboard State
 * @asseris-description  Auto-annotated module metadata for public/js/core/dashboard-state.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/dashboard-state.js — Central dashboard data state + filter state.
 *
 * Owns:
 *   - __lastUsageData (canonical location)
 *   - __releaseStabilityData
 *   - Filter state: date range, host filter, forensic host filter
 *   - Section context store (getSectionCtx / setSectionCtx)
 *
 * API: window.__dashboardState
 */
(function () {

  var __lastUsageData = null;
  var __releaseStabilityData = null;
  var __forensicHostFilterSig = '';
  var __sectionCtx = {};

  // ── Range overlay (Grafana-style pinned historical range) ──────────
  // While pinned, getData() serves a composed snapshot with the overlay's
  // days/proxy_days and a frozen `generated` — the core fingerprint stays
  // stable, so SSE ticks become render no-ops while the live snapshot keeps
  // updating in the background via setData().
  var __rangeOverlay = null;   // { from, to, days, proxy_days, days_missing, generated }
  var __effectiveCache = null; // composed object, invalidated on setData/overlay change

  function setRangeOverlay(o) { __rangeOverlay = o || null; __effectiveCache = null; }
  function clearRangeOverlay() { __rangeOverlay = null; __effectiveCache = null; }
  function getRangeOverlay() { return __rangeOverlay; }
  function isRangePinned() { return !!__rangeOverlay; }
  function getLiveData() { return __lastUsageData; }

  // ── Data accessors ──────────────────────────────────────────────────

  function getData() {
    if (!__rangeOverlay || !__lastUsageData) return __lastUsageData;
    if (!__effectiveCache) {
      __effectiveCache = Object.assign({}, __lastUsageData, {
        days: __rangeOverlay.days || [],
        proxy: Object.assign({}, __lastUsageData.proxy, {
          proxy_days: __rangeOverlay.proxy_days || []
        }),
        generated: __rangeOverlay.generated,
        scanning: false
      });
    }
    return __effectiveCache;
  }
  function setData(d) {
    __lastUsageData = d;
    __effectiveCache = null;
  }

  function getReleaseStability() { return __releaseStabilityData; }
  function setReleaseStability(d) { __releaseStabilityData = d; }

  // ── Section context store ───────────────────────────────────────────

  function getSectionCtx(name) { return __sectionCtx[name] || null; }
  function setSectionCtx(name, ctx) { __sectionCtx[name] = ctx; }

  // ── Filters ─────────────────────────────────────────────────────────

  function getFilteredDays(days) {
    if (!days?.length) return days;
    // Pinned historical range: the overlay already IS the requested range —
    // the date inputs reflect it, no further narrowing.
    if (__rangeOverlay) return days;
    var startEl = document.getElementById('filter-date-start');
    var endEl = document.getElementById('filter-date-end');
    var startVal = startEl ? startEl.value : '';
    var endVal = endEl ? endEl.value : '';
    if (!startVal && !endVal) return days;
    var filtered = [];
    for (var dy of days) {
      var d = dy.date;
      if (startVal && d < startVal) continue;
      if (endVal && d > endVal) continue;
      filtered.push(dy);
    }
    return filtered;
  }

  function getFilteredProxyDays(days) {
    var ranged = getFilteredDays(days || []);
    if (!ranged?.length) return ranged || [];
    var providerDays = __filterProvider === 'all' ? ranged : ranged.map(getProviderDay);
    var hostFilter = getFilterHost();
    if (__filterAccount === 'all' && !hostFilter) return providerDays;
    return providerDays.map(function (day) {
      var result = Object.assign({}, day);
      var requests = (day.gateway_last_requests || []).filter(requestMatchesFilters);
      result.gateway_last_requests = requests;
      result.gateway_requests_filtered = true;
      return result;
    });
  }

  function getFilterHost() {
    var container = document.getElementById('filter-host-container');
    if (!container) return '';
    var sel = container.querySelector('select');
    if (sel) {
      var opts = sel.selectedOptions;
      if (!opts?.length) return '';
      var vals = [];
      for (var opt of opts) vals.push(opt.value);
      if (vals.includes('')) return '';
      return vals.join(',');
    }
    var active = container.querySelector('.filter-chip.active');
    if (!active) return '';
    return active.dataset.host || '';
  }

  function getForensicHostFilter() {
    return __forensicHostFilterSig || '';
  }

  function setForensicHostFilter(val) {
    __forensicHostFilterSig = val || '';
  }

  // ── Provider filter ────────────────────────────────────────────────

  var __filterProvider = 'all';
  var __filterAccount = 'all';

  function getFilterProvider() { return __filterProvider; }
  function setFilterProvider(val) { __filterProvider = val || 'all'; }
  function getFilterAccount() { return __filterAccount; }
  function setFilterAccount(val) { __filterAccount = val || 'all'; }

  function requestMatchesFilters(req) {
    if (!req) return false;
    if (__filterProvider !== 'all') {
      var vendor = String(req.vendor || req.provider || req.endpoint || '').toLowerCase();
      if (vendor !== __filterProvider) return false;
    }
    if (__filterAccount !== 'all') {
      var account = String(req.account_key || req.organization_id || req._account_key || '');
      if (account !== __filterAccount) return false;
    }
    var hosts = getFilterHost().split(',').filter(Boolean);
    if (hosts.length) {
      var host = String(req.host || req.source_host || req.source_ip || '');
      if (!hosts.includes(host)) return false;
    }
    return true;
  }

  function getFilteredData(data) {
    if (!data) return data;
    var filteredDays = getFilteredDays(data.days || []);
    var hostKeys = getFilterHost().split(',').filter(Boolean);
    if (hostKeys.length) {
      filteredDays = filteredDays.map(function (day) {
        var buckets = hostKeys.map(function (key) { return day.hosts?.[key]; }).filter(Boolean);
        if (!buckets.length) return Object.assign({}, day, {
          input: 0, output: 0, cache_read: 0, cache_creation: 0,
          total: 0, calls: 0, hit_limit: 0, hours: {}, hour_signals: {},
          session_signals: {}
        });
        var out = Object.assign({}, day);
        var numeric = ['input', 'output', 'cache_read', 'cache_creation', 'total', 'calls',
          'active_hours', 'hit_limit', 'sub_calls', 'sub_cache'];
        numeric.forEach(function (key) {
          out[key] = buckets.reduce(function (sum, bucket) { return sum + (Number(bucket[key]) || 0); }, 0);
        });
        out.hours = {};
        out.session_signals = {};
        buckets.forEach(function (bucket) {
          Object.keys(bucket.hours || {}).forEach(function (hour) {
            out.hours[hour] = (out.hours[hour] || 0) + (Number(bucket.hours[hour]) || 0);
          });
          Object.keys(bucket.session_signals || {}).forEach(function (signal) {
            out.session_signals[signal] = (out.session_signals[signal] || 0) +
              (Number(bucket.session_signals[signal]) || 0);
          });
        });
        out.cache_output_ratio = out.output > 0 ? out.cache_read / out.output : 0;
        out.overhead = out.output > 0 ? out.total / out.output : 0;
        return out;
      });
    }
    return Object.assign({}, data, {
      days: filteredDays,
      proxy: Object.assign({}, data.proxy || {}, {
        proxy_days: getFilteredProxyDays(data.proxy?.proxy_days || [])
      })
    });
  }

  /**
   * Returns the data bucket for the active provider filter.
   * 'all' → original day object; specific provider → day.providers[provider] with date copied.
   */
  function getProviderDay(day) {
    if (__filterProvider === 'all' || !day) return day;
    var pb = day.providers?.[__filterProvider];
    if (!pb) return { date: day.date, requests: 0, errors: 0, error_rate: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, thinking_tokens: 0, models: {}, status_codes: {}, total_duration_ms: 0, avg_duration_ms: 0, min_duration_ms: 0, max_duration_ms: 0, response_bytes: 0, cache_read_ratio: null };
    var result = Object.assign({}, day, pb, { date: day.date });
    var providerRequests = day.gateway_requests_by_provider?.[__filterProvider];
    if (providerRequests) result.gateway_last_requests = providerRequests;
    // Compute derived fields charts expect
    if (result.requests > 0) {
      result.avg_duration_ms = Math.round(result.total_duration_ms / result.requests);
      result.error_rate = Math.round(result.errors / result.requests * 10000) / 100;
    } else {
      result.avg_duration_ms = 0;
      result.error_rate = 0;
    }
    var crTotal = (result.cache_read_tokens || 0) + (result.cache_creation_tokens || 0);
    result.cache_read_ratio = crTotal > 0 ? (result.cache_read_tokens || 0) / crTotal : null;
    result.cache_creation_tokens = result.cache_creation_tokens || 0;
    return result;
  }

  // ── Public API ──────────────────────────────────────────────────────

  window.__dashboardState = {
    getData: getData,
    setData: setData,
    getLiveData: getLiveData,
    setRangeOverlay: setRangeOverlay,
    clearRangeOverlay: clearRangeOverlay,
    getRangeOverlay: getRangeOverlay,
    isRangePinned: isRangePinned,
    getReleaseStability: getReleaseStability,
    setReleaseStability: setReleaseStability,
    getSectionCtx: getSectionCtx,
    setSectionCtx: setSectionCtx,
    getFilteredDays: getFilteredDays,
    getFilteredProxyDays: getFilteredProxyDays,
    getFilterHost: getFilterHost,
    getForensicHostFilter: getForensicHostFilter,
    setForensicHostFilter: setForensicHostFilter,
    getFilterProvider: getFilterProvider,
    setFilterProvider: setFilterProvider,
    getFilterAccount: getFilterAccount,
    setFilterAccount: setFilterAccount,
    requestMatchesFilters: requestMatchesFilters,
    getFilteredData: getFilteredData,
    getProviderDay: getProviderDay
  };

  // Phase 17: backward-compat window exports removed — use __dashboardState API

  // Phase 17d: __sectionCtx_* bridge removed — all consumers use getSectionCtx()/setSectionCtx()
})();
