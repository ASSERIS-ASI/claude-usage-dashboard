/**
 * @asseris-module       Health
 * @asseris-description  Auto-annotated module metadata for public/js/sections/health.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * sections/health.js — Health / Status section renderer.
 * Surface: Overview.
 *
 * Contains: Health Score Ampel, Key Findings Panel, Health Score History,
 * Uptime Chart, Incident History, Outage Timeline, Availability KPIs,
 * Anthropic popup / modal, widget dispatcher shims.
 *
 * Dependencies (window globals):
 *   fmt, pct, escHtml, t, tr, logClientOptionalErr,
 *   _proxyCharts, echarts, defined_colors,
 *   __lastUsageData, getFilteredDays,
 *   sumServiceImpactForDay, classifyWorkHour, unionWorkHourKeys,
 *   isAnthropicPopupVisible (defined here), updateAnthropicPopup (defined here),
 *   __scheduleAnthropicHealthChartsResize, __bumpAnthropicHealthCharts,
 *   __forensicHostFilterSig, renderDashboard, _cf (defined here)
 *
 * Registers on window: renderHealthScore, renderKeyFindings,
 *   invalidateHealthAndFindingsRender, computeHealthIndicators,
 *   computeKeyFindings, computeHealthScoreForDay, buildHealthScoreHistory,
 *   renderUptimeChart, renderIncidentHistory, renderOutageTimeline,
 *   renderAvailabilityKpis, updateAnthropicPopup, isAnthropicPopupVisible,
 *   renderStatus_uptime, renderStatus_incidents,
 *   renderStatus_outageScatter, renderStatus_outageTimeline,
 *   getSelectedPlan, getSelectedPlanLabel
 */
