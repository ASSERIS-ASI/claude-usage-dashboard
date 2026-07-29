/**
 * @asseris-module       User Profile
 * @asseris-description  Auto-annotated module metadata for public/js/sections/user-profile.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * sections/user-profile.js
 * Extracted User Profile Charts rendering logic from dashboard.client.js.
 *
 * Exports on window:
 *   renderUserProfileCharts(days)
 *   __userProfileChartsResizeAll()
 *   _computeUserProfileCtx(days)
 *   renderUserProfile_versions(sCtx)
 *   renderUserProfile_entrypoints(sCtx)
 *   renderUserProfile_releaseStability(sCtx)
 *
 * Dependencies via window globals:
 *   fmt, pct, escHtml, t, tr, logClientOptionalErr, _charts, echarts,
 *   defined_colors, __lastUsageData, getFilteredDays, getFilterHost, getProxyDay
 */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────
  var _userCharts = { versions: null, entrypoints: null, releaseStability: null };

  /** Identical grid for all User-Profile horizontal bar charts (aligns Y rows + bar thickness across columns). */
  var __USER_PROFILE_BAR_GRID = { left: 6, right: 6, top: 54, bottom: 56, containLabel: true };
  var __USER_PROFILE_BAR_Y_LABEL = {
    color: "#F7F3EC",
    fontSize: 11,
    fontFamily: "monospace",
    width: 64,
    overflow: "truncate",
    margin: 2,
    align: "right"
  };

  var __releaseStabilityData = null;
  var __userVersionSort = "anomalies"; // anomalies | newest | calls
  var __userVersionFilter = null; // null = all, [] = none selected

  var __userProfileColors = [
    "rgba(184,145,90,0.8)",   // blue
    "rgba(212,175,127,0.8)",   // violet
    "rgba(34,197,94,0.8)",    // green
    "rgba(245,158,11,0.8)",   // amber
    "rgba(219,39,180,0.8)",   // pink
    "rgba(6,182,212,0.8)",    // cyan
    "rgba(249,115,22,0.8)",   // orange
    "rgba(212,175,127,0.8)"    // purple
  ];

  var __versionHealthMetrics = [
    { key: "hit_limit",  label: "userDSHitLimit",  color: "rgba(248,113,113,0.85)" },
    { key: "retry",      label: "userDSRetry",     color: "rgba(251,146,60,0.85)" },
    { key: "interrupt",  label: "userDSInterrupt",  color: "rgba(250,204,21,0.85)" },
    { key: "truncated",  label: "userDSTruncated",  color: "rgba(34,211,238,0.85)" },
    { key: "api_error",  label: "userDSApiError",   color: "rgba(219,39,180,0.85)" }
  ];

  var __userFilterDdOpen = false;
  var __userProfileHeightObserver = null;
  var __userProfileHeightFrame = 0;

  // ── Resize ─────────────────────────────────────────────────────────────────
  function __applyUserProfileChartHeight(sCtx) {
    sCtx = sCtx || window.__dashboardState?.getSectionCtx('userProfile');
    if (!sCtx) return;
    var height = Math.max(240, Number(sCtx.chartCanvasH) || 240);
    document.documentElement.style.setProperty("--user-profile-canvas-h", height + "px");
    // The template builder may move widgets into a sibling internal grid.
    // The details element remains stable across both layouts.
    var hosts = document.querySelectorAll("#user-profile-collapse .user-chart-canvas-host");
    for (var hEl of hosts) {
      hEl.style.setProperty("height", height + "px", "important");
      hEl.style.setProperty("min-height", height + "px", "important");
      var chartRoot = hEl.firstElementChild;
      if (chartRoot) {
        chartRoot.style.setProperty("height", height + "px", "important");
        chartRoot.style.setProperty("min-height", height + "px", "important");
      }
      var box = hEl.closest(".user-profile-chart-box");
      if (box) {
        box.style.setProperty("height", "auto", "important");
        box.style.setProperty("min-height", (height + 136) + "px", "important");
      }
    }
  }

  function __ensureUserProfileHeightObserver() {
    if (__userProfileHeightObserver || typeof MutationObserver === "undefined") return;
    var stableRoot = document.getElementById("layout-grid") || document.body;
    __userProfileHeightObserver = new MutationObserver(function () {
      if (__userProfileHeightFrame) cancelAnimationFrame(__userProfileHeightFrame);
      __userProfileHeightFrame = requestAnimationFrame(function () {
        __userProfileHeightFrame = 0;
        if (!document.getElementById("user-profile-collapse")) return;
        __applyUserProfileChartHeight();
        __userProfileChartsResizeAll();
      });
    });
    __userProfileHeightObserver.observe(stableRoot, { childList: true, subtree: true });
  }

  function __userProfileChartsResizeAll() {
    __applyUserProfileChartHeight();
    if (_userCharts.versions && typeof _userCharts.versions.resize === "function") {
      try { _userCharts.versions.resize(); } catch (error) { logClientOptionalErr(error); }
    }
    if (_userCharts.entrypoints && typeof _userCharts.entrypoints.resize === "function") {
      try { _userCharts.entrypoints.resize(); } catch (error) { logClientOptionalErr(error); }
    }
    if (_userCharts.releaseStability && typeof _userCharts.releaseStability.resize === "function") {
      try { _userCharts.releaseStability.resize(); } catch (error) { logClientOptionalErr(error); }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Scroll legend with fixed vertical footprint so Version / Entry / Release reserve the same top band. */
  function __userProfileLegendOpts(legendData) {
    return {
      type: "scroll",
      orient: "horizontal",
      top: 6,
      left: 6,
      right: 6,
      height: 30,
      itemGap: 6,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 10, color: "#EFE7D6" },
      data: legendData
    };
  }

  /** Display names for entrypoint keys -- aligned with userEntrypointBlurb (VS Code, CLI, JetBrains). */
  function __userEntrypointLegendName(key) {
    if (key === "claude-vscode") return t("userEntrypointLegendVscode");
    if (key === "cli") return t("userEntrypointLegendCli");
    if (key === "claude-jetbrains") return t("userEntrypointLegendJetbrains");
    return key;
  }

  function __disposeUserEchartsChart(which) {
    var ch = _userCharts[which];
    if (!ch) return;
    if (typeof ch.dispose === "function") {
      ch.dispose();
    }
    _userCharts[which] = null;
  }

  /** Max. Zeilensumme ueber alle Datasets (ein gemeinsamer Stack) -- verhindert x-Skala < gestapelte Summe (Balken laufen aus). */
  function __stackedHBarXMax(datasets) {
    if (!datasets?.length) return undefined;
    var len = 0;
    for (var ds0 of datasets) {
      var d = ds0.data;
      if (d && d.length > len) len = d.length;
    }
    if (!len) return undefined;
    var sums = new Array(len).fill(0);
    for (var ds of datasets) {
      var row = ds.data || [];
      for (var j = 0; j < len; j++) sums[j] += Number(row[j]) || 0;
    }
    var mx = 0;
    for (var k = 0; k < len; k++) {
      if (sums[k] > mx) mx = sums[k];
    }
    if (mx <= 0) return 1;
    return Math.ceil(mx * 1.15);
  }

  function semverCmpDesc(a, b) {
    var pa = a.split(".").map(Number);
    var pb = b.split(".").map(Number);
    for (var i of [0, 1, 2]) {
      var da = pa[i] || 0, db = pb[i] || 0;
      if (da !== db) return db - da;
    }
    return 0;
  }

  function mergeVersionEntry(tgt, src) {
    for (var fk of Object.keys(src)) {
      if (fk === 'entrypoints') {
        for (var ek of Object.keys(src.entrypoints || {})) {
          tgt.entrypoints[ek] = (tgt.entrypoints[ek] || 0) + (src.entrypoints[ek] || 0);
        }
      } else {
        tgt[fk] = (tgt[fk] || 0) + (src[fk] || 0);
      }
    }
  }

  function aggregateVersionStats(days) {
    var merged = {};
    for (var day of days) {
      var vs = day.version_stats || {};
      for (var ver of Object.keys(vs)) {
        if (!merged[ver]) merged[ver] = { calls: 0, output: 0, cache_read: 0, hit_limit: 0, retry: 0, interrupt: 0, continue: 0, resume: 0, truncated: 0, api_error: 0, entrypoints: {} };
        mergeVersionEntry(merged[ver], vs[ver]);
      }
    }
    return merged;
  }

  function versionAnomalyTotal(s) {
    if (!s) return 0;
    return (s.hit_limit || 0) + (s.retry || 0) + (s.interrupt || 0) + (s.truncated || 0) + (s.api_error || 0);
  }

  function sortVersionKeys(keys, stats, mode) {
    var arr = keys.slice();
    if (mode === "newest") {
      arr.sort(semverCmpDesc);
    } else if (mode === "calls") {
      arr.sort(function(a, b) { return (stats[b]?.calls || 0) - (stats[a]?.calls || 0); });
    } else {
      arr.sort(function(a, b) { return versionAnomalyTotal(stats[b]) - versionAnomalyTotal(stats[a]); });
    }
    return arr;
  }

  function initVersionSortDropdown(days) {
    var sortEl = document.getElementById("user-version-sort");
    if (!sortEl || sortEl.options.length) return;
    var opts = [
      { val: "anomalies", lbl: t("userSortAnomalies") },
      { val: "newest", lbl: t("userSortNewest") },
      { val: "calls", lbl: t("userSortCalls") }
    ];
    for (var opt of opts) {
      var o = document.createElement("option");
      o.value = opt.val;
      o.textContent = opt.lbl;
      if (opt.val === __userVersionSort) o.selected = true;
      sortEl.appendChild(o);
    }
    sortEl.addEventListener("change", function() {
      __userVersionSort = sortEl.value;
      renderUserProfileCharts(days);
    });
  }

  function buildFilterCheckboxHtml(allVers, stats) {
    var html = "";
    for (var v of allVers) {
      var checked = !__userVersionFilter || __userVersionFilter.includes(v);
      var anomalies = versionAnomalyTotal(stats[v]);
      var calls = stats[v]?.calls || 0;
      var badge = "";
      if (anomalies > 0) badge = " (" + anomalies + "!)";
      else if (calls > 0) badge = " (" + calls + ")";
      html += '<label><input type="checkbox" value="' + v + '"' + (checked ? ' checked' : '') + '>' + v + '<span style="color:#8C6A3F;font-size:.65rem">' + badge + '</span></label>';
    }
    html += '<div class="user-filter-actions"><button id="user-ver-all">Alle</button><button id="user-ver-none">Keine</button></div>';
    return html;
  }

  function initUserVersionControls(stats, days) {
    initVersionSortDropdown(days);

    var btn = document.getElementById("user-version-filter-btn");
    var dd = document.getElementById("user-version-filter-dd");
    var countEl = document.getElementById("user-version-filter-count");
    if (!btn || !dd) return;

    var allVers = Object.keys(stats).sort(semverCmpDesc);

    function updateCount() {
      var n = __userVersionFilter ? __userVersionFilter.length : 0;
      if (countEl) countEl.textContent = n ? "(" + n + "/" + allVers.length + ")" : "(" + allVers.length + ")";
    }

    dd.innerHTML = buildFilterCheckboxHtml(allVers, stats);
    updateCount();

    btn.onclick = function(e) {
      e.stopPropagation();
      __userFilterDdOpen = !__userFilterDdOpen;
      dd.classList.toggle("open", __userFilterDdOpen);
    };

    document.addEventListener("click", function(e) {
      if (__userFilterDdOpen && !dd.contains(e.target) && e.target !== btn) {
        __userFilterDdOpen = false;
        dd.classList.remove("open");
      }
    });

    var cbs = dd.querySelectorAll('input[type=checkbox]');
    function applyFilter() {
      var sel = [];
      for (var cb of cbs) {
        if (cb.checked) sel.push(cb.value);
      }
      __userVersionFilter = sel.length === allVers.length ? null : sel;
      updateCount();
      renderUserProfileCharts(days);
    }
    for (var cb of cbs) {
      cb.addEventListener("change", applyFilter);
    }

    var allBtn = document.getElementById("user-ver-all");
    var noneBtn = document.getElementById("user-ver-none");
    if (allBtn) allBtn.onclick = function() {
      for (var cb of cbs) cb.checked = true;
      applyFilter();
    };
    if (noneBtn) noneBtn.onclick = function() {
      for (var cb of cbs) cb.checked = false;
      applyFilter();
    };
  }

  function collectAllVersionKeys(stats, days) {
    var allVers = Object.keys(stats);
    if (allVers.length) return allVers;
    return collectFallbackVersionKeys(days);
  }

  function collectFallbackVersionKeys(days) {
    var fallbackVers = {};
    for (var day of days) {
      for (var fk of Object.keys(day.versions || {})) fallbackVers[fk] = true;
    }
    return Object.keys(fallbackVers);
  }

  function maxKeyByValue(obj) {
    var best = "", bestVal = 0;
    for (var k of Object.keys(obj)) {
      if (obj[k] > bestVal) { best = k; bestVal = obj[k]; }
    }
    return best;
  }

  /**
   * Pick the highest semver version with calls on the most recent active day.
   * Uses newest-semver (not max-count) so a fresh upgrade is reflected
   * immediately, even if older versions still dominate the day's volume.
   * Entrypoint stays on max-count because there's no natural ordering.
   */
  function findLatestDayTopEntries(days) {
    for (var ldi = days.length - 1; ldi >= 0; ldi--) {
      var ldv = days[ldi].versions || {};
      var keys = Object.keys(ldv).filter(function (k) { return (ldv[k] || 0) > 0; });
      if (keys.length) {
        keys.sort(semverCmpDesc);
        return { topVersion: keys[0], topEntrypoint: maxKeyByValue(days[ldi].entrypoints || {}) };
      }
    }
    return { topVersion: "", topEntrypoint: "" };
  }

  function computeAnomalyStats(allVers, stats) {
    var totalCalls = 0;
    var totalAnomalies = 0;
    var worstVer = "";
    var worstAnomaly = 0;
    for (var ver of allVers) {
      var sv = stats[ver];
      if (sv) {
        totalCalls += sv.calls || 0;
        totalAnomalies += versionAnomalyTotal(sv);
        var wa = versionAnomalyTotal(sv);
        if (wa > worstAnomaly) { worstAnomaly = wa; worstVer = ver; }
      }
    }
    var anomalyRate = totalCalls > 0 ? Math.round(totalAnomalies / totalCalls * 100) : 0;
    return { totalCalls: totalCalls, totalAnomalies: totalAnomalies, anomalyRate: anomalyRate, worstVer: worstVer, worstAnomaly: worstAnomaly };
  }

  // ── Context builder ────────────────────────────────────────────────────────
  /**
   * Compute shared context for User Profile charts.
   * Cached on window.__dashboardState.getSectionCtx('userProfile') so standalone chart renderers can use it.
   */
  function _computeUserProfileCtx(days) {
    var stats = aggregateVersionStats(days);
    var allVers = collectAllVersionKeys(stats, days);
    var top = findLatestDayTopEntries(days);
    var anom = computeAnomalyStats(allVers, stats);

    var filteredVers = __userVersionFilter
      ? allVers.filter(function(v) { return __userVersionFilter.includes(v); })
      : allVers;
    var sortedVers = sortVersionKeys(filteredVers, stats, __userVersionSort);

    var barPitch = 30;
    var chartCanvasH = Math.max(240, sortedVers.length * barPitch + 56);

    var sCtx = {
      days: days,
      stats: stats,
      allVers: allVers,
      top: top,
      anom: anom,
      sortedVers: sortedVers,
      chartCanvasH: chartCanvasH,
      releaseData: window.__dashboardState?.getReleaseStability() || window.__dashboardState.getData()?.release_stability || null
    };
    window.__dashboardState.setSectionCtx('userProfile', sCtx);
    return sCtx;
  }

  // ── Chart renderers ────────────────────────────────────────────────────────
  function renderVersionHealthChart(sortedVers, stats, allVers) {
    var elV = document.getElementById("c-user-versions");
    var h3V = document.getElementById("user-version-h3");
    if (h3V) h3V.textContent = t("userVersionHealthTitle");
    var blurbV = document.getElementById("user-version-blurb");
    if (blurbV) blurbV.textContent = t("userVersionHealthBlurb");
    if (!elV || !allVers.length || !sortedVers.length) {
      __disposeUserEchartsChart("versions");
      return;
    }
    __disposeUserEchartsChart("versions");

    var datasets = [];
    for (var m of __versionHealthMetrics) {
      var mData = sortedVers.map(function(sv) { return stats[sv] ? (stats[sv][m.key] || 0) : 0; });
      datasets.push({ name: t(m.label), data: mData, color: m.color });
    }

    _userCharts.versions = echarts.init(elV, null, { renderer: 'canvas' });
    var vSeries = datasets.map(function(ds) {
      return { name: ds.name, type: 'bar', stack: 'vh', data: ds.data, itemStyle: { color: ds.color }, barCategoryGap: '12%' };
    });
    _userCharts.versions.setOption({
      animation: false,
      grid: __USER_PROFILE_BAR_GRID,
      legend: __userProfileLegendOpts(datasets.map(function(ds) { return ds.name; })),
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
      xAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: {
        type: "category",
        data: sortedVers,
        inverse: true,
        boundaryGap: true,
        axisLabel: __USER_PROFILE_BAR_Y_LABEL,
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } }
      },
      series: vSeries
    }, true);
  }

  function renderEntrypointsChart(sortedVers, stats) {
    var elE = document.getElementById("c-user-entrypoints");
    var h3E = document.getElementById("user-entrypoint-h3");
    if (h3E) h3E.textContent = t("userEntrypointChartTitle");
    var blurbE = document.getElementById("user-entrypoint-blurb");
    if (blurbE) blurbE.textContent = t("userEntrypointBlurb");
    if (!elE || !sortedVers.length) {
      __disposeUserEchartsChart("entrypoints");
      return;
    }
    __disposeUserEchartsChart("entrypoints");

    var allEp = {};
    for (var sv of sortedVers) {
      if (stats[sv]?.entrypoints) {
        for (var epk of Object.keys(stats[sv].entrypoints)) allEp[epk] = true;
      }
    }
    var epKeys = Object.keys(allEp).sort(function(a, b) { return a.localeCompare(b); });

    var epColors = {
      "claude-vscode": "rgba(184,145,90,0.8)",
      "cli": "rgba(34,197,94,0.8)",
      "claude-jetbrains": "rgba(245,158,11,0.8)"
    };
    var epSeries = [];
    var epLegendNames = [];
    for (var edi = 0; edi < epKeys.length; edi++) {
      var eKey = epKeys[edi];
      var legName = __userEntrypointLegendName(eKey);
      epLegendNames.push(legName);
      var eData = sortedVers.map(function(sv) { return stats[sv]?.entrypoints ? (stats[sv].entrypoints[eKey] || 0) : 0; });
      epSeries.push({
        name: legName, type: 'bar', stack: 'ep', data: eData, barCategoryGap: '12%',
        itemStyle: { color: epColors[eKey] || __userProfileColors[edi % __userProfileColors.length] }
      });
    }

    _userCharts.entrypoints = echarts.init(elE, null, { renderer: 'canvas' });
    _userCharts.entrypoints.setOption({
      animation: false,
      grid: __USER_PROFILE_BAR_GRID,
      legend: __userProfileLegendOpts(epLegendNames),
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
      xAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: {
        type: "category",
        data: sortedVers,
        inverse: true,
        boundaryGap: true,
        axisLabel: __USER_PROFILE_BAR_Y_LABEL,
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } }
      },
      series: epSeries
    }, true);
  }

  // ── Release Stability Chart ────────────────────────────────────────────────
  function __countReleaseStabilityBlurb(sortedVers, lookup) {
    var matched = 0, stableN = 0, regN = 0, hotN = 0, unknownN = 0;
    for (var ver of sortedVers) {
      var info = lookup[ver];
      if (info) {
        matched++;
        if (info.stability === "hotfix") hotN++;
        else if (info.stability === "regression") regN++;
        else stableN++;
      } else {
        unknownN++;
      }
    }
    return { matched: matched, stableN: stableN, regN: regN, hotN: hotN, unknownN: unknownN };
  }

  function __buildReleaseStabilitySeries(sortedVers, lookup) {
    var stableData = [];
    var regressionData = [];
    var hotfixData = [];
    var unknownData = [];
    var meta = [];
    for (var ver of sortedVers) {
      var r = lookup[ver];
      if (!r) {
        stableData.push(0);
        regressionData.push(0);
        hotfixData.push(0);
        unknownData.push(1);
        meta.push({ tag: ver, stability: "unknown", daysActive: 0, skippedPatches: 0, matchedKeywords: [] });
        continue;
      }
      var d = Math.max(r.daysActive || 0, 0.3);
      unknownData.push(0);
      if (r.stability === "hotfix") {
        stableData.push(0); regressionData.push(0); hotfixData.push(d);
      } else if (r.stability === "regression") {
        stableData.push(0); regressionData.push(d); hotfixData.push(0);
      } else {
        stableData.push(d); regressionData.push(0); hotfixData.push(0);
      }
      meta.push(r);
    }
    return { stableData: stableData, regressionData: regressionData, hotfixData: hotfixData, unknownData: unknownData, meta: meta };
  }

  function __releaseStabilityTooltipAfterBody(meta, items, t) {
    if (!items.length) return "";
    var idx = items[0].dataIndex;
    var m = meta[idx];
    if (!m) return "";
    if (m.stability === "unknown") return t("releaseStabilityNoRelease");
    var lines = [];
    lines.push((m.date || "") + " \u00B7 " + (m.daysActive || 0) + "d active \u00B7 " + m.stability);
    if (m.skippedPatches > 0) lines.push(t("releaseStabilitySkipped") + ": " + m.skippedPatches);
    if (m.matchedKeywords?.length) lines.push("Keywords: " + m.matchedKeywords.join(", "));
    return lines.join("\n");
  }

  // Build a lookup: version string (without "v" prefix) -> release info
  function __buildReleaseLookup(releaseData) {
    var map = {};
    if (!releaseData?.releases) return map;
    for (var r of releaseData.releases) {
      var key = (r.tag || "").replace(/^v/, "");
      map[key] = r;
    }
    return map;
  }

  function renderReleaseStabilityChart(sortedVers, releaseData) {
    var el = document.getElementById("c-user-release-stability");
    var h3 = document.getElementById("user-release-stability-h3");
    if (h3) h3.textContent = t("releaseStabilityTitle");
    var blurb = document.getElementById("user-release-stability-blurb");
    if (!el) return;
    if (_userCharts.releaseStability) {
      if (typeof _userCharts.releaseStability.dispose === 'function') _userCharts.releaseStability.dispose();
      _userCharts.releaseStability = null;
    }
    if (!sortedVers?.length || !releaseData) {
      if (blurb) blurb.textContent = t("releaseStabilityNoData");
      return;
    }

    var lookup = __buildReleaseLookup(releaseData);

    var counts = __countReleaseStabilityBlurb(sortedVers, lookup);
    if (blurb) blurb.textContent = t("releaseStabilityBlurb")
      .replace("{total}", String(sortedVers.length))
      .replace("{matched}", String(counts.matched))
      .replace("{stable}", String(counts.stableN))
      .replace("{hotfixes}", String(counts.hotN))
      .replace("{regressions}", String(counts.regN));

    var series = __buildReleaseStabilitySeries(sortedVers, lookup);

    _userCharts.releaseStability = echarts.init(el, null, { renderer: 'canvas' });
    _userCharts.releaseStability.setOption({
      animation: false,
      grid: __USER_PROFILE_BAR_GRID,
      legend: __userProfileLegendOpts([
        t("releaseStabilityStable"),
        t("releaseStabilityRegression"),
        t("releaseStabilityHotfix"),
        t("releaseStabilityUnknown")
      ]),
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
      xAxis: { type: 'value', min: 0, name: t("releaseStabilityXAxis"), nameLocation: 'center', nameGap: 22, nameTextStyle: { color: '#8C6A3F', fontSize: 11 },
        axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: {
        type: "category",
        data: sortedVers,
        inverse: true,
        boundaryGap: true,
        axisLabel: __USER_PROFILE_BAR_Y_LABEL,
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.18)' } }
      },
      series: [
        { name: t("releaseStabilityStable"), type: 'bar', stack: 's', data: series.stableData, itemStyle: { color: 'rgba(34,197,94,0.8)' }, barCategoryGap: '12%' },
        { name: t("releaseStabilityRegression"), type: 'bar', stack: 's', data: series.regressionData, itemStyle: { color: 'rgba(250,204,21,0.85)' }, barCategoryGap: '12%' },
        { name: t("releaseStabilityHotfix"), type: 'bar', stack: 's', data: series.hotfixData, itemStyle: { color: 'rgba(248,113,113,0.85)' }, barCategoryGap: '12%' },
        { name: t("releaseStabilityUnknown"), type: 'bar', stack: 's', data: series.unknownData, itemStyle: { color: 'rgba(100,116,139,0.4)' }, barCategoryGap: '12%' }
      ]
    }, true);
  }

  // ── Main entry point ───────────────────────────────────────────────────────
  function renderUserProfileCharts(dataOrDays, dispatchedDays) {
    var sumEl = document.getElementById("user-profile-summary-line");
    if (!sumEl) return;
    var days = Array.isArray(dataOrDays)
      ? dataOrDays
      : (Array.isArray(dispatchedDays)
        ? dispatchedDays
        : (window.__dashboardState?.getFilteredDays(dataOrDays?.days || []) || []));

    if (!days?.length) {
      sumEl.textContent = t("userProfileNoData");
      __disposeUserEchartsChart("versions");
      __disposeUserEchartsChart("entrypoints");
      __disposeUserEchartsChart("releaseStability");
      return;
    }

    var sCtx = _computeUserProfileCtx(days);

    sumEl.textContent = t("userProfileSummary")
      .replace("{version}", sCtx.top.topVersion || "?")
      .replace("{entrypoint}", sCtx.top.topEntrypoint || "?")
      .replace("{verCount}", String(sCtx.allVers.length))
      .replace("{rate}", String(sCtx.anom.anomalyRate))
      .replace("{anomalies}", String(sCtx.anom.totalAnomalies))
      .replace("{calls}", String(sCtx.anom.totalCalls))
      .replace("{worst}", sCtx.anom.worstVer || "-")
      .replace("{worstCount}", String(sCtx.anom.worstAnomaly));

    // Init sort/filter controls
    initUserVersionControls(sCtx.stats, days);

    // Set canvas heights
    __ensureUserProfileHeightObserver();
    __applyUserProfileChartHeight(sCtx);

    // Render via standalone functions
    window.renderUserProfile_versions(sCtx);
    window.renderUserProfile_entrypoints(sCtx);
    window.renderUserProfile_releaseStability(sCtx);

    function __resizeUserProfileChartsAfterLayout() {
      try {
        __applyUserProfileChartHeight(sCtx);
        if (_userCharts.versions && typeof _userCharts.versions.resize === "function") _userCharts.versions.resize();
        if (_userCharts.entrypoints && typeof _userCharts.entrypoints.resize === "function") _userCharts.entrypoints.resize();
        if (_userCharts.releaseStability && typeof _userCharts.releaseStability.resize === "function") _userCharts.releaseStability.resize();
      } catch (error) { logClientOptionalErr(error); }
    }
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(__resizeUserProfileChartsAfterLayout);
    } else {
      setTimeout(__resizeUserProfileChartsAfterLayout, 0);
    }
  }

  // ── Widget dispatcher shims ────────────────────────────────────────────────
  /** Standalone: render Version Health horizontal bar chart. */
  window.renderUserProfile_versions = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('userProfile');
    if (!sCtx) return;
    renderVersionHealthChart(sCtx.sortedVers, sCtx.stats, sCtx.allVers);
  };

  /** Standalone: render Entrypoints horizontal bar chart. */
  window.renderUserProfile_entrypoints = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('userProfile');
    if (!sCtx) return;
    renderEntrypointsChart(sCtx.sortedVers, sCtx.stats);
  };

  /** Standalone: render Release Stability horizontal bar chart. */
  window.renderUserProfile_releaseStability = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('userProfile');
    if (!sCtx) return;
    renderReleaseStabilityChart(sCtx.sortedVers, sCtx.releaseData);
  };

  // ── Register on window ─────────────────────────────────────────────────────
  window.renderUserProfileCharts = renderUserProfileCharts;
  window.__userProfileChartsResizeAll = __userProfileChartsResizeAll;
  window._computeUserProfileCtx = _computeUserProfileCtx;

})();
