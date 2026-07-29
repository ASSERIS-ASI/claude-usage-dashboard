/**
 * @asseris-module       Proxy
 * @asseris-description  Auto-annotated module metadata for public/js/sections/proxy.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * sections/proxy.js — Proxy Analysis section (extracted from dashboard.client.js).
 * Browser-side IIFE module. No require() / module.exports.
 *
 * Exports on window:
 *   renderProxyAnalysis(data)
 *   _computeProxyCtx(data)
 *   renderProxy_tokens / renderProxy_latency / renderProxy_hourly / renderProxy_models
 *   renderProxy_hourlyLatency / renderProxy_errorTrend / renderProxy_cacheTrend
 *   renderProxy_ttlHistory / renderProxy_trafficSources / renderProxy_clientCompare
 *   renderProxyEfficiencyTrend(data)
 *   renderEfficiencyHistory(data, el)     — called by gateway cut-impact toggle
 *   buildEfficiencyData(proxyDays, mainDays)
 *   __effInitOrSet / __effConnectCharts   — shared with econ charts
 *
 * Dependencies from window:
 *   fmt, pct, escHtml, t, tr, logClientOptionalErr
 *   _charts, echarts, chartShellSetLoading
 *   getForensicHostFilterForCharts, getProxyDay, __lastUsageData
 *   getFilteredDays, defined_colors
 *   _gatewayCharts                        — used by renderEfficiencyHistory
 *   classifyModelFamily                   — used by renderEfficiencyHistory
 */