(function () {

// ── State vars ────────────────────────────────────────────────────────────
var _proxyCharts = window._proxyCharts || { uptimeChart: null, incidentHistory: null, anthropicIncidents: null, outageTimeline: null };
window._proxyCharts = _proxyCharts;
var __lastHealthFingerprint = "";
var __lastFindingsFingerprint = "";
var __planLabels = { max5: "MAX 5", max20: "MAX 20", pro: "Pro", free: "Free", api: "API" };
var __planPrices = { max5: 100, max20: 200, pro: 20, free: 0, api: 0 };
var _isModalOpen = false;
var _modalFontScale = { tick: 13, legend: 12, title: 12, tooltip: 12 };
var _popupFontScale = { tick: 10, legend: 10, title: 10, tooltip: 11 };
var _outageTimelineMonthFilter = null;   // null = all, "2026-03" = single month
var _outageImpactExclude = {};            // { "critical": true, "minor": true } = hidden
var _outageStatusExclude = {};            // { "major_outage": true } = hidden (uptime chart)
var _lastAvailKpiData = null;

function _cf() { return _isModalOpen ? _modalFontScale : _popupFontScale; }

// ── Health Score Ampel ────────────────────────────────────────────────────

function invalidateHealthAndFindingsRender() {
  __lastHealthFingerprint = "";
  __lastFindingsFingerprint = "";
}
window.invalidateHealthAndFindingsRender = invalidateHealthAndFindingsRender;

function healthColor(value, greenMax, yellowMax) {
  // greenMax = upper bound for green, yellowMax = upper bound for yellow
  if (value <= greenMax) return "green";
  if (value <= yellowMax) return "yellow";
  return "red";
}
function healthColorInverse(value, greenMin, yellowMin) {
  // For metrics where HIGHER is better (cache health)
  if (value >= greenMin) return "green";
  if (value >= yellowMin) return "yellow";
  return "red";
}
function healthPoints(color) { return color === "green" ? 2 : color === "yellow" ? 1 : 0; }

function computeHealthIndicators(data) {
  var days = data.days || [];
  var proxy = data.proxy || {};
  var pdays = proxy.proxy_days || [];
  var pd = pdays.length > 0 ? pdays[pdays.length - 1] : null;
  var numDays = days.length || 1;

  // Averages from JSONL
  var totalHits = 0, totalInterrupts = 0, totalRetries = 0;
  for (var _hd of days) {
    totalHits += (_hd.hit_limit || 0);
    var ss = _hd.session_signals || {};
    totalInterrupts += (ss.interrupt || 0);
    totalRetries += (ss.retry || 0);
  }
  var hitsPerDay = Math.round(totalHits / numDays);
  var interruptsPerDay = Math.round(totalInterrupts / numDays);
  var retriesPerDay = Math.round(totalRetries / numDays);

  // Thinking Gap: compare JSONL vs proxy for matching day
  var thinkingGap = 0;
  if (pd && days.length) {
    // Try matching proxy days from newest to oldest until we find one with JSONL data
    var pdAll = data.proxy?.proxy_days || [];
    for (var tgi = pdAll.length - 1; tgi >= 0; tgi--) {
      var tgPd = pdAll[tgi];
      if (!(tgPd.total_tokens > 0)) continue;
      var tgJsonl = null;
      for (var _tgd of days) {
        if (_tgd.date === tgPd.date && (_tgd.total || 0) > 0) { tgJsonl = _tgd; break; }
      }
      if (tgJsonl) {
        thinkingGap = tgJsonl.total / tgPd.total_tokens;
        break;
      }
    }
  }

  // Proxy metrics (fallback to 0/defaults if no proxy)
  var rl = pd ? (pd.rate_limit || {}) : {};
  var q5h = Number.parseFloat(rl["anthropic-ratelimit-unified-5h-utilization"] || 0) * 100;
  var cacheRatio = pd ? ((pd.cache_read_ratio || 0) * 100) : 100;
  var errorRate = pd ? (pd.error_rate || 0) : 0;
  var avgLatMs = pd ? (pd.avg_duration_ms || 0) : 0;
  var avgLatS = avgLatMs / 1000;
  var coldStarts = pd ? (pd.cold_starts || 0) : 0;
  var false429s = pd ? (pd.false_429s || 0) : 0;
  var contextResets = pd ? (pd.context_resets || 0) : 0;
  var tokPerPct = pd ? (pd.visible_tokens_per_pct || 0) : 0;
  var tokPerPctM = tokPerPct > 0 ? (tokPerPct / 1000000).toFixed(1) + "M" : "-";

  // B5: Truncations from JSONL session_signals
  var truncPerDay = 0;
  if (days.length) {
    var truncTotal = 0;
    for (var _trd of days) {
      var trSig = _trd.session_signals;
      if (trSig) truncTotal += (trSig.truncated || 0);
    }
    truncPerDay = Math.round(truncTotal / days.length);
  }

  // Stop-reason anomalies: count non-standard stop reasons
  var anomalStops = 0;
  if (days.length) {
    for (var _srd of days) {
      var sr = _srd.stop_reasons || {};
      for (var srk in sr) {
        if (srk !== "end_turn" && srk !== "tool_use" && srk !== "max_tokens" && srk !== "unknown") {
          anomalStops += sr[srk];
        }
      }
    }
  }

  return [
    { id: "quota5h", label: t("healthQuota5h"), sub: t("healthQuota5hSub"), value: q5h, display: q5h.toFixed(0) + "%", color: healthColor(q5h, 50, 80), barPct: Math.min(100, q5h) },
    { id: "thinkingGap", label: t("healthThinkingGap"), sub: t("healthThinkingGapSub"), value: thinkingGap, display: thinkingGap > 0 ? thinkingGap.toFixed(1) + "x" : "-", color: thinkingGap <= 0 ? "green" : healthColor(thinkingGap, 2, 5), barPct: Math.min(100, thinkingGap * 10) },
    { id: "cacheHealth", label: t("healthCacheHealth"), sub: t("healthCacheHealthSub"), value: cacheRatio, display: cacheRatio.toFixed(1) + "%", color: healthColorInverse(cacheRatio, 90, 70), barPct: cacheRatio },
    { id: "errorRate", label: t("healthErrorRate"), sub: t("healthErrorRateSub"), value: errorRate, display: errorRate.toFixed(1) + "%", color: healthColor(errorRate, 3, 10), barPct: Math.min(100, errorRate * 5) },
    { id: "hitLimits", label: t("healthHitLimits"), sub: t("healthHitLimitsSub"), value: hitsPerDay, display: String(hitsPerDay), color: healthColor(hitsPerDay, 50, 500), barPct: Math.min(100, hitsPerDay / 10) },
    { id: "latency", label: t("healthLatency"), sub: t("healthLatencySub"), value: avgLatS, display: avgLatS >= 1 ? avgLatS.toFixed(1) + "s" : Math.round(avgLatMs) + "ms", color: healthColor(avgLatS, 5, 15), barPct: Math.min(100, avgLatS * 5) },
    { id: "interrupts", label: t("healthInterrupts"), sub: t("healthInterruptsSub"), value: interruptsPerDay, display: String(interruptsPerDay), color: healthColor(interruptsPerDay, 100, 500), barPct: Math.min(100, interruptsPerDay / 10) },
    { id: "coldStarts", label: t("healthColdStarts"), sub: t("healthColdStartsSub"), value: coldStarts, display: String(coldStarts), color: healthColor(coldStarts, 0, 5), barPct: Math.min(100, coldStarts * 10) },
    { id: "retries", label: t("healthRetries"), sub: t("healthRetriesSub"), value: retriesPerDay, display: String(retriesPerDay), color: healthColor(retriesPerDay, 50, 200), barPct: Math.min(100, retriesPerDay / 5) },
    { id: "false429", label: t("healthFalse429"), sub: t("healthFalse429Sub"), value: false429s, display: String(false429s), color: healthColor(false429s, 0, 1), barPct: Math.min(100, false429s * 50) },
    { id: "truncations", label: t("healthTruncations"), sub: t("healthTruncationsSub"), value: truncPerDay, display: String(truncPerDay), color: healthColor(truncPerDay, 0, 5), barPct: Math.min(100, truncPerDay * 10) },
    { id: "contextResets", label: t("healthContextResets"), sub: t("healthContextResetsSub"), value: contextResets, display: String(contextResets), color: healthColor(contextResets, 0, 3), barPct: Math.min(100, contextResets * 20) },
    { id: "quotaBench", label: t("healthQuotaBench"), sub: t("healthQuotaBenchSub"), value: tokPerPct, display: tokPerPctM, color: tokPerPct > 0 ? healthColor(tokPerPct / 1000000, 2.1, 3) : "gray", barPct: tokPerPct > 0 ? Math.min(100, tokPerPct / 21000) : 0 },
    { id: "anomalStops", label: t("healthAnomalStops"), sub: t("healthAnomalStopsSub"), value: anomalStops, display: String(anomalStops), color: healthColor(anomalStops, 0, 10), barPct: Math.min(100, anomalStops * 5) }
  ];
}

function renderHealthScore(data) {
  var headerEl = document.getElementById("health-header");
  var gridEl = document.getElementById("health-grid");
  if (!headerEl || !gridEl) return;

  var fp = (data.generated || "") + "|" + (data.proxy?.generated || "") + "|" +
    (data.days || []).map(function (d) { return d.date; }).join(',') + "|" +
    (window.__dashboardState?.getFilterHost?.() || '') + "|" +
    (window.__dashboardState?.getFilterProvider?.() || 'all') + "|" +
    (window.__dashboardState?.getFilterAccount?.() || 'all');
  if (fp === __lastHealthFingerprint) return;
  __lastHealthFingerprint = fp;

  var days = data.days || [];
  var proxy = data.proxy || {};
  var pdays = proxy.proxy_days || [];
  if (!days.length && !pdays.length) {
    headerEl.innerHTML = "<span style=\"color:#A0875E\">" + escHtml(t("healthScoreNoData")) + "</span>";
    gridEl.innerHTML = "";
    var hintNoData = document.getElementById("health-kpi-all-hidden-hint");
    if (hintNoData) {
      hintNoData.textContent = "";
      hintNoData.classList.remove("is-visible");
    }
    return;
  }

  var indicators = computeHealthIndicators(data);
  var dispH = window.__widgetDispatcher;
  var visInd = [];
  for (var _ind of indicators) {
    var kpiId = "health-kpi-" + _ind.id;
    if (dispH && typeof dispH.isChartVisible === "function" && !dispH.isChartVisible(kpiId)) continue;
    visInd.push(_ind);
  }
  var totalPts = 0, warns = 0, crits = 0;
  var score = 0;
  var scoreColor = "#8C6A3F";
  if (visInd.length) {
    for (var _vi of visInd) {
      totalPts += healthPoints(_vi.color);
      if (_vi.color === "yellow") warns++;
      if (_vi.color === "red") crits++;
    }
    var denom = visInd.length * 2;
    score = denom > 0 ? Math.round(totalPts / denom * 10) : 0;
    scoreColor = score > 7 ? "#22c55e" : score >= 4 ? "#f59e0b" : "#ef4444";
  }

  // Header
  var hh = "<div class=\"health-total-circle\" style=\"background:" + scoreColor + "\">" + score + "</div>";
  hh += "<div class=\"health-total-text\">";
  hh += "<strong>" + escHtml(t("healthScoreTitle")) + "</strong><br>";
  hh += "<span" + (crits > 0 ? " class=\"health-crits\"" : warns > 0 ? " class=\"health-warns\"" : "") + ">";
  hh += escHtml(tr("healthScoreSummary", { score: score, warns: warns, crits: crits }));
  hh += "</span></div>";
  if (headerEl.innerHTML !== hh) headerEl.innerHTML = hh;

  // Update collapsed summary: score circle + inline indicator dots + findings count
  var smCircle = document.getElementById("health-circle-sm");
  var smText = document.getElementById("health-summary-text");
  if (smCircle) { smCircle.style.background = scoreColor; smCircle.textContent = score; }
  if (smText) {
    var sh = "";
    for (var inlineInd of visInd) {
      var dc = inlineInd.color === "red" ? "#ef4444" : inlineInd.color === "yellow" ? "#f59e0b" : "#22c55e";
      sh += '<span class="hs-inline-badge"><span class="hs-inline-dot" style="background:' + dc + '"></span>' + escHtml(inlineInd.label) + ' <strong>' + escHtml(inlineInd.display) + '</strong></span>';
    }

    smText.innerHTML = sh;
  }
  renderUptimeChart(data);
  renderIncidentHistory(data);
  renderOutageTimeline(data);
  renderAvailabilityKpis(data);

  // Grid (one host per KPI for visibility sync)
  var gh = "";
  for (var ind of indicators) {
    var hostId = "health-kpi-" + ind.id;
    gh += "<div class=\"chart-box chart-box--kpi\" id=\"" + hostId + "\">";
    gh += "<div class=\"health-badge health-badge--" + ind.color + "\">";
    gh += "<div class=\"health-badge-label\">" + escHtml(ind.label) + "</div>";
    gh += "<div class=\"health-badge-value\">" + escHtml(ind.display) + "</div>";
    gh += "<div class=\"health-badge-sub\">" + escHtml(ind.sub || "") + "</div>";
    gh += "<div class=\"health-badge-bar\"><div class=\"health-badge-bar-fill health-badge-bar-fill--" + ind.color + "\" style=\"width:" + Math.round(ind.barPct) + "%\"></div></div>";
    gh += "</div></div>";
  }
  if (gridEl.innerHTML !== gh) gridEl.innerHTML = gh;

  var hintAll = document.getElementById("health-kpi-all-hidden-hint");
  if (hintAll) {
    var anyK = false;
    var wd = window.__widgetDispatcher;
    for (var _hki of indicators) {
      var kpid = "health-kpi-" + _hki.id;
      if (!wd || typeof wd.isChartVisible !== "function" || wd.isChartVisible(kpid)) {
        anyK = true;
        break;
      }
    }
    if (indicators.length && !anyK) {
      hintAll.textContent = t("healthKpiAllHiddenHint");
      hintAll.classList.add("is-visible");
    } else {
      hintAll.textContent = "";
      hintAll.classList.remove("is-visible");
    }
  }
}

// ── Key Findings Panel ────────────────────────────────────────────────────

function computeKeyFindings(data) {
  var days = data.days || [];
  var proxy = data.proxy || {};
  var pdays = proxy.proxy_days || [];
  var pd = pdays.length > 0 ? pdays[pdays.length - 1] : null;
  var numDays = days.length || 1;
  var findings = [];

  // Totals from JSONL
  var totalOut = 0, totalCache = 0, totalAll = 0, totalCalls = 0;
  var totalHits = 0, totalRetries = 0, totalInterrupts = 0, totalContinue = 0;
  var peakDay = null, peakTotal = 0;
  for (var d of days) {
    totalOut += (d.output || 0);
    totalCache += (d.cache_read || 0);
    totalAll += (d.total || 0);
    totalCalls += (d.calls || 0);
    totalHits += (d.hit_limit || 0);
    var ss = d.session_signals || {};
    totalRetries += (ss.retry || 0);
    totalInterrupts += (ss.interrupt || 0);
    totalContinue += (ss["continue"] || 0);
    if ((d.total || 0) > peakTotal) { peakTotal = d.total || 0; peakDay = d; }
  }

  // 1. Thinking Token Gap
  if (pd && days.length) {
    var todayJ = null;
    for (var _dj of days) { if (_dj.date === pd.date) { todayJ = _dj; break; } }
    if (todayJ && pd.total_tokens > 0) {
      var gap = (todayJ.total || 0) / pd.total_tokens;
      findings.push({
        widgetId: "health-finding-jsonlProxyGap",
        icon: gap > 5 ? "red" : gap > 2 ? "yellow" : "green",
        title: t("findingThinkingGap"),
        value: gap.toFixed(1) + "x",
        detail: tr("findingThinkingGapDetail", { jsonl: fmt(todayJ.total || 0), proxy: fmt(pd.total_tokens) })
      });
    }
  }

  // 2. Overhead
  if (totalOut > 0) {
    var overhead = Math.round(totalAll / totalOut);
    findings.push({
      widgetId: "health-finding-overhead",
      icon: overhead > 1000 ? "red" : overhead > 500 ? "yellow" : "green",
      title: t("findingOverhead"),
      value: overhead + "x",
      detail: tr("findingOverheadDetail", { total: fmt(totalAll), output: fmt(totalOut), days: numDays })
    });
  }

  // 3. Hit Limits
  if (totalHits > 0) {
    var hpd = Math.round(totalHits / numDays);
    findings.push({
      widgetId: "health-finding-hitLimits",
      icon: hpd > 500 ? "red" : hpd > 50 ? "yellow" : "green",
      title: t("findingHitLimits"),
      value: fmt(totalHits),
      detail: tr("findingHitLimitsDetail", { total: totalHits, perDay: hpd, days: numDays })
    });
  }

  // 4. Interrupts vs Hit Limits
  if (totalInterrupts > 0) {
    findings.push({
      widgetId: "health-finding-interrupts",
      icon: totalInterrupts > totalHits ? "red" : "yellow",
      title: t("findingInterrupts"),
      value: fmt(totalInterrupts),
      detail: tr("findingInterruptsDetail", { interrupts: totalInterrupts, hits: totalHits, ratio: totalHits > 0 ? (totalInterrupts / totalHits).toFixed(1) : "-" })
    });
  }

  // 5. Quota (from proxy)
  if (pd) {
    var rl = pd.rate_limit || {};
    var q5 = Number.parseFloat(rl["anthropic-ratelimit-unified-5h-utilization"] || 0) * 100;
    var q7 = Number.parseFloat(rl["anthropic-ratelimit-unified-7d-utilization"] || 0) * 100;
    if (q5 > 0) {
      findings.push({
        widgetId: "health-finding-quota",
        icon: q5 > 80 ? "red" : q5 > 50 ? "yellow" : "green",
        title: t("findingQuota"),
        value: q5.toFixed(0) + "% / " + q7.toFixed(0) + "%",
        detail: tr("findingQuotaDetail", { q5: q5.toFixed(1), q7: q7.toFixed(1), reqs: pd.requests || 0, output: fmt(pd.output_tokens || 0) })
      });
    }
  }

  // 6. Fallback Budget (from proxy headers)
  if (pd) {
    var rl6 = pd.rate_limit || {};
    var fb = rl6["anthropic-ratelimit-unified-fallback-percentage"];
    if (fb !== undefined && fb !== null) {
      var fbPct = Math.round(Number.parseFloat(fb) * 100);
      findings.push({
        widgetId: "health-finding-fallback",
        icon: fbPct < 100 ? "red" : "green",
        title: t("findingFallback"),
        value: fbPct + "%",
        detail: tr("findingFallbackDetail", { pct: fbPct })
      });
    }
  }

  // 7. Overage Policy (from proxy headers)
  if (pd) {
    var rl7 = pd.rate_limit || {};
    var ovStatus = rl7["anthropic-ratelimit-unified-overage-status"];
    var ovReason = rl7["anthropic-ratelimit-unified-overage-disabled-reason"];
    if (ovStatus) {
      findings.push({
        widgetId: "health-finding-overage",
        icon: ovStatus === "rejected" ? "red" : "green",
        title: t("findingOveragePolicy"),
        value: ovStatus,
        detail: ovReason ? tr("findingOveragePolicyDetail", { status: ovStatus, reason: ovReason }) : ovStatus
      });
    }
  }

  // 8. Binding Window (from proxy headers)
  if (pd) {
    var rl8 = pd.rate_limit || {};
    var claim = rl8["anthropic-ratelimit-unified-representative-claim"];
    if (claim) {
      findings.push({
        widgetId: "health-finding-claim",
        icon: claim === "five_hour" ? "yellow" : "green",
        title: t("findingClaim"),
        value: claim.replaceAll("_", " "),
        detail: t("findingClaimDetail")
      });
    }
  }

  // 9. Peak Day
  if (peakDay) {
    findings.push({
      widgetId: "health-finding-peakDay",
      icon: peakTotal > 2e9 ? "red" : peakTotal > 500e6 ? "yellow" : "green",
      title: t("findingPeakDay"),
      value: peakDay.date,
      detail: tr("findingPeakDayDetail", { total: fmt(peakTotal), calls: peakDay.calls || 0, overhead: peakDay.overhead || 0 })
    });
  }

  // 10. Retries
  if (totalRetries > 0) {
    var rpd = Math.round(totalRetries / numDays);
    findings.push({
      widgetId: "health-finding-retries",
      icon: rpd > 200 ? "red" : rpd > 50 ? "yellow" : "green",
      title: t("findingRetries"),
      value: fmt(totalRetries),
      detail: tr("findingRetriesDetail", { total: totalRetries, perDay: rpd })
    });
  }

  // 11. Cache paradox
  if (pd?.cache_read_ratio > 0.9 && totalHits > 100) {
    findings.push({
      widgetId: "health-finding-cacheParadox",
      icon: "yellow",
      title: t("findingCacheParadox"),
      value: (pd.cache_read_ratio * 100).toFixed(1) + "%",
      detail: t("findingCacheParadoxDetail")
    });
  }

  return findings;
}

function renderKeyFindings(data) {
  var el = document.getElementById("key-findings-grid");
  var headerEl = document.getElementById("key-findings-header");
  if (!el) return;

  var fp = (data.generated || "") + "|" + (data.proxy?.generated || "") + "|" +
    (data.days || []).map(function (d) { return d.date; }).join(',') + "|" +
    (window.__dashboardState?.getFilterHost?.() || '') + "|" +
    (window.__dashboardState?.getFilterProvider?.() || 'all') + "|" +
    (window.__dashboardState?.getFilterAccount?.() || 'all');
  if (fp === __lastFindingsFingerprint) return;
  __lastFindingsFingerprint = fp;

  var days = data.days || [];
  var px = data.proxy;
  var pdays = px?.proxy_days || [];
  if (!days.length && !pdays.length) {
    if (headerEl) headerEl.textContent = t("findingsNoData");
    el.innerHTML = "";
    var kfClear = document.getElementById("key-findings");
    if (kfClear) kfClear.classList.remove("is-layout-empty");
    return;
  }

  var findings = computeKeyFindings(data);
  function findingShown(f) {
    var w = f.widgetId || "";
    var disp = window.__widgetDispatcher;
    if (!w || !disp || typeof disp.isChartVisible !== "function") return true;
    return disp.isChartVisible(w);
  }
  if (headerEl) {
    var reds = 0, yellows = 0, visTotal = 0;
    for (var _fg of findings) {
      if (!findingShown(_fg)) continue;
      visTotal++;
      if (_fg.icon === "red") reds++;
      if (_fg.icon === "yellow") yellows++;
    }
    headerEl.innerHTML = "<strong>" + escHtml(t("findingsTitle")) + "</strong> <span style=\"font-size:.78rem;color:#A0875E\">" +
      escHtml(tr("findingsSummary", { total: visTotal, reds: reds, yellows: yellows })) + "</span>";
  }

  var html = "";
  for (var f of findings) {
    if (!findingShown(f)) continue;
    var wid = f.widgetId || "";
    var dot = f.icon === "red" ? "#ef4444" : f.icon === "yellow" ? "#f59e0b" : "#22c55e";
    html += '<div class="finding-card-host" id="' + wid + '">';
    html += "<div class=\"finding-card\">";
    html += "<div class=\"finding-head\"><span class=\"finding-dot\" style=\"background:" + dot + "\"></span>";
    html += "<span class=\"finding-title\">" + escHtml(f.title) + "</span>";
    html += "<span class=\"finding-value\">" + escHtml(f.value) + "</span></div>";
    html += "<div class=\"finding-detail\">" + escHtml(f.detail) + "</div>";
    html += "</div></div>";
  }
  var kfWrap = document.getElementById("key-findings");
  if (!html && findings.length) {
    if (kfWrap) kfWrap.classList.add("is-layout-empty");
  } else {
    if (kfWrap) kfWrap.classList.remove("is-layout-empty");
  }
  if (el.innerHTML !== html) el.innerHTML = html;
}

// ── Filter Bar ────────────────────────────────────────────────────────────
function initFilterBar(data) {
  var days = data.days || [];
  if (!days.length) return;

  // Filter bar title
  var ftitle = document.getElementById('filter-bar-title');
  if (ftitle) ftitle.textContent = t('filterBarTitle');
  // Date labels
  var dlabel = document.getElementById('filter-date-label');
  if (dlabel) dlabel.textContent = t('filterDateRange');
  var slabel = document.getElementById('filter-scope-label');
  if (slabel) slabel.textContent = t('filterScope');
  var hlabel = document.getElementById('filter-host-label');
  if (hlabel) hlabel.textContent = t('filterHost');

  // Date range: Grafana-style picker (presets + custom from/to) — owns the
  // filter-date-start/-end inputs and their listeners.
  if (window.__dateRange) window.__dateRange.init(data);

  // Scope chips (All days / 24h) — mirror existing main-charts-scope
  var scopeChips = document.getElementById('filter-scope-chips');
  if (scopeChips && !scopeChips.dataset.bound) {
    scopeChips.dataset.bound = '1';
    scopeChips.innerHTML = '<button type="button" class="filter-chip active" data-scope="timeline">' + escHtml(t('mainChartsScopeTimeline')) + '</button>' +
      '<button type="button" class="filter-chip" data-scope="hourly">' + escHtml(t('mainChartsScopeHourly')) + '</button>';
    scopeChips.addEventListener('click', function(e) {
      var btn = e.target.closest('.filter-chip');
      if (!btn?.dataset.scope) return;
      scopeChips.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); });
      btn.classList.add('active');
      // Sync with existing scope chips
      var existing = document.getElementById('main-charts-scope-chips');
      if (existing) {
        var btns = existing.querySelectorAll('[data-scope]');
        for (var _btn of btns) {
          if (_btn.dataset.scope === btn.dataset.scope) _btn.click();
        }
      }
    });
  }

  // Host filter: chips if <=3, multi-select if 4+
  var hostContainer = document.getElementById('filter-host-container');
  if (hostContainer && days.length && !hostContainer.dataset.bound) {
    hostContainer.dataset.bound = '1';
    var hosts = {};
    for (var _hdd of days) {
      var dh = _hdd.hosts || {};
      for (var hk in dh) { if (Object.hasOwn(dh, hk)) hosts[hk] = true; }
    }
    var hkeys = Object.keys(hosts).sort(function (a, b) { return a.localeCompare(b); });
    if (hkeys.length <= 5) {
      // Chips mode
      var hhtml = '<div class="filter-chips">';
      hhtml += '<button type="button" class="filter-chip active" data-host="">' + escHtml(t('filterHostAll')) + '</button>';
      for (var _hk of hkeys) {
        hhtml += '<button type="button" class="filter-chip" data-host="' + escHtml(_hk) + '">' + escHtml(_hk) + '</button>';
      }
      hhtml += '</div>';
      hostContainer.innerHTML = hhtml;
      hostContainer.addEventListener('click', function(e) {
        var btn = e.target.closest('.filter-chip');
        if (!btn) return;
        hostContainer.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); });
        btn.classList.add('active');
        // Sync with forensic host filter + persist in sessionStorage
        var hostVal = btn.dataset.host || "";
        __forensicHostFilterSig = hostVal;
        try {
          if (hostVal) sessionStorage.setItem("usageForensicHostFilter", hostVal);
          else sessionStorage.removeItem("usageForensicHostFilter");
        } catch (error) { logClientOptionalErr(error); }
        if (window.__resetProxyFingerprint) window.__resetProxyFingerprint();
        if (window.__resetDashboardCoreFingerprint) window.__resetDashboardCoreFingerprint();
        if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
      });
    } else {
      // Multi-select mode
      var hopts = '<option value="" selected>' + escHtml(t('filterHostAll')) + '</option>';
      for (var _hk2 of hkeys) {
        hopts += '<option value="' + escHtml(_hk2) + '">' + escHtml(_hk2) + '</option>';
      }
      hostContainer.innerHTML = '<select class="filter-input" multiple size="' + Math.min(hkeys.length + 1, 6) + '">' + hopts + '</select>';
      hostContainer.querySelector('select').addEventListener('change', function() {
        if (window.__resetProxyFingerprint) window.__resetProxyFingerprint();
        if (window.__resetDashboardCoreFingerprint) window.__resetDashboardCoreFingerprint();
        if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
      });
    }
  }

  // Provider filter chips
  var provChips = document.getElementById('filter-provider-chips');
  var proxyDays = data.proxy?.proxy_days || [];
  if (provChips && proxyDays.length && !provChips.dataset.bound) {
    provChips.dataset.bound = '1';
    var provSet = {};
    for (var _pd of proxyDays) {
      if (_pd.providers) {
        for (var _pk in _pd.providers) { if (Object.hasOwn(_pd.providers, _pk) && _pk !== '_system') provSet[_pk] = true; }
      }
    }
    var provKeys = Object.keys(provSet).sort();
    if (provKeys.length > 0) {
      var phtml = '<button type="button" class="filter-chip active" data-provider="all">All</button>';
      for (var _pvk of provKeys) {
        var _pvLabel = _pvk.charAt(0).toUpperCase() + _pvk.slice(1);
        phtml += '<button type="button" class="filter-chip" data-provider="' + escHtml(_pvk) + '">' + escHtml(_pvLabel) + '</button>';
      }
      provChips.innerHTML = phtml;
      provChips.addEventListener('click', function(e) {
        var btn = e.target.closest('.filter-chip');
        if (!btn?.dataset.provider) return;
        provChips.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); });
        btn.classList.add('active');
        window.__dashboardState.setFilterProvider(btn.dataset.provider);
        if (window.__resetProxyFingerprint) window.__resetProxyFingerprint();
        if (window.__resetDashboardCoreFingerprint) window.__resetDashboardCoreFingerprint();
        if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
      });
    }
  }

  // Account filter: available when request telemetry exposes more than one
  // account key. It filters request-level Gateway/Serializer views; aggregate
  // quota headers remain explicitly tied to the account that emitted them.
  var accountGroup = document.getElementById('filter-account-group');
  var accountChips = document.getElementById('filter-account-chips');
  if (accountChips && proxyDays.length && !accountChips.dataset.bound) {
    var accountSet = {};
    var accountLabels = data.proxy?.account_labels || {};
    for (var _apd of proxyDays) {
      for (var _ar of (_apd.gateway_last_requests || [])) {
        var _ak = _ar.account_key || _ar.organization_id;
        if (_ak) accountSet[_ak] = true;
      }
    }
    var accountKeys = Object.keys(accountSet).sort();
    if (accountKeys.length) {
      accountChips.dataset.bound = '1';
      if (accountGroup) accountGroup.hidden = false;
      var ahtml = '<button type="button" class="filter-chip active" data-account="all">All</button>';
      for (var _accountKey of accountKeys) {
        var accountLabel = accountLabels[_accountKey] || String(_accountKey).replace(/^acct:/, '').slice(0, 8);
        ahtml += '<button type="button" class="filter-chip" data-account="' +
          escHtml(_accountKey) + '">' + escHtml(accountLabel) + '</button>';
      }
      accountChips.innerHTML = ahtml;
      accountChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-chip');
        if (!btn?.dataset.account) return;
        accountChips.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
        btn.classList.add('active');
        window.__dashboardState.setFilterAccount(btn.dataset.account);
        if (window.__resetProxyFingerprint) window.__resetProxyFingerprint();
        if (window.__resetDashboardCoreFingerprint) window.__resetDashboardCoreFingerprint();
        if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
      });
    }
  }

  // Day picker in filter bar — mirror the original day-picker
  var fDayPicker = document.getElementById('filter-day-picker');
  var origDayPicker = document.getElementById('day-picker');
  var fDayLabel = document.getElementById('filter-day-label');
  if (fDayLabel) fDayLabel.textContent = t('dayPickerLabel');
  if (fDayPicker && origDayPicker) {
    // Copy options from original
    fDayPicker.innerHTML = origDayPicker.innerHTML;
    fDayPicker.value = origDayPicker.value;
    fDayPicker.addEventListener('change', function() {
      origDayPicker.value = this.value;
      origDayPicker.dispatchEvent(new Event('change'));
    });
    // Watch original for changes
    var _origObserver = new MutationObserver(function() {
      if (fDayPicker.innerHTML !== origDayPicker.innerHTML) fDayPicker.innerHTML = origDayPicker.innerHTML;
      if (fDayPicker.value !== origDayPicker.value) fDayPicker.value = origDayPicker.value;
    });
    _origObserver.observe(origDayPicker, { childList: true, attributes: true });
  }

}

