/**
 * @asseris-module       Budget
 * @asseris-description  Auto-annotated module metadata for public/js/sections/budget.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * sections/budget.js
 * Extracted Budget Efficiency rendering logic from dashboard.client.js.
 *
 * Exports on window:
 *   renderBudgetEfficiency(data)
 *   __budgetResizeAll()
 *   _computeBudgetCtx(data)
 *   renderBudget_sankey(sCtx)
 *   renderBudget_trend(sCtx)
 *   renderBudget_quota(sCtx)
 *
 * Dependencies via window globals:
 *   fmt, pct, escHtml, t, tr, logClientOptionalErr, _charts, echarts,
 *   defined_colors, __lastUsageData, getFilteredDays, getFilterHost,
 *   getProxyDay, getSelectedPlanLabel
 */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────
  var _budgetCharts = { waterfall: null, trend: null, quota: null };

  // Approximate quota cost weights (relative to output=1)
  var __quotaWeights = {
    output: 1,
    input: 0.33,
    cache_creation: 0.42,
    cache_read: 0.03
  };
  var __budgetViewMode = "volume"; // "volume" | "cost"
  var __budgetFlowMode = "budget"; // "budget" | "api" | "user"
  var __budgetSankeyState = null;
  var __budgetFilteredHost = "";
  var __budgetSwitchesWired = false;

  // ── Resize ─────────────────────────────────────────────────────────────────
  function __budgetResizeAll() {
    for (var bk in _budgetCharts) {
      if (_budgetCharts[bk] && typeof _budgetCharts[bk].resize === 'function') {
        try { _budgetCharts[bk].resize(); } catch (error) { logClientOptionalErr(error); }
      }
    }
  }

  // ── Aggregation helpers ────────────────────────────────────────────────────
  function __aggregateBudgetDaysForEfficiency(days, filteredHost) {
    var tot = { input: 0, output: 0, cache_read: 0, cache_creation: 0, total: 0,
      retries: 0, interrupts: 0, api_errors: 0, hit_limits: 0, calls: 0, active_hours: 0 };
    var dailyTrend = [];
    for (var d of days) {
      var src_d = d;
      if (filteredHost && d.hosts?.[filteredHost]) src_d = d.hosts[filteredHost];
      tot.input += src_d.input || 0;
      tot.output += src_d.output || 0;
      tot.cache_read += src_d.cache_read || 0;
      tot.cache_creation += src_d.cache_creation || 0;
      var daySum = src_d.total;
      if (daySum == null) daySum = (src_d.input || 0) + (src_d.output || 0) + (src_d.cache_read || 0) + (src_d.cache_creation || 0);
      tot.total += daySum;
      tot.calls += src_d.calls || 0;
      tot.active_hours += src_d.active_hours || 0;
      var ss = src_d.session_signals || d.session_signals || {};
      tot.retries += ss.retry || 0;
      tot.interrupts += ss.interrupt || 0;
      tot.api_errors += ss.api_error || 0;
      var hitLim = src_d.hit_limit;
      if (hitLim == null) hitLim = d.hit_limit;
      tot.hit_limits += hitLim || 0;

      var dayTotal = d.total || 0;
      var dayOutput = d.output || 0;
      dailyTrend.push({
        date: d.date,
        overhead: dayOutput > 0 ? Math.round(dayTotal / dayOutput * 10) / 10 : 0,
        output_pct: dayTotal > 0 ? Math.round(dayOutput / dayTotal * 100) : 0,
        cache_miss_rate: (d.cache_creation || 0) + (d.cache_read || 0) > 0
          ? Math.round((d.cache_creation || 0) / ((d.cache_creation || 0) + (d.cache_read || 0)) * 100)
          : 0
      });
    }
    return { tot: tot, dailyTrend: dailyTrend };
  }

  function __budgetHostTotalsFromDays(days) {
    var hostTotals = {};
    for (var dayRow of days) {
      var dh = dayRow.hosts || {};
      for (var hl of Object.keys(dh)) {
        var hv = dh[hl];
        if (!hostTotals[hl]) hostTotals[hl] = { output: 0, input: 0, cache_read: 0, cache_creation: 0, total: 0 };
        hostTotals[hl].output += hv.output || 0;
        hostTotals[hl].input += hv.input || 0;
        hostTotals[hl].cache_read += hv.cache_read || 0;
        hostTotals[hl].cache_creation += hv.cache_creation || 0;
        hostTotals[hl].total += hv.total || (hv.output || 0) + (hv.input || 0) + (hv.cache_read || 0) + (hv.cache_creation || 0);
      }
    }
    return hostTotals;
  }

  function __budgetSankeyWeights(src) {
    var allVals = [src.out, src.inp, src.cr, src.cc].filter(function(v) { return v > 0; });
    var maxLog = 0;
    for (var av of allVals) {
      var lx = Math.log10(1 + av);
      if (lx > maxLog) maxLog = lx;
    }
    function wOf(v) {
      if (v <= 0) return 0;
      var logV = Math.log10(1 + v);
      var normalized = maxLog > 0 ? (logV / maxLog) : 1;
      return Math.max(1, Math.round(1 + normalized * 3));
    }
    return { wOut: wOf(src.out), wInp: wOf(src.inp), wCr: wOf(src.cr), wCc: wOf(src.cc), wOf: wOf };
  }

  function __budgetKpiCardsHtml(days, tot, outputPct, overheadFactor, cacheMissRate, lostSignals) {
    var totalOutageH = 0;
    var totalTruncated = 0;
    for (var d of days) {
      totalOutageH += d.outage_hours || 0;
      totalTruncated += d.session_signals?.truncated || 0;
    }
    var cards = [
      { wid: "budget-kpi-output", label: t("budgetCardOutput"), value: outputPct + "%", sub: t("budgetCardOutputSub"), cls: outputPct < 25 ? "warn" : "" },
      { wid: "budget-kpi-overhead", label: t("budgetCardOverhead"), value: overheadFactor + "x", sub: t("budgetCardOverheadSub"), cls: overheadFactor > 4 ? "warn" : "" },
      { wid: "budget-kpi-cache-miss", label: t("budgetCardCacheMiss"), value: cacheMissRate + "%", sub: t("budgetCardCacheMissSub"), cls: cacheMissRate > 40 ? "warn" : "" },
      { wid: "budget-kpi-lost", label: t("budgetCardLost"), value: String(lostSignals), sub: t("budgetCardLostSub").replace("{r}", String(tot.retries)).replace("{i}", String(tot.interrupts)).replace("{e}", String(tot.api_errors)), cls: lostSignals > 5 ? "warn" : "" },
      { wid: "budget-kpi-outage", label: t("budgetCardOutage"), value: totalOutageH.toFixed(1) + "h", sub: t("budgetCardOutageSub"), cls: totalOutageH > 2 ? "warn" : "" },
      { wid: "budget-kpi-truncated", label: t("budgetCardTruncated"), value: String(totalTruncated), sub: t("budgetCardTruncatedSub"), cls: totalTruncated > 50 ? "warn" : "" }
    ];
    var ch = "";
    for (var c of cards) {
      ch +=
        '<div class="chart-box chart-box--kpi" id="' +
        c.wid +
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
    return ch;
  }

  // ── Quota helpers ──────────────────────────────────────────────────────────
  function __budgetQuotaFromLatestProxy(proxy) {
    var quota = { pct_5h: null, pct_7d: null, visible_tokens_per_pct: 0,
      fallback_pct: null, overage_status: null, overage_reason: null, representative_claim: null };
    var pDays = proxy?.proxy_days;
    if (!pDays?.length) return quota;
    var lastPd = pDays.at(-1);
    if (lastPd.rate_limit) {
      var rl = lastPd.rate_limit;
      var rlQ5 = rl["anthropic-ratelimit-unified-5h-utilization"];
      var rlQ7 = rl["anthropic-ratelimit-unified-7d-utilization"];
      if (rlQ5 != null) quota.pct_5h = Number.parseFloat(rlQ5) * 100;
      if (rlQ7 != null) quota.pct_7d = Number.parseFloat(rlQ7) * 100;
      var rlFb = rl["anthropic-ratelimit-unified-fallback-percentage"];
      if (rlFb != null) quota.fallback_pct = Number.parseFloat(rlFb);
      var ov = rl["anthropic-ratelimit-unified-overage-status"];
      if (ov) quota.overage_status = ov;
      var ovr = rl["anthropic-ratelimit-unified-overage-disabled-reason"];
      if (ovr) quota.overage_reason = ovr;
      var rc = rl["anthropic-ratelimit-unified-representative-claim"];
      if (rc) quota.representative_claim = rc;
    }
    if (lastPd.visible_tokens_per_pct) quota.visible_tokens_per_pct = lastPd.visible_tokens_per_pct;
    return quota;
  }

  function __budgetQuotaByDateMap(proxyDays) {
    var quotaByDate = {};
    for (var pd of proxyDays) {
      if (!pd.date || !pd.rate_limit) continue;
      var rl = pd.rate_limit;
      var pdQ5 = rl["anthropic-ratelimit-unified-5h-utilization"];
      var pdQ7 = rl["anthropic-ratelimit-unified-7d-utilization"];
      var pdFb = rl["anthropic-ratelimit-unified-fallback-percentage"];
      quotaByDate[pd.date] = {
        pct_5h: pdQ5 == null ? null : Math.round(Number.parseFloat(pdQ5) * 1000) / 10,
        pct_7d: pdQ7 == null ? null : Math.round(Number.parseFloat(pdQ7) * 1000) / 10,
        vis_per_pct: pd.visible_tokens_per_pct || 0,
        fallback_pct: pdFb == null ? null : Math.round(Number.parseFloat(pdFb) * 100)
      };
    }
    return quotaByDate;
  }

  function __budgetApplyQuotaToTrend(dailyTrend, quotaByDate) {
    for (var dt of dailyTrend) {
      var qd = quotaByDate[dt.date];
      dt.quota_5h = qd ? qd.pct_5h : null;
      dt.quota_7d = qd ? qd.pct_7d : null;
      dt.vis_per_pct = qd ? qd.vis_per_pct : 0;
      dt.fallback_pct = qd ? qd.fallback_pct : null;
    }
  }

  // ── Fuel gauge + alert ─────────────────────────────────────────────────────
  function __budgetFuelGaugeHtml(tot, quota, t) {
    var fuelColor = function(pct) {
      var p = Math.min(100, Math.max(0, pct)) / 100;
      var r = Math.round(p < 0.5 ? p * 2 * 245 : 245);
      var g = Math.round(p < 0.5 ? 197 : (1 - p) * 2 * 197);
      return "rgb(" + r + "," + g + ",20)";
    };
    var fuelRows = [];
    var pct5 = Math.min(quota.pct_5h, 100);
    var left5 = (100 - pct5);
    var hrs5 = quota.pct_5h > 0 && tot.active_hours > 0
      ? (left5 / quota.pct_5h * tot.active_hours).toFixed(1) : "?";
    fuelRows.push(
      "<div class=\"fuel-row\"><span class=\"fuel-label\">5h Window</span>" +
      "<div class=\"fuel-bar\"><div class=\"fuel-fill\" style=\"width:" + pct5 + "%;background:" + fuelColor(pct5) + "\"></div>" +
      "<span class=\"fuel-text\">" + pct5.toFixed(0) + "% used \u00B7 ~" + hrs5 + "h left</span></div></div>"
    );
    if (quota.pct_7d != null) {
      var pct7 = Math.min(quota.pct_7d, 100);
      fuelRows.push(
        "<div class=\"fuel-row\"><span class=\"fuel-label\">7d Window</span>" +
        "<div class=\"fuel-bar\"><div class=\"fuel-fill\" style=\"width:" + pct7 + "%;background:" + fuelColor(pct7) + "\"></div>" +
        "<span class=\"fuel-text\">" + pct7.toFixed(0) + "% used</span></div></div>"
      );
    }
    if (quota.fallback_pct != null) {
      var fbPctG = Math.round(quota.fallback_pct * 100);
      fuelRows.push(
        "<div class=\"fuel-row\"><span class=\"fuel-label\">" + t("budgetCardFallback") + "</span>" +
        "<div class=\"fuel-bar\"><div class=\"fuel-fill\" style=\"width:" + fbPctG + "%;background:" + fuelColor(100 - fbPctG) + "\"></div>" +
        "<span class=\"fuel-text\">" + fbPctG + "% " + t("budgetWfOfQuota") + "</span></div></div>"
      );
    }
    return fuelRows.join("");
  }

  function __budgetSankeyDispose() {
    if (_budgetCharts.waterfall) {
      if (typeof _budgetCharts.waterfall.dispose === 'function') _budgetCharts.waterfall.dispose();
      _budgetCharts.waterfall = null;
    }
  }

  /** Destroy waterfall + trend + quota chart instances (called from empty-state handler). */
  function __budgetDisposeCharts() {
    if (_budgetCharts.waterfall) {
      if (typeof _budgetCharts.waterfall.dispose === 'function') _budgetCharts.waterfall.dispose();
      else if (typeof _budgetCharts.waterfall.destroy === 'function') _budgetCharts.waterfall.destroy();
      _budgetCharts.waterfall = null;
    }
    if (_budgetCharts.trend) {
      if (typeof _budgetCharts.trend.dispose === 'function') _budgetCharts.trend.dispose();
      _budgetCharts.trend = null;
    }
    if (_budgetCharts.quota) {
      if (typeof _budgetCharts.quota.dispose === 'function') _budgetCharts.quota.dispose();
      _budgetCharts.quota = null;
    }
  }

  /** Handle empty-data state: render 'no data' text and clean up charts. */
  function __budgetHandleEmpty(sumEl, cardsEl) {
    sumEl.textContent = t("budgetNoData");
    if (cardsEl) cardsEl.innerHTML = "";
    __budgetDisposeCharts();
  }

  /** Compute aggregated budget-efficiency metrics from totals. */
  function __budgetMetricsFromTot(tot) {
    return {
      outputPct: tot.total > 0 ? Math.round(tot.output / tot.total * 100) : 0,
      overheadFactor: tot.output > 0 ? Math.round(tot.total / tot.output * 10) / 10 : 0,
      cacheMissRate: (tot.cache_creation + tot.cache_read) > 0
        ? Math.round(tot.cache_creation / (tot.cache_creation + tot.cache_read) * 100) : 0,
      lostSignals: tot.retries + tot.interrupts + tot.api_errors
    };
  }

  /** Fill the budget summary line with placeholder substitution. */
  function __budgetFillSummary(sumEl, tot, m) {
    sumEl.textContent = t("budgetSummary")
      .replace("{overhead}", String(m.overheadFactor))
      .replace("{outputPct}", String(m.outputPct))
      .replace("{cmr}", String(m.cacheMissRate))
      .replace("{retries}", String(tot.retries))
      .replace("{interrupts}", String(tot.interrupts));
  }

  /** Show or hide the fuel gauge row based on quota availability. */
  function __budgetRenderFuel(fuelEl, tot, quota) {
    if (fuelEl == null) return;
    if (quota.pct_5h == null) {
      fuelEl.style.display = "none";
      return;
    }
    fuelEl.innerHTML = __budgetFuelGaugeHtml(tot, quota, t);
    fuelEl.style.display = "flex";
  }

  /** Build the HTML parts for the capacity-reduced alert banner. */
  function __budgetAlertParts(quota) {
    var fbPctAlert = Math.round(quota.fallback_pct * 100);
    var parts = ["<strong>" + t("budgetAlertTitle") + "</strong> "];
    parts.push(t("budgetAlertFallback").split("{pct}").join(String(fbPctAlert)));
    if (quota.overage_status === "rejected") parts.push(" · " + t("budgetAlertOverage"));
    if (quota.representative_claim) parts.push(" · " + t("budgetAlertClaim").replace("{claim}", quota.representative_claim.replaceAll("_", " ")));
    return parts;
  }

  /** Show or hide the capacity-reduced alert banner. */
  function __budgetRenderAlert(alertEl, quota) {
    if (!alertEl) return;
    if (quota.fallback_pct != null && quota.fallback_pct < 1) {
      alertEl.innerHTML = __budgetAlertParts(quota).join("");
      alertEl.style.display = "block";
    } else {
      alertEl.style.display = "none";
    }
  }

  // ── Context builder ────────────────────────────────────────────────────────
  /**
   * Compute shared context for Budget Efficiency charts.
   * Cached on window.__dashboardState.getSectionCtx('budget').
   */
  function _computeBudgetCtx(data) {
    var days = getFilteredDays(data.days);
    var filteredHost = typeof getFilterHost === "function" ? getFilterHost() : "";
    __budgetFilteredHost = filteredHost;

    var aggBe = __aggregateBudgetDaysForEfficiency(days, filteredHost);
    var tot = aggBe.tot;
    var dailyTrend = aggBe.dailyTrend;
    var m = __budgetMetricsFromTot(tot);
    var quota = __budgetQuotaFromLatestProxy(data.proxy);
    var hostTotals = __budgetHostTotalsFromDays(days);
    var proxyDays = data.proxy?.proxy_days || [];
    __budgetApplyQuotaToTrend(dailyTrend, __budgetQuotaByDateMap(proxyDays));

    var sCtx = {
      data: data, days: days, tot: tot, dailyTrend: dailyTrend,
      m: m, quota: quota, hostTotals: hostTotals, filteredHost: filteredHost
    };
    window.__dashboardState.setSectionCtx('budget', sCtx);
    return sCtx;
  }

  // ── Sankey switch UI ───────────────────────────────────────────────────────
  function __renderBudgetGroup(el, modes, current, setter) {
    el.innerHTML = "";
    for (var mode of modes) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = mode.label;
      btn.dataset.key = mode.key;
      if (mode.key === current) btn.className = "active";
      btn.addEventListener("click", (function(k) {
        return function() {
          setter(k);
          if (__budgetSankeyState) renderBudgetWaterfall(__budgetSankeyState.tot, __budgetSankeyState.quota, __budgetSankeyState.hostTotals);
        };
      })(mode.key));
      el.appendChild(btn);
    }
  }

  function __buildBudgetSwitches() {
    if (__budgetSwitchesWired) return;
    __budgetSwitchesWired = true;

    var flowGrp = document.getElementById("budget-flow-group");
    var weightGrp = document.getElementById("budget-weight-group");
    if (!flowGrp || !weightGrp) return;

    var flowModes = [
      { key: "budget", label: t("budgetFlowBudget") },
      { key: "api",    label: t("budgetFlowApi") },
      { key: "user",   label: t("budgetFlowUser") }
    ];
    var weightModes = [
      { key: "volume", label: t("budgetWfVolume") },
      { key: "cost",   label: t("budgetWfCost") }
    ];

    __renderBudgetGroup(flowGrp, flowModes, __budgetFlowMode, function(k) { __budgetFlowMode = k; });
    __renderBudgetGroup(weightGrp, weightModes, __budgetViewMode, function(k) { __budgetViewMode = k; });
  }

  function __updateBudgetSwitchActive() {
    var flowGrp = document.getElementById("budget-flow-group");
    var weightGrp = document.getElementById("budget-weight-group");
    if (flowGrp) {
      for (var btn of flowGrp.querySelectorAll("button")) {
        btn.className = btn.dataset.key === __budgetFlowMode ? "active" : "";
      }
    }
    if (weightGrp) {
      for (var b2 of weightGrp.querySelectorAll("button")) {
        b2.className = b2.dataset.key === __budgetViewMode ? "active" : "";
      }
    }
  }

  // ── Sankey row builders ────────────────────────────────────────────────────
  /** Build host-local src (weighted if cost view, raw otherwise). */
  function __budgetHostSrc(hd, isCost) {
    if (isCost) {
      return {
        out: hd.output * __quotaWeights.output,
        inp: hd.input * __quotaWeights.input,
        cr:  hd.cache_read * __quotaWeights.cache_read,
        cc:  hd.cache_creation * __quotaWeights.cache_creation
      };
    }
    return { out: hd.output, inp: hd.input, cr: hd.cache_read, cc: hd.cache_creation };
  }

  /** Push one conditional row per token-kind (output / input / cache_read / cache_creation). */
  function __budgetPushLeafs(rows, from, s, x, w) {
    if (s.out > 0) rows.push([from, x.nOut, w.out]);
    if (s.inp > 0) rows.push([from, x.nInp, w.inp]);
    if (s.cr  > 0) rows.push([from, x.nCr,  w.cr]);
    if (s.cc  > 0) rows.push([from, x.nCc,  w.cc]);
  }

  /** Expand parentNode into per-host sub-nodes and recurse into leafs. */
  function __budgetExpandHosts(rows, parentNode, x) {
    for (var hk of x.hostKeys) {
      var hd = x.hostTotals[hk];
      var hLabel = hk + " (" + x.fmtTok(hd.total) + ")";
      var hsrc = __budgetHostSrc(hd, x.isCost);
      var hTotal = hsrc.out + hsrc.inp + hsrc.cr + hsrc.cc;
      rows.push([parentNode, hLabel, x.wOf(hTotal)]);
      __budgetPushLeafs(rows, hLabel, hsrc, x, {
        out: x.wOf(hsrc.out),
        inp: x.wOf(hsrc.inp),
        cr:  x.wOf(hsrc.cr),
        cc:  x.wOf(hsrc.cc)
      });
    }
  }

  /** Push final leaf->target rows (output -> outNode, overhead -> restNode). */
  function __budgetPushFinalLeafs(rows, x, outNode, restNode) {
    if (x.src.out > 0) rows.push([x.nOut, outNode,  x.wOut]);
    if (x.src.inp > 0) rows.push([x.nInp, restNode, x.wInp]);
    if (x.src.cr  > 0) rows.push([x.nCr,  restNode, x.wCr]);
    if (x.src.cc  > 0) rows.push([x.nCc,  restNode, x.wCc]);
  }

  /** Top-level weights adapter for __budgetPushLeafs. */
  function __budgetTopWeights(x) {
    return { out: x.wOut, inp: x.wInp, cr: x.wCr, cc: x.wCc };
  }

  /** Build budget-mode sankey rows: Plan Budget -> (hosts) -> leafs -> Productive/Overhead. */
  function __budgetRowsBudget(x) {
    var rows = [];
    var srcN = getSelectedPlanLabel() + " Budget";
    var prodN = t("budgetWfProductive") + " (" + x.fmtTok(x.raw.out) + ")";
    var overN = t("budgetWfOverhead") + " (" + x.fmtTok(x.raw.inp + x.raw.cr + x.raw.cc) + ")";
    if (x.hostKeys.length > 1) {
      __budgetExpandHosts(rows, srcN, x);
    } else {
      __budgetPushLeafs(rows, srcN, x.src, x, __budgetTopWeights(x));
    }
    __budgetPushFinalLeafs(rows, x, prodN, overN);
    return rows;
  }

  /** Build api-mode sankey rows: Claude API -> (hosts) -> leafs -> You. */
  function __budgetRowsApi(x) {
    var rows = [];
    var apiN = "Claude API";
    var youN = t("budgetWfYou") + " (" + x.fmtTok(x.totalVal) + ")";
    if (x.hostKeys.length > 1) {
      __budgetExpandHosts(rows, apiN, x);
    } else {
      __budgetPushLeafs(rows, apiN, x.src, x, __budgetTopWeights(x));
    }
    __budgetPushFinalLeafs(rows, x, youN, youN);
    return rows;
  }

  /** Build user-mode sankey rows: You -> (hosts | Claude API) -> leafs -> Result. */
  function __budgetRowsUser(x) {
    var rows = [];
    var youN = t("budgetWfYou");
    var resN = t("budgetWfResult") + " (" + x.fmtTok(x.totalVal) + ")";
    if (x.hostKeys.length > 1) {
      __budgetExpandHosts(rows, youN, x);
    } else {
      var apiN = "Claude API";
      rows.push([youN, apiN, x.wOut + x.wInp + x.wCr + x.wCc]);
      __budgetPushLeafs(rows, apiN, x.src, x, __budgetTopWeights(x));
    }
    __budgetPushFinalLeafs(rows, x, resN, resN);
    return rows;
  }

  /** Build Sankey rows for budget / api / user flow (reduces renderBudgetWaterfall complexity). */
  function __budgetBuildSankeyRows(x) {
    if (x.flowMode === "budget") return __budgetRowsBudget(x);
    if (x.flowMode === "api")    return __budgetRowsApi(x);
    return __budgetRowsUser(x);
  }

  /** Compact token formatter: 1.2B / 3.4M / 56K / 789. Shared by sankey and tooltip paths. */
  function __budgetFmtTok(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(Math.round(v));
  }

  // ── Chart renderers ────────────────────────────────────────────────────────
  function renderBudgetWaterfall(tot, quota, hostTotals) {
    __budgetSankeyState = { tot: tot, quota: quota, hostTotals: hostTotals || {} };
    __buildBudgetSwitches();
    __updateBudgetSwitchActive();

    var el = document.getElementById("c-budget-sankey");
    var h3 = document.getElementById("budget-waterfall-h3");
    if (h3) h3.textContent = t("budgetWaterfallTitle");
    var blurb = document.getElementById("budget-waterfall-blurb");
    if (!el) return;

    if (tot.total <= 0) {
      __budgetSankeyDispose();
      el.innerHTML = "<div style='text-align:center;padding:2rem;color:#A0875E'>" + t("budgetNoData") + "</div>";
      return;
    }

    var isCost = __budgetViewMode === "cost";
    var raw = { out: tot.output, inp: tot.input, cr: tot.cache_read, cc: tot.cache_creation };
    var weighted = {
      out: tot.output * __quotaWeights.output,
      inp: tot.input * __quotaWeights.input,
      cr:  tot.cache_read * __quotaWeights.cache_read,
      cc:  tot.cache_creation * __quotaWeights.cache_creation
    };
    var src = isCost ? weighted : raw;
    var totalVal = src.out + src.inp + src.cr + src.cc;

    var pctOf = function(v) { return totalVal > 0 ? Math.round(v / totalVal * 1000) / 10 : 0; };

    if (blurb) {
      blurb.textContent = isCost ? t("budgetWaterfallBlurbCost") : t("budgetWaterfallBlurb");
    }

    var nOut = t("budgetWfOutput") + " " + pctOf(src.out) + "%";
    var nInp = t("budgetWfInput") + " " + pctOf(src.inp) + "%";
    var nCr  = t("budgetWfCacheRead") + " " + pctOf(src.cr) + "%";
    var nCc  = t("budgetWfCacheCreate") + " " + pctOf(src.cc) + "%";

    var sw2 = __budgetSankeyWeights(src);
    var wOf = sw2.wOf;
    var wOut = sw2.wOut, wInp = sw2.wInp, wCr = sw2.wCr, wCc = sw2.wCc;

    var hostKeys = Object.keys(hostTotals || {}).sort(function (a, b) { return a.localeCompare(b); });

    var rows = __budgetBuildSankeyRows({
      flowMode: __budgetFlowMode,
      src: src,
      raw: raw,
      hostKeys: hostKeys,
      hostTotals: hostTotals,
      isCost: isCost,
      wOf: wOf,
      wOut: wOut, wInp: wInp, wCr: wCr, wCc: wCc,
      nOut: nOut, nInp: nInp, nCr: nCr, nCc: nCc,
      totalVal: totalVal,
      fmtTok: __budgetFmtTok
    });

    if (!rows.length) {
      __budgetSankeyDispose();
      el.innerHTML = "";
      return;
    }

    // Convert [From, To, Weight] rows to ECharts sankey nodes + links
    var nodeSet = {};
    var links = [];
    var palette = ['#A0875E', '#22c55e', '#B8915A', '#D4AF7F', '#f59e0b', '#f87171', '#D4AF7F', '#D4AF7F'];
    for (var _row of rows) {
      var from = _row[0], to = _row[1], weight = _row[2];
      if (!nodeSet[from]) nodeSet[from] = { name: from, itemStyle: { color: palette[Object.keys(nodeSet).length % palette.length] } };
      if (!nodeSet[to]) nodeSet[to] = { name: to, itemStyle: { color: palette[Object.keys(nodeSet).length % palette.length] } };
      links.push({ source: from, target: to, value: weight });
    }
    var nodes = [];
    for (var nk in nodeSet) {
      if (Object.hasOwn(nodeSet, nk)) nodes.push(nodeSet[nk]);
    }

    // ECharts Sankey
    if (!_budgetCharts.waterfall) {
      el.innerHTML = "";
      _budgetCharts.waterfall = echarts.init(el, null, { renderer: 'canvas' });
    }
    var chart = _budgetCharts.waterfall;
    var rc = Math.max(rows.length, 1);
    var winH = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800;
    var byRows = Math.max(160, Math.min(410, rc * 12));
    var byVh = Math.round(winH * 0.31);
    var h = Math.max(byRows, Math.min(430, byVh));
    el.style.width = "100%";
    el.style.height = h + "px";
    el.style.minHeight = Math.min(180, byRows) + "px";
    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        backgroundColor: 'rgba(14,17,22,0.95)',
        borderColor: '#2A2D34',
        textStyle: { color: '#F7F3EC' }
      },
      series: [{
        type: 'sankey',
        layout: 'none',
        left: "1%",
        right: "1%",
        top: "3%",
        bottom: "3%",
        emphasis: { focus: 'adjacency' },
        nodeWidth: 32,
        nodeGap: 12,
        layoutIterations: 32,
        label: { color: '#F7F3EC', fontSize: 11 },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.48 },
        data: nodes,
        links: links
      }]
    }, true);
    try {
      chart.resize();
    } catch (error) { logClientOptionalErr(error); }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        try {
          if (_budgetCharts.waterfall && typeof _budgetCharts.waterfall.resize === "function") {
            _budgetCharts.waterfall.resize();
          }
        } catch (error) { logClientOptionalErr(error); }
      });
    }
  }

  // ── Trend + Quota charts ───────────────────────────────────────────────────
  /** X-Achse Budget-Trend/Quota: ohne Jahr (MM-TT aus YYYY-MM-TT), sonst unveraendert. */
  function __budgetTrendAxisLabel(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return dateStr == null ? "" : String(dateStr);
    if (dateStr.length >= 10 && dateStr.charAt(4) === "-" && dateStr.charAt(7) === "-") return dateStr.slice(5, 10);
    return dateStr;
  }

  function __budgetTrendAxisLabelsFromDates(labels) {
    var out = [];
    for (var _lbl of labels) out.push(__budgetTrendAxisLabel(_lbl));
    return out;
  }

  function __budgetDrawTrendEfficiencyChart(el, labels, dailyTrend, t) {
    if (!el || !dailyTrend.length) return;
    if (_budgetCharts.trend) { _budgetCharts.trend.dispose(); _budgetCharts.trend = null; }
    var chart = echarts.init(el, null, { renderer: 'canvas' });
    _budgetCharts.trend = chart;
    var axisLabs = __budgetTrendAxisLabelsFromDates(labels);
    var outputPctData = dailyTrend.map(function(d) { return d.output_pct; });
    var overheadInvData = dailyTrend.map(function(d) { return d.overhead > 0 ? -Math.min(d.overhead, 100) : 0; });
    var cacheMissData = dailyTrend.map(function(d) { return d.cache_miss_rate; });
    chart.setOption({
      animation: false,
      grid: { left: 50, right: 20, top: 40, bottom: 34 },
      legend: { data: [t("budgetTrendOutputPct"), t("budgetTrendOverhead"), t("budgetTrendCacheMiss")], textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var ix = params[0].dataIndex;
          var head = dailyTrend[ix]?.date ? dailyTrend[ix].date : params[0].axisValueLabel;
          var lines = [head];
          for (var p of params) {
            var val = p.value;
            if (val == null) continue;
            var fmt = p.seriesIndex === 1 ? Math.abs(val) + 'x' : val + '%';
            lines.push(p.marker + ' ' + p.seriesName + ': ' + fmt);
          }
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: axisLabs, axisLabel: { color: '#A0875E', rotate: 45, fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
      yAxis: { type: 'value', min: -20, max: function(v) { return Math.max(50, v.max + 5); },
        axisLabel: { color: '#A0875E', formatter: function(v) { return v >= 0 ? v + '%' : Math.abs(v) + 'x'; } },
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } }
      },
      series: [
        { name: t("budgetTrendOutputPct"), type: 'line', data: outputPctData, smooth: 0.3, symbol: 'circle', symbolSize: 6,
          itemStyle: { color: 'rgba(34,197,94,0.9)' },
          lineStyle: { color: 'rgba(34,197,94,0.9)' }, itemStyle: { color: 'rgba(34,197,94,0.9)' },
          areaStyle: { color: 'rgba(34,197,94,0.15)' } },
        { name: t("budgetTrendOverhead"), type: 'line', data: overheadInvData, smooth: 0.3, symbol: 'circle', symbolSize: 6,
          itemStyle: { color: 'rgba(248,113,113,0.9)' },
          lineStyle: { color: 'rgba(248,113,113,0.9)' }, itemStyle: { color: 'rgba(248,113,113,0.9)' },
          areaStyle: { color: 'rgba(248,113,113,0.15)' } },
        { name: t("budgetTrendCacheMiss"), type: 'line', data: cacheMissData, smooth: 0.3, symbol: 'circle', symbolSize: 4,
          itemStyle: { color: 'rgba(245,158,11,0.8)' },
          lineStyle: { color: 'rgba(245,158,11,0.8)', type: 'dashed' }, itemStyle: { color: 'rgba(245,158,11,0.8)' } }
      ]
    });
  }

  function __budgetQuotaTrendDatasets(dailyTrend, t) {
    var quota5hData = dailyTrend.map(function(d) { return d.quota_5h; });
    var quota7dData = dailyTrend.map(function(d) { return d.quota_7d; });
    var fallbackData = dailyTrend.map(function(d) { return d.fallback_pct; });
    var hasQuota = quota5hData.some(function(v) { return v !== null && v !== undefined; });
    var hasFallback = fallbackData.some(function(v) { return v !== null && v !== undefined; });
    var qDatasets = [];
    if (hasQuota) {
      qDatasets.push(
        {
          label: t("budgetTrendQuota5h"),
          data: quota5hData,
          borderColor: "rgba(212,175,127,0.9)",
          backgroundColor: "rgba(212,175,127,0.1)",
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointStyle: "rectRounded",
          borderWidth: 2,
          spanGaps: true
        },
        {
          label: t("budgetTrendQuota7d"),
          data: quota7dData,
          borderColor: "rgba(219,39,180,0.8)",
          backgroundColor: "transparent",
          tension: 0.3,
          fill: false,
          borderDash: [6, 3],
          pointRadius: 3,
          pointStyle: "triangle",
          borderWidth: 2,
          spanGaps: true
        }
      );
    }
    if (hasFallback) {
      qDatasets.push({
        label: t("budgetTrendFallback"),
        data: fallbackData,
        borderColor: "rgba(239,68,68,1)",
        backgroundColor: "rgba(239,68,68,0.12)",
        tension: 0,
        fill: true,
        pointRadius: 5,
        pointStyle: "star",
        borderWidth: 3,
        spanGaps: true
      });
    }
    return qDatasets;
  }

  function __budgetDrawQuotaUsageChart(el2, labels, qDatasets) {
    if (!el2 || !labels.length) return;
    if (!qDatasets.length) {
      el2.parentElement.style.display = "";
      el2.style.display = "none";
      var placeholder = el2.parentElement.querySelector(".chart-no-data");
      if (!placeholder) {
        placeholder = document.createElement("div");
        placeholder.className = "chart-no-data";
        placeholder.style.cssText = "display:flex;align-items:center;justify-content:center;height:200px;color:#8C6A3F;font-size:0.95rem;text-align:center";
        placeholder.textContent = t("budgetQuotaNoData") || "Quota data requires proxy mode — no API header data available.";
        el2.parentElement.appendChild(placeholder);
      }
      placeholder.style.display = "flex";
      return;
    }
    el2.parentElement.style.display = "";
    el2.style.display = "";
    var oldPlaceholder = el2.parentElement.querySelector(".chart-no-data");
    if (oldPlaceholder) oldPlaceholder.style.display = "none";
    if (_budgetCharts.quota) { _budgetCharts.quota.dispose(); _budgetCharts.quota = null; }
    var chart = echarts.init(el2, null, { renderer: 'canvas' });
    _budgetCharts.quota = chart;
    var series = [];
    var legendNames = [];
    for (var ds of qDatasets) {
      legendNames.push(ds.label);
      var s = {
        name: ds.label,
        type: 'line',
        data: ds.data,
        smooth: 0.3,
        symbol: ds.pointStyle === 'triangle' ? 'triangle' : ds.pointStyle === 'star' ? 'diamond' : 'roundRect',
        symbolSize: (ds.pointRadius || 3) * 2,
        lineStyle: { color: ds.borderColor, width: ds.borderWidth || 2 },
        itemStyle: { color: ds.borderColor },
        connectNulls: ds.spanGaps || false
      };
      if (ds.borderDash) s.lineStyle.type = 'dashed';
      if (ds.fill && ds.backgroundColor !== 'transparent') {
        s.areaStyle = { color: ds.backgroundColor };
      }
      series.push(s);
    }
    var axisLabsQ = __budgetTrendAxisLabelsFromDates(labels);
    chart.setOption({
      animation: false,
      grid: { left: 50, right: 20, top: 40, bottom: 34 },
      legend: { data: legendNames, textStyle: { color: '#EFE7D6' }, top: 4 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function(params) {
          var ixq = params[0].dataIndex;
          var headQ = (ixq >= 0 && ixq < labels.length && labels[ixq]) ? labels[ixq] : params[0].axisValueLabel;
          var lines = [headQ];
          for (var _pm of params) {
            if (_pm.value == null) continue;
            lines.push(_pm.marker + ' ' + _pm.seriesName + ': ' + _pm.value + '%');
          }
          return lines.join('<br>');
        }
      },
      xAxis: { type: 'category', data: axisLabsQ, axisLabel: { color: '#A0875E', rotate: 45, fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
      yAxis: { type: 'value', min: 0, max: 100,
        axisLabel: { color: '#D4AF7F', formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } }
      },
      series: series
    });
  }

  // renderBudgetTrend: kept as backward-compat wrapper (called from __budgetSwitchesWired flow)
  function renderBudgetTrend(dailyTrend) {
    var labels = dailyTrend.map(function(d) { return d.date; });
    __budgetDrawTrendEfficiencyChart(document.getElementById("c-budget-trend"), labels, dailyTrend, t);
    var el2 = document.getElementById("c-budget-quota");
    if (el2 && dailyTrend.length) {
      __budgetDrawQuotaUsageChart(el2, labels, __budgetQuotaTrendDatasets(dailyTrend, t));
    }
  }

  // ── Main entry point ───────────────────────────────────────────────────────
  function renderBudgetEfficiency(data) {
    var sumEl = document.getElementById("budget-summary-line");
    var cardsEl = document.getElementById("budget-cards");
    if (!sumEl) return;

    var days = getFilteredDays(data.days);
    if (!days?.length) {
      __budgetHandleEmpty(sumEl, cardsEl);
      return;
    }

    var sCtx = _computeBudgetCtx(data);

    __budgetFillSummary(sumEl, sCtx.tot, sCtx.m);

    if (cardsEl) {
      cardsEl.innerHTML = __budgetKpiCardsHtml(sCtx.days, sCtx.tot, sCtx.m.outputPct, sCtx.m.overheadFactor, sCtx.m.cacheMissRate, sCtx.m.lostSignals);
    }

    __budgetRenderFuel(document.getElementById("budget-fuel"), sCtx.tot, sCtx.quota);
    __budgetRenderAlert(document.getElementById("budget-alert"), sCtx.quota);

    // Render charts via standalone functions
    window.renderBudget_sankey(sCtx);
    window.renderBudget_trend(sCtx);
    window.renderBudget_quota(sCtx);
  }

  // ── Widget dispatcher shims ────────────────────────────────────────────────
  /** Standalone: render Budget Sankey chart. */
  window.renderBudget_sankey = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('budget');
    if (!sCtx) return;
    renderBudgetWaterfall(sCtx.tot, sCtx.quota, sCtx.filteredHost ? {} : sCtx.hostTotals);
  };

  /** Standalone: render Budget Trend chart. */
  window.renderBudget_trend = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('budget');
    if (!sCtx) return;
    var el = document.getElementById("c-budget-trend");
    var h3 = document.getElementById("budget-trend-h3");
    if (h3) h3.textContent = t("budgetTrendTitle");
    var blurb = document.getElementById("budget-trend-blurb");
    if (blurb) blurb.textContent = t("budgetTrendBlurb");
    __budgetDrawTrendEfficiencyChart(el, sCtx.dailyTrend.map(function(d) { return d.date; }), sCtx.dailyTrend, t);
  };

  /** Standalone: render Budget Quota Usage chart. */
  window.renderBudget_quota = function (sCtx) {
    sCtx = sCtx || window.__dashboardState.getSectionCtx('budget');
    if (!sCtx) return;
    var labels = sCtx.dailyTrend.map(function(d) { return d.date; });
    var el2 = document.getElementById("c-budget-quota");
    var h32 = document.getElementById("budget-quota-h3");
    if (h32) h32.textContent = t("budgetQuotaTitle");
    var blurb2 = document.getElementById("budget-quota-blurb");
    if (blurb2) blurb2.textContent = t("budgetQuotaBlurb");
    if (el2 && sCtx.dailyTrend.length) {
      __budgetDrawQuotaUsageChart(el2, labels, __budgetQuotaTrendDatasets(sCtx.dailyTrend, t));
    }
  };

  // ── Register on window ─────────────────────────────────────────────────────
  window.renderBudgetEfficiency = renderBudgetEfficiency;
  window.__budgetResizeAll = __budgetResizeAll;
  window._computeBudgetCtx = _computeBudgetCtx;

})();