(function () {
  function _proxyDays(data) {
    var days = data?.proxy?.proxy_days || [];
    return window.__dashboardState?.getFilteredProxyDays
      ? window.__dashboardState.getFilteredProxyDays(days)
      : days;
  }

  // ── State ───────────────────────────────────────────────────────────────
  var _proxyCharts = { tokens: null, latency: null };
  var _effCharts = { heatmap: null, ratio: null, vispct: null, cachemiss: null };
  window._effCharts = _effCharts; // expose for econ charts that use __effInitOrSet
  var __effResizeT = null;
  var __lastProxyFingerprint = "";
  window.__resetProxyFingerprint = function () { __lastProxyFingerprint = ''; };
  var __proxyToggleBound = false;
  var __gatewayToggleBound = false;

  // ── Resize helpers ──────────────────────────────────────────────────────
  function __effResizeAll() {
    for (var key of Object.keys(_effCharts)) {
      var c = _effCharts[key];
      if (c && typeof c.resize === "function") {
        try { c.resize(); } catch (error) { logClientOptionalErr(error); }
      }
    }
  }
  window.__effResizeAll = __effResizeAll;

  function __proxyChartsResizeAll() {
    for (var k in _proxyCharts) {
      if (_proxyCharts[k] && typeof _proxyCharts[k].resize === 'function') {
        try { _proxyCharts[k].resize(); } catch (error) { logClientOptionalErr(error); }
      }
    }
  }
  window.__proxyChartsResizeAll = __proxyChartsResizeAll;

  function __bindProxyToggleResize() {
    if (__proxyToggleBound) return;
    if (window.__widgetDispatcher) return;
    var det = document.getElementById("proxy-collapse");
    if (!det) return;
    __proxyToggleBound = true;
    det.addEventListener("toggle", function () {
      if (det.open) setTimeout(function () { __proxyChartsResizeAll(); __effResizeAll(); }, 60);
    });
  }

  function __bindGatewayToggleResize() {
    if (__gatewayToggleBound) return;
    if (window.__widgetDispatcher) return;
    var det = document.getElementById("gateway-collapse");
    if (!det) return;
    __gatewayToggleBound = true;
    det.addEventListener("toggle", function () {
      if (det.open) setTimeout(function () { if (typeof window.__gatewayChartsResizeAll === 'function') window.__gatewayChartsResizeAll(); }, 80);
    });
  }
  window.__bindGatewayToggleResize = __bindGatewayToggleResize;

  // ── Context builder ─────────────────────────────────────────────────────
  function _computeProxyCtx(data) {
    var sCtx = { data: data };
    window.__dashboardState.setSectionCtx('proxy', sCtx);
    return sCtx;
  }
  window._computeProxyCtx = _computeProxyCtx;

  function setProxySourceAvailability(proxyDays, hasInterceptor, hasProxy) {
    var requestOnly = hasInterceptor && !hasProxy;
    var sourceChanged = window.__proxyRequestOnly !== requestOnly;
    window.__proxyRequestOnly = requestOnly;
    ['c-proxy-latency', 'c-proxy-hourly-latency'].forEach(function (id) {
      var box = document.getElementById(id)?.closest('.chart-box');
      if (box) box.style.display = requestOnly ? 'none' : '';
    });
    var errorBox = document.getElementById('c-proxy-error-trend')?.closest('.chart-box');
    if (errorBox) errorBox.style.display = requestOnly || proxyDays.length < 2 ? 'none' : '';

    var efficiencyBox = document.getElementById('c-proxy-efficiency-heatmap')?.closest('.chart-box');
    if (efficiencyBox) efficiencyBox.style.display = proxyDays.length < 2 ? 'none' : '';
    if (sourceChanged) {
      if (window.__layoutTree) window.__layoutTree.renderWidgetTree();
      // Layout templates can be applied before the asynchronous proxy source
      // has established its capabilities. Re-apply once on a source change so
      // full-proxy-only widgets cannot be made visible again by the scaffold.
      if (window.__dispatcherLayout?.applyStoredInternalScaffolds) {
        setTimeout(function () {
          window.__dispatcherLayout.applyStoredInternalScaffolds();
          if (window.__widgetDispatcher?.resizeAll) window.__widgetDispatcher.resizeAll();
        }, 0);
      }
    }

    var note = document.getElementById('proxy-note');
    if (note && requestOnly) {
      note.textContent = t('proxyCacheFixSourceNote');
    }
  }

  // ── Widget Dispatcher shims ─────────────────────────────────────────────
  window.renderProxy_tokens = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyTokenChart(sCtx.data);
  };
  window.renderProxy_latency = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyLatencyChart(sCtx.data);
  };
  window.renderProxy_hourly = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyHourlyHeatmap(sCtx.data);
  };
  window.renderProxy_models = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyModelChart(sCtx.data);
  };
  window.renderProxy_hourlyLatency = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyHourlyLatency(sCtx.data);
  };
  window.renderProxy_errorTrend = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyErrorTrend(sCtx.data);
  };
  window.renderProxy_cacheTrend = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    renderProxyCacheTrend(sCtx.data);
  };

  window.renderProxy_cacheFixActivity = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx || typeof echarts === 'undefined') return;
    var pd = typeof getProxyDay === 'function' ? getProxyDay(sCtx.data) : null;
    var debug = pd?.cache_fix_debug;
    var box = document.getElementById('proxy-cache-fix-activity-box');
    var el = document.getElementById('c-proxy-cache-fix-activity');
    if (!box || !el) return;
    box.style.display = debug?.events?.length ? '' : 'none';
    if (!debug?.events?.length) {
      if (_proxyCharts.cacheFixActivity) {
        _proxyCharts.cacheFixActivity.dispose();
        _proxyCharts.cacheFixActivity = null;
      }
      return;
    }
    var h3 = document.getElementById('proxy-cache-fix-activity-h3');
    var blurb = document.getElementById('proxy-cache-fix-activity-blurb');
    if (h3) h3.textContent = t('proxyCacheFixActivityTitle');
    if (blurb) blurb.textContent = tr('proxyCacheFixActivityBlurb', {
      applied: debug.applied_total || 0,
      skipped: debug.skipped_total || 0
    });
    var hourly = debug.hourly || [];
    var hours = Array.from({ length: 24 }, function (_, hour) {
      return String(hour).padStart(2, '0') + ':00';
    });
    var names = new Set();
    for (var bucket of hourly) {
      for (var name of Object.keys(bucket.fixes || {})) names.add(name);
    }
    var palette = ['#22c55e', '#B8915A', '#f59e0b', '#db27b4', '#fbbf24', '#e879f9', '#fb7185', '#84cc16', '#14b8a6', '#D4AF7F', '#6ee7b7', '#f97316'];
    var series = Array.from(names).sort().map(function (name, index) {
      return {
        name: name.replace(/_/g, ' '),
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2 },
        itemStyle: { color: palette[index % palette.length] },
        data: hours.map(function (_, hour) { return hourly[hour]?.fixes?.[name] || 0; })
      };
    });
    series.push({
      name: 'Cache Read',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1, type: 'dashed', color: 'rgba(212,175,127,.65)' },
      areaStyle: { color: 'rgba(212,175,127,.08)' },
      data: hours.map(function (_, hour) { return hourly[hour]?.cache_read_tokens || 0; })
    });
    if (!_proxyCharts.cacheFixActivity) {
      _proxyCharts.cacheFixActivity = echarts.init(el, null, { renderer: 'canvas' });
    }
    _proxyCharts.cacheFixActivity.setOption({
      animation: false,
      grid: { left: 52, right: 70, top: 46, bottom: 30 },
      legend: { data: series.map(function (item) { return item.name; }), textStyle: { color: '#EFE7D6', fontSize: 10 }, top: 3 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,.96)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
      xAxis: { type: 'category', data: hours, axisLabel: { color: '#A0875E', fontSize: 10 } },
      yAxis: [
        { type: 'value', name: 'Observed fixes', axisLabel: { color: '#A0875E', fontSize: 10 }, nameTextStyle: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.5)' } } },
        { type: 'value', name: 'Cache Read', axisLabel: { color: '#A0875E', fontSize: 10, formatter: function (value) { return fmt(value); } }, nameTextStyle: { color: '#A0875E' }, splitLine: { show: false } }
      ],
      series: series
    }, true);
  };

  // ── TTL History widget ──────────────────────────────────────────────────
  window.renderProxy_ttlHistory = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    var data = sCtx.data;
    var el = document.getElementById("c-proxy-ttl-history");
    if (!el) return;
    var h3 = document.getElementById("proxy-ttl-history-h3");
    if (h3) h3.textContent = t("proxyTtlHistoryTitle");
    var blurb = document.getElementById("proxy-ttl-history-blurb");
    if (blurb) blurb.textContent = t("proxyTtlHistoryBlurb");

    var pd = data?.proxy ? data.proxy.proxy_days || [] : [];
    if (!pd.length) return;
    var jsonlDays = data?.days ? data.days : [];
    var jsonlByDate = {};
    for (var _jd of jsonlDays) {
      if (_jd.date) jsonlByDate[_jd.date] = _jd;
    }
    var labels = [], d1h = [], d5m = [], dUnk = [], dIntr = [], dCold = [];
    for (var day of pd) {
      labels.push(day.date || "");
      var ttl = day.ttl_tiers || {};
      var t1h = ttl["1h"] || 0;
      var t5m = ttl["5m"] || 0;
      var tUnk = ttl.unknown || 0;
      d1h.push(t1h);
      d5m.push(t5m);
      dUnk.push(tUnk);
      var ttlTotal = t1h + t5m + tUnk;
      dCold.push(ttlTotal > 0 ? Math.round(t5m / ttlTotal * 100) : 0);
      var jd = jsonlByDate[day.date];
      var sig = jd?.session_signals ? jd.session_signals : {};
      dIntr.push((sig.interrupt || 0) + (sig.retry || 0));
    }
    if (!_proxyCharts.ttlHistory) _proxyCharts.ttlHistory = echarts.init(el, null, { renderer: "canvas" });
    _proxyCharts.ttlHistory.setOption({
      animation: false,
      grid: { left: 50, right: 55, top: 36, bottom: 30 },
      legend: { data: ["1h", "5m", "unknown", t("proxyTtlColdPct"), t("proxyTtlInterrupts")], textStyle: { color: "#EFE7D6", fontSize: 10 }, top: 4 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(14,17,22,0.95)",
        borderColor: "#2A2D34",
        textStyle: { color: "#F7F3EC", fontSize: 12 },
        formatter: function (params) {
          var lines = [params[0].axisValueLabel];
          var ttlTotal = 0;
          for (var _pt of params) {
            if (_pt.seriesType === "bar") ttlTotal += _pt.value || 0;
          }
          for (var p of params) {
            if (p.seriesType === "bar") {
              var pct = ttlTotal > 0 ? Math.round(p.value / ttlTotal * 100) : 0;
              lines.push(p.marker + " " + p.seriesName + ": " + p.value + " (" + pct + "%)");
            } else {
              lines.push(p.marker + " " + p.seriesName + ": " + p.value);
            }
          }
          return lines.join("<br>");
        }
      },
      xAxis: { type: "category", data: labels, axisLabel: { color: "#A0875E", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(42,45,52,0.5)" } } },
      yAxis: [
        { type: "value", name: "Requests", nameTextStyle: { color: "#A0875E", fontSize: 11 }, axisLabel: { color: "#A0875E", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(42,45,52,0.5)" } } },
        { type: "value", name: "Cold %", nameLocation: "center", nameGap: 35, nameRotate: 90, nameTextStyle: { color: "#fbbf24", fontSize: 11 }, min: 0, max: 100, axisLabel: { color: "#fbbf24", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } },
        { type: "value", name: t("proxyTtlInterrupts"), nameLocation: "center", nameGap: 40, nameRotate: 90, nameTextStyle: { color: "#f87171", fontSize: 11 }, axisLabel: { show: false }, splitLine: { show: false }, show: false }
      ],
      series: [
        { name: "1h", type: "bar", stack: "ttl", data: d1h, itemStyle: { color: "rgba(34,197,94,0.7)" }, barCategoryGap: "20%" },
        { name: "5m", type: "bar", stack: "ttl", data: d5m, itemStyle: { color: "rgba(251,191,36,0.6)" }, barCategoryGap: "20%" },
        { name: "unknown", type: "bar", stack: "ttl", data: dUnk, itemStyle: { color: "rgba(107,114,128,0.35)" }, barCategoryGap: "20%" },
        { name: t("proxyTtlColdPct"), type: "line", yAxisIndex: 1, data: dCold, smooth: 0.25, symbol: "diamond", symbolSize: 6,
          itemStyle: { color: "rgba(251,191,36,0.8)" },
          lineStyle: { color: "rgba(251,191,36,0.8)", width: 2 }, itemStyle: { color: "#fbbf24" },
          markLine: { silent: true, symbol: "none", lineStyle: { color: "rgba(251,191,36,0.3)", type: "dashed" },
            label: { show: false }, data: [{ yAxis: 20 }] } },
        { name: t("proxyTtlInterrupts"), type: "bar", yAxisIndex: 2, data: dIntr, barCategoryGap: "60%",
          itemStyle: { color: "rgba(248,113,113,0.45)" } }
      ]
    }, true);
  };

  // ── Traffic Sources widget ──────────────────────────────────────────────
  window.renderProxy_trafficSources = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    var data = sCtx.data;
    var el = document.getElementById("c-proxy-traffic-sources");
    if (!el) return;

    var pd = data?.proxy ? data.proxy.proxy_days || [] : [];
    if (!pd.length) return;

    var clientAgg = {};
    var connAgg = {};
    for (var day of pd) {
      var ct = day.client_types || {};
      for (var k of Object.keys(ct)) {
        clientAgg[k] = (clientAgg[k] || 0) + ct[k];
      }
      var cn = day.connection_types || {};
      for (var c of Object.keys(cn)) {
        connAgg[c] = (connAgg[c] || 0) + cn[c];
      }
    }

    var clientData = Object.entries(clientAgg)
      .map(function (e) { return { name: e[0], value: e[1] }; })
      .sort(function (a, b) { return b.value - a.value; });

    var connData = Object.entries(connAgg)
      .map(function (e) { return { name: e[0], value: e[1] }; })
      .sort(function (a, b) { return b.value - a.value; });

    var colors = ['#D4AF7F', '#34d399', '#fbbf24', '#f87171', '#D4AF7F', '#fb923c', '#A0875E'];

    if (!_proxyCharts.trafficSources) _proxyCharts.trafficSources = echarts.init(el, null, { renderer: "canvas" });
    _proxyCharts.trafficSources.setOption({
      animation: false,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(14,17,22,0.95)",
        borderColor: "#2A2D34",
        textStyle: { color: "#F7F3EC", fontSize: 12 },
        formatter: "{b}: {c} ({d}%)"
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        textStyle: { color: "#EFE7D6", fontSize: 10 }
      },
      color: colors,
      series: [
        {
          name: "Client",
          type: "pie",
          radius: ["30%", "55%"],
          center: ["28%", "45%"],
          label: { color: "#EFE7D6", fontSize: 10, formatter: "{b}\n{d}%" },
          data: clientData
        },
        {
          name: "Connection",
          type: "pie",
          radius: ["30%", "55%"],
          center: ["72%", "45%"],
          label: { color: "#EFE7D6", fontSize: 10, formatter: "{b}\n{d}%" },
          data: connData
        }
      ],
      title: [
        { text: "Client Type", left: "18%", top: 2, textStyle: { color: "#A0875E", fontSize: 12, fontWeight: "normal" }, textAlign: "center" },
        { text: "Connection Type", left: "62%", top: 2, textStyle: { color: "#A0875E", fontSize: 12, fontWeight: "normal" }, textAlign: "center" }
      ]
    }, true);
  };

  // ── Client Compare widget ───────────────────────────────────────────────
  window.renderProxy_clientCompare = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('proxy');
    if (!sCtx) return;
    var data = sCtx.data;
    var el = document.getElementById("c-proxy-client-compare");
    if (!el) return;

    var pd = data?.proxy ? data.proxy.proxy_days || [] : [];
    if (!pd.length) return;

    var anthropicHourly = {};
    var monitorHosts = {};

    for (var day of pd) {
      var phl = day.per_hour_latency || {};
      for (var h of Object.keys(phl)) {
        if (!anthropicHourly[h]) anthropicHourly[h] = { count: 0, total_ms: 0 };
        var hd = phl[h];
        anthropicHourly[h].count += hd.count || 0;
        anthropicHourly[h].total_ms += (hd.avg || 0) * (hd.count || 0);
      }
      var cm = day.connect_monitor || {};
      for (var host of Object.keys(cm)) {
        if (!monitorHosts[host]) monitorHosts[host] = { count: 0, total_ms: 0, bytes_received: 0, hourly: {} };
        var mh = cm[host];
        monitorHosts[host].count += mh.count || 0;
        monitorHosts[host].total_ms += mh.total_ms || 0;
        monitorHosts[host].bytes_received += mh.bytes_received || 0;
        var mhh = mh.hourly || {};
        for (var hk of Object.keys(mhh)) {
          if (!monitorHosts[host].hourly[hk]) monitorHosts[host].hourly[hk] = { count: 0, total_ms: 0 };
          monitorHosts[host].hourly[hk].count += mhh[hk].count || 0;
          monitorHosts[host].hourly[hk].total_ms += mhh[hk].total_ms || 0;
        }
      }
    }

    var hours = [];
    var anthropicAvg = [];
    var anthropicCount = [];
    for (var i = 0; i < 24; i++) {
      hours.push(String(i).padStart(2, "0") + ":00");
      var ah = anthropicHourly[String(i)];
      anthropicAvg.push(ah && ah.count ? Math.round(ah.total_ms / ah.count) : null);
      anthropicCount.push(ah ? ah.count : 0);
    }

    var series = [
      {
        name: "Anthropic (ms)",
        type: "bar",
        data: anthropicAvg,
        itemStyle: { color: "rgba(96,165,250,0.7)" },
        barCategoryGap: "30%"
      },
      {
        name: "Anthropic (req)",
        type: "line",
        yAxisIndex: 1,
        data: anthropicCount,
        smooth: 0.3,
        symbol: "none",
        lineStyle: { color: "rgba(96,165,250,0.4)", width: 1, type: "dashed" }
      }
    ];

    var monitorColors = ["#fbbf24", "#f87171", "#D4AF7F", "#34d399"];
    var ci = 0;
    for (var mHost of Object.keys(monitorHosts)) {
      var mData = monitorHosts[mHost];
      var color = monitorColors[ci % monitorColors.length];
      ci++;
      var shortName = mHost.replace(/\.cursor\.sh$/, "");
      var mAvg = [];
      var mCount = [];
      for (var j = 0; j < 24; j++) {
        var mhd = mData.hourly[String(j)];
        mAvg.push(mhd && mhd.count ? Math.round(mhd.total_ms / mhd.count) : null);
        mCount.push(mhd ? mhd.count : 0);
      }
      series.push({
        name: shortName + " (ms)",
        type: "bar",
        data: mAvg,
        itemStyle: { color: color.replace(")", ",0.7)").replace("rgb", "rgba") || color },
        barCategoryGap: "30%"
      });
      series.push({
        name: shortName + " (req)",
        type: "line",
        yAxisIndex: 1,
        data: mCount,
        smooth: 0.3,
        symbol: "none",
        lineStyle: { color: color, width: 1, type: "dashed" }
      });
    }

    var totalAnthropic = Object.values(anthropicHourly).reduce(function (s, h) { return s + h.count; }, 0);
    var avgAnthropic = totalAnthropic > 0 ? Math.round(Object.values(anthropicHourly).reduce(function (s, h) { return s + h.total_ms; }, 0) / totalAnthropic) : 0;
    var monitorSummary = Object.entries(monitorHosts).map(function (e) {
      return e[0].replace(/\.cursor\.sh$/, "") + ": " + (e[1].count > 0 ? Math.round(e[1].total_ms / e[1].count) : 0) + "ms";
    }).join(" | ");

    if (!_proxyCharts.clientCompare) _proxyCharts.clientCompare = echarts.init(el, null, { renderer: "canvas" });
    _proxyCharts.clientCompare.setOption({
      animation: false,
      grid: { left: 50, right: 50, top: 50, bottom: 30 },
      legend: { textStyle: { color: "#EFE7D6", fontSize: 10 }, top: 4 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(14,17,22,0.95)",
        borderColor: "#2A2D34",
        textStyle: { color: "#F7F3EC", fontSize: 12 }
      },
      title: {
        text: "Anthropic: " + avgAnthropic + "ms avg | " + (monitorSummary || "no monitor data"),
        right: 10, top: 4,
        textStyle: { color: "#8C6A3F", fontSize: 11, fontWeight: "normal" }
      },
      xAxis: { type: "category", data: hours, axisLabel: { color: "#A0875E", fontSize: 11 } },
      yAxis: [
        { type: "value", name: "Avg Latency (ms)", nameTextStyle: { color: "#A0875E", fontSize: 11 }, axisLabel: { color: "#A0875E", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(42,45,52,0.5)" } } },
        { type: "value", name: "Requests", nameTextStyle: { color: "#8C6A3F", fontSize: 11 }, axisLabel: { color: "#8C6A3F", fontSize: 11 }, splitLine: { show: false } }
      ],
      series: series
    }, true);
  };

  // ── Helper functions ────────────────────────────────────────────────────
  function destroyProxyCharts() {
    for (var k in _proxyCharts) {
      if (_proxyCharts[k]) { try { _proxyCharts[k].dispose(); } catch (error) { logClientOptionalErr(error); } _proxyCharts[k] = null; }
    }
  }

  function gaugeColor(pct) {
    if (pct >= 80) return "#ef4444";
    if (pct >= 50) return "#f59e0b";
    return "#22c55e";
  }
  window.gaugeColor = gaugeColor;

  function __fmtMsShort(v) {
    return v >= 1000 ? (v / 1000).toFixed(1) + "s" : Math.round(v) + "ms";
  }

  function aggregateHourlyTotals(proxyDays) {
    var totals = {};
    for (var pd of proxyDays) {
      var dh = pd.hours || {};
      for (var hk in dh) {
        if (Object.hasOwn(dh, hk)) totals[hk] = (totals[hk] || 0) + (dh[hk] || 0);
      }
    }
    var labels = [], values = [], maxVal = 0;
    for (var h = 0; h <= 23; h++) {
      var v = totals[String(h)] || 0;
      if (v > maxVal) maxVal = v;
      values.push(v);
      labels.push(String(h).length < 2 ? "0" + h : String(h));
    }
    var bgColors = values.map(function(val) {
      var intensity = maxVal > 0 ? Math.min(1, val / maxVal) : 0;
      return val === 0 ? "rgba(42,45,52,.2)" : "rgba(184,145,90," + (0.2 + intensity * 0.7).toFixed(2) + ")";
    });
    return { labels: labels, values: values, bgColors: bgColors };
  }

  function __aggAddHourLatency(agg, hk, hl) {
    if (!agg[hk]) agg[hk] = { sum: 0, count: 0, max: 0 };
    agg[hk].sum += hl.sum;
    agg[hk].count += hl.count;
    if (hl.max > agg[hk].max) agg[hk].max = hl.max;
  }

  function aggregateHourlyLatency(proxyDays) {
    var agg = {};
    for (var pd of proxyDays) {
      var phl = pd.per_hour_latency || {};
      for (var hk in phl) {
        if (!Object.hasOwn(phl, hk)) continue;
        var hl = phl[hk];
        if (hl?.count) __aggAddHourLatency(agg, hk, hl);
      }
    }
    var labels = [], avgData = [], maxData = [];
    for (var h = 0; h <= 23; h++) {
      var key = String(h);
      labels.push(key.length < 2 ? "0" + key : key);
      var a = agg[key];
      avgData.push(a?.count > 0 ? Math.round(a.sum / a.count) : 0);
      maxData.push(a?.max || 0);
    }
    var nonZeroMax = maxData.filter(function(v) { return v > 0; }).sort(function(a, b) { return a - b; });
    var avgMean = avgData.reduce(function(s, v) { return s + v; }, 0) / (avgData.length || 1);
    var actualMax = nonZeroMax.length ? nonZeroMax[nonZeroMax.length - 1] : 0;
    var p95 = nonZeroMax.length ? nonZeroMax[Math.floor(nonZeroMax.length * 0.95)] : 0;
    var yCap = (p95 > 0 && actualMax > avgMean * 5) ? Math.ceil(p95 * 1.3) : undefined;
    return { labels: labels, avgData: avgData, maxData: maxData, yCap: yCap };
  }

  function __proxyHourlyLatencyYAxis(ld, legendSelected) {
    var nameMax = t("proxyDSMaxLatency");
    var yBase = { type: 'value', min: 0, axisLabel: { color: '#A0875E', formatter: function(v) { return __fmtMsShort(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } };
    var maxOn = legendSelected?.[nameMax] !== false;
    if (ld.yCap && maxOn) yBase.max = ld.yCap;
    return yBase;
  }

  function __proxyJsonlMatchAggregate(days, proxyByDate) {
    var matches = 0;
    var jsonlTotal = 0;
    var proxyTotal = 0;
    for (var day of days) {
      var pdx = proxyByDate[day.date];
      if (!pdx) continue;
      matches++;
      jsonlTotal += (day.total || 0);
      proxyTotal += (pdx.total_tokens || 0);
    }
    return { matches: matches, jsonlTotal: jsonlTotal, proxyTotal: proxyTotal };
  }

  // ── Render: Proxy Token Chart ───────────────────────────────────────────
  function renderProxyTokenChart(data) {
    if (typeof echarts === "undefined") return;
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) { chartShellSetLoading("c-proxy-tokens", false); return; }

    var labels = [], cacheRead = [], cacheCreate = [], output = [];
    var _ds = window.__dashboardState;
    for (var i = 0; i < proxyDays.length; i++) {
      var d = _ds ? _ds.getProviderDay(proxyDays[i]) : proxyDays[i];
      labels.push(d.date ? d.date.slice(5) : String(i));
      cacheRead.push(d.cache_read_tokens || 0);
      cacheCreate.push(d.cache_creation_tokens || 0);
      output.push(d.output_tokens || 0);
    }

    chartShellSetLoading("c-proxy-tokens", false);
    var el = document.getElementById("c-proxy-tokens");
    if (!el) return;
    if (!_proxyCharts.tokens) _proxyCharts.tokens = echarts.init(el, null, { renderer: 'canvas' });
    _proxyCharts.tokens.setOption({
      animation: false,
      grid: { left: 60, right: 16, top: 36, bottom: 30 },
      legend: { data: [t("proxyDSCacheRead"), t("proxyDSCacheCreate"), t("proxyDSOutput")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var _pm of params) lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + fmt(_pm.value));
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', axisLabel: { color: '#A0875E', formatter: function(v) { return fmt(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [
        { name: t("proxyDSCacheRead"), type: 'bar', stack: 's', data: cacheRead, itemStyle: { color: 'rgba(212,175,127,0.7)' } },
        { name: t("proxyDSCacheCreate"), type: 'bar', stack: 's', data: cacheCreate, itemStyle: { color: 'rgba(6,182,212,0.6)' } },
        { name: t("proxyDSOutput"), type: 'bar', stack: 's', data: output, itemStyle: { color: 'rgba(34,197,94,0.7)' } }
      ]
    }, true);
  }

  // ── Render: Proxy Latency Chart ─────────────────────────────────────────
  function renderProxyLatencyChart(data) {
    if (typeof echarts === "undefined") return;
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) { chartShellSetLoading("c-proxy-latency", false); return; }

    var labels = [], avg = [], mn = [];
    var _ds = window.__dashboardState;
    for (var i = 0; i < proxyDays.length; i++) {
      var d = _ds ? _ds.getProviderDay(proxyDays[i]) : proxyDays[i];
      labels.push(d.date ? d.date.slice(5) : String(i));
      avg.push(d.avg_duration_ms || 0);
      mn.push(d.min_duration_ms || 0);
    }

    chartShellSetLoading("c-proxy-latency", false);
    var el = document.getElementById("c-proxy-latency");
    if (!el) return;
    if (!_proxyCharts.latency) _proxyCharts.latency = echarts.init(el, null, { renderer: 'canvas' });
    _proxyCharts.latency.setOption({
      animation: false,
      grid: { left: 60, right: 16, top: 36, bottom: 30 },
      legend: { data: [t("proxyDSAvgLatency"), t("proxyDSMinLatency")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var _pm of params) lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + __fmtMsShort(_pm.value));
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', formatter: function(v) { return __fmtMsShort(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [
        { name: t("proxyDSAvgLatency"), type: 'line', data: avg, smooth: 0.3, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#B8915A' },
          lineStyle: { color: '#B8915A', width: 2 }, itemStyle: { color: '#B8915A' }, areaStyle: { color: 'rgba(184,145,90,0.15)' } },
        { name: t("proxyDSMinLatency"), type: 'line', data: mn, smooth: 0.3, symbol: 'circle', symbolSize: 4, itemStyle: { color: '#22c55e' },
          lineStyle: { color: '#22c55e', width: 1, type: [4, 2] }, itemStyle: { color: '#22c55e' } }
      ]
    }, true);
  }

  // ── Render: Invisible Cost ──────────────────────────────────────────────
  function renderProxyInvisibleCost(pd) {
    var el = document.getElementById("proxy-invisible-cost");
    if (!el) return;
    if (!pd) return;
    var rl = pd.rate_limit || {};
    var q5 = Number.parseFloat(rl["anthropic-ratelimit-unified-5h-utilization"] || 0);
    var visibleTokens = (pd.output_tokens || 0) + (pd.input_tokens || 0);
    var cacheTokens = (pd.cache_read_tokens || 0) + (pd.cache_creation_tokens || 0);
    var totalVisible = visibleTokens + cacheTokens;
    var costNote = "";
    if (q5 > 0 && visibleTokens > 0) {
      var visPerPct = visibleTokens / (q5 * 100);
      costNote = tr("proxyInvisibleCostNote", {
        visible: fmt(visibleTokens),
        cache: fmt(cacheTokens),
        perPct: fmt(Math.round(visPerPct))
      });
    }
    el.textContent = costNote;
  }

  // ── Render: Hourly Heatmap ──────────────────────────────────────────────
  function renderProxyHourlyHeatmap(data) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("c-proxy-hourly");
    if (!el) return;
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) return;
    var hd = aggregateHourlyTotals(proxyDays);

    chartShellSetLoading("c-proxy-hourly", false);
    if (!_proxyCharts.hourly) _proxyCharts.hourly = echarts.init(el, null, { renderer: 'canvas' });
    var nDays = proxyDays.length;
    _proxyCharts.hourly.setOption({
      animation: false,
      grid: { left: 40, right: 16, top: 12, bottom: 30 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) { var p = params[0]; return p.name + ':00 UTC<br>' + p.value + ' requests (' + nDays + ' days)'; }
      },
      xAxis: { type: 'category', data: hd.labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [{
        type: 'bar', data: hd.values,
        itemStyle: { color: function(p) { return hd.bgColors[p.dataIndex]; }, borderRadius: [3, 3, 0, 0] }
      }]
    }, true);
  }

  // ── Render: Model Chart ─────────────────────────────────────────────────
  function renderProxyModelChart(data) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("c-proxy-models");
    if (!el) return;
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) return;
    var fallbackColors = ["#B8915A", "#D4AF7F", "#22c55e", "#ef4444", "#06b6d4"];
    var _ds = window.__dashboardState;
    var _pDays = proxyDays.map(function(d) { return _ds ? _ds.getProviderDay(d) : d; });
    var allModels = {};
    for (var pd of _pDays) {
      var dm = pd.models || {};
      for (var mk in dm) { if (Object.hasOwn(dm, mk)) allModels[mk] = true; }
    }
    var modelKeys = Object.keys(allModels).sort(function(a, b) { return a.localeCompare(b); });
    var labels = _pDays.map(function(d) { return d.date ? d.date.slice(5) : "?"; });
    var series = [];
    var legendData = [];
    for (var mi = 0; mi < modelKeys.length; mi++) {
      var mKey = modelKeys[mi];
      var short = mKey.replace("claude-", "").replace(/-\d{8}$/, "");
      legendData.push(short);
      series.push({ name: short, type: 'bar', stack: 'models', yAxisIndex: 0, data: _pDays.map(function(d) { return d.models?.[mKey]?.requests || d.models?.[mKey] || 0; }), itemStyle: { color: modelFamilyColor(mKey, fallbackColors[mi % fallbackColors.length]), borderRadius: [2, 2, 0, 0] } });
    }
    var latLabel = t("proxyDSModelLatency");
    legendData.push(latLabel);
    series.push({ name: latLabel, type: 'line', yAxisIndex: 1, data: _pDays.map(function(d) { return d.avg_duration_ms || 0; }), smooth: 0.3, symbol: 'circle', symbolSize: 6, lineStyle: { color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { color: 'rgba(245,158,11,0.15)' } });

    chartShellSetLoading("c-proxy-models", false);
    if (!_proxyCharts.models) _proxyCharts.models = echarts.init(el, null, { renderer: 'canvas' });
    _proxyCharts.models.setOption({
      animation: false,
      grid: { left: 50, right: 60, top: 36, bottom: 30 },
      legend: { data: legendData, textStyle: { color: '#EFE7D6', fontSize: 10 }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var p of params) {
            lines.push(p.marker + ' ' + p.seriesName + ': ' + (p.seriesType === 'line' ? __fmtMsShort(p.value) : p.value));
          }
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: [
        { type: 'value', min: 0, position: 'left', name: t("proxyAxisRequests"), nameTextStyle: { color: '#A0875E', fontSize: 10 }, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        { type: 'value', min: 0, position: 'right', name: t("proxyAxisLatency"), nameTextStyle: { color: '#f59e0b', fontSize: 10 }, axisLabel: { color: '#f59e0b', formatter: function(v) { return __fmtMsShort(v); } }, splitLine: { show: false } }
      ],
      series: series
    }, true);
  }

  // ── Render: Cold Start ──────────────────────────────────────────────────
  function renderProxyColdStart(pd) {
    var el = document.getElementById("proxy-coldstart-info");
    if (!el) return;
    var cs = pd.cold_starts || 0;
    var ratios = pd.cache_ratios || [];
    if (!ratios.length) { el.textContent = ""; return; }
    var avgRatio = 0;
    for (var _rv of ratios) avgRatio += _rv;
    avgRatio = avgRatio / ratios.length;
    var minRatio = ratios[0];
    for (var j = 1; j < ratios.length; j++) { if (ratios[j] < minRatio) minRatio = ratios[j]; }
    var text = tr("proxyColdStartInfo", {
      cold: cs,
      total: ratios.length,
      avg: (avgRatio * 100).toFixed(1),
      min: (minRatio * 100).toFixed(1)
    });
    el.textContent = text;
    el.style.color = cs > 0 ? "#f59e0b" : "#22c55e";
  }

  // ── Render: JSONL vs Proxy Comparison ───────────────────────────────────
  function renderProxyJsonlComparison(data) {
    var el = document.getElementById("proxy-jsonl-compare");
    if (!el) return;
    var days = data.days || [];
    var proxyDays = _proxyDays(data);
    if (!days.length || !proxyDays.length) {
      el.textContent = days.length ? "" : t("proxyJsonlNoData");
      return;
    }
    var proxyByDate = {};
    for (var pDay of proxyDays) {
      proxyByDate[pDay.date] = pDay;
    }
    var agg = __proxyJsonlMatchAggregate(days, proxyByDate);
    var matches = agg.matches;
    var jsonlTotal = agg.jsonlTotal;
    var proxyTotal = agg.proxyTotal;
    if (!matches) { el.textContent = t("proxyJsonlNoOverlap"); return; }
    var ratio = proxyTotal > 0 ? (jsonlTotal / proxyTotal) : 0;
    el.textContent = tr("proxyJsonlCompare", {
      days: matches,
      jsonl: fmt(jsonlTotal),
      proxy: fmt(proxyTotal),
      ratio: ratio.toFixed(2)
    });
    el.style.color = ratio > 1.5 ? "#ef4444" : ratio > 1.1 ? "#f59e0b" : "#22c55e";
  }

  // ── Render: Hourly Latency ──────────────────────────────────────────────
  function renderProxyHourlyLatency(data) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("c-proxy-hourly-latency");
    if (!el) return;
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) return;
    var ld = aggregateHourlyLatency(proxyDays);

    chartShellSetLoading("c-proxy-hourly-latency", false);
    if (!_proxyCharts.hourlyLatency) _proxyCharts.hourlyLatency = echarts.init(el, null, { renderer: 'canvas' });
    var chart = _proxyCharts.hourlyLatency;
    var yOpts = __proxyHourlyLatencyYAxis(ld, null);
    var maxSeries = { name: t("proxyDSMaxLatency"), type: 'bar', data: ld.maxData, barGap: '-100%', z: 1, itemStyle: { color: 'rgba(239,68,68,0.25)', borderRadius: [2, 2, 0, 0] } };
    if (ld.yCap) {
      maxSeries.markLine = { silent: true, symbol: 'none', data: [{ yAxis: ld.yCap, lineStyle: { color: '#ef4444', type: 'dashed', width: 1 }, label: { show: true, position: 'insideEndTop', color: '#ef4444', fontSize: 9, formatter: 'outlier cap ' + __fmtMsShort(ld.yCap) } }] };
    }
    chart.setOption({
      animation: false,
      grid: { left: 60, right: 16, top: 36, bottom: 38 },
      legend: { data: [t("proxyDSAvgLatency"), t("proxyDSMaxLatency")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel + ':00'];
          for (var _pm of params) lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + __fmtMsShort(_pm.value));
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: ld.labels, axisLabel: { color: '#A0875E', fontSize: 10, rotate: 0 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: yOpts,
      series: [
        maxSeries,
        { name: t("proxyDSAvgLatency"), type: 'bar', data: ld.avgData, z: 2, itemStyle: { color: 'rgba(184,145,90,0.7)', borderRadius: [2, 2, 0, 0] } }
      ]
    }, true);
    chart.off("legendselectchanged");
    chart.on("legendselectchanged", function(ev) {
      var sel = ev.selected || {};
      chart.setOption({ yAxis: __proxyHourlyLatencyYAxis(ld, sel) }, { replaceMerge: ["yAxis"] });
    });
  }

  // ── Render: Error Trend ─────────────────────────────────────────────────
  function renderProxyErrorTrend(data) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("c-proxy-error-trend");
    if (!el) return;
    var proxyDays = _proxyDays(data);
    if (proxyDays.length < 2) return;
    var _ds = window.__dashboardState;
    var _pDays = proxyDays.map(function(d) { return _ds ? _ds.getProviderDay(d) : d; });
    var labels = _pDays.map(function(d) { return d.date ? d.date.slice(5) : "?"; });
    var errRate = _pDays.map(function(d) { return d.error_rate || 0; });
    var f429 = _pDays.map(function(d) { return d.requests > 0 ? Math.round((d.false_429s || 0) / d.requests * 100 * 10) / 10 : 0; });

    chartShellSetLoading("c-proxy-error-trend", false);
    var h3 = document.getElementById("proxy-error-trend-h3");
    if (h3) h3.textContent = t("proxyErrorTrendTitle");
    var blurb = document.getElementById("proxy-error-trend-blurb");
    if (blurb) blurb.textContent = t("proxyErrorTrendBlurb");

    if (!_proxyCharts.errorTrend) _proxyCharts.errorTrend = echarts.init(el, null, { renderer: 'canvas' });
    _proxyCharts.errorTrend.setOption({
      animation: false,
      grid: { left: 46, right: 16, top: 36, bottom: 30 },
      legend: { data: [t("proxyDSErrorRate"), t("proxyDSFalse429Rate")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var _pm of params) lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + _pm.value.toFixed(1) + '%');
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', formatter: function(v) { return v + '%'; } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [
        { name: t("proxyDSErrorRate"), type: 'line', data: errRate, smooth: 0.3, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#ef4444' },
          lineStyle: { color: '#ef4444' }, itemStyle: { color: '#ef4444' }, areaStyle: { color: 'rgba(239,68,68,0.1)' } },
        { name: t("proxyDSFalse429Rate"), type: 'line', data: f429, smooth: 0.3, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#f59e0b' },
          lineStyle: { color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { color: 'rgba(245,158,11,0.1)' } }
      ]
    }, true);
  }

  // ── Render: Cache Trend ─────────────────────────────────────────────────
  function renderProxyCacheTrend(data) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("c-proxy-cache-trend");
    if (!el) return;
    var h3 = document.getElementById("proxy-cache-trend-h3");
    if (h3) h3.textContent = t("proxyCacheTrendTitle");
    var blurb = document.getElementById("proxy-cache-trend-blurb");
    if (blurb) blurb.textContent = t("proxyCacheTrendBlurb");
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) {
      chartShellSetLoading("c-proxy-cache-trend", false);
      return;
    }
    var _ds = window.__dashboardState;
    var _pDays = proxyDays.map(function(d) { return _ds ? _ds.getProviderDay(d) : d; });
    var labels = _pDays.map(function(d) { return d.date ? d.date.slice(5) : "?"; });
    var ratio = _pDays.map(function(d) { return d.cache_read_ratio == null ? 0 : Math.round(d.cache_read_ratio * 100 * 10) / 10; });
    var coldStarts = _pDays.map(function(d) { return d.cold_starts || 0; });

    chartShellSetLoading("c-proxy-cache-trend", false);
    if (!_proxyCharts.cacheTrend) _proxyCharts.cacheTrend = echarts.init(el, null, { renderer: 'canvas' });
    _proxyCharts.cacheTrend.setOption({
      animation: false,
      grid: { left: 50, right: 60, top: 36, bottom: 30 },
      legend: { data: [t("proxyDSCacheRatio"), t("proxyDSColdStarts")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var p of params) {
            lines.push(p.marker + ' ' + p.seriesName + ': ' + (p.seriesType === 'line' ? p.value.toFixed(1) + '%' : p.value));
          }
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: [
        { type: 'value', min: 0, max: 100, position: 'left', name: 'Cache Ratio', nameTextStyle: { color: '#22c55e', fontSize: 10 }, axisLabel: { color: '#22c55e', formatter: function(v) { return v + '%'; } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        { type: 'value', min: 0, position: 'right', name: 'Cold Starts', nameTextStyle: { color: '#B8915A', fontSize: 10 }, axisLabel: { color: '#B8915A' }, splitLine: { show: false } }
      ],
      series: [
        { name: t("proxyDSCacheRatio"), type: 'line', yAxisIndex: 0, data: ratio, smooth: 0.3, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#22c55e' },
          lineStyle: { color: '#22c55e' }, itemStyle: { color: '#22c55e' }, areaStyle: { color: 'rgba(34,197,94,0.1)' } },
        { name: t("proxyDSColdStarts"), type: 'bar', yAxisIndex: 1, data: coldStarts, itemStyle: { color: 'rgba(184,145,90,0.5)', borderRadius: [2, 2, 0, 0] } }
      ]
    }, true);
  }

  // ── Main: renderProxyAnalysis ───────────────────────────────────────────
  function renderProxyAnalysis(data) {
    __bindProxyToggleResize();
    _computeProxyCtx(data);
    var sumEl = document.getElementById("proxy-summary-line");
    var noteEl = document.getElementById("proxy-note");
    var cardsEl = document.getElementById("proxy-cards");
    if (!sumEl) return;

    var det = document.getElementById("proxy-collapse");
    var _rawPd = getProxyDay(data);
    var pd = window.__dashboardState ? window.__dashboardState.getProviderDay(_rawPd) : _rawPd;
    var fp = (data.proxy?.generated || "") + "|" +
      (data.proxy?.proxy_days || []).map(function (d) { return d.date; }).join(',') + "|" +
      (window.__dashboardState?.getFilterProvider?.() || 'all') + "|" +
      (window.__dashboardState?.getFilterAccount?.() || 'all') + "|" +
      (window.__dashboardState?.getFilterHost?.() || '');
    if (fp && fp === __lastProxyFingerprint && _proxyCharts.gauge5h) return;
    __lastProxyFingerprint = fp;
    if (!pd) {
      if (det) det.classList.add('section-no-data');
      window.__proxyHasData = false;
      sumEl.textContent = t("proxySummaryNoData");
      if (noteEl) noteEl.textContent = "";
      if (cardsEl) cardsEl.innerHTML = "";
      destroyProxyCharts();
      return;
    }
    if (det) det.classList.remove('section-no-data');
    window.__proxyHasData = true;

    // Summary line
    var rl = pd.rate_limit || {};
    var q5h = rl["anthropic-ratelimit-unified-5h-utilization"];
    var q7d = rl["anthropic-ratelimit-unified-7d-utilization"];
    var q5pct = "?";
    var q7pct = "?";
    if (q5h !== undefined && q5h !== null) q5pct = (Number.parseFloat(q5h) * 100).toFixed(1);
    if (q7d !== undefined && q7d !== null) q7pct = (Number.parseFloat(q7d) * 100).toFixed(1);
    var summaryText = tr("proxySummaryLine", {
      reqs: pd.requests || 0,
      errs: pd.errors || 0,
      q5h: q5pct,
      q7d: q7pct
    });
    var ds = pd.data_sources || {};
    var hasProxy = (ds.proxy || 0) > 0;
    var hasMeter = (ds["claude-code-meter"] || 0) > 0;
    var hasInterceptor = (ds["claude-code-cache-fix"] || 0) > 0 || hasMeter;
    var proxyDaysForAvailability = _proxyDays(data);
    if (hasProxy && hasInterceptor) summaryText += " · " + t("proxySourceBoth");
    else if (hasInterceptor) summaryText += " · " + t("proxySourceInterceptor");
    if (hasMeter) summaryText += " · Meter";
    sumEl.textContent = summaryText;
    if (noteEl) noteEl.textContent = t("proxyNote");
    setProxySourceAvailability(proxyDaysForAvailability, hasInterceptor, hasProxy);

    // Cards
    var ch = pd.cache_health || {};
    var models = pd.models || {};
    var opusReqs = models["claude-opus-4-6"]?.requests || 0;
    var sonnetReqs = 0;
    var otherReqs = 0;
    for (var mk in models) {
      if (!Object.hasOwn(models, mk)) continue;
      if (mk.includes("opus")) continue;
      else if (mk.includes("sonnet")) sonnetReqs += models[mk].requests || 0;
      else otherReqs += models[mk].requests || 0;
    }

    var sc = pd.status_codes || {};
    var scParts = [];
    var scKeys = Object.keys(sc).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
    for (var _sk of scKeys) {
      if (_sk !== "200" && sc[_sk] > 0) scParts.push(_sk + ":" + sc[_sk]);
    }
    var reqSub = tr("proxyCardRequestsSub", { errs: pd.errors || 0, rate: (pd.error_rate || 0).toFixed(1) });
    if (scParts.length) reqSub += " (" + scParts.join(", ") + ")";

    var q5raw = Number.parseFloat(rl["anthropic-ratelimit-unified-5h-utilization"] || 0);
    var q7raw = Number.parseFloat(rl["anthropic-ratelimit-unified-7d-utilization"] || 0);
    var q5pctVal = q5raw * 100;
    var q7pctVal = q7raw * 100;

    function quotaResetStr(epoch) {
      if (!epoch) return "";
      var diff = Number.parseInt(epoch, 10) - Date.now() / 1000;
      if (diff <= 0) return "";
      var rh = Math.floor(diff / 3600);
      var rm = Math.floor((diff % 3600) / 60);
      return tr("proxyGaugeResetIn", { h: rh, m: rm });
    }

    var pcards = [
      {
        wid: "proxy-kpi-requests",
        label: t("proxyCardRequests"),
        value: String(pd.requests || 0),
        sub: reqSub,
        cls: (pd.error_rate || 0) > 5 ? "warn" : ""
      },
      {
        wid: "proxy-kpi-latency",
        label: t("proxyCardLatency"),
        value: hasInterceptor && !hasProxy ? "\u2014" : (pd.avg_duration_ms >= 1000 ? (pd.avg_duration_ms/1000).toFixed(1) + "s" : Math.round(pd.avg_duration_ms || 0) + "ms"),
        sub: hasInterceptor && !hasProxy ? "not recorded by cache-fix" : tr("proxyCardLatencySub", { min: pd.min_duration_ms || 0, max: pd.max_duration_ms || 0 }),
        cls: (pd.avg_duration_ms || 0) > 15000 ? "warn" : ""
      },
      {
        wid: "proxy-kpi-cache-ratio",
        label: t("proxyCardCacheRatio"),
        value: ((pd.cache_read_ratio || 0) * 100).toFixed(1) + "%",
        sub: tr("proxyCardCacheRatioSub", { healthy: ch.healthy || 0, affected: ch.affected || 0 }),
        cls: (pd.cache_read_ratio || 0) < 0.8 ? "warn" : "ok"
      },
      {
        wid: "proxy-kpi-models",
        label: t("proxyCardModels"),
        value: String(pd.requests || 0),
        sub: tr("proxyCardModelsSub", { opus: opusReqs, sonnet: sonnetReqs, other: otherReqs }),
        cls: ""
      },
      {
        wid: "proxy-kpi-quota-5h",
        label: t("proxyCardQuota5h"),
        value: q5pctVal.toFixed(1) + "%",
        sub: quotaResetStr(rl["anthropic-ratelimit-unified-5h-reset"]),
        cls: q5pctVal >= 80 ? "danger" : q5pctVal >= 50 ? "warn" : "",
        valueColor: gaugeColor(q5pctVal)
      },
      {
        wid: "proxy-kpi-quota-7d",
        label: t("proxyCardQuota7d"),
        value: q7pctVal.toFixed(1) + "%",
        sub: quotaResetStr(rl["anthropic-ratelimit-unified-7d-reset"]),
        cls: q7pctVal >= 80 ? "danger" : q7pctVal >= 50 ? "warn" : "",
        valueColor: gaugeColor(q7pctVal)
      }
    ];
    if (hasInterceptor && !hasProxy) {
      pcards = pcards.filter(function (card) { return card.wid !== 'proxy-kpi-latency'; });
    }

    // TTL tier card
    var ttl = pd.ttl_tiers || {};
    var ttlTotal = (ttl["1h"] || 0) + (ttl["5m"] || 0);
    if (ttlTotal > 0) {
      var ttl1hPct = Math.round((ttl["1h"] || 0) / ttlTotal * 100);
      var ttl5mPct = 100 - ttl1hPct;
      pcards.push({
        wid: "proxy-kpi-ttl-tier",
        label: t("proxyTtlTier"),
        value: tr("proxyTtl1h", { pct: ttl1hPct }),
        sub: tr("proxyTtl5m", { pct: ttl5mPct }),
        cls: ttl5mPct > 20 ? "warn" : "ok"
      });
    }

    // Peak / Off-Peak card
    var peakReqs = pd.peak_hour_requests || 0;
    var offPeakReqs = pd.off_peak_requests || 0;
    if (peakReqs + offPeakReqs > 0) {
      pcards.push({
        wid: "proxy-kpi-peak-hours",
        label: t("proxyDataSource"),
        value: hasInterceptor ? t("proxySourceInterceptor") : t("proxySourceProxy"),
        valueLines: hasInterceptor ? ["Inter-", "ceptor"] : null,
        sub: tr("proxyPeakHours", { peak: peakReqs, offpeak: offPeakReqs }),
        subLines: ["Peak: " + peakReqs, "Off-Peak: " + offPeakReqs],
        cls: ""
      });
    }
    // Saturation + Health from metrics engine
    var me = window.__metricsEngine;
    if (me) {
      var sat = me.calcSaturationScore(pd);
      var hi = { error_rate: pd.error_rate || 0, avg_duration_ms: pd.avg_duration_ms || 0, cache_read_ratio: pd.cache_read_ratio || 0, cold_starts: 0, retry_rate: 0 };
      var health = me.calcHealthScore(hi, pd);
      var satCls = sat > 60 ? "danger" : sat > 30 ? "warn" : "ok";
      var healthCls = health < 50 ? "danger" : health < 70 ? "warn" : "ok";
      pcards.push({ wid: "proxy-kpi-saturation", label: t("proxySaturation"), value: sat + "/100", sub: t("proxySaturationSub"), cls: satCls, valueColor: sat > 60 ? "#ef4444" : sat > 30 ? "#f59e0b" : "#22c55e" });
      pcards.push({ wid: "proxy-kpi-health", label: t("proxyHealth"), value: health + "/100", sub: t("proxyHealthSub"), cls: healthCls, valueColor: health < 50 ? "#ef4444" : health < 70 ? "#f59e0b" : "#22c55e" });
    }
    if (cardsEl) {
      var ch2 = "";
      for (var c of pcards) {
        var valStyle = c.valueColor ? " style=\"color:" + c.valueColor + "\"" : "";
        var valueText = String(c.value == null ? "" : c.value);
        var valueClass = valueText.length > 22 ? " value--long value--very-long" :
          valueText.length > 13 ? " value--long" : "";
        var w = c.wid || "proxy-kpi";
        ch2 +=
          '<div class="chart-box chart-box--kpi" id="' +
          w +
          '"><div class="card ' +
          c.cls +
          '"><div class="label">' +
          escHtml(c.label) +
          '</div><div class="value' +
          valueClass +
          '" title="' +
          escHtml(valueText) +
          '"' +
          valStyle +
          ">" +
          (Array.isArray(c.valueLines) ? c.valueLines.map(function (line) {
            return escHtml(line);
          }).join("<br>") : escHtml(valueText)) +
          '</div><div class="sub">' +
          (Array.isArray(c.subLines) ? c.subLines.map(function (line) {
            return escHtml(line);
          }).join("<br>") : escHtml(c.sub)) +
          "</div></div></div>";
      }
      cardsEl.innerHTML = ch2;
    }

    // i18n labels for chart headings
    var h3tok = document.getElementById("proxy-token-chart-h3");
    if (h3tok) h3tok.textContent = t("proxyTokenChartTitle");
    var blurbTok = document.getElementById("proxy-token-blurb");
    if (blurbTok) blurbTok.textContent = t("proxyTokenBlurb");
    var h3lat = document.getElementById("proxy-latency-chart-h3");
    if (h3lat) h3lat.textContent = t("proxyLatencyChartTitle");
    var blurbLat = document.getElementById("proxy-latency-blurb");
    if (blurbLat) blurbLat.textContent = t("proxyLatencyBlurb");

    renderProxyTokenChart(data);
    if (!hasInterceptor || hasProxy) renderProxyLatencyChart(data);
    renderProxyHourlyHeatmap(data);
    renderProxyModelChart(data);
    renderProxyInvisibleCost(pd);
    var h3hr = document.getElementById("proxy-hourly-h3");
    if (h3hr) h3hr.textContent = t("proxyHourlyTitle");
    var blurbHr = document.getElementById("proxy-hourly-blurb");
    if (blurbHr) blurbHr.textContent = t("proxyHourlyBlurb");
    var h3mod = document.getElementById("proxy-model-h3");
    if (h3mod) h3mod.textContent = t("proxyModelTitle");
    var blurbMod = document.getElementById("proxy-model-blurb");
    if (blurbMod) blurbMod.textContent = t("proxyModelBlurb");
    renderProxyColdStart(pd);
    if (!hasInterceptor || hasProxy) renderProxyHourlyLatency(data);
    renderProxyErrorTrend(data);
    renderProxyCacheTrend(data);
    if (typeof window.renderProxy_ttlHistory === 'function') window.renderProxy_ttlHistory();
    if (typeof window.renderProxy_cacheFixActivity === 'function') window.renderProxy_cacheFixActivity();
    renderProxyEfficiencyTrend(data);
    var h3hl = document.getElementById("proxy-hourly-latency-h3");
    if (h3hl) h3hl.textContent = t("proxyHourlyLatencyTitle");
    var blurbHl = document.getElementById("proxy-hourly-latency-blurb");
    if (blurbHl) blurbHl.textContent = t("proxyHourlyLatencyBlurb");
  }
  window.renderProxyAnalysis = renderProxyAnalysis;

  // ── Efficiency Data Builder ─────────────────────────────────────────────
  function buildEfficiencyData(proxyDays, mainDays) {
    var jsonlByDate = {};
    var jsonlVisibleByDate = {};
    var cacheMissByDate = {};
    for (var md of mainDays) {
      if (!md.date) continue;
      jsonlByDate[md.date] = (md.input || 0) + (md.output || 0) + (md.cache_read || 0) + (md.cache_creation || 0);
      jsonlVisibleByDate[md.date] = (md.input || 0) + (md.output || 0);
      var cc = md.cache_creation || 0;
      var cr = md.cache_read || 0;
      cacheMissByDate[md.date] = cc + cr > 0 ? Math.round((cc / (cc + cr)) * 1000) / 10 : 0;
    }
    var labels = [], ratioData = [], visPerPctData = [], cacheMissData = [];
    var visPerPctMeta = [];
    for (var pd of proxyDays) {
      var dk = pd.date || "";
      labels.push(dk ? dk.slice(5) : "?");
      var proxyTotal = pd.total_tokens || 0;
      var jsonlTotal = jsonlByDate[dk] || 0;
      ratioData.push(proxyTotal > 0 ? Math.round(jsonlTotal / proxyTotal * 100) / 100 : null);

      var vpp = pd.visible_tokens_per_pct;
      visPerPctData.push(vpp || 0);

      var jsonlVisible = jsonlVisibleByDate[dk] || 0;
      var proxyActive = pd.proxy_active_visible_tokens || 0;
      var coverage = jsonlVisible > 0 ? proxyActive / jsonlVisible : null;
      visPerPctMeta.push({
        method: pd.visible_tokens_per_pct_method || null,
        q5Pct: pd.q5_consumed_pct || 0,
        samples: pd.q5_samples || 0,
        proxyActive: proxyActive,
        jsonlVisible: jsonlVisible,
        coverage: coverage,
        lowCoverage: coverage != null && coverage < 0.5
      });

      cacheMissData.push(cacheMissByDate[dk] || 0);
    }
    return {
      labels: labels,
      ratioData: ratioData,
      visPerPctData: visPerPctData,
      visPerPctMeta: visPerPctMeta,
      cacheMissData: cacheMissData
    };
  }
  window.buildEfficiencyData = buildEfficiencyData;

  // ── Efficiency History (daily average, multi-panel) ─────────────────────
  function renderEfficiencyHistory(data, el) {
    var proxyDays = _proxyDays(data);
    if (!proxyDays.length) { el.classList.add('section-no-data'); return; }
    el.classList.remove('section-no-data');
    chartShellSetLoading("c-gateway-cut-impact", false);

    var labels = [];
    var dailyEff = [];
    var dailyCR = [];
    var dailyQ5 = [];
    var cutMarkers = [];
    var dailyModels = [];

    for (var di = 0; di < proxyDays.length; di++) {
      var dpd = proxyDays[di];
      labels.push((dpd.date || "?").slice(5));
      var dqt = dpd.gateway_quota_timeline || [];
      var sumOut = 0, sumCR = 0, count = 0;
      var reqCounts = {};
      var resCounts = {};
      var prevDQ5 = -1;
      for (var qi = 0; qi < dqt.length; qi++) {
        var ds = dqt[qi];
        if (ds.tokens > 0 || ds.cache_read > 0) {
          sumOut += ds.tokens || 0;
          sumCR += ds.cache_read || 0;
          count++;
          var reqModel = classifyModelFamily(ds.model);
          var resModel = classifyModelFamily(ds.response_model || ds.model);
          reqCounts[reqModel] = (reqCounts[reqModel] || 0) + 1;
          resCounts[resModel] = (resCounts[resModel] || 0) + 1;
        }
        var dQ5 = ds.q5 * 100;
        if (prevDQ5 >= 0 && (prevDQ5 - dQ5) > 20) {
          var cutTs = typeof ds.ts === "number" ? ds.ts : Date.parse(ds.ts);
          var cutHour = new Date(cutTs).getHours() + new Date(cutTs).getMinutes() / 60;
          var timeOffset = (cutHour / 24 - 0.5) * 0.8;
          var sameDay = cutMarkers.filter(function(c){return c.dayIdx===di;}).length;
          cutMarkers.push({ xAxis: di + timeOffset, dayIdx: di, label: prevDQ5.toFixed(0) + "%\u2192" + dQ5.toFixed(0) + "%", cutNum: sameDay });
        }
        prevDQ5 = dQ5;
      }
      var dTotal = sumOut + sumCR;
      dailyEff.push(dTotal > 0 ? Math.round(sumOut / dTotal * 1000) / 10 : 0);
      dailyCR.push(Math.round(sumCR / 1000));
      var lastQ5 = dqt.length ? Math.round(dqt[dqt.length - 1].q5 * 1000) / 10 : 0;
      dailyQ5.push(lastQ5);
      var MW = { opus: 1.0, haiku: 0.3, sonnet: 0.6 };
      var reqScore = (reqCounts.opus || 0) * MW.opus + (reqCounts.haiku || 0) * MW.haiku + (reqCounts.sonnet || 0) * MW.sonnet;
      var resScore = (resCounts.opus || 0) * MW.opus + (resCounts.haiku || 0) * MW.haiku + (resCounts.sonnet || 0) * MW.sonnet;
      var reqNorm = count > 0 ? Math.round(reqScore / count * 100) / 100 : 1;
      var resNorm = count > 0 ? Math.round(resScore / count * 100) / 100 : 1;
      dailyModels.push({
        req_opus: count > 0 ? Math.round((reqCounts.opus || 0) / count * 100) : 100,
        req_haiku: count > 0 ? Math.round((reqCounts.haiku || 0) / count * 100) : 0,
        req_sonnet: count > 0 ? Math.round((reqCounts.sonnet || 0) / count * 100) : 0,
        res_opus: count > 0 ? Math.round((resCounts.opus || 0) / count * 100) : 100,
        res_haiku: count > 0 ? Math.round((resCounts.haiku || 0) / count * 100) : 0,
        res_sonnet: count > 0 ? Math.round((resCounts.sonnet || 0) / count * 100) : 0,
        reqScore: reqNorm,
        resScore: resNorm
      });
    }

    // Use _gatewayCharts from window (stays in dashboard.client.js)
    var gwCharts = window._gatewayCharts || {};
    if (!gwCharts.cutImpact) {
      gwCharts.cutImpact = echarts.init(el, null, { renderer: "canvas" });
    }

    var modelNames = ["Req Opus", "Req Haiku", "Req Sonnet", "Del Opus", "Del Haiku", "Del Sonnet"];
    var hmModelData = [];
    for (var hdi = 0; hdi < dailyModels.length; hdi++) {
      var dm = dailyModels[hdi];
      hmModelData.push([hdi, 0, dm.req_opus]);
      hmModelData.push([hdi, 1, dm.req_haiku]);
      hmModelData.push([hdi, 2, dm.req_sonnet]);
      hmModelData.push([hdi, 3, dm.res_opus]);
      hmModelData.push([hdi, 4, dm.res_haiku]);
      hmModelData.push([hdi, 5, dm.res_sonnet]);
    }

    gwCharts.cutImpact.setOption({
      animation: false,
      grid: [
        { left: 50, right: 50, top: 40, bottom: "62%" },
        { left: 50, right: 50, top: "42%", bottom: "42%" },
        { left: 50, right: 50, top: "62%", bottom: "22%" },
        { left: 80, right: 50, top: "82%", bottom: 25 }
      ],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      legend: {
        data: [t("gwEfficiency"), t("gwEffCR"), "Requested", "Delivered", t("gwEffQ5"), "Models"],
        textStyle: { color: "#EFE7D6" }, top: 4
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(14,17,22,0.95)",
        borderColor: "#2A2D34",
        textStyle: { color: "#F7F3EC" },
        formatter: function (params) {
          if (!params || !params.length) return "";
          var modelColors = { Opus: modelFamilyColor("opus"), Haiku: modelFamilyColor("haiku"), Sonnet: modelFamilyColor("sonnet"), Fable: modelFamilyColor("fable"), Models: "#A0875E" };
          var hmRowNames = ["Req Opus", "Req Haiku", "Req Sonnet", "Del Opus", "Del Haiku", "Del Sonnet"];
          var hmRowColors = ["#16a34a", "#db27b4", "#f59e0b", "#16a34a", "#db27b4", "#f59e0b"];
          var groups = {};
          for (var pi = 0; pi < params.length; pi++) {
            var p = params[pi];
            var axRaw = p.axisValue != null ? p.axisValue : "";
            var ax = typeof axRaw === "number" ? (labels[Math.round(axRaw)] || axRaw) : axRaw;
            if (!groups[ax]) groups[ax] = [];
            groups[ax].push(p);
          }
          var html = "";
          for (var gk in groups) {
            html += "<strong>" + gk + "</strong><br/>";
            for (var gi = 0; gi < groups[gk].length; gi++) {
              var gp = groups[gk][gi];
              var isHeatmap = gp.seriesName === "Models";
              var val = Array.isArray(gp.value) ? gp.value[isHeatmap ? 2 : 1] : gp.value;
              if (isHeatmap && Array.isArray(gp.value)) {
                var rowIdx = gp.value[1];
                var rowColor = hmRowColors[rowIdx] || "#A0875E";
                var rowName = hmRowNames[rowIdx] || "?";
                var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + rowColor + ';margin-right:4px"></span>';
                html += dot + rowName + ": <strong>" + val + "%</strong><br/>";
              } else {
                var mc = modelColors[gp.seriesName];
                var dot = mc
                  ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + mc + ';margin-right:4px"></span>'
                  : gp.marker;
                html += dot + gp.seriesName + ": <strong>" + val + "</strong><br/>";
              }
            }
          }
          return html;
        }
      },
      xAxis: [
        {
          type: "value", min: -0.5, max: labels.length - 0.5, gridIndex: 0,
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        },
        {
          type: "value", min: -0.5, max: labels.length - 0.5, gridIndex: 1,
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        },
        {
          type: "value", min: -0.5, max: labels.length - 0.5, gridIndex: 2,
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        },
        {
          type: "category", data: labels, gridIndex: 3,
          axisLabel: { color: "#A0875E", fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        }
      ],
      yAxis: [
        {
          type: "value", name: "Eff %", min: 0, gridIndex: 0,
          nameTextStyle: { color: "#A0875E", fontSize: 10 },
          axisLabel: { color: "#A0875E", formatter: function (v) { return v + "%"; } },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.5)" } }
        },
        {
          type: "value", name: "CR (K)", position: "right", gridIndex: 0,
          nameTextStyle: { color: "#A0875E", fontSize: 10 },
          axisLabel: { color: "#A0875E", formatter: function (v) { return v + "K"; } },
          splitLine: { show: false }
        },
        {
          type: "value", name: "Score", min: function (v) { return Math.max(0, Math.floor(v.min * 20) / 20 - 0.05); }, max: 1, gridIndex: 1,
          nameTextStyle: { color: "#A0875E", fontSize: 10 },
          axisLabel: { color: "#A0875E", fontSize: 9 },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        },
        {
          type: "value", name: "Q5 %", min: 0, max: 110, gridIndex: 2,
          nameTextStyle: { color: "#A0875E", fontSize: 10 },
          axisLabel: { color: "#A0875E", formatter: function (v) { return v + "%"; } },
          splitLine: { lineStyle: { color: "rgba(42,45,52,0.3)" } }
        },
        {
          type: "category", data: modelNames, gridIndex: 3,
          axisLabel: { color: "#A0875E", fontSize: 9 },
          splitArea: { show: true, areaStyle: { color: ["rgba(26,29,36,0.3)", "rgba(26,29,36,0.5)"] } }
        }
      ],
      series: [
        {
          name: t("gwEfficiency"), type: "line", xAxisIndex: 0, yAxisIndex: 0, data: dailyEff.map(function(v,i){return [i,v];}),
          smooth: 0.3, symbol: "circle", symbolSize: 6,
          color: "#22c55e",
          itemStyle: { color: function (p) { var v = Array.isArray(p.value) ? p.value[1] : p.value; return v < 1 ? "#ef4444" : v < 5 ? "#f59e0b" : "#22c55e"; } },
          lineStyle: { width: 2.5, color: "#22c55e" },
          areaStyle: { color: "rgba(34,197,94,0.1)" },
          label: { show: true, position: "top", fontSize: 9, color: "#A0875E", formatter: function (p) { var v = Array.isArray(p.value) ? p.value[1] : p.value; return v.toFixed(1) + "%"; } },
          markLine: {
            silent: true, symbol: "none",
            data: cutMarkers.map(function (m) {
              var step = (m.cutNum || 0) * 55;
              return {
                xAxis: m.xAxis,
                lineStyle: { color: "transparent", width: 0 },
                label: {
                  show: true,
                  formatter: "5h " + (m.label || ""),
                  color: "#fff", fontSize: 8,
                  backgroundColor: "rgba(239,68,68,0.8)",
                  borderRadius: 3, padding: [2, 5],
                  position: "insideEndTop", rotate: 90, distance: 5 + step
                }
              };
            })
          }
        },
        {
          name: t("gwEffCR"), type: "line", xAxisIndex: 0, yAxisIndex: 1, data: dailyCR.map(function(v,i){return [i,v];}),
          smooth: 0.3, symbol: "none",
          itemStyle: { color: "rgba(212,175,127,0.6)" },
          lineStyle: { color: "rgba(212,175,127,0.6)", width: 1.5 },
          areaStyle: { color: "rgba(212,175,127,0.08)" }
        },
        {
          name: "Requested", type: "line", xAxisIndex: 1, yAxisIndex: 2,
          data: dailyModels.map(function (d, i) { return [i, d.reqScore]; }),
          smooth: 0.3, symbol: "circle", symbolSize: 5,
          color: "#B8915A",
          itemStyle: { color: "#B8915A" },
          lineStyle: { color: "#B8915A", width: 2 },
          areaStyle: { color: "rgba(184,145,90,0.1)" },
          z: 2
        },
        {
          name: "Delivered", type: "line", xAxisIndex: 1, yAxisIndex: 2,
          data: dailyModels.map(function (d, i) { return [i, d.resScore]; }),
          smooth: 0.3, symbol: "diamond", symbolSize: 6,
          color: "#ef4444",
          itemStyle: { color: "#ef4444" },
          lineStyle: { color: "#ef4444", width: 2.5 },
          z: 3
        },
        {
          name: "Models", type: "heatmap", xAxisIndex: 3, yAxisIndex: 4,
          data: hmModelData,
          itemStyle: {
            color: function (p) {
              var pct = p.value[2];
              var row = p.value[1];
              var mType = row % 3;
              if (pct === 0) return "#1A1D24";
              var a = Math.min(0.9, 0.25 + pct / 120);
              if (mType === 0) return "rgba(22,120,50," + a + ")";
              if (mType === 1) return "rgba(219,39,180," + a + ")";
              return "rgba(217,119,6," + a + ")";
            }
          },
          label: {
            show: true, color: "#F7F3EC", fontSize: 8,
            formatter: function (p) { return p.value[2] > 0 ? p.value[2] + "%" : ""; }
          }
        },
        {
          name: t("gwEffQ5"), type: "line", xAxisIndex: 2, yAxisIndex: 3, data: dailyQ5.map(function(v,i){return [i,v];}),
          smooth: 0.3, symbol: "circle", symbolSize: 5,
          color: "#fbbf24", z: 3,
          itemStyle: { color: function (p) { var v = Array.isArray(p.value) ? p.value[1] : p.value; return v > 80 ? "#ef4444" : v > 50 ? "#f59e0b" : "#22c55e"; } },
          lineStyle: { color: "#fbbf24", width: 2 },
          markLine: {
            silent: true, symbol: "none",
            data: [{ yAxis: 80, lineStyle: { color: "rgba(239,68,68,0.4)", type: "dashed" }, label: { formatter: "80%", color: "#ef4444", fontSize: 9, position: "insideEndTop" } }]
          }
        }
      ]
    }, true);
  }
  window.renderEfficiencyHistory = renderEfficiencyHistory;

  // ── Efficiency Trend: ECharts helpers ───────────────────────────────────
  function __effNormalizeRow(row) {
    var min = Infinity, max = -Infinity;
    for (var v of row) {
      if (v == null || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      var span = max - min;
      return row.map(function (v) {
        if (v == null || Number.isNaN(v)) return 0;
        return (v - min) / span;
      });
    }
    return row.map(function () { return 0.5; });
  }

  function __effHeatmapOption(ed) {
    var covLabel = t("proxyDSCoverage");
    if (covLabel === "proxyDSCoverage") covLabel = "Quota-Active %";
    var metricLabels = [
      t("proxyDSJsonlRatio"),
      t("proxyDSVisPerPct"),
      t("budgetTrendCacheMiss"),
      covLabel
    ];
    var rawRows = [
      ed.ratioData,
      ed.visPerPctData,
      ed.cacheMissData,
      ed.visPerPctMeta.map(function (m) { return m?.coverage != null ? m.coverage * 100 : 0; })
    ];
    var normRows = rawRows.map(__effNormalizeRow);
    var hdata = [];
    rawRows.forEach(function (rawRow, m) {
      ed.labels.forEach(function (_unused, d) {
        hdata.push([d, m, normRows[m][d], rawRow[d]]);
      });
    });
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        position: "top",
        backgroundColor: "rgba(14,17,22,.95)",
        borderColor: "#3D3830",
        textStyle: { color: "#F7F3EC" },
        formatter: function (p) {
          var raw = p.data[3];
          var norm = p.data[2];
          var metricName = metricLabels[p.data[1]];
          var dayLabel = ed.labels[p.data[0]];
          var rawStr;
          if (raw == null) rawStr = "n/a";
          else if (metricName.includes("Ratio")) rawStr = raw.toFixed(2) + "x";
          else if (metricName.includes("%")) rawStr = raw.toFixed(1) + "%";
          else rawStr = Math.round(raw).toLocaleString();
          return dayLabel + "<br/>" + metricName + ": <b>" + rawStr + "</b><br/>"
            + "normalized: " + (norm * 100).toFixed(0) + "%";
        }
      },
      grid: { left: 118, right: 6, top: 6, bottom: 26, containLabel: false },
      xAxis: {
        type: "category",
        data: ed.labels,
        boundaryGap: true,
        axisLabel: { color: "#A0875E", fontSize: 10, interval: 0 },
        axisLine: { lineStyle: { color: "#3D3830" } },
        splitArea: { show: false }
      },
      yAxis: {
        type: "category",
        data: metricLabels,
        axisLabel: { color: "#EFE7D6", fontSize: 10, width: 102, overflow: "truncate" },
        axisLine: { lineStyle: { color: "#3D3830" } },
        splitArea: { show: false }
      },
      visualMap: {
        min: 0,
        max: 1,
        dimension: 2,
        show: false,
        inRange: { color: ["#2A2D34", "#B8915A", "#D4AF7F", "#f59e0b", "#ef4444"] }
      },
      series: [{
        type: "heatmap",
        data: hdata,
        label: {
          show: true,
          color: "#F7F3EC",
          fontSize: 9,
          formatter: function (p) {
            var raw = p.data[3];
            var m = p.data[1];
            if (raw == null) return "·";
            if (m === 0) return raw.toFixed(1) + "x";
            if (m === 1) return raw >= 1000 ? (raw / 1000).toFixed(1) + "K" : String(Math.round(raw));
            return raw.toFixed(1) + "%";
          }
        },
        itemStyle: { borderColor: "#0E1116", borderWidth: 1 }
      }]
    };
  }

  function __effSmallMultipleOption(spec) {
    return {
      animation: false,
      backgroundColor: "transparent",
      title: {
        text: spec.title,
        left: "center",
        top: 4,
        textStyle: { color: spec.color, fontSize: 11, fontWeight: "normal" }
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(14,17,22,.95)",
        borderColor: "#3D3830",
        textStyle: { color: "#F7F3EC", fontSize: 11 },
        formatter: spec.tooltipFormatter
      },
      grid: { left: 6, right: 6, top: 28, bottom: 22, containLabel: true },
      xAxis: {
        type: "category",
        data: spec.labels,
        axisLabel: { color: "#A0875E", fontSize: 9 },
        axisLine: { lineStyle: { color: "#3D3830" } },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#A0875E", fontSize: 9, formatter: spec.yFormatter },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(42,45,52,.4)" } }
      },
      series: [spec.series]
    };
  }

  function __effInitOrSet(key, el, option, notMerge) {
    if (!el) return;
    if (!_effCharts[key]) {
      if (typeof echarts === "undefined") return;
      _effCharts[key] = echarts.init(el, null, { renderer: "canvas" });
    }
    _effCharts[key].setOption(option, { notMerge: !!notMerge, lazyUpdate: false });
    try {
      _effCharts[key].resize();
    } catch (error) { logClientOptionalErr(error); }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        try {
          if (_effCharts[key] && typeof _effCharts[key].resize === "function") {
            _effCharts[key].resize();
          }
        } catch (error) { logClientOptionalErr(error); }
      });
    }
  }
  window.__effInitOrSet = __effInitOrSet;

  function __effConnectCharts() {
    if (typeof echarts === "undefined" || !echarts.connect) return;
    var group = [];
    if (_effCharts.ratio) group.push(_effCharts.ratio);
    if (_effCharts.vispct) group.push(_effCharts.vispct);
    if (_effCharts.cachemiss) group.push(_effCharts.cachemiss);
    if (group.length >= 2) echarts.connect(group);
    var econGroup = [];
    if (_effCharts.econDrain) econGroup.push(_effCharts.econDrain);
    if (_effCharts.econOverhead) econGroup.push(_effCharts.econOverhead);
    if (econGroup.length === 2) echarts.connect(econGroup);
  }
  window.__effConnectCharts = __effConnectCharts;

  // ── Render: Efficiency Trend (heatmap + small multiples) ────────────────
  function renderProxyEfficiencyTrend(data) {
    if (typeof echarts === "undefined") return;
    var elHeat = document.getElementById("c-proxy-efficiency-heatmap");
    var elR = document.getElementById("c-proxy-efficiency-ratio");
    var elV = document.getElementById("c-proxy-efficiency-vispct");
    var elC = document.getElementById("c-proxy-efficiency-cachemiss");
    if (!elHeat || !elR || !elV || !elC) return;
    var proxyDays = _proxyDays(data);
    if (proxyDays.length < 2) return;
    var ed = buildEfficiencyData(proxyDays, data.days || []);

    var h3 = document.getElementById("proxy-efficiency-trend-h3");
    if (h3) h3.textContent = t("proxyEfficiencyTrendTitle");
    var blurb = document.getElementById("proxy-efficiency-trend-blurb");
    if (blurb) blurb.textContent = t("proxyEfficiencyTrendBlurb");

    // Heatmap Matrix
    __effInitOrSet("heatmap", elHeat, __effHeatmapOption(ed));

    // Small multiple 1: JSONL/Proxy Ratio
    __effInitOrSet("ratio", elR, __effSmallMultipleOption({
      title: t("proxyDSJsonlRatio"),
      color: "#f59e0b",
      labels: ed.labels,
      yFormatter: function (v) { return v.toFixed(1) + "x"; },
      tooltipFormatter: function (ps) {
        if (!ps?.length) return "";
        var p = ps[0];
        var val = (p.value == null) ? "n/a" : (p.value.toFixed(2) + "x");
        return p.axisValue + "<br/>" + t("proxyDSJsonlRatio") + ": <b>" + val + "</b><br/>"
          + "<span style='color:#A0875E'>B8 baseline: 2.87x</span>";
      },
      series: {
        type: "line",
        data: ed.ratioData,
        smooth: 0.3,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: "#f59e0b", width: 2 },
        itemStyle: { color: "#f59e0b" },
        areaStyle: { color: "rgba(245,158,11,.12)" },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 2.87, lineStyle: { color: "#A0875E", type: "dashed", width: 1 }, label: { show: true, position: "end", color: "#A0875E", fontSize: 9, formatter: "B8 2.87x" } }]
        }
      }
    }));

    // Small multiple 2: Visible Tokens per 1%
    var visMeta = ed.visPerPctMeta;
    __effInitOrSet("vispct", elV, __effSmallMultipleOption({
      title: t("proxyDSVisPerPct"),
      color: "#D4AF7F",
      labels: ed.labels,
      yFormatter: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)); },
      tooltipFormatter: function (ps) {
        if (!ps?.length) return "";
        var p = ps[0];
        var meta = visMeta[p.dataIndex];
        var val = p.value;
        var txt = p.axisValue + "<br/>" + t("proxyDSVisPerPct") + ": <b>"
          + (val >= 1000 ? (val / 1000).toFixed(2) + "K" : Math.round(val)) + "/1%</b>";
        if (!meta) return txt;
        if (meta.method === "cumulative_delta") {
          txt += "<br/><span style='color:#A0875E'>\u0394q5: " + meta.q5Pct.toFixed(1) + "% / " + meta.samples + " samples</span>";
        }
        if (meta.coverage != null) {
          var covPct = Math.round(meta.coverage * 100);
          txt += "<br/><span style='color:#A0875E'>proxy coverage: " + covPct + "% of JSONL</span>";
          if (meta.lowCoverage) {
            txt += "<br/><span style='color:#f59e0b'>\u26a0 below 50% \u2014 lower bound</span>";
          }
        }
        return txt;
      },
      series: {
        type: "bar",
        data: ed.visPerPctData,
        barMaxWidth: 28,
        itemStyle: { color: "rgba(212,175,127,.75)", borderRadius: [2, 2, 0, 0] }
      }
    }));

    // Small multiple 3: Cache Miss %
    __effInitOrSet("cachemiss", elC, __effSmallMultipleOption({
      title: t("budgetTrendCacheMiss"),
      color: "#eab308",
      labels: ed.labels,
      yFormatter: function (v) { return v.toFixed(1) + "%"; },
      tooltipFormatter: function (ps) {
        if (!ps?.length) return "";
        var p = ps[0];
        return p.axisValue + "<br/>" + t("budgetTrendCacheMiss") + ": <b>" + p.value.toFixed(2) + "%</b>";
      },
      series: {
        type: "line",
        data: ed.cacheMissData,
        smooth: 0.3,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { color: "#eab308", width: 2, type: "dashed" },
        itemStyle: { color: "#eab308" }
      }
    }));

    __effConnectCharts();
  }
  window.renderProxyEfficiencyTrend = renderProxyEfficiencyTrend;

  // ── Section registration ────────────────────────────────────────────────
  window.__sections = window.__sections || {};
  window.__sections.proxy = {
    id: 'proxy',
    surface: 'proxy',
    domId: 'proxy-collapse',
    render: function (data) {
      if (typeof window.renderProxyAnalysis === 'function') window.renderProxyAnalysis(data);
    }
  };
})();