// ── Plan Selector ───────────────────────────────────────────────────────

function getSelectedPlan() {
  var sel = document.getElementById("plan-select");
  return sel ? sel.value : (localStorage.getItem("cud_plan") || "max5");
}

function getSelectedPlanLabel() {
  return __planLabels[getSelectedPlan()] || "MAX 5";
}

function getSelectedPlanPrice() {
  var price = __planPrices[getSelectedPlan()];
  return price == null ? 100 : price;
}

/**
 * Returns the plan's monthly price for a given date string (YYYY-MM-DD).
 *
 * Source priority:
 *   1. proxy_day.cc_plans map from gateway NDJSON (dominant plan that day)
 *   2. Manual plan-change date stored in localStorage (cud_plan_change_date +
 *      cud_plan_previous) as fallback for historical days before gateway logged cc_plan
 *   3. Current selected plan for everything else
 *
 * Call: window.getPlanPriceForDate('2026-04-15', proxyDaysMap)
 *   proxyDaysMap is optional: { 'YYYY-MM-DD': { cc_plans: { MAX5: 42, MAX20: 1 } } }
 */
function getPlanPriceForDate(dateStr, proxyDaysMap) {
  // 1. Try gateway-logged cc_plans for this day
  if (proxyDaysMap && proxyDaysMap[dateStr]) {
    var plans = proxyDaysMap[dateStr].cc_plans;
    if (plans && typeof plans === 'object') {
      var dominant = Object.keys(plans).sort(function(a, b) { return plans[b] - plans[a]; })[0];
      if (dominant) {
        var normalized = dominant.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (__planPrices[normalized]) return __planPrices[normalized];
        // Try partial match: MAX20 → max20, MAX5 → max5
        for (var k of Object.keys(__planPrices)) {
          if (normalized.includes(k) || k.includes(normalized)) return __planPrices[k];
        }
      }
    }
  }
  // 2. Manual fallback: cud_plan_change_date splits history
  var changeDate = localStorage.getItem('cud_plan_change_date') || '';
  var prevPlan = localStorage.getItem('cud_plan_previous') || '';
  if (changeDate && prevPlan && dateStr < changeDate) {
    return __planPrices[prevPlan] == null ? 100 : __planPrices[prevPlan];
  }
  // 3. Current plan
  return getSelectedPlanPrice();
}

