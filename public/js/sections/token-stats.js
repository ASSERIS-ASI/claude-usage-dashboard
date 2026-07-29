/**
 * @asseris-module       Token Stats
 * @asseris-description  Auto-annotated module metadata for public/js/sections/token-stats.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * sections/token-stats.js - Token Stats section renderer.
 * Surface: Usage.
 * Extracted from dashboard-sections.js (Phase 16c).
 */
(function () {

  /**
   * Compute shared context for Token Stats charts.
   * Cached on window.__dashboardState.getSectionCtx('tokenStats') so standalone chart renderers can use it.
   * Returns the same forensic values that renderTokenStatsSection returns.
   */
  window._computeTokenStatsCtx = function (ctx) {
    // The monolithic renderTokenStatsSection computes and caches this.
    // If called before rendering, just store ctx for later.
    if (!window.__dashboardState.getSectionCtx('tokenStats')) {
      window.__dashboardState.setSectionCtx('tokenStats', { ctx: ctx });
    }
    return window.__dashboardState.getSectionCtx('tokenStats');
  };

  /**
   * Standalone chart renderers for Token Stats.
   * These delegate to the cached ECharts instances that renderTokenStatsSection creates.
   * On standalone call (when section hasn't rendered), they render from cached ctx.
   */
  window.renderTokenStats_c1_daily = function () {
    // c1 is rendered inline by renderTokenStatsSection; standalone re-render via ctx
    var sCtx = window.__dashboardState.getSectionCtx('tokenStats');
    if (!sCtx || !sCtx.ctx) return;
    if (_charts.c1 && typeof _charts.c1.resize === 'function') _charts.c1.resize();
  };
  window.renderTokenStats_c2_daily = function () {
    if (_charts.c2 && typeof _charts.c2.resize === 'function') _charts.c2.resize();
  };
  window.renderTokenStats_c3_daily = function () {
    if (_charts.c3 && typeof _charts.c3.resize === 'function') _charts.c3.resize();
  };
  window.renderTokenStats_c4_hourly = function () {
    if (_charts.c4 && typeof _charts.c4.resize === 'function') _charts.c4.resize();
  };
  window.renderTokenStats_c1hosts = function () {
    if (_charts.c1hosts && typeof _charts.c1hosts.resize === 'function') _charts.c1hosts.resize();
  };

  /* ================================================================
   *  renderTokenStatsSection — Summary cards + charts c1-c4 + host table
   * ================================================================ */
  window.renderTokenStatsSection = function (ctx) {
    var data = ctx.data;
    var days = ctx.days;
    var selDay = ctx.selDay;
    var pick = ctx.pick;
    var hLabs = ctx.hLabs;
    var multiHost = ctx.multiHost;

    // --- Summary cards (gewaehlter Tag im Dropdown); Host-Filter steuert Tages-/Peak-/Forensic-Kennzahlen ---
    if (!selDay) return;
    var fhCard = getForensicHostFilterForCharts();
    var hSlicePick = fhCard && selDay.hosts?.[fhCard] ? selDay.hosts[fhCard] : null;
    var emptyHostDay = {
      output: 0,
      cache_read: 0,
      total: 0,
      calls: 0,
      active_hours: 0,
      cache_output_ratio: 0,
      overhead: 0,
      hit_limit: 0,
      session_signals: { continue: 0, resume: 0, retry: 0, interrupt: 0 }
    };
    var cardBase = fhCard ? hSlicePick || emptyHostDay : selDay;
    var totalOut = fhCard ? sumHostNumericField(days, fhCard, "output") : days.reduce(function (s, d) { return s + d.output; }, 0);
    var totalCache = fhCard ? sumHostNumericField(days, fhCard, "cache_read") : days.reduce(function (s, d) { return s + d.cache_read; }, 0);
    var totalAll = fhCard
      ? days.reduce(function (s, d) {
          var hh = d.hosts?.[fhCard];
          return s + (hh ? hh.total || 0 : 0);
        }, 0)
      : days.reduce(function (s, d) { return s + d.total; }, 0);
    var peak = fhCard
      ? (function () {
          var hp = findHostPeakAcrossDays(days, fhCard);
          return { date: hp.date, total: hp.total };
        })()
      : days.reduce(function (a, b) { return a.total > b.total ? a : b; });
    var selTotalForBudget = cardBase.total || 0;
    var budgetRatio =
      peak.total > 0 && selTotalForBudget > 0 ? Math.round(peak.total / (selTotalForBudget / 0.9)) : 0;
    var hitSel = fhCard ? (hSlicePick ? hSlicePick.hit_limit || 0 : 0) : selDay.hit_limit || 0;
    var hitAll = fhCard
      ? days.reduce(function (s, d) {
          var hh = d.hosts?.[fhCard];
          return s + (hh ? hh.hit_limit || 0 : 0);
        }, 0)
      : days.reduce(function (s, d) { return s + (d.hit_limit || 0); }, 0);
    var fc;
    var fwarn;
    var impl90;
    var forensicHintF;
    if (fhCard) {
      var rHost = hostApiToForensicRow(hSlicePick);
      var hpK = findHostPeakAcrossDays(days, fhCard);
      var fHost = computeForensicForDayClient(pick, rHost, hpK.date, hpK.total);
      fc = fHost.forensic_code;
      forensicHintF = fHost.forensic_hint;
      impl90 = fHost.forensic_implied_cap_90;
      fwarn = fc === "?" || fc === "HIT" || fc === "<<P";
    } else {
      fc = selDay.forensic_code || "\u2014";
      forensicHintF = selDay.forensic_hint || "";
      fwarn = fc === "?" || fc === "HIT" || fc === "<<P";
      impl90 = selDay.forensic_implied_cap_90 || 0;
    }
    var cards = [
      { wid: "token-stats-kpi-day-output", label: t("cardDayOutput"), value: fmt(cardBase.output || 0), sub: selDay.date, cls: "" },
      {
        wid: "token-stats-kpi-day-cache-read",
        label: t("cardDayCacheRead"),
        value: fmt(cardBase.cache_read || 0),
        sub: tr("cardCacheOutSub", { ratio: cardBase.cache_output_ratio || 0 }),
        cls: (cardBase.cache_output_ratio || 0) > 500 ? "warn" : ""
      },
      {
        wid: "token-stats-kpi-day-total",
        label: t("cardDayTotal"),
        value: fmt(cardBase.total || 0),
        sub: tr("cardCallsActiveSub", { calls: cardBase.calls || 0, hours: cardBase.active_hours || 0 }),
        cls: ""
      },
      { wid: "token-stats-kpi-hit-day", label: t("cardHitDay"), value: String(hitSel), sub: t("cardHitDaySub"), cls: hitSel > 0 ? "warn" : "ok" },
      { wid: "token-stats-kpi-hit-all", label: t("cardHitAll"), value: String(hitAll), sub: t("cardHitAllSub"), cls: hitAll > 0 ? "warn" : "" },
      {
        wid: "token-stats-kpi-overhead",
        label: t("cardOverhead"),
        value: (cardBase.overhead || 0) + "x",
        sub: t("cardOverheadSub"),
        cls: (cardBase.overhead || 0) > 1000 ? "danger" : ""
      },
      { wid: "token-stats-kpi-peak", label: t("cardPeak"), value: fmt(peak.total || 0), sub: tr("cardPeakSub", { date: peak.date || "\u2014" }), cls: "ok" },
      { wid: "token-stats-kpi-all-out", label: t("cardAllOut"), value: fmt(totalOut), sub: tr("cardAllOutSub", { days: days.length }), cls: "" },
      { wid: "token-stats-kpi-all-cache", label: t("cardAllCache"), value: fmt(totalCache), sub: tr("cardAllCacheSub", { pct: pct(totalCache, totalAll) }), cls: "" }
    ];
    var ssSel = cardBase.session_signals || {};
    var ssc = ssSel.continue || 0;
    var ssr = ssSel.resume || 0;
    var ssy = ssSel.retry || 0;
    var ssi = ssSel.interrupt || 0;
    cards.push({
      wid: "token-stats-kpi-session-signals",
      label: t("cardSessionSignals"),
      value: String(ssc + ssr + ssy + ssi),
      sub: tr("cardSessionSignalsSub", { c: String(ssc), r: String(ssr), y: String(ssy), i: String(ssi) }),
      cls: ssy + ssi > 0 ? "warn" : ""
    });
    var chtml = "";
    for (var cix = 0; cix < cards.length; cix++) {
      var c = cards[cix];
      var wid = c.wid;
      if (!wid) continue;
      chtml +=
        '<div class="chart-box chart-box--kpi" id="' +
        wid +
        '"><div class="card ' +
        c.cls +
        '"><div class="label">' +
        escHtml(c.label) +
        '</div><div class="value">' +
        escHtml(c.value) +
        '</div><div class="sub">' +
        escHtml(c.sub) +
        "</div></div></div>";
    }
    if (multiHost && selDay.hosts) {
      chtml += '<div class="chart-box chart-box--kpi" id="token-stats-kpi-hosts">';
      for (var hci = 0; hci < hLabs.length; hci++) {
        var hlbl = hLabs[hci];
        var hday = selDay.hosts[hlbl];
        if (!hday) continue;
        var hhit = hday.hit_limit || 0;
        var hc = {
          label: hlbl + t("cardHostParen"),
          value: fmt(hday.total),
          sub: tr("cardHostSub", { out: fmt(hday.output), calls: hday.calls, hit: String(hhit) }),
          cls: hhit > 0 ? "warn" : ""
        };
        chtml +=
          '<div class="card ' +
          hc.cls +
          '"><div class="label">' +
          escHtml(hc.label) +
          '</div><div class="value">' +
          escHtml(hc.value) +
          '</div><div class="sub">' +
          escHtml(hc.sub) +
          "</div></div>";
      }
      chtml += "</div>";
    }
    var _ce = document.getElementById("cards");
    if (_ce && _ce.innerHTML !== chtml) _ce.innerHTML = chtml;
    var tsSum=document.getElementById("token-stats-summary-line");
    if(tsSum) tsSum.textContent=tr("tokenStatsSummary",{date:selDay.date||"",out:fmt(cardBase.output||0),cache:fmt(cardBase.cache_read||0),overhead:(cardBase.overhead||0)+"x"});

    // --- Charts ---
    var labels = days.map(function(d){return d.date.slice(5)});
    var mainScope = getMainChartsScope();
    var hourlyMode = mainScope === "hourly";
    var hourLabs = buildHourlyAxisLabels();
    var dayForHourly = selDay;
    var fhForMainCharts = getForensicHostFilterForCharts();
    var mainHostKey =
      multiHost && fhForMainCharts && hLabs.includes(fhForMainCharts) ? fhForMainCharts : "";
    var c4TimelineHostStack = multiHost && !mainHostKey;
    var tokenStatsHostTrioRow = multiHost && !hourlyMode && !mainHostKey;
    var c3PairGridTop = tokenStatsHostTrioRow ? 36 : 20;
    destroyMainChartIfScopeMismatch(mainScope, "c1");
    destroyMainChartIfScopeMismatch(mainScope, "c2");
    destroyMainChartIfScopeMismatch(mainScope, "c3");
    destroyMainChartIfScopeMismatch(mainScope, "c4");
    if (_charts.c1hosts && _charts.c1hosts._dashScope !== mainScope) {
      try {
        if (typeof _charts.c1hosts.dispose === 'function') _charts.c1hosts.dispose();
        else if (typeof _charts.c1hosts.destroy === 'function') _charts.c1hosts.destroy();
      } catch (error) { /* intentional */ }
      _charts.c1hosts = null;
    }

    // Haupt-Chart-Boxen stehen in tpl/dashboard.html (c1-c4); nur Host-Box ggf. einfuegen.
    (function reorderChartBoxes(){
      var cr = document.getElementById("charts");
      var pair = document.getElementById("charts-host-sub");
      if (!cr || !pair) return;
      var c1b = document.getElementById("c1")?.closest(".chart-box");
      var c2b = document.getElementById("c2")?.closest(".chart-box");
      var c3b = document.getElementById("c3")?.closest(".chart-box");
      var hb = document.getElementById("chart-host-wrap");
      var c4b = document.getElementById("c4")?.closest(".chart-box");
      if (c1b) cr.appendChild(c1b);
      if (c2b) cr.appendChild(c2b);
      if (hb) pair.appendChild(hb);
      if (c3b) pair.appendChild(c3b);
      if (c4b) pair.appendChild(c4b);
    })();

    var elc1 = document.getElementById("c1");
    if (elc1?.previousElementSibling?.tagName === "H3") {
      elc1.previousElementSibling.textContent = hourlyMode
        ? t("chartDailyTokenHourly") + " (" + pick + ")"
        : t("chartDailyToken");
    }
    var elc2 = document.getElementById("c2");
    if (elc2?.previousElementSibling?.tagName === "H3") {
      elc2.previousElementSibling.textContent = hourlyMode ? t("chartCacheRatioHourly") : t("chartCacheRatio");
    }

    // -- c1: Token Breakdown (stacked bar) -- ECharts --
    if (!_charts.c1) _charts.c1 = echarts.init(elc1, null, { renderer: 'canvas' });
    var c1Labels = hourlyMode ? hourLabs : labels;
    var c1CacheRead = hourlyMode
      ? estimatedFieldPerHourHost(dayForHourly, mainHostKey, "cache_read")
      : days.map(function (d) { return dayNumericForMainCharts(d, mainHostKey, "cache_read"); });
    var c1Output = hourlyMode
      ? estimatedFieldPerHourHost(dayForHourly, mainHostKey, "output")
      : days.map(function (d) { return dayNumericForMainCharts(d, mainHostKey, "output"); });
    var c1CacheCreate = hourlyMode
      ? estimatedFieldPerHourHost(dayForHourly, mainHostKey, "cache_creation")
      : days.map(function (d) { return dayNumericForMainCharts(d, mainHostKey, "cache_creation"); });
    _charts.c1.setOption({
      animation: false,
      grid: { left: 60, right: 16, top: 36, bottom: 30 },
      legend: { data: [t("chartDS_cacheRead"), t("chartDS_output"), t("chartDS_cacheCreate")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var lines = [params[0].axisValueLabel];
          for (var pi = 0; pi < params.length; pi++) lines.push(params[pi].marker + ' ' + params[pi].seriesName + ': ' + fmt(params[pi].value));
          if (hourlyMode) lines.push(t("chartTooltipHourlyTokenEst") + ' | C:O ' + (dayForHourly.cache_output_ratio || 0) + 'x');
          else {
            var di1 = params[0].dataIndex;
            lines.push(tr("chartTooltipCoDay", { ratio: String(dayRatioCacheOutForMainCharts(days[di1], mainHostKey)) }));
          }
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: c1Labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', name: t("unifiedAxisTokens"), nameTextStyle: { color: '#A0875E' },
        axisLabel: { color: '#A0875E', formatter: function(v) { return fmt(v); } },
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [
        { name: t("chartDS_cacheRead"), type: 'bar', stack: 'tok', barCategoryGap: '8%', data: c1CacheRead, itemStyle: { color: 'rgba(212,175,127,0.7)' } },
        { name: t("chartDS_output"), type: 'bar', stack: 'tok', barCategoryGap: '8%', data: c1Output, itemStyle: { color: 'rgba(184,145,90,0.9)' } },
        { name: t("chartDS_cacheCreate"), type: 'bar', stack: 'tok', barCategoryGap: '8%', data: c1CacheCreate, itemStyle: { color: 'rgba(6,182,212,0.5)' } }
      ]
    }, true);
    _charts.c1._dashScope = mainScope;

    // -- c1-hosts: Per-Host Token Breakdown (stacked bar) -- ECharts --
    var hostBarColors = ["rgba(184,145,90,0.88)","rgba(167,139,250,0.88)","rgba(52,211,153,0.88)","rgba(251,191,36,0.88)","rgba(249,115,22,0.88)","rgba(236,72,153,0.88)"];
    if (multiHost && !hourlyMode && !mainHostKey) {
      if (!document.getElementById("c1-hosts")) {
        var ch1h = document.createElement("div");
        ch1h.className = "chart-box";
        ch1h.id = "chart-host-wrap";
        ch1h.innerHTML = "<h3></h3><p class=\"token-stats-host-blurb\"></p><div id=\"c1-hosts\" class=\"token-stats-pair-echart\"></div>";
        var pairIns = document.getElementById("charts-host-sub");
        if (pairIns) {
          if (pairIns.firstChild) pairIns.insertBefore(ch1h, pairIns.firstChild);
          else pairIns.appendChild(ch1h);
        }
      }
      var pairBar = document.getElementById("charts-host-sub");
      if (pairBar) pairBar.classList.remove("no-host-chart");
      var chw = document.getElementById("chart-host-wrap");
      if (chw) {
        chw.style.display = "";
        var h3h = chw.querySelector("h3");
        var ph = chw.querySelector("p");
        if (h3h) h3h.textContent = t("chartHostTitle");
        if (ph) {
          ph.classList.add("token-stats-host-blurb");
          ph.textContent = t("chartHostBlurb");
        }
      }
      var hostEl = document.getElementById("c1-hosts");
      if (hostEl) {
        hostEl.classList.add("token-stats-pair-echart");
        if (!_charts.c1hosts) _charts.c1hosts = echarts.init(hostEl, null, { renderer: 'canvas' });
        var hostSeries = [];
        for (var hli = 0; hli < hLabs.length; hli++) {
          var lb0 = hLabs[hli];
          hostSeries.push({
            name: lb0, type: 'bar', stack: 'h', barCategoryGap: '8%',
            data: days.map(function(d) { var x = d.hosts?.[lb0]; return x ? (x.total || 0) : 0; }),
            itemStyle: { color: hostBarColors[hli % hostBarColors.length] }
          });
        }
        _charts.c1hosts.setOption({
          animation: false,
          grid: { left: 60, right: 16, top: 36, bottom: 30 },
          legend: { data: hLabs, textStyle: { color: '#EFE7D6' }, top: 4 },
          tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
            formatter: function(params) {
              var lines = [params[0].axisValueLabel];
              var total = 0;
              for (var pi = 0; pi < params.length; pi++) {
                lines.push(params[pi].marker + ' ' + params[pi].seriesName + ': ' + fmt(params[pi].value));
                total += params[pi].value || 0;
              }
              lines.push(t("hostStackFooter") + fmt(total));
              return lines.join('<br>');
            }
          },
          xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
          yAxis: { type: 'value', axisLabel: { color: '#A0875E', formatter: function(v) { return fmt(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
          series: hostSeries
        }, true);
        _charts.c1hosts._dashScope = mainScope;
      }
    } else {
      if (_charts.c1hosts) {
        try { _charts.c1hosts.dispose(); } catch (error) { /* intentional */ }
        _charts.c1hosts = null;
      }
      var chw2 = document.getElementById("chart-host-wrap");
      if (chw2) chw2.style.display = "none";
      var pairBar2 = document.getElementById("charts-host-sub");
      if (pairBar2) pairBar2.classList.add("no-host-chart");
    }

    // -- c2: Cache:Output Ratio (line) -- ECharts --
    if (!_charts.c2) _charts.c2 = echarts.init(elc2, null, { renderer: 'canvas' });
    var c2Labels = hourlyMode ? hourLabs : labels;
    var c2Data = hourlyMode
      ? hourlyCacheOutRatioEstHost(dayForHourly, mainHostKey)
      : days.map(function (d) { return dayRatioCacheOutForMainCharts(d, mainHostKey); });
    _charts.c2.setOption({
      animation: false,
      grid: { left: 50, right: 16, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var p = params[0];
          var line = p.axisValueLabel + '<br>' + p.marker + ' ' + p.seriesName + ': ' + p.value + 'x';
          if (hourlyMode) { line += '<br>' + t("chartTooltipHourlyTokenEst"); }
          else {
            var d2 = days[p.dataIndex];
            if (d2) {
              var hx = mainHostKey && d2.hosts?.[mainHostKey] ? d2.hosts[mainHostKey] : d2;
              line += '<br>' + tr("chartTooltipOutCacheDay", { out: fmt(hx.output), cache: fmt(hx.cache_read) });
            }
          }
          return line;
        }
      },
      xAxis: { type: 'category', data: c2Labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', formatter: '{value}x' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [{
        name: t("chartLineCacheOut"), type: 'line', data: c2Data, smooth: 0.3,
        lineStyle: { color: '#f59e0b' }, itemStyle: { color: '#f59e0b' },
        areaStyle: { color: 'rgba(245,158,11,0.1)' }
      }]
    }, true);
    _charts.c2._dashScope = mainScope;

    var elc3 = document.getElementById("c3");
    if (elc3) elc3.classList.add("token-stats-pair-echart");
    if (elc3?.previousElementSibling?.tagName === "H3") {
      elc3.previousElementSibling.textContent = hourlyMode ? t("chartOutPerHourHourly") : t("chartOutPerHour");
    }
    var elc4 = document.getElementById("c4");
    if (elc4) elc4.classList.add("token-stats-pair-echart");
    if (elc4?.previousElementSibling?.tagName === "H3") {
      elc4.previousElementSibling.textContent = hourlyMode ? t("chartSubCachePctHourly") : t("chartSubCachePct");
    }

    // -- c3: Output per Hour / API Events (bar) -- ECharts --
    if (!_charts.c3) _charts.c3 = echarts.init(elc3, null, { renderer: 'canvas' });
    var c3Labels, c3Data, c3Name;
    if (hourlyMode) {
      var hwC = mainHostKey
        ? dayHourCallWeights({
            hours: (dayForHourly.hosts?.[mainHostKey]?.hours) || {},
            calls: dayForHourly.hosts?.[mainHostKey]?.calls != null
              ? dayForHourly.hosts[mainHostKey].calls : dayForHourly.calls || 0
          })
        : dayHourCallWeights(dayForHourly);
      c3Labels = hourLabs; c3Data = hwC.w.slice(); c3Name = t("chartHourlyApiEventsLabel");
    } else {
      c3Labels = labels;
      c3Data = days.map(function (d) { return dayOutputPerHourForMainCharts(d, mainHostKey); });
      c3Name = t("chartOutPerHLabel");
    }
    _charts.c3.setOption({
      animation: false,
      grid: { left: 50, right: 16, top: c3PairGridTop, bottom: 30 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) { return params[0].axisValueLabel + '<br>' + params[0].marker + ' ' + fmt(params[0].value) + '/h'; }
      },
      xAxis: { type: 'category', data: c3Labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E', formatter: function(v) { return fmt(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      series: [{ name: c3Name, type: 'bar', barCategoryGap: '8%', data: c3Data, itemStyle: { color: 'rgba(34,197,94,0.7)' } }]
    }, true);
    _charts.c3._dashScope = mainScope;

    // -- c4: Signals / Sub-Cache % (stacked bar) -- ECharts --
    if (!_charts.c4) _charts.c4 = echarts.init(elc4, null, { renderer: 'canvas' });
    var c4Series = [];
    var c4Leg = [];
    if (hourlyMode) {
      c4Leg = [t("forensicDS_continueStack"), t("forensicDS_resumeStack"), t("forensicDS_retryStack"), t("forensicDS_interruptStack")];
      var sigColors = ['rgba(184,145,90,0.75)', 'rgba(6,182,212,0.7)', 'rgba(239,68,68,0.65)', 'rgba(251,191,36,0.55)'];
      var sigKeys = ['continue', 'resume', 'retry', 'interrupt'];
      for (var si4 = 0; si4 < 4; si4++) {
        c4Series.push({ name: c4Leg[si4], type: 'bar', stack: 'sig', barCategoryGap: '8%', data: hourSignalsArrayForHost(dayForHourly, mainHostKey, sigKeys[si4]), itemStyle: { color: sigColors[si4] } });
      }
      _charts.c4.setOption({
        animation: false,
        grid: { left: 50, right: 16, top: 36, bottom: 30 },
        legend: { data: c4Leg, textStyle: { color: '#EFE7D6' }, top: 4 },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' } },
        xAxis: { type: 'category', data: hourLabs, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'value', min: 0, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        series: c4Series
      }, true);
    } else if (c4TimelineHostStack) {
      for (var c4i = 0; c4i < hLabs.length; c4i++) {
        var lb4 = hLabs[c4i];
        c4Leg.push(lb4);
        c4Series.push({
          name: lb4, type: 'bar', stack: 'subcache', barCategoryGap: '8%',
          data: days.map(function (d) { var cr = d.cache_read || 0; var x = d.hosts?.[lb4]; if (!x || cr <= 0) return 0; return Math.round(((x.sub_cache || 0) / cr) * 100); }),
          itemStyle: { color: hostBarColors[c4i % hostBarColors.length] }
        });
      }
      _charts.c4.setOption({
        animation: false,
        grid: { left: 50, right: 16, top: 36, bottom: 30 },
        legend: { data: c4Leg, textStyle: { color: '#EFE7D6' }, top: 4 },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
          formatter: function(params) {
            var lines = [params[0].axisValueLabel];
            for (var pi = 0; pi < params.length; pi++) lines.push(params[pi].marker + ' ' + params[pi].seriesName + ': ' + params[pi].value + '%');
            return lines.join('<br>');
          }
        },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'value', max: 100, axisLabel: { color: '#A0875E', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        series: c4Series
      }, true);
    } else {
      var c4Vals = days.map(function (d) { return subCachePctForDayMainCharts(d, mainHostKey); });
      var c4Colors = c4Vals.map(function(p) { return p > 70 ? 'rgba(239,68,68,0.7)' : 'rgba(100,116,139,0.5)'; });
      var c4DaysSnap = days.map(function(d) { return { sub_cache: d.sub_cache || 0, cache_read: d.cache_read || 0 }; });
      var fmtM = function(n) { return n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(0)+'M' : (n/1e3).toFixed(0)+'K'; };
      _charts.c4.setOption({
        animation: false,
        grid: { left: 50, right: 16, top: 20, bottom: 30 },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
          formatter: function(params) {
            var idx = params[0].dataIndex;
            var snap = c4DaysSnap[idx];
            var pct = params[0].value;
            var flag = pct > 70 ? ' <span style="color:#ef4444">⚠ agent-dominated</span>' : '';
            return params[0].axisValueLabel + '<br>Subagent: <b>' + pct + '%</b>' + flag
              + '<br>Sub-cache: ' + fmtM(snap.sub_cache) + ' / ' + fmtM(snap.cache_read) + ' total';
          }
        },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'value', max: 100, axisLabel: { color: '#A0875E', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        series: [{ name: t("chartSubCachePct"), type: 'bar', barCategoryGap: '8%', data: c4Vals,
          itemStyle: { color: function(params) { return c4Colors[params.dataIndex]; } },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: 'rgba(239,68,68,0.45)', type: 'dashed', width: 1 },
            label: { color: 'rgba(239,68,68,0.7)', fontSize: 10, formatter: '≥70% agent-dominated' },
            data: [{ yAxis: 70 }] } }]
      }, true);
    }
    _charts.c4._dashScope = mainScope;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        if (_charts.c1hosts && typeof _charts.c1hosts.resize === "function") _charts.c1hosts.resize();
        if (_charts.c3 && typeof _charts.c3.resize === "function") _charts.c3.resize();
        if (_charts.c4 && typeof _charts.c4.resize === "function") _charts.c4.resize();
      });
    }
    var crSig = document.getElementById("charts");
    if (crSig) crSig.classList.remove("has-session-row");

    var tblDeleg = document.getElementById("tbl");
    if (tblDeleg && !tblDeleg.dataset.hostDetailDeleg) {
      tblDeleg.dataset.hostDetailDeleg = "1";
      tblDeleg.addEventListener("click", function (ev) {
        var tr = ev.target.closest("tr");
        if (!tr || !tr.dataset.detailRow) return;
        if (tr.dataset.detailRow === "host" && tr.dataset.hostLabel) {
          window.__usageDetailHost = tr.dataset.hostLabel;
          if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
        } else if (tr.dataset.detailRow === "filtered") {
          window.__usageDetailHost = null;
          if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
        }
      });
    }

    // --- Table ---
    var cols = t("tableCols").split("|");
    for (var ctrim = cols.length - 1; ctrim >= 0; ctrim--) {
      if (cols[ctrim] !== "") break;
      cols.pop();
    }
    var thead = document.querySelector("#tbl thead tr");
    thead.innerHTML = "";
    cols.forEach(function (c, ci) {
      var th = document.createElement("th");
      th.textContent = c;
      if (ci > 0) th.className = "num";
      thead.appendChild(th);
    });
    var cg = document.getElementById("tbl-colgroup");
    if (cg && cols.length) {
      cg.innerHTML = "";
      var cw = (100 / cols.length).toFixed(5) + "%";
      for (var cgi = 0; cgi < cols.length; cgi++) {
        var colEl = document.createElement("col");
        colEl.style.width = cw;
        cg.appendChild(colEl);
      }
    }

    var tbody=document.querySelector("#tbl tbody");
    tbody.innerHTML="";
    var filteredHost = window.__usageDetailHost;
    var fhDay = filteredHost && selDay.hosts?.[filteredHost] ? selDay.hosts[filteredHost] : null;
    var tableRows = fhDay
      ? [{
          date: pick,
          output: fhDay.output,
          cache_read: fhDay.cache_read,
          cache_output_ratio: fhDay.cache_output_ratio,
          overhead: fhDay.overhead,
          total: fhDay.total,
          calls: fhDay.calls,
          active_hours: fhDay.active_hours,
          hit_limit: fhDay.hit_limit || 0,
          sub_pct: fhDay.sub_pct,
          sub_cache_pct: fhDay.sub_cache_pct,
          output_per_hour: fhDay.output_per_hour
        }]
      : [selDay];
    for(var i=0;i<tableRows.length;i++){
      var d=tableRows[i];
      var trEl=document.createElement("tr");
      if (fhDay) {
        trEl.dataset.detailRow = "filtered";
        trEl.style.cursor = "pointer";
        trEl.title = t("dailyDetailFilteredRowTitle");
      }
      var hl=d.hit_limit||0;
      var vals = [d.date, fmt(d.output), fmt(d.cache_read), d.cache_output_ratio + "x", d.overhead + "x", fmt(d.total), d.calls, d.active_hours, String(hl), d.sub_pct + "%", d.sub_cache_pct + "%", fmt(d.output_per_hour)];
      if (vals.length !== cols.length) {
        while (vals.length < cols.length) vals.push("");
        while (vals.length > cols.length) vals.pop();
      }
      vals.forEach(function(v,j){
        var td=document.createElement("td");
        td.textContent=v;
        if(j>0)td.className="num";
        if(j===3&&d.cache_output_ratio>1000)td.classList.add("hi");
        if(j===3&&d.cache_output_ratio>2000)td.classList.add("crit");
        if(j===4&&d.overhead>1500)td.classList.add("hi");
        if(j===8&&hl>0)td.classList.add("hi");
        trEl.appendChild(td);
      });
      tbody.appendChild(trEl);
      if (!fhDay && multiHost && selDay.hosts) {
        for (var ti = 0; ti < hLabs.length; ti++) {
          var tlab = hLabs[ti];
          var hd = selDay.hosts[tlab];
          if (!hd) continue;
          var trh = document.createElement("tr");
          trh.style.color = "#A0875E";
          trh.style.cursor = "pointer";
          trh.title = t("dailyDetailHostRowTitle");
          trh.dataset.detailRow = "host";
          trh.dataset.hostLabel = tlab;
          var hhl = hd.hit_limit || 0;
          var hvals = ["  \u2514 " + tlab, fmt(hd.output), fmt(hd.cache_read), hd.cache_output_ratio + "x", hd.overhead + "x", fmt(hd.total), hd.calls, hd.active_hours, String(hhl), hd.sub_pct + "%", hd.sub_cache_pct + "%", fmt(hd.output_per_hour)];
          if (hvals.length !== cols.length) {
            while (hvals.length < cols.length) hvals.push("");
            while (hvals.length > cols.length) hvals.pop();
          }
          for (var hj = 0; hj < hvals.length; hj++) {
            var tdh = document.createElement("td");
            tdh.textContent = hvals[hj];
            if (hj > 0) tdh.className = "num";
            if (hj === 8 && hhl > 0) tdh.classList.add("hi");
            trh.appendChild(tdh);
          }
          tbody.appendChild(trh);
        }
      }
    }

    // Cache computed context for standalone chart renderers
    window.__dashboardState.setSectionCtx('tokenStats', {
      ctx: ctx, labels: labels, mainScope: mainScope, hourlyMode: hourlyMode,
      hourLabs: hourLabs, dayForHourly: dayForHourly, mainHostKey: mainHostKey,
      c4TimelineHostStack: c4TimelineHostStack, days: days, hLabs: hLabs,
      multiHost: multiHost, selDay: selDay
    });

    // Expose computed forensic values for renderForensicSection
    return {
      fc: fc,
      fwarn: fwarn,
      impl90: impl90,
      forensicHintF: forensicHintF,
      budgetRatio: budgetRatio,
      peak: peak,
      fhCard: fhCard,
      labels: labels
    };
  };

  // Section registration
  window.__sections = window.__sections || {};
  window.__sections['token-stats'] = {
    id: 'token-stats',
    surface: 'usage',
    domId: 'token-stats-collapse',
    render: function (data, days) {
      if (typeof window.renderTokenStatsSection === 'function') window.renderTokenStatsSection(data);
    }
  };
})();
