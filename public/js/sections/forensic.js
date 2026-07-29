/**
 * @asseris-module       Forensic
 * @asseris-description  Auto-annotated module metadata for public/js/sections/forensic.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * sections/forensic.js - Forensic section renderer.
 * Surface: Usage.
 * Extracted from dashboard-sections.js (Phase 16c).
 */
(function () {
  /* ================================================================
   *  Forensic Section — compute + standalone chart renderers
   * ================================================================ */

  /**
   * Compute shared context for Forensic charts.
   * Cached on window.__dashboardState.getSectionCtx('forensic').
   */
  window._computeForensicCtx = function (ctx, tokenStatsResult) {
    var data = ctx.data;
    if (!data) return null;
    var days = ctx.days;
    var selDay = ctx.selDay;
    if (!selDay) return null;
    var pick = ctx.pick;

    var fc, fwarn, impl90, forensicHintF, budgetRatio, peak, fhCard, labels;
    if (tokenStatsResult) {
      fc = tokenStatsResult.fc;
      fwarn = tokenStatsResult.fwarn;
      impl90 = tokenStatsResult.impl90;
      forensicHintF = tokenStatsResult.forensicHintF;
      budgetRatio = tokenStatsResult.budgetRatio;
      peak = tokenStatsResult.peak;
      fhCard = tokenStatsResult.fhCard;
      labels = tokenStatsResult.labels;
    } else {
      fhCard = getForensicHostFilterForCharts();
      var hSlicePick = fhCard && selDay.hosts?.[fhCard] ? selDay.hosts[fhCard] : null;
      var emptyHostDay = {
        output: 0, cache_read: 0, total: 0, calls: 0, active_hours: 0,
        cache_output_ratio: 0, overhead: 0, hit_limit: 0,
        session_signals: { continue: 0, resume: 0, retry: 0, interrupt: 0 }
      };
      var cardBase = fhCard ? hSlicePick || emptyHostDay : selDay;
      var selTotalForBudget = cardBase.total || 0;
      peak = fhCard
        ? (function () { var hp = findHostPeakAcrossDays(days, fhCard); return { date: hp.date, total: hp.total }; })()
        : days.reduce(function (a, b) { return a.total > b.total ? a : b; });
      budgetRatio = peak.total > 0 && selTotalForBudget > 0 ? Math.round(peak.total / (selTotalForBudget / 0.9)) : 0;
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
      labels = days.map(function(d){return d.date.slice(5)});
    }

    // Data fingerprint: skip chart repaint when days data is unchanged
    // (preserves zoom, pan, selection state across SSE refreshes)
    var _fpParts = [];
    for (var _fpi = 0; _fpi < days.length; _fpi++) {
      var _fpd = days[_fpi];
      _fpParts.push(_fpd.date + ':' + (_fpd.total || 0) + ':' + (_fpd.hit_limit || 0) + ':' + (_fpd.cache_read || 0) + ':' + (_fpd.output || 0));
    }
    var _fp = _fpParts.join('|') + '|' + pick + '|' + (fhCard || '');
    var dataUnchanged = _fp === window.__forensicLastFp;
    window.__forensicLastFp = _fp;

    // Throttle state
    var spForensic = data.scan_progress;
    var scanInProgForensic =
      data.scanning && spForensic && spForensic.total > 0 && spForensic.done < spForensic.total;
    var nowForensic = Date.now();
    var fsUntilMs = window.__dashForensicSvcPaintUntilMs || 0;
    var inFsThrottleWindow = scanInProgForensic && nowForensic < fsUntilMs;
    var skipForensicPaint = (dataUnchanged && !!_charts.cForensic && !!_charts.cForensicSignals) ||
      (inFsThrottleWindow && !!_charts.cForensic && !!_charts.cForensicSignals);
    var skipServicePaint = (dataUnchanged && !!_charts.cService) ||
      (inFsThrottleWindow && !!_charts.cService);
    if (!skipForensicPaint || !skipServicePaint) {
      if (scanInProgForensic) window.__dashForensicSvcPaintUntilMs = nowForensic + 3500;
      else window.__dashForensicSvcPaintUntilMs = 0;
    }

    var sCtx = {
      data: data, days: days, selDay: selDay, pick: pick,
      fc: fc, fwarn: fwarn, impl90: impl90, forensicHintF: forensicHintF,
      budgetRatio: budgetRatio, peak: peak, fhCard: fhCard, labels: labels,
      skipForensicPaint: skipForensicPaint, skipServicePaint: skipServicePaint
    };
    window.__dashboardState.setSectionCtx('forensic', sCtx);
    return sCtx;
  };

  /** Standalone: render Hit-Limit + Forensic Score chart. */
  window.renderForensic_main = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('forensic');
    if (!sCtx || sCtx.skipForensicPaint) return;
    var fhForensic = getForensicHostFilterForCharts();
    var days = sCtx.days;
    var labels = sCtx.labels;
    function hitLimitBarForChart(d) {
      if (!fhForensic) return d.hit_limit || 0;
      var H = d.hosts?.[fhForensic];
      return H ? H.hit_limit || 0 : 0;
    }
    function forensicScoreDay(d) {
      return forensicScoreForChartDay(d, days, fhForensic);
    }
    var elF = document.getElementById("c-forensic");
    if (!elF) return;
    try {
      if (!_charts.cForensic) _charts.cForensic = echarts.init(elF, null, { renderer: 'canvas' });
      var fHitData = days.map(hitLimitBarForChart);
      var fScoreData = days.map(forensicScoreDay);
      var fHitColors = fHitData.map(function(v) { return v > 0 ? 'rgba(248,113,113,0.55)' : 'rgba(71,85,105,0.35)'; });
      _charts.cForensic.setOption({
        animation: false,
        grid: { left: 50, right: fhForensic ? 20 : 65, top: 40, bottom: 36 },
        legend: { data: [t("forensicDS_hitLimit"), t("forensicDS_score")], textStyle: { color: '#EFE7D6', fontSize: 11 }, top: 4 },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: [
          { type: 'value', name: t("forensicAxisCounts"), nameLocation: 'center', nameGap: 35, nameRotate: 90, nameTextStyle: { color: '#A0875E', fontSize: 11 }, min: 0, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
          { type: 'value', name: fhForensic ? '' : t("forensicAxisForensic"), nameLocation: 'center', nameGap: 40, nameRotate: 90, nameTextStyle: { color: '#fbbf24', fontSize: 11 }, min: 0, max: 3.5, show: !fhForensic,
            axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { show: false } }
        ],
        series: [
          { name: t("forensicDS_hitLimit"), type: 'bar', data: fHitData, yAxisIndex: 0,
            itemStyle: { color: function(p) { return fHitColors[p.dataIndex]; }, borderColor: function(p) { return fHitData[p.dataIndex] > 0 ? '#f87171' : 'transparent'; } },
            legendHoverLink: true, color: 'rgba(248,113,113,0.55)' },
          { name: t("forensicDS_score"), type: 'line', data: fScoreData, yAxisIndex: 1, smooth: 0.25, symbol: 'circle', symbolSize: 8,
            lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#fbbf24' },
            areaStyle: { color: 'rgba(245,158,11,0.12)' }, show: !fhForensic }
        ]
      }, true);
    } finally {
      chartShellSetLoading("c-forensic", false);
    }
    var forensicDisc = elF.closest('.forensic-chart-disclosure');
    if (forensicDisc && !forensicDisc.dataset.bound) {
      forensicDisc.dataset.bound = '1';
      forensicDisc.addEventListener('toggle', function() {
        if (forensicDisc.open && _charts.cForensic) {
          setTimeout(function() { _charts.cForensic.resize(); }, 50);
        }
      });
    }
  };

  /** Standalone: render Session Signals stacked bar + Cache Read line. */
  window.renderForensic_signals = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('forensic');
    if (!sCtx || sCtx.skipForensicPaint) return;
    var fhForensic = getForensicHostFilterForCharts();
    var labels = sCtx.labels;
    var elSig = document.getElementById("c-forensic-signals");
    if (!elSig) return;
    try {
      var sigStack = buildSessionSignalsStackedByDay(sCtx.days, fhForensic);
      if (!_charts.cForensicSignals) _charts.cForensicSignals = echarts.init(elSig, null, { renderer: 'canvas' });
      _charts.cForensicSignals.setOption({
        animation: false,
        grid: { left: 60, right: 65, top: 40, bottom: 36 },
        legend: {
          data: [t("forensicDS_continueStack"), t("forensicDS_resumeStack"), t("forensicDS_retryStack"), t("forensicDS_interruptStack"), t("forensicDS_outageHoursDay"), t("chartDS_cacheRead")],
          textStyle: { color: '#EFE7D6', fontSize: 10 }, top: 4, itemWidth: 12, itemHeight: 10
        },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 } },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 11, rotate: 45 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.45)' } } },
        yAxis: [
          { type: 'value', name: t("forensicSignalsAxisLines"), nameLocation: 'center', nameGap: 42, nameRotate: 90, nameTextStyle: { color: '#A0875E', fontSize: 11 }, min: 0, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
          { type: 'value', name: t("forensicSignalsAxisCacheRead"), nameLocation: 'center', nameGap: 48, nameRotate: 90, nameTextStyle: { color: '#D4AF7F', fontSize: 11 }, min: 0,
            axisLabel: { color: '#D4AF7F', fontSize: 11, formatter: function(v) { return fmt(v); } }, splitLine: { show: false } }
        ],
        series: [
          { name: t("forensicDS_continueStack"), type: 'bar', stack: 'sig', data: sigStack.cont, itemStyle: { color: 'rgba(184,145,90,0.75)' } },
          { name: t("forensicDS_resumeStack"), type: 'bar', stack: 'sig', data: sigStack.res, itemStyle: { color: 'rgba(6,182,212,0.7)' } },
          { name: t("forensicDS_retryStack"), type: 'bar', stack: 'sig', data: sigStack.retry, itemStyle: { color: 'rgba(239,68,68,0.65)' } },
          { name: t("forensicDS_interruptStack"), type: 'bar', stack: 'sig', data: sigStack.intr, itemStyle: { color: 'rgba(251,191,36,0.55)' } },
          { name: t("forensicDS_outageHoursDay"), type: 'bar', stack: 'sig', data: sigStack.outageBar, itemStyle: { color: 'rgba(107,114,128,0.35)' } },
          { name: t("chartDS_cacheRead"), type: 'line', yAxisIndex: 1, data: sigStack.cacheRead, smooth: 0.2, symbol: 'circle', symbolSize: 6,
            lineStyle: { color: 'rgba(212,175,127,0.95)', width: 2 }, itemStyle: { color: '#D4AF7F' } }
        ]
      }, true);
    } finally {
      chartShellSetLoading("c-forensic-signals", false);
    }
  };

  /** Standalone: render Service Impact chart (work hours vs outage). */
  window.renderForensic_service = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('forensic');
    if (!sCtx || sCtx.skipServicePaint) return;
    var days = sCtx.days;
    var labels = sCtx.labels;
    var elS = document.getElementById("c-service");
    if (!elS) return;
    try {
      var sClean=[],sAffServer=[],sAffClient=[],sOutOnly=[],sCacheRead=[];
      for(var si=0;si<days.length;si++){
        var sd=days[si];
        var imp=sumServiceImpactForDay(sd);
        sClean.push(imp.cleanWork);
        sAffServer.push(imp.affSrv);
        sAffClient.push(imp.affCli);
        sOutOnly.push(imp.outOnly);
        sCacheRead.push(sd.cache_read||0);
      }
      window.__svcTip = { sClean: sClean, sAffServer: sAffServer, sAffClient: sAffClient, sOutOnly: sOutOnly, labels: labels };
      if (!_charts.cService) _charts.cService = echarts.init(elS, null, { renderer: 'canvas' });
      _charts.cService.setOption({
        animation: false,
        grid: { left: 50, right: 65, top: 40, bottom: 36 },
        legend: {
          data: [t("serviceDS_cleanWork"), t("serviceDS_affectedServer"), t("serviceDS_affectedClient"), t("serviceDS_outageOnly"), t("chartDS_cacheRead")],
          textStyle: { color: '#EFE7D6', fontSize: 10 }, top: 4, itemWidth: 12, itemHeight: 10
        },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 12 },
          formatter: function(params) {
            var lines = [params[0].axisValueLabel];
            for (var pi = 0; pi < params.length; pi++) {
              var p = params[pi];
              var val = p.seriesType === 'line' ? fmt(p.value) : p.value + 'h';
              lines.push(p.marker + ' ' + p.seriesName + ': ' + val);
            }
            return lines.join('<br>');
          }
        },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: [
          { type: 'value', name: t("serviceAxisHours"), nameLocation: 'center', nameGap: 35, nameRotate: 90, nameTextStyle: { color: '#A0875E', fontSize: 11 }, min: 0,
            axisLabel: { color: '#A0875E', fontSize: 11, formatter: '{value}h' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
          { type: 'value', name: t("chartDS_cacheRead"), nameLocation: 'center', nameGap: 48, nameRotate: 90, nameTextStyle: { color: '#D4AF7F', fontSize: 11 }, min: 0,
            axisLabel: { color: '#D4AF7F', fontSize: 11, formatter: function(v) { return fmt(v); } }, splitLine: { show: false } }
        ],
        series: [
          { name: t("serviceDS_cleanWork"), type: 'bar', stack: 'hours', data: sClean, itemStyle: { color: 'rgba(184,145,90,0.7)' } },
          { name: t("serviceDS_affectedServer"), type: 'bar', stack: 'hours', data: sAffServer, itemStyle: { color: 'rgba(239,68,68,0.7)' } },
          { name: t("serviceDS_affectedClient"), type: 'bar', stack: 'hours', data: sAffClient, itemStyle: { color: 'rgba(251,191,36,0.6)' } },
          { name: t("serviceDS_outageOnly"), type: 'bar', stack: 'hours', data: sOutOnly, itemStyle: { color: 'rgba(107,114,128,0.35)' } },
          { name: t("chartDS_cacheRead"), type: 'line', yAxisIndex: 1, data: sCacheRead, smooth: 0.25, symbol: 'circle', symbolSize: 6,
            lineStyle: { color: 'rgba(212,175,127,0.8)', width: 2 }, itemStyle: { color: '#D4AF7F' },
            areaStyle: { color: 'rgba(212,175,127,0.08)' } }
        ]
      }, true);
    } finally {
      chartShellSetLoading("c-service", false);
    }
  };

  /* ================================================================
   *  renderForensicSection — orchestrator (calls standalone renderers)
   * ================================================================ */
  window.renderForensicSection = function (ctx, tokenStatsResult) {
    var sCtx = window._computeForensicCtx(ctx, tokenStatsResult);
    if (!sCtx) return;

    // --- Forensic summary line ---
    var sumEl = document.getElementById("forensic-summary-line");
    if (sumEl) {
      var sumLine = tr("forensicSummaryLine", {
        pick: sCtx.pick,
        fc: sCtx.fc,
        impl: sCtx.impl90 > 0 ? fmt(sCtx.impl90) : "\u2014",
        bud: String(sCtx.budgetRatio),
        peak: sCtx.peak.date || "\u2014"
      });
      if (sCtx.fhCard) sumLine += tr("forensicSummaryHostSuffix", { host: sCtx.fhCard });
      sumEl.textContent = sumLine;
    }

    // --- Forensic cards ---
    var fcards = [
      { wid: "forensic-card-code", label: t("fcForensicDay"), value: sCtx.fc, sub: sCtx.forensicHintF, cls: sCtx.fwarn ? "warn" : "" },
      { wid: "forensic-card-impl", label: t("fcImpl"), value: sCtx.impl90 > 0 ? fmt(sCtx.impl90) : "\u2014", sub: t("fcImplSub"), cls: "" },
      { wid: "forensic-card-budget", label: t("fcBudget"), value: "~" + sCtx.budgetRatio + "x", sub: t("fcBudgetSub"), cls: sCtx.budgetRatio > 10 ? "danger" : "warn" }
    ];
    var fch = "";
    for (var fci = 0; fci < fcards.length; fci++) {
      var fcrd = fcards[fci];
      fch +=
        '<div class="chart-box chart-box--kpi" id="' +
        fcrd.wid +
        '"><div class="card ' +
        fcrd.cls +
        '"><div class="label">' +
        escHtml(fcrd.label) +
        '</div><div class="value">' +
        escHtml(fcrd.value) +
        '</div><div class="sub">' +
        escHtml(fcrd.sub) +
        "</div></div></div>";
    }
    var fcg = document.getElementById("forensic-cards");
    if (fcg && fcg.innerHTML !== fch) fcg.innerHTML = fch;

    // --- Render charts via standalone functions ---
    window.renderForensic_main(sCtx);
    window.renderForensic_signals(sCtx);
    window.renderForensic_service(sCtx);

    initUpdateSlideoutOnce();
  };

  // Section registration
  window.__sections = window.__sections || {};
  window.__sections.forensic = {
    id: 'forensic',
    surface: 'usage',
    domId: 'forensic-collapse',
    render: function (data, days) {
      if (typeof window.renderForensicSection === 'function') window.renderForensicSection(data);
    }
  };
})();