(function initPlanSelector() {
  var saved = localStorage.getItem("cud_plan") || "max5";
  var sel = document.getElementById("plan-select");
  if (sel) {
    sel.value = saved;
    sel.addEventListener("change", function() {
      localStorage.setItem("cud_plan", sel.value);
      if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
    });
  }
})();

function getFilterDateRange() {
  var s = document.getElementById('filter-date-start');
  var e = document.getElementById('filter-date-end');
  return { start: s ? s.value : '', end: e ? e.value : '' };
}

// ── Health Score History ──────────────────────────────────────────────────
function computeHealthScoreForDay(dayData, proxyDay) {
  var pd = proxyDay || null;
  var d = dayData;
  var ss = d.session_signals || {};
  var hits = d.hit_limit || 0;
  var interrupts = ss.interrupt || 0;
  var retries = ss.retry || 0;
  var rl = pd ? (pd.rate_limit || {}) : {};
  var q5h = Number.parseFloat(rl["anthropic-ratelimit-unified-5h-utilization"] || 0) * 100;
  var cacheRatio = pd ? ((pd.cache_read_ratio || 0) * 100) : 95;
  var errorRate = pd ? (pd.error_rate || 0) : 0;
  var avgLatS = pd ? ((pd.avg_duration_ms || 0) / 1000) : 5;
  var coldStarts = pd ? (pd.cold_starts || 0) : 0;
  var thinkingGap = (pd?.total_tokens > 0 && d.total > 0) ? d.total / pd.total_tokens : 0;

  var colors = [
    healthColor(q5h, 50, 80),
    thinkingGap <= 0 ? "green" : healthColor(thinkingGap, 2, 5),
    healthColorInverse(cacheRatio, 90, 70),
    healthColor(errorRate, 3, 10),
    healthColor(hits, 50, 500),
    healthColor(avgLatS, 5, 15),
    healthColor(interrupts, 100, 500),
    healthColor(coldStarts, 0, 5),
    healthColor(retries, 50, 200)
  ];
  var pts = 0;
  for (var _clr of colors) pts += healthPoints(_clr);
  return Math.round(pts / (colors.length * 2) * 10);
}

function buildHealthScoreHistory(data) {
  var days = getFilteredDays(data.days || []);
  var proxyDays = data.proxy?.proxy_days || [];
  var proxyByDate = {};
  for (var _pd of proxyDays) proxyByDate[_pd.date] = _pd;
  var scores = [];
  for (var _hsd of days) {
    scores.push(computeHealthScoreForDay(_hsd, proxyByDate[_hsd.date] || null));
  }
  return scores;
}

// ── Uptime Chart (24h stacked by component status) ───────────────────────
function renderUptimeChart(data) {
  var titleEl = document.getElementById("uptime-chart-title");
  if (titleEl) titleEl.textContent = t("uptimeChartTitle");
  var el = document.getElementById("c-uptime-chart");
  if (!el) return;
  if (typeof echarts === "undefined") return;
  if (!data?.days?.length) return;

  // Apply month filter (same as outage timeline)
  var srcDays = _outageTimelineMonthFilter ? (data.days || []) : getFilteredDays(data.days || []);
  var filtDays = [];
  for (var _sfd of srcDays) {
    if (_outageTimelineMonthFilter && _sfd.date && _sfd.date.slice(0, 7) !== _outageTimelineMonthFilter) continue;
    filtDays.push(_sfd);
  }
  if (filtDays.length < 1) filtDays = getFilteredDays(data.days || []);

  // Pad month with empty days
  var dayMap = {};
  for (var _fdm of filtDays) dayMap[_fdm.date] = _fdm;
  var days = [];
  if (_outageTimelineMonthFilter) {
    var parts = _outageTimelineMonthFilter.split("-");
    var yr = Number.parseInt(parts[0], 10), mo = Number.parseInt(parts[1], 10);
    var dim = new Date(yr, mo, 0).getDate();
    for (var pd = 1; pd <= dim; pd++) {
      var dk = yr + "-" + String(mo).padStart(2, "0") + "-" + String(pd).padStart(2, "0");
      days.push(dayMap[dk] || { date: dk, outage_spans: [], _empty: true });
    }
  } else {
    days = filtDays;
  }
  if (days.length < 2) return;

  var labels = [], opData = [], degData = [], partData = [], outData = [], greyData = [];

  for (var d of days) {
    labels.push(d.date.slice(5));
    if (d._empty) {
      opData.push(0); degData.push(0); partData.push(0); outData.push(0); greyData.push(24);
      continue;
    }
    var spans = d.outage_spans || [];

    // Total hours by comp_status (unfiltered)
    var totalByStatus = { major_outage: 0, partial_outage: 0, degraded_performance: 0 };
    for (var _sp of spans) {
      var aCs = _sp.comp_status || "degraded_performance";
      var aDur = (_sp.to || 0) - (_sp.from || 0);
      if (aDur < 0) aDur = 0;
      if (totalByStatus[aCs] !== undefined) totalByStatus[aCs] += aDur;
      else totalByStatus.degraded_performance += aDur;
    }

    var totalInc = totalByStatus.major_outage + totalByStatus.partial_outage + totalByStatus.degraded_performance;
    if (totalInc > 24) {
      var sc = 24 / totalInc;
      totalByStatus.major_outage *= sc; totalByStatus.partial_outage *= sc; totalByStatus.degraded_performance *= sc;
      totalInc = 24;
    }

    // Apply status exclude filter
    var visOut = _outageStatusExclude["major_outage"] ? 0 : totalByStatus.major_outage;
    var visPart = _outageStatusExclude["partial_outage"] ? 0 : totalByStatus.partial_outage;
    var visDeg = _outageStatusExclude["degraded_performance"] ? 0 : totalByStatus.degraded_performance;
    var visInc = visOut + visPart + visDeg;
    var opH = 24 - totalInc;
    var visOp = _outageStatusExclude["operational"] ? 0 : opH;
    var greyH = (totalByStatus.major_outage - visOut) + (totalByStatus.partial_outage - visPart) + (totalByStatus.degraded_performance - visDeg) + (opH - visOp);
    if (greyH < 0) greyH = 0;

    opData.push(Math.round(visOp * 10) / 10);
    degData.push(Math.round(visDeg * 10) / 10);
    partData.push(Math.round(visPart * 10) / 10);
    outData.push(Math.round(visOut * 10) / 10);
    greyData.push(Math.round(greyH * 10) / 10);
  }

  if (_proxyCharts.uptimeChart) {
    _proxyCharts.uptimeChart.dispose();
    _proxyCharts.uptimeChart = null;
  }

  _proxyCharts.uptimeChart = echarts.init(el, null, { renderer: 'canvas' });
  _proxyCharts.uptimeChart.setOption({
    animation: false,
    grid: { left: 40, right: 8, top: 30, bottom: 24 },
    legend: { data: [t("uptimeOperational"), t("uptimeDegraded"), t("uptimePartial"), t("uptimeOutage")], textStyle: { color: '#F7F3EC', fontSize: _cf().legend }, top: 2, itemWidth: 12, itemHeight: 10 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: _cf().tooltip },
      formatter: function(params) {
        var lines = [params[0].axisValueLabel];
        for (var _pm of params) { if (_pm.seriesName) lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + _pm.value + 'h'); }
        return lines.join('<br>');
      }
    },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#EFE7D6', fontSize: _cf().tick }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
    yAxis: { type: 'value', max: 24, min: 0, interval: 6, axisLabel: { color: '#EFE7D6', fontSize: _cf().tick, formatter: function(v) { return v + 'h'; } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
    series: [
      { name: t("uptimeOperational"), type: 'bar', stack: 's', data: opData, itemStyle: { color: 'rgba(34,197,94,0.3)', borderColor: 'rgba(34,197,94,0.5)', borderWidth: 1 } },
      { name: t("uptimeDegraded"), type: 'bar', stack: 's', data: degData, itemStyle: { color: 'rgba(245,158,11,0.3)', borderColor: 'rgba(245,158,11,0.6)', borderWidth: 1 } },
      { name: t("uptimePartial"), type: 'bar', stack: 's', data: partData, itemStyle: { color: 'rgba(249,115,22,0.35)', borderColor: 'rgba(249,115,22,0.7)', borderWidth: 1 } },
      { name: t("uptimeOutage"), type: 'bar', stack: 's', data: outData, itemStyle: { color: 'rgba(239,68,68,0.4)', borderColor: 'rgba(239,68,68,0.7)', borderWidth: 1 } },
      { name: '', type: 'bar', stack: 's', data: greyData, itemStyle: { color: 'rgba(42,45,52,0.45)', borderColor: 'rgba(42,45,52,0.55)', borderWidth: 1 } }
    ]
  }, true);
  if (typeof window.__scheduleAnthropicHealthChartsResize === 'function') window.__scheduleAnthropicHealthChartsResize();
}

// ── Incident History Chart ────────────────────────────────────────────────
function renderIncidentHistory(data) {
  var titleEl = document.getElementById("incident-history-title");
  if (titleEl) titleEl.textContent = t("incidentHistoryLabel");
  var titleOT = document.getElementById("outage-timeline-title");
  if (titleOT) titleOT.textContent = t("outageTimelineTitle");
  var el = document.getElementById("c-incident-history");
  if (!el) return;
  if (typeof echarts === "undefined") return;
  if (!data?.days?.length) return;

  var srcDays = _outageTimelineMonthFilter ? (data.days || []) : getFilteredDays(data.days || []);
  var days = [];
  for (var _sfd2 of srcDays) {
    if (_outageTimelineMonthFilter && _sfd2.date && _sfd2.date.slice(0, 7) !== _outageTimelineMonthFilter) continue;
    days.push(_sfd2);
  }
  if (days.length < 1) days = getFilteredDays(data.days || []);
  if (days.length < 2) return;

  var labels = [];
  var critH = [], majorH = [], minorH = [], greyH = [];
  var hitLimits = [];

  for (var d of days) {
    labels.push(d.date.slice(5));
    hitLimits.push(d.hit_limit || 0);

    var spans = d.outage_spans || [];
    var bySev = { critical: 0, major: 0, minor: 0 };
    var excludedH = 0;
    for (var _sp2 of spans) {
      var imp = _sp2.impact || "none";
      if (imp === "none") continue;
      var dur = (_sp2.to || 0) - (_sp2.from || 0);
      if (dur < 0) dur = 0;
      if (_outageImpactExclude[imp]) { excludedH += dur; continue; }
      if (bySev[imp] !== undefined) bySev[imp] += dur;
    }
    critH.push(Math.round(bySev.critical * 10) / 10);
    majorH.push(Math.round(bySev.major * 10) / 10);
    minorH.push(Math.round(bySev.minor * 10) / 10);
    greyH.push(Math.round(excludedH * 10) / 10);
  }

  if (_proxyCharts.incidentHistory) {
    _proxyCharts.incidentHistory.dispose();
    _proxyCharts.incidentHistory = null;
  }

  var legCrit = t("incidentLegendCritical");
  var legMajor = t("incidentLegendMajor");
  var legMinor = t("incidentLegendMinor");
  _proxyCharts.incidentHistory = echarts.init(el, null, { renderer: 'canvas' });
  _proxyCharts.incidentHistory.setOption({
    animation: false,
    grid: { left: 50, right: 50, top: 30, bottom: 24 },
    legend: { data: [legCrit, legMajor, legMinor, t("incidentDSHitLimits")], textStyle: { color: '#F7F3EC', fontSize: _cf().legend }, top: 2, itemWidth: 12, itemHeight: 10 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: _cf().tooltip },
      formatter: function(params) {
        var lines = [params[0].axisValueLabel];
        for (var pi = 0; pi < params.length; pi++) {
          var p = params[pi];
          if (!p.seriesName) continue;
          var suffix = p.seriesType === 'line' ? '' : 'h';
          lines.push(p.marker + ' ' + p.seriesName + ': ' + p.value + suffix);
        }
        return lines.join('<br>');
      }
    },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#EFE7D6', fontSize: _cf().tick }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.4)' } } },
    yAxis: [
      { type: 'value', min: 0, position: 'left', name: t("incidentAxisOutage"), nameTextStyle: { color: '#EFE7D6', fontSize: _cf().title }, axisLabel: { color: '#EFE7D6', fontSize: _cf().tick }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.4)' } } },
      { type: 'value', min: 0, position: 'right', name: t("incidentAxisHitLimits"), nameTextStyle: { color: '#f59e0b', fontSize: _cf().title }, axisLabel: { color: '#f59e0b', fontSize: _cf().tick }, splitLine: { show: false } }
    ],
    series: [
      { name: legCrit, type: 'bar', stack: 'inc', yAxisIndex: 0, data: critH, itemStyle: { color: 'rgba(239,68,68,0.4)', borderColor: 'rgba(239,68,68,0.7)', borderWidth: 1 } },
      { name: legMajor, type: 'bar', stack: 'inc', yAxisIndex: 0, data: majorH, itemStyle: { color: 'rgba(249,115,22,0.35)', borderColor: 'rgba(249,115,22,0.6)', borderWidth: 1 } },
      { name: legMinor, type: 'bar', stack: 'inc', yAxisIndex: 0, data: minorH, itemStyle: { color: 'rgba(245,158,11,0.3)', borderColor: 'rgba(245,158,11,0.6)', borderWidth: 1 } },
      { name: '', type: 'bar', stack: 'inc', yAxisIndex: 0, data: greyH, itemStyle: { color: 'rgba(42,45,52,0.45)', borderColor: 'rgba(42,45,52,0.55)', borderWidth: 1 } },
      { name: t("incidentDSHitLimits"), type: 'line', yAxisIndex: 1, data: hitLimits, smooth: 0.3, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#f59e0b' },
        lineStyle: { color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { color: 'rgba(245,158,11,0.1)' } }
    ]
  }, true);
  if (typeof window.__scheduleAnthropicHealthChartsResize === 'function') window.__scheduleAnthropicHealthChartsResize();
}


function updateAnthropicPopup(data) {
  var scatterTitle = document.getElementById("anthropic-scatter-chart-title");
  if (scatterTitle) scatterTitle.textContent = t("chartStatusOutageScatter");
  var el = document.getElementById("c-anthropic-incidents");
  if (!el) return;
  if (typeof echarts === "undefined") return;

  var label = document.getElementById("anthropic-label");
  if (label) label.textContent = "Anthropic";

  var days = getFilteredDays(data.days || []);
  if (days.length < 2) return;

  var labels = [];
  var outageH = [];
  var outageColors = [];
  var incidentCounts = [];
  var scatterData = [];
  for (var i = 0; i < days.length; i++) {
    var d = days[i];
    labels.push(d.date.slice(5));
    var oh = d.outage_hours || 0;
    outageH.push(oh);
    outageColors.push(oh > 2 ? 'rgba(239,68,68,0.08)' : oh > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(42,45,52,0.05)');
    var ic = (d.outage_incidents || []).length;
    incidentCounts.push(ic);
    if (ic > 0) scatterData.push([i, ic]);
  }

  if (_proxyCharts.anthropicIncidents) {
    try {
      var domA = _proxyCharts.anthropicIncidents.getDom ? _proxyCharts.anthropicIncidents.getDom() : null;
      if (domA !== el) {
        _proxyCharts.anthropicIncidents.dispose();
        _proxyCharts.anthropicIncidents = null;
      }
    } catch (eAnth) {
      try {
        _proxyCharts.anthropicIncidents.dispose();
      } catch (error) { logClientOptionalErr(error); }
      _proxyCharts.anthropicIncidents = null;
    }
  }
  if (!_proxyCharts.anthropicIncidents) {
    _proxyCharts.anthropicIncidents = echarts.init(el, null, { renderer: 'canvas' });
  }
  var legAnthInc = t("anthropicLegendIncidents");
  _proxyCharts.anthropicIncidents.setOption({
    animation: false,
    grid: { left: 50, right: 50, top: 16, bottom: 24 },
    legend: { data: [t("incidentDSOutageHours"), legAnthInc], textStyle: { color: '#F7F3EC', fontSize: 10 }, top: 0, itemWidth: 10, itemHeight: 8 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: 11 } },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.4)' } } },
    yAxis: [
      { type: 'value', min: 0, position: 'left', name: t("incidentAxisOutage"), nameTextStyle: { color: '#A0875E', fontSize: 9 }, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.4)' } } },
      { type: 'value', min: 0, position: 'right', name: t("availKpiIncidents"), nameTextStyle: { color: '#ef4444', fontSize: 9 }, axisLabel: { color: '#ef4444' }, splitLine: { show: false } }
    ],
    series: [
      { name: t("incidentDSOutageHours"), type: 'bar', yAxisIndex: 0, data: outageH, barWidth: '35%', itemStyle: { color: function(p) { return outageColors[p.dataIndex]; }, borderColor: function(p) { return outageColors[p.dataIndex].replace(/[\d.]+\)$/, '0.8)'); }, borderWidth: 1, borderRadius: 2 } },
      { name: legAnthInc, type: 'scatter', yAxisIndex: 1, data: scatterData, symbolSize: 8, itemStyle: { color: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.8)', borderWidth: 2 } }
    ]
  }, true);
}


// ── Outage Timeline (24h stacked per day) ─────────────────────────────────
function renderOutageTimeline(data, monthFilter) {
  var titleOT = document.getElementById("outage-timeline-title");
  if (titleOT) titleOT.textContent = t("outageTimelineTitle");
  var el = document.getElementById("c-outage-timeline");
  if (!el) return;
  if (typeof echarts === "undefined") return;
  if (!data?.days?.length) return;
  if (monthFilter !== undefined) _outageTimelineMonthFilter = monthFilter;

  var srcDays = _outageTimelineMonthFilter ? (data.days || []) : getFilteredDays(data.days || []);
  var days = [];
  for (var fi = 0; fi < srcDays.length; fi++) {
    if (_outageTimelineMonthFilter && srcDays[fi].date && srcDays[fi].date.slice(0, 7) !== _outageTimelineMonthFilter) continue;
    days.push(srcDays[fi]);
  }
  if (days.length < 1) days = getFilteredDays(data.days || []);
  if (days.length < 2 && !_outageTimelineMonthFilter) return;

  var dayMap = {};
  for (var dm = 0; dm < days.length; dm++) dayMap[days[dm].date] = days[dm];

  var paddedDays = [];
  if (_outageTimelineMonthFilter) {
    var parts = _outageTimelineMonthFilter.split("-");
    var yr = Number.parseInt(parts[0], 10);
    var mo = Number.parseInt(parts[1], 10);
    var daysInMonth = new Date(yr, mo, 0).getDate();
    for (var pd = 1; pd <= daysInMonth; pd++) {
      var dk = yr + "-" + String(mo).padStart(2, "0") + "-" + String(pd).padStart(2, "0");
      paddedDays.push(dayMap[dk] || { date: dk, outage_spans: [], _empty: true });
    }
  } else {
    paddedDays = days;
  }
  if (paddedDays.length < 2) return;

  var labels = [];
  var critData = [], majorData = [], minorData = [], noneData = [], greyData = [];

  for (var di = 0; di < paddedDays.length; di++) {
    var d = paddedDays[di];
    labels.push(d.date.slice(5));
    if (d._empty) {
      critData.push(0); majorData.push(0); minorData.push(0); noneData.push(0); greyData.push(24);
      continue;
    }
    var spans = d.outage_spans || [];

    var bySev = { critical: 0, major: 0, minor: 0, none: 0 };
    for (var si = 0; si < spans.length; si++) {
      var dur = (spans[si].to || 0) - (spans[si].from || 0);
      if (dur < 0) dur = 0;
      var imp = spans[si].impact || "none";
      if (bySev[imp] !== undefined) bySev[imp] += dur;
      else bySev.none += dur;
    }

    var totalInc = bySev.critical + bySev.major + bySev.minor + bySev.none;
    if (totalInc > 24) {
      var scale = 24 / totalInc;
      bySev.critical *= scale; bySev.major *= scale; bySev.minor *= scale; bySev.none *= scale;
      totalInc = 24;
    }

    var uptimeH = 24 - totalInc;
    if (uptimeH < 0) uptimeH = 0;
    bySev.none += uptimeH;

    var greyH = 0;
    var visCrit = bySev.critical, visMajor = bySev.major, visMinor = bySev.minor, visNone = bySev.none;
    if (_outageImpactExclude["critical"]) { greyH += visCrit; visCrit = 0; }
    if (_outageImpactExclude["major"]) { greyH += visMajor; visMajor = 0; }
    if (_outageImpactExclude["minor"]) { greyH += visMinor; visMinor = 0; }
    if (_outageImpactExclude["none"]) { greyH += visNone; visNone = 0; }

    critData.push(Math.round(visCrit * 10) / 10);
    majorData.push(Math.round(visMajor * 10) / 10);
    minorData.push(Math.round(visMinor * 10) / 10);
    noneData.push(Math.round(visNone * 10) / 10);
    greyData.push(Math.round(greyH * 10) / 10);
  }

  if (_proxyCharts.outageTimeline) {
    _proxyCharts.outageTimeline.dispose();
    _proxyCharts.outageTimeline = null;
  }

  var xLabelOpts = paddedDays.length > 31
    ? { color: '#EFE7D6', fontSize: Math.max(9, _cf().tick - 2), rotate: 45, interval: 0 }
    : { color: '#EFE7D6', fontSize: _cf().tick };

  var legNone = t("outageTimelineOk");
  var legOCrit = t("incidentLegendCritical");
  var legOMajor = t("incidentLegendMajor");
  var legOMinor = t("incidentLegendMinor");
  _proxyCharts.outageTimeline = echarts.init(el, null, { renderer: 'canvas' });
  _proxyCharts.outageTimeline.setOption({
    animation: false,
    grid: { left: 40, right: 8, top: 30, bottom: paddedDays.length > 31 ? 40 : 24 },
    legend: { data: [legNone, legOCrit, legOMajor, legOMinor], textStyle: { color: '#F7F3EC', fontSize: _cf().legend }, top: 2, itemWidth: 12, itemHeight: 10 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC', fontSize: _cf().tooltip },
      formatter: function(params) {
        var lines = [params[0].axisValueLabel];
        for (var pi = 0; pi < params.length; pi++) { if (params[pi].seriesName) lines.push(params[pi].marker + ' ' + params[pi].seriesName + ': ' + params[pi].value + 'h'); }
        return lines.join('<br>');
      }
    },
    xAxis: { type: 'category', data: labels, axisLabel: xLabelOpts, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
    yAxis: { type: 'value', max: 24, min: 0, interval: 6, axisLabel: { color: '#EFE7D6', fontSize: _cf().tick, formatter: function(v) { return v + 'h'; } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
    series: [
      { name: legNone, type: 'bar', stack: 's', data: noneData, itemStyle: { color: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)', borderWidth: 1 } },
      { name: legOCrit, type: 'bar', stack: 's', data: critData, itemStyle: { color: 'rgba(239,68,68,0.35)', borderColor: 'rgba(239,68,68,0.7)', borderWidth: 1 } },
      { name: legOMajor, type: 'bar', stack: 's', data: majorData, itemStyle: { color: 'rgba(249,115,22,0.3)', borderColor: 'rgba(249,115,22,0.6)', borderWidth: 1 } },
      { name: legOMinor, type: 'bar', stack: 's', data: minorData, itemStyle: { color: 'rgba(245,158,11,0.25)', borderColor: 'rgba(245,158,11,0.6)', borderWidth: 1 } },
      { name: '', type: 'bar', stack: 's', data: greyData, itemStyle: { color: 'rgba(42,45,52,0.45)', borderColor: 'rgba(42,45,52,0.55)', borderWidth: 1 } }
    ]
  }, true);
  if (typeof window.__scheduleAnthropicHealthChartsResize === 'function') window.__scheduleAnthropicHealthChartsResize();
}


// ── Availability KPIs (Anthropic popup fold-out) ─────────────────────────
function renderAvailabilityKpis(data) {
  _lastAvailKpiData = data;
  var panel = document.getElementById("avail-kpi-panel");
  var summary = document.getElementById("avail-kpi-summary");
  if (!panel || !summary) return;
  if (!data?.days?.length) { panel.innerHTML = ""; return; }
  summary.textContent = t("availKpiSummary");

  var allDays = data.days || [];
  if (allDays.length < 2) { panel.innerHTML = ""; return; }

  // ── Collect per-day degradation + uptime + per-incident impact counts ──
  // Degradation = critical + major + minor hours (NOT "none")
  // Outage = only major_outage comp_status hours
  var totalDegradationH = 0;
  var totalOutageH = 0;
  var byMonth = {};       // { "2026-03": { count, hours, days } }
  var byImpact = {};      // { "critical": { count, hours } }
  var seenIncidents = {};  // dedup by name+date

  for (var i = 0; i < allDays.length; i++) {
    var d = allDays[i];
    var spans = d.outage_spans || [];
    var dayDegH = 0;
    for (var si = 0; si < spans.length; si++) {
      var dur = (spans[si].to || 0) - (spans[si].from || 0);
      if (dur < 0) dur = 0;
      var imp = spans[si].impact || "none";
      // Only critical/major/minor count as degradation
      if (imp !== "none") dayDegH += dur;
      if ((spans[si].comp_status || "degraded_performance") === "major_outage") totalOutageH += dur;
      if (!byImpact[imp]) byImpact[imp] = { count: 0, hours: 0 };
      byImpact[imp].hours += dur;
    }
    if (dayDegH > 24) dayDegH = 24;
    totalDegradationH += dayDegH;

    var mk = d.date ? d.date.slice(0, 7) : "";
    if (mk) {
      if (!byMonth[mk]) byMonth[mk] = { count: 0, hours: 0, days: 0 };
      byMonth[mk].hours += dayDegH;
      byMonth[mk].days++;
    }

    var incidents = d.outage_incidents || [];
    for (var ii = 0; ii < incidents.length; ii++) {
      var inc = incidents[ii];
      var ikey = (inc.name || "") + "|" + d.date;
      if (seenIncidents[ikey]) continue;
      seenIncidents[ikey] = true;
      var incImp = inc.impact || "none";
      if (!byImpact[incImp]) byImpact[incImp] = { count: 0, hours: 0 };
      byImpact[incImp].count++;
      if (mk) byMonth[mk].count++;
    }
  }

  var totalDays = allDays.length;
  var totalH = totalDays * 24;
  var uptimePct = totalH > 0 ? ((totalH - totalDegradationH) / totalH * 100) : 100;
  var firstDate = allDays[0].date || "";
  var lastDate = allDays[allDays.length - 1].date || "";

  var realUptimePct = totalH > 0 ? ((totalH - totalOutageH) / totalH * 100) : 100;

  // Median-based color: per-day weighted quality %, sort, take median
  // Severity weights: critical=1, major=0.7, minor=0.3, none=0
  var _sevWeight = { critical: 1, major: 0.7, minor: 0.3, none: 0 };
  var dailySqPcts = [];
  var dailyUtPcts = [];
  for (var dpi = 0; dpi < allDays.length; dpi++) {
    var dpSpans = allDays[dpi].outage_spans || [];
    var dpWeightedH = 0, dpOutH = 0;
    for (var dpsi = 0; dpsi < dpSpans.length; dpsi++) {
      var dpDur = (dpSpans[dpsi].to || 0) - (dpSpans[dpsi].from || 0);
      if (dpDur < 0) dpDur = 0;
      var dpImp = dpSpans[dpsi].impact || "none";
      dpWeightedH += dpDur * (_sevWeight[dpImp] || 0);
      if ((dpSpans[dpsi].comp_status || "degraded_performance") === "major_outage") dpOutH += dpDur;
    }
    if (dpWeightedH > 24) dpWeightedH = 24;
    dailySqPcts.push(((24 - dpWeightedH) / 24 * 100));
    dailyUtPcts.push(dpOutH > 24 ? 0 : ((24 - dpOutH) / 24 * 100));
  }
  dailySqPcts.sort(function(a, b) { return a - b; });
  dailyUtPcts.sort(function(a, b) { return a - b; });
  var medianSq = dailySqPcts.length > 0 ? dailySqPcts[Math.floor(dailySqPcts.length / 2)] : 100;
  var medianUt = dailyUtPcts.length > 0 ? dailyUtPcts[Math.floor(dailyUtPcts.length / 2)] : 100;

  // ITSCM color bands based on MEDIAN (not average)
  var utColorCls = medianUt >= 99.8 ? "ok" : medianUt >= 99 ? "warn" : medianUt >= 95 ? "caution" : "danger";
  var sqColorCls = medianSq >= 99 ? "ok" : medianSq >= 95 ? "warn" : medianSq >= 85 ? "caution" : "danger";

  // ── Build HTML ──
  var h = "";

  var inModal = document.getElementById("anthropic-modal-overlay");
  var isWide = inModal?.classList.contains("is-open");

  var utCCls = medianUt >= 99.8 ? "ok" : medianUt >= 99 ? "warn" : medianUt >= 95 ? "caution" : "danger";
  var sqCCls = medianSq >= 99 ? "ok" : medianSq >= 95 ? "warn" : medianSq >= 85 ? "caution" : "danger";
  var utColorTxt = "avail-" + (medianUt >= 99.8 ? "green" : medianUt >= 99 ? "yellow" : medianUt >= 95 ? "orange" : "red");
  var sqColorTxt = "avail-" + (medianSq >= 99 ? "green" : medianSq >= 95 ? "yellow" : medianSq >= 85 ? "orange" : "red");

  if (isWide) {
    // Popout: full cards side by side (like Peak-Tag Total)
    h += "<div class=\"avail-kpi-cards\">";
    h += "<div class=\"card " + utCCls + "\"><div class=\"label\">" + escHtml(t("cardUptime")) + "</div>";
    h += "<div class=\"value\">" + realUptimePct.toFixed(2) + "%</div>";
    h += "<div class=\"sub\">" + escHtml(firstDate) + " \u2013 " + escHtml(lastDate) + " (" + totalDays + "d)</div></div>";
    h += "<div class=\"card " + sqCCls + "\"><div class=\"label\">" + escHtml(t("cardServiceQuality")) + "</div>";
    h += "<div class=\"value\">" + uptimePct.toFixed(1) + "%</div>";
    h += "<div class=\"sub\">" + escHtml(t("availKpiDowntime")) + ": " + (Math.round(totalDegradationH * 10) / 10) + "h</div></div>";
    h += "</div>";
  } else {
    // Popup: compact inline row
    h += "<div class=\"avail-kpi-row\">";
    h += "<span class=\"avail-kpi-metric\"><span class=\"avail-kpi-label\">" + escHtml(t("cardUptime")) + "</span> <span class=\"" + utColorTxt + " avail-kpi-val\">" + realUptimePct.toFixed(2) + "%</span></span>";
    h += "<span class=\"avail-kpi-metric\"><span class=\"avail-kpi-label\">" + escHtml(t("cardServiceQuality")) + "</span> <span class=\"" + sqColorTxt + " avail-kpi-val\">" + uptimePct.toFixed(1) + "%</span></span>";
    h += "</div>";
  }

  // Monthly table
  var monthKeys = Object.keys(byMonth).sort(function (a, b) { return a.localeCompare(b); });
  if (monthKeys.length > 0) {
    var now = new Date();
    var curMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

    // Precompute month data
    var totalIncidents = 0;
    var cols = []; // { key, label, count, hours, pct, trendHtml, isCurrent, isActive }
    for (var ti = 0; ti < monthKeys.length; ti++) totalIncidents += byMonth[monthKeys[ti]].count;

    // "Gesamt" column
    var isAllActive = !_outageTimelineMonthFilter;
    cols.push({ key: "__all__", label: t("availKpiTotal"), count: totalIncidents, hours: totalDegradationH, pct: uptimePct, trendHtml: "", isCurrent: false, isActive: isAllActive, bold: true });

    for (var mi = 0; mi < monthKeys.length; mi++) {
      var mk2 = monthKeys[mi];
      var m = byMonth[mk2];
      var mTotalH = m.days * 24;
      var mPct = mTotalH > 0 ? ((mTotalH - m.hours) / mTotalH * 100) : 100;
      var isCurrent = mk2 === curMonth;
      var isActive = mk2 === _outageTimelineMonthFilter;
      var trendHtml = "";
      if (mi > 0) {
        var prev = byMonth[monthKeys[mi - 1]];
        var prevTotalH = prev.days * 24;
        var prevPct = prevTotalH > 0 ? ((prevTotalH - prev.hours) / prevTotalH * 100) : 100;
        var delta = mPct - prevPct;
        if (Math.abs(delta) >= 0.1) {
          var trendCls = delta > 0 ? "trend-up" : "trend-down";
          var arrow = delta > 0 ? "\u2191" : "\u2193";
          trendHtml = "<span class=\"avail-kpi-trend " + trendCls + "\">" + arrow + Math.abs(delta).toFixed(1) + "%</span>";
        }
      }
      var mlabel = mk2.slice(2);  // "26-03" instead of "2026-03"
      if (isCurrent) mlabel += " *";
      cols.push({ key: mk2, label: mlabel, count: m.count, hours: m.hours, pct: mPct, trendHtml: trendHtml, isCurrent: isCurrent, isActive: isActive, bold: false, empty: false });
    }

    // Pad +12 future months from current month
    var padStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    for (var fp = 0; fp < 12; fp++) {
      var fy = padStart.getFullYear();
      var fm = padStart.getMonth() + 1;
      var fk = fy + "-" + String(fm).padStart(2, "0");
      if (!byMonth[fk]) {
        var fl = fk.slice(2);
        cols.push({ key: fk, label: fl, count: null, hours: null, pct: null, trendHtml: "", isCurrent: false, isActive: false, bold: false, empty: true });
      }
      padStart.setMonth(padStart.getMonth() + 1);
    }

    if (isWide) {
      // ── Modal: transposed — months as columns, in card wrapper ──
      h += "<div class=\"card\" style=\"margin-top:12px;padding:14px 16px;overflow-x:auto\">";
      h += "<div class=\"label\" style=\"margin-bottom:8px\">" + escHtml(t("availKpiMonth")) + "</div>";
      h += "<table class=\"avail-kpi-table avail-kpi-table-cols\"><thead><tr><th></th>";
      for (var ci = 0; ci < cols.length; ci++) {
        var c = cols[ci];
        var thCls = [];
        if (c.isActive) thCls.push("avail-kpi-col-active");
        if (c.isCurrent) thCls.push("avail-kpi-col-current");
        h += "<th class=\"num" + (thCls.length ? " " + thCls.join(" ") : "") + "\" data-month=\"" + escHtml(c.key) + "\"" + (c.empty ? "" : " style=\"cursor:pointer\"") + ">";
        h += (c.bold ? "<strong>" : "") + escHtml(c.label) + (c.bold ? "</strong>" : "");
        h += "<span style=\"display:inline-block;width:1em;text-align:center\">" + (c.isActive ? "\u25bc" : "") + "</span>";
        h += "</th>";
      }
      h += "</tr></thead><tbody>";
      // Incidents row
      h += "<tr><td>" + escHtml(t("availKpiIncidents")) + "</td>";
      for (var ci2 = 0; ci2 < cols.length; ci2++) {
        h += "<td class=\"num" + (cols[ci2].empty ? " avail-kpi-empty" : "") + "\">" + (cols[ci2].empty ? "\u2013" : cols[ci2].count) + "</td>";
      }
      h += "</tr>";
      // Downtime row
      h += "<tr><td>" + escHtml(t("availKpiDowntime")) + "</td>";
      for (var ci3 = 0; ci3 < cols.length; ci3++) {
        h += "<td class=\"num" + (cols[ci3].empty ? " avail-kpi-empty" : "") + "\">" + (cols[ci3].empty ? "\u2013" : (Math.round(cols[ci3].hours * 10) / 10) + "h") + "</td>";
      }
      h += "</tr>";
      // Availability row
      h += "<tr><td>" + escHtml(t("availKpiAvail")) + "</td>";
      for (var ci4 = 0; ci4 < cols.length; ci4++) {
        var cp = cols[ci4];
        if (cp.empty) {
          h += "<td class=\"num avail-kpi-empty\">\u2013</td>";
        } else {
          var pctCls = cp.pct >= 99 ? "avail-green" : cp.pct >= 95 ? "avail-yellow" : cp.pct >= 85 ? "avail-orange" : "avail-red";
          h += "<td class=\"num\"><span class=\"" + pctCls + "\">" + (cp.bold ? "<strong>" : "") + cp.pct.toFixed(1) + "%" + (cp.bold ? "</strong>" : "") + "</span>";
          if (cp.trendHtml) h += " " + cp.trendHtml;
          h += "</td>";
        }
      }
      h += "</tr>";
      h += "</tbody></table></div>";
    } else {
      h += "<div class=\"avail-kpi-section-head\">" + escHtml(t("availKpiMonth")) + "</div>";
      // ── Popup: classic rows — months as rows, metrics as columns ──
      h += "<table class=\"avail-kpi-table\"><thead><tr>";
      h += "<th>" + escHtml(t("availKpiMonth")) + "</th>";
      h += "<th class=\"num\">" + escHtml(t("availKpiIncidents")) + "</th>";
      h += "<th class=\"num\">" + escHtml(t("availKpiDowntime")) + "</th>";
      h += "<th class=\"num\">" + escHtml(t("availKpiAvail")) + "</th>";
      h += "</tr></thead><tbody>";
      // Only data cols (no future empty months in popup)
      for (var ri = 0; ri < cols.length; ri++) {
        var rc = cols[ri];
        if (rc.empty) continue;
        var rCls = [];
        if (rc.isActive) rCls.push("avail-kpi-month-active");
        if (rc.isCurrent) rCls.push("avail-kpi-month-current");
        h += "<tr" + (rCls.length ? " class=\"" + rCls.join(" ") + "\"" : "") + " data-month=\"" + escHtml(rc.key) + "\" style=\"cursor:pointer\">";
        h += "<td>" + (rc.bold ? "<strong>" + escHtml(rc.label) + "</strong>" : escHtml(rc.label));
        if (rc.isCurrent) h += " <em>" + escHtml(t("availKpiCurrent")) + "</em>";
        if (rc.isActive) h += " \u25c0";
        h += "</td>";
        h += "<td class=\"num\">" + rc.count + "</td>";
        h += "<td class=\"num\">" + (Math.round(rc.hours * 10) / 10) + "h</td>";
        var rpCls = rc.pct >= 99 ? "avail-green" : rc.pct >= 95 ? "avail-yellow" : rc.pct >= 85 ? "avail-orange" : "avail-red";
        h += "<td class=\"num\"><span class=\"" + rpCls + "\">" + (rc.bold ? "<strong>" : "") + rc.pct.toFixed(1) + "%" + (rc.bold ? "</strong>" : "") + "</span>";
        if (rc.trendHtml) h += " " + rc.trendHtml;
        h += "</td></tr>";
      }
      h += "</tbody></table>";
    }
  }

  // Impact breakdown + Status filters
  var impactOrder = ["critical", "major", "minor", "none"];
  var hasImpact = false;
  for (var ci = 0; ci < impactOrder.length; ci++) {
    if (byImpact[impactOrder[ci]]) { hasImpact = true; break; }
  }
  var statusOrder = [
    { key: "operational", label: t("uptimeOperational"), cls: "kind-ok" },
    { key: "degraded_performance", label: t("uptimeDegraded"), cls: "impact-minor" },
    { key: "partial_outage", label: t("uptimePartial"), cls: "impact-major" },
    { key: "major_outage", label: t("uptimeOutage"), cls: "impact-critical" }
  ];

  if (isWide) {
    // Popout: both filter groups side by side in one row
    h += "<div class=\"avail-kpi-filters-row\">";
    if (hasImpact) {
      h += "<div class=\"avail-kpi-filter-group\">";
      h += "<span class=\"avail-kpi-filter-label\">" + escHtml(t("availKpiImpact")) + "</span>";
      for (var bi = 0; bi < impactOrder.length; bi++) {
        var ik = impactOrder[bi];
        var iv = byImpact[ik];
        if (!iv) continue;
        var impExcluded = !!_outageImpactExclude[ik];
        h += "<span class=\"avail-kpi-impact-badge impact-" + ik + (impExcluded ? " impact-excluded" : "") + "\" data-impact=\"" + ik + "\" style=\"cursor:pointer\">";
        h += escHtml(ik) + ": " + iv.count + " / " + (Math.round(iv.hours * 10) / 10) + "h";
        h += "</span>";
      }
      h += "</div>";
    }
    h += "<div class=\"avail-kpi-filter-group\">";
    h += "<span class=\"avail-kpi-filter-label\">Service Status</span>";
    for (var sti = 0; sti < statusOrder.length; sti++) {
      var st = statusOrder[sti];
      var stExcl = !!_outageStatusExclude[st.key];
      h += "<span class=\"avail-kpi-impact-badge " + st.cls + (stExcl ? " impact-excluded" : "") + "\" data-status=\"" + st.key + "\" style=\"cursor:pointer\">";
      h += st.label;
      h += "</span>";
    }
    h += "</div>";
    h += "</div>";
  } else {
    // Popup: stacked with section heads
    if (hasImpact) {
      h += "<div class=\"avail-kpi-section-head\">" + escHtml(t("availKpiImpact")) + "</div>";
      h += "<div class=\"avail-kpi-impact-row\">";
      for (var bi2 = 0; bi2 < impactOrder.length; bi2++) {
        var ik2 = impactOrder[bi2];
        var iv2 = byImpact[ik2];
        if (!iv2) continue;
        var impExcl2 = !!_outageImpactExclude[ik2];
        h += "<span class=\"avail-kpi-impact-badge impact-" + ik2 + (impExcl2 ? " impact-excluded" : "") + "\" data-impact=\"" + ik2 + "\" style=\"cursor:pointer\">";
        h += escHtml(ik2) + ": " + iv2.count + " / " + (Math.round(iv2.hours * 10) / 10) + "h";
        h += "</span>";
      }
      h += "</div>";
    }
    h += "<div class=\"avail-kpi-section-head\">Service Status</div>";
    h += "<div class=\"avail-kpi-impact-row\">";
    for (var sti2 = 0; sti2 < statusOrder.length; sti2++) {
      var st2 = statusOrder[sti2];
      var stExcl2 = !!_outageStatusExclude[st2.key];
      h += "<span class=\"avail-kpi-impact-badge " + st2.cls + (stExcl2 ? " impact-excluded" : "") + "\" data-status=\"" + st2.key + "\" style=\"cursor:pointer\">";
      h += st2.label;
      h += "</span>";
    }
    h += "</div>";
  }

  panel.innerHTML = h;

  // Bind month-column click → filter outage timeline chart
  var rows = panel.querySelectorAll("[data-month]");
  for (var ri = 0; ri < rows.length; ri++) {
    rows[ri].addEventListener("click", function() {
      var mk = this.dataset.month;
      var newFilter;
      if (mk === "__all__") {
        newFilter = null;
      } else {
        newFilter = (_outageTimelineMonthFilter === mk) ? null : mk;
      }
      _outageTimelineMonthFilter = newFilter;
      renderUptimeChart(data);
      renderIncidentHistory(data);
      renderOutageTimeline(data);
      renderAvailabilityKpis(data);
      var otDet = document.getElementById("outage-timeline-details");
      if (otDet && !otDet.open) otDet.setAttribute("open", "");
    });
  }

  // Bind impact-badge click → toggle exclude from all charts
  var badges = panel.querySelectorAll("[data-impact]");
  for (var bi2 = 0; bi2 < badges.length; bi2++) {
    badges[bi2].addEventListener("click", function() {
      var imp = this.dataset.impact;
      if (_outageImpactExclude[imp]) { delete _outageImpactExclude[imp]; } else { _outageImpactExclude[imp] = true; }
      renderUptimeChart(data);
      renderIncidentHistory(data);
      renderOutageTimeline(data);
      renderAvailabilityKpis(data);
      var otDet = document.getElementById("outage-timeline-details");
      if (otDet && !otDet.open) otDet.setAttribute("open", "");
    });
  }

  // Bind status-badge click → toggle exclude for uptime chart
  var stBadges = panel.querySelectorAll("[data-status]");
  for (var sb = 0; sb < stBadges.length; sb++) {
    stBadges[sb].addEventListener("click", function() {
      var sk = this.dataset.status;
      if (_outageStatusExclude[sk]) { delete _outageStatusExclude[sk]; } else { _outageStatusExclude[sk] = true; }
      renderUptimeChart(data);
      renderAvailabilityKpis(data);
    });
  }
}

// ── Auto-collapse charts when Kennzahlen opens (and vice versa) ──────────
(function() {
  var kpiDet = document.getElementById("avail-kpi-details");
  var chartIds = ["uptime-chart-details", "incident-history-details", "anthropic-incidents-details"];
  var keepOpen = "outage-timeline-details";
  if (!kpiDet) return;
  function isInModal() {
    var overlay = document.getElementById("anthropic-modal-overlay");
    return overlay?.classList.contains("is-open");
  }
  kpiDet.addEventListener("toggle", function() {
    if (isInModal()) return;
    if (kpiDet.open) {
      for (var i = 0; i < chartIds.length; i++) {
        var el = document.getElementById(chartIds[i]);
        if (el) el.removeAttribute("open");
      }
    }
  });
  // Re-open default service charts when Kennzahlen closes (incident charts stay collapsed)
  kpiDet.addEventListener("toggle", function() {
    if (isInModal()) return;
    if (!kpiDet.open) {
      var u = document.getElementById("uptime-chart-details");
      var o = document.getElementById("outage-timeline-details");
      var ih = document.getElementById("incident-history-details");
      var ai = document.getElementById("anthropic-incidents-details");
      if (u) u.setAttribute("open", "");
      if (o) o.setAttribute("open", "");
      if (ih) ih.removeAttribute("open");
      if (ai) ai.removeAttribute("open");
    }
  });
})();

// Anthropic badge click toggle popup
(function() {
  var badge = document.getElementById("anthropic-badge");
  if (badge) {
    badge.style.cursor = "pointer";
    badge.addEventListener("click", function(e) {
      e.stopPropagation();
      badge.classList.toggle("popup-open");
      if (badge.classList.contains("popup-open") && window.__dashboardState.getData()) {
        renderUptimeChart(window.__dashboardState.getData());
        renderIncidentHistory(window.__dashboardState.getData());
        renderOutageTimeline(window.__dashboardState.getData());
        updateAnthropicPopup(window.__dashboardState.getData());
      }
    });
    document.addEventListener("click", function() {
      badge.classList.remove("popup-open");
    });
    var popup = document.getElementById("anthropic-popup");
    if (popup) popup.addEventListener("click", function(e) { e.stopPropagation(); });
  }
})();

// ── Anthropic popup → fullscreen modal ───────────────────────────────────
(function() {
  var expandBtn = document.getElementById("anthropic-popup-expand");
  var overlay = document.getElementById("anthropic-modal-overlay");
  var modalBody = document.getElementById("anthropic-modal-body");
  var closeBtn = document.getElementById("anthropic-modal-close");
  var popup = document.getElementById("anthropic-popup");
  var badge = document.getElementById("anthropic-badge");
  if (!expandBtn || !overlay || !modalBody || !popup) return;

  var chartDetailIds = ["uptime-chart-details", "outage-timeline-details", "incident-history-details", "anthropic-incidents-details"];

  /** Service row open, incident row closed — same as initial popup / refresh. */
  function setDefaultAnthropicHealthDetailsState() {
    var u = document.getElementById("uptime-chart-details");
    var o = document.getElementById("outage-timeline-details");
    var ih = document.getElementById("incident-history-details");
    var ai = document.getElementById("anthropic-incidents-details");
    if (u) u.setAttribute("open", "");
    if (o) o.setAttribute("open", "");
    if (ih) ih.removeAttribute("open");
    if (ai) ai.removeAttribute("open");
  }

  function restoreChartsCollapse() {
    for (var i = 0; i < chartDetailIds.length; i++) {
      var el = document.getElementById(chartDetailIds[i]);
      if (el) el.classList.remove("no-collapse");
    }
  }

  function openModal() {
    // Move popup content into modal
    while (popup.firstChild) modalBody.appendChild(popup.firstChild);
    // Hide expand button inside modal (not needed)
    var expInModal = modalBody.querySelector(".anthropic-popup-expand");
    if (expInModal) expInModal.style.display = "none";
    setDefaultAnthropicHealthDetailsState();
    // Move Kennzahlen above charts in modal (collapsed by default)
    var kpiEl = modalBody.querySelector("#avail-kpi-details");
    var chartsRow = modalBody.querySelector(".health-charts-row");
    if (kpiEl && chartsRow?.parentNode) {
      chartsRow.parentNode.insertBefore(kpiEl, chartsRow);
      kpiEl.removeAttribute("open");
    }
    // Close the dropdown popup
    if (badge) badge.classList.remove("popup-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    _isModalOpen = true;
    // Re-render all charts with modal font sizes
    if (_lastAvailKpiData) {
      renderUptimeChart(_lastAvailKpiData);
      renderIncidentHistory(_lastAvailKpiData);
      renderOutageTimeline(_lastAvailKpiData);
      renderAvailabilityKpis(_lastAvailKpiData);
      updateAnthropicPopup(_lastAvailKpiData);
    }
    requestAnimationFrame(function () {
      if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts();
      requestAnimationFrame(function () { if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts(); });
    });
    setTimeout(function () { if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts(); }, 220);
  }

  function closeModal() {
    // Move Kennzahlen back below charts
    var kpiEl = modalBody.querySelector("#avail-kpi-details");
    var chartsRow = modalBody.querySelector(".health-charts-row");
    if (kpiEl && chartsRow?.parentNode) {
      chartsRow.parentNode.insertBefore(kpiEl, chartsRow.nextSibling);
    }
    // Restore collapse behavior
    restoreChartsCollapse();
    // Move content back into popup
    while (modalBody.firstChild) popup.appendChild(modalBody.firstChild);
    // Restore expand button
    var expInPopup = popup.querySelector(".anthropic-popup-expand");
    if (expInPopup) expInPopup.style.display = "";
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
    _isModalOpen = false;
    // Re-render all charts with popup font sizes
    if (_lastAvailKpiData) {
      renderUptimeChart(_lastAvailKpiData);
      renderIncidentHistory(_lastAvailKpiData);
      renderOutageTimeline(_lastAvailKpiData);
      renderAvailabilityKpis(_lastAvailKpiData);
      updateAnthropicPopup(_lastAvailKpiData);
    }
    requestAnimationFrame(function () {
      if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts();
      requestAnimationFrame(function () { if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts(); });
    });
    setTimeout(function () { if (typeof window.__bumpAnthropicHealthCharts === 'function') window.__bumpAnthropicHealthCharts(); }, 220);
  }

  expandBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener("click", function() { closeModal(); });

  // Close on overlay background click
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) closeModal();
  });
})();

(function __initAnthropicHealthChartResizeWatch() {
  var winH = globalThis.window;
  if (!winH) return;
  // Resolve at call-time: dashboard.client.js loads after health.js
  function schedResize() {
    if (typeof window.__scheduleAnthropicHealthChartsResize === 'function') {
      window.__scheduleAnthropicHealthChartsResize();
    }
  }
  winH.addEventListener("resize", schedResize);
  ["uptime-chart-details", "outage-timeline-details", "incident-history-details", "anthropic-incidents-details"].forEach(function (id) {
    var d = document.getElementById(id);
    if (d) d.addEventListener("toggle", schedResize);
  });
  if (typeof ResizeObserver === "undefined") return;
  var ids = ["c-uptime-chart", "c-incident-history", "c-anthropic-incidents", "c-outage-timeline"];
  for (var _id of ids) {
    var chartEl = document.getElementById(_id);
    var host = chartEl?.parentElement;
    if (host?.classList?.contains("health-chart-canvas-host")) {
      var ro = new ResizeObserver(schedResize);
      ro.observe(host);
    }
  }
})();

// Registry renderFn targets for Anthropic status charts (widget dispatcher / template preview).
function isAnthropicPopupVisible() {
  var badge = document.getElementById("anthropic-badge");
  return badge && badge.classList.contains("popup-open");
}

// ── Widget dispatcher shims ─────────────────────────────────────────────
window.renderStatus_uptime = function () {
  if (window.__dashboardState.getData() && isAnthropicPopupVisible()) renderUptimeChart(window.__dashboardState.getData());
};
window.renderStatus_incidents = function () {
  if (window.__dashboardState.getData() && isAnthropicPopupVisible()) renderIncidentHistory(window.__dashboardState.getData());
};
window.renderStatus_outageScatter = function () {
  if (window.__dashboardState.getData() && isAnthropicPopupVisible()) updateAnthropicPopup(window.__dashboardState.getData());
};
window.renderStatus_outageTimeline = function () {
  if (window.__dashboardState.getData() && isAnthropicPopupVisible()) renderOutageTimeline(window.__dashboardState.getData());
};

// ── Anthropic Status Lamp (Phase 18d: moved from dashboard.client.js) ──
function updateStatusLamp(data) {
  var dot = document.getElementById("anthropic-dot");
  var label = document.getElementById("anthropic-label");
  if (!dot || !label) return;
  var st = data.outage_status || "pending";
  if (st === "error" || st === "pending") {
    dot.style.background = "#3D3830";
    label.textContent = "Anthropic";
    dot.parentElement.title = t("statusPendingTip");
    return;
  }
  var days = data.days || [];
  var today = data.calendar_today || new Date().toISOString().slice(0,10);
  var todayData = null;
  for (var i = days.length - 1; i >= 0; i--) { if (days[i].date === today) { todayData = days[i]; break; } }
  var hasActiveOutage = false;
  var hasRecentIncident = false;
  if (todayData?.outage_incidents) {
    for (var ii = 0; ii < todayData.outage_incidents.length; ii++) {
      var inc = todayData.outage_incidents[ii];
      if (!inc.resolved_at) { hasActiveOutage = true; break; }
      hasRecentIncident = true;
    }
  }
  if (hasActiveOutage) {
    dot.style.background = "#ef4444";
    label.textContent = "Anthropic";
    dot.parentElement.title = t("statusOutageTip");
  } else if (hasRecentIncident) {
    dot.style.background = "#f59e0b";
    label.textContent = "Anthropic";
    dot.parentElement.title = t("statusIncidentTip");
  } else {
    dot.style.background = "#22c55e";
    label.textContent = "Anthropic";
    dot.parentElement.title = t("statusOkTip");
  }
}

// ── Window exports ──────────────────────────────────────────────────────
window.updateStatusLamp = updateStatusLamp;
window.renderHealthScore = renderHealthScore;
window.renderKeyFindings = renderKeyFindings;
window.computeHealthIndicators = computeHealthIndicators;
window.computeKeyFindings = computeKeyFindings;
window.computeHealthScoreForDay = computeHealthScoreForDay;
window.buildHealthScoreHistory = buildHealthScoreHistory;
window.renderUptimeChart = renderUptimeChart;
window.renderIncidentHistory = renderIncidentHistory;
window.renderOutageTimeline = renderOutageTimeline;
window.renderAvailabilityKpis = renderAvailabilityKpis;
window.updateAnthropicPopup = updateAnthropicPopup;
window.isAnthropicPopupVisible = isAnthropicPopupVisible;
window.initFilterBar = initFilterBar;
window.getSelectedPlan = getSelectedPlan;
window.getSelectedPlanLabel = getSelectedPlanLabel;
window.getSelectedPlanPrice = getSelectedPlanPrice;
window.getPlanPriceForDate = getPlanPriceForDate;
window.getFilterDateRange = getFilterDateRange;

// ── Section registration ────────────────────────────────────────────────
window.__sections = window.__sections || {};
window.__sections.health = {
  id: 'health',
  surface: 'overview',
  domId: 'health-collapse',
  render: function (data) {
    if (typeof window.renderHealthScore === 'function') window.renderHealthScore(data);
  }
};

})();
