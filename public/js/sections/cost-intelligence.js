/**
 * @asseris-module       Cost Intelligence
 * @asseris-description  Auto-annotated module metadata for public/js/sections/cost-intelligence.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
(function () {
  'use strict';

  /**
   * sections/cost-intelligence.js — Cost Forensic section.
   *
   * Implements the ASSERIS Cost Forensic spec (Edition 1 / Detection):
   *   Hero-Strip, Vendor-Reconciliation (placeholder), Counter-Factual,
   *   Top-5 Sessions by Overhead Tax, Token-Decomposition.
   *
   * Layout follows cost-forensic-mockup.html; colors/fonts from brand-tokens.css.
   *
   * Concept lineage:
   *   Subscription cost-multiplier M(t): first published as M_real in
   *   ASSERIS-ASI/claude-usage-dashboard (2026-04-13), extended as
   *   computeSessionMt (2026-04-30). Session-based quadratic model.
   *   Overhead-Tax framing (Counter-Factual section): fgrosswig, 2026-04-13.
   *
   * Dependencies (via window / globals):
   *   escHtml, t, getProxyDay
   *   getSelectedPlan
   */

  // ── Constants ─────────────────────────────────────────────────────────────

  var BADGE_CATALOG = [
    { key: 'split',       i18n: 'cfBadgeSplit',      color: '#fff',    bg: '#E24B4A', test: function (s) { return s.split_recommended; } },
    { key: 'phantom',     i18n: 'cfBadgePhantom',    color: '#fff',    bg: '#7C3AED', test: function (s) { return s.is_phantom_rebuild; } },
    { key: 'long',        i18n: 'cfBadgeLong',       color: '#fff',    bg: '#f59e0b', test: function (s) { return s.t_now_h > 10; } },
    { key: 'compaction',  i18n: 'cfBadgeCompaction',  color: '#fff',    bg: '#f59e0b', test: function (s) { return (s.compaction_count || 0) > 5; } },
    { key: 'density',     i18n: 'cfBadgeDensity',    color: '#fff',    bg: '#f59e0b', test: function (s) { return s.points_count / Math.max(s.t_now_h, 0.1) > 100; } },
    { key: 'efficient',   i18n: 'cfBadgeEfficient',  color: '#fff',    bg: '#22c55e', test: function (s) { return s.mt <= 1.05 && s.t_now_h >= 4; } }
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  var __lastCfFingerprint = '';
  var __cfFeverChart = null;
  var __cfFeverMode = 'live';
  var __cfFeverDate = '';
  var __cfFeverControlsWired = false;
  var __cfFeverLastData = null;
  var __cfFeverResizeObserver = null;
  var __cfFeverResizeFrame = 0;
  var __cfJsonlMtByDate = {};
  var __cfJsonlMtPending = {};

  function cfBindFeverToHost(el) {
    if (!el || typeof ResizeObserver === 'undefined') return;
    if (__cfFeverResizeObserver) __cfFeverResizeObserver.disconnect();
    __cfFeverResizeObserver = new ResizeObserver(function () {
      if (!__cfFeverChart || !el.isConnected) return;
      if (__cfFeverResizeFrame) cancelAnimationFrame(__cfFeverResizeFrame);
      __cfFeverResizeFrame = requestAnimationFrame(function () {
        __cfFeverResizeFrame = 0;
        if (!__cfFeverChart || !el.clientWidth || !el.clientHeight) return;
        try {
          __cfFeverChart.dispatchAction({ type: 'hideTip' });
          __cfFeverChart.resize({ width: el.clientWidth, height: el.clientHeight });
        } catch (error) {
          if (typeof window.logClientOptionalErr === 'function') window.logClientOptionalErr(error);
        }
      });
    });
    __cfFeverResizeObserver.observe(el);
  }

  // ── Section registration ──────────────────────────────────────────────────
  window.__sections = window.__sections || {};
  window.__sections['cost-intelligence'] = {
    id: 'cost-intelligence',
    surface: 'cost-intelligence',
    domId: 'cost-intelligence-collapse',
    capabilityGated: true,
    render: function (data) {
      renderCostForensic(data);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function cfResetCountdown(epochSec) {
    if (!epochSec) return { text: '\u2014', sec: 0 };
    var diff = epochSec - Math.floor(Date.now() / 1000);
    if (diff <= 0) return { text: 'reset!', sec: 0 };
    var d = Math.floor(diff / 86400);
    var h = Math.floor((diff % 86400) / 3600);
    var m = Math.floor((diff % 3600) / 60);
    if (d > 0) return { text: d + 'd ' + h + 'h ' + m + 'm', sec: diff };
    if (h > 0) return { text: h + 'h ' + m + 'm', sec: diff };
    return { text: m + 'm', sec: diff };
  }

  function cfMtColor(mt) {
    if (mt >= 2.0) return '#ef4444';
    if (mt >= 1.10) return '#EF9F27';
    return '#22c55e';
  }

  function cfFmtUsd(v) {
    return '$' + v.toFixed(2);
  }

  function cfResetDayTime(epochSec) {
    if (!epochSec) return '\u2014';
    var dt = new Date(epochSec * 1000);
    var days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    var hh = String(dt.getHours()).padStart(2, '0');
    var mm = String(dt.getMinutes()).padStart(2, '0');
    return days[dt.getDay()] + ' \u00b7 ' + hh + ':' + mm;
  }

  function cfPeriodMt(sessions) {
    var sumCostMt = 0;
    var sumCost = 0;
    for (var i = 0; i < sessions.length; i++) {
      var cost = sessions[i].real_cost_daily || 0;
      sumCostMt += cost * (sessions[i].mt || 1);
      sumCost += cost;
    }
    return sumCost > 0 ? sumCostMt / sumCost : 1.0;
  }

  function cfAttributeOverhead(session) {
    var vendorFactor =
      (session.compaction_count || 0) * 0.4 +
      (session.spoofing_count || 0) * 0.3 +
      (session.cache_drain_count || 0) * 0.3;
    var practiceFactor =
      Math.max(0, (session.t_now_h || 0) - 4) * 0.05 +
      Math.max(0, (session.points_count || 0) / Math.max(session.t_now_h || 1, 0.1) - 50) * 0.001 +
      (session.split_recommended ? 0.2 : 0);
    var total = vendorFactor + practiceFactor;
    if (total === 0) return { vendor: 0.5, practice: 0.5 };
    return { vendor: vendorFactor / total, practice: practiceFactor / total };
  }

  function cfCounterFactual(realCost, mt) {
    if (!mt || mt < 1.0) return { costAtM1: realCost, overheadTax: 0, mt: mt || 1 };
    var costAtM1 = realCost / mt;
    return { costAtM1: costAtM1, overheadTax: realCost - costAtM1, mt: mt };
  }

  function cfGetPlan(dateStr, proxyDaysMap) {
    var planPrices = { max5: 100, max20: 200, pro: 20, free: 0, api: 0 };
    var planLabels = { max5: 'MAX 5', max20: 'MAX 20', pro: 'Pro', free: 'Free', api: 'API' };
    var monthly;
    if (dateStr && typeof window.getPlanPriceForDate === 'function') {
      monthly = window.getPlanPriceForDate(dateStr, proxyDaysMap);
    } else {
      var selected = (typeof window.getSelectedPlan === 'function') ? window.getSelectedPlan() : 'max5';
      monthly = planPrices[selected] || 100;
    }
    var selected = (typeof window.getSelectedPlan === 'function') ? window.getSelectedPlan() : 'max5';
    var key = Object.keys(planPrices).find(function(k) { return planPrices[k] === monthly; }) || selected;
    return {
      key: key,
      label: planLabels[key] || 'MAX 5',
      monthly: monthly,
      daily: +(monthly / 30).toFixed(2)
    };
  }

  function cfPill(label, value, color) {
    return '<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--asseris-dark-bg);border:1px solid var(--asseris-dark-border);border-radius:12px;font-size:.72rem">' +
      '<span style="color:#6B7280">' + escHtml(label) + ':</span>' +
      '<span style="color:' + color + ';font-weight:600;font-family:var(--asseris-font-mono)">' + escHtml(value) + '</span>' +
      '</div>';
  }

  function cfFitQuadratic(xs, ys) {
    var n = xs.length;
    if (n < 5) return null;
    var s1 = n, s2 = 0, s3 = 0, s4 = 0, s5 = 0;
    var t1 = 0, t2 = 0, t3 = 0;
    for (var i = 0; i < n; i++) {
      var x = xs[i], y = ys[i], x2 = x * x;
      s2 += x; s3 += x2; s4 += x2 * x; s5 += x2 * x2;
      t1 += y; t2 += x * y; t3 += x2 * y;
    }
    var matrix = [[s5, s4, s3, t3], [s4, s3, s2, t2], [s3, s2, s1, t1]];
    for (var col = 0; col < 3; col++) {
      var maxRow = col;
      for (var row = col + 1; row < 3; row++) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[maxRow][col])) maxRow = row;
      }
      var swap = matrix[col]; matrix[col] = matrix[maxRow]; matrix[maxRow] = swap;
      if (Math.abs(matrix[col][col]) < 1e-12) return null;
      for (var rr = col + 1; rr < 3; rr++) {
        var factor = matrix[rr][col] / matrix[col][col];
        for (var cc = col; cc <= 3; cc++) matrix[rr][cc] -= factor * matrix[col][cc];
      }
    }
    var a = matrix[2][3] / matrix[2][2];
    var b = (matrix[1][3] - matrix[1][2] * a) / matrix[1][1];
    var c = (matrix[0][3] - matrix[0][2] * a - matrix[0][1] * b) / matrix[0][0];
    return [a, b, c];
  }

  function cfTurnCost(turn) {
    var family = String(turn.model || '').toLowerCase();
    var price = family.includes('fable') ? [10, 50, 1, 12.5] :
      family.includes('sonnet') ? [3, 15, 0.3, 3.75] :
      family.includes('haiku') ? [1, 5, 0.1, 1.25] : [5, 25, 0.5, 6.25];
    return ((turn.input || 0) * price[0] + (turn.output || 0) * price[1] +
      (turn.cache_read || 0) * price[2] + (turn.cache_creation || 0) * price[3]) / 1000000;
  }

  function cfMtFromJsonlSession(session) {
    var turns = (session.turns || []).filter(function (turn) {
      return Number.isFinite(Date.parse(turn.ts)) && ((turn.cache_read || 0) + (turn.cache_creation || 0)) > 0;
    });
    if (turns.length < 5) return null;
    turns.sort(function (a, b) { return Date.parse(a.ts) - Date.parse(b.ts); });
    var t0 = Date.parse(turns[0].ts);
    var xs = turns.map(function (turn) { return (Date.parse(turn.ts) - t0) / 3600000; });
    var ys = turns.map(function (turn) { return (turn.cache_read || 0) + (turn.cache_creation || 0); });
    var fit = cfFitQuadratic(xs, ys);
    if (!fit) return null;
    var fitted = xs.map(function (x) { return fit[0] * x * x + fit[1] * x + fit[2]; });
    var avg = fitted.reduce(function (sum, value) { return sum + value; }, 0) / fitted.length;
    var mt = avg > 0 ? Math.max(1, fitted.at(-1) / avg) : 1;
    var modelCounts = {};
    var cost = 0;
    for (var turn of turns) {
      modelCounts[turn.model || 'unknown'] = (modelCounts[turn.model || 'unknown'] || 0) + 1;
      cost += cfTurnCost(turn);
    }
    var model = Object.keys(modelCounts).sort(function (a, b) { return modelCounts[b] - modelCounts[a]; })[0] || 'unknown';
    return {
      sid: session.session_id_hash || 'unknown',
      model: model,
      source: 'JSONL',
      points_count: turns.length,
      t_now_h: Math.round(xs.at(-1) * 10) / 10,
      mt: Math.round(mt * 100) / 100,
      actual_cost_usd: cost,
      real_cost_daily: cost,
      overpayment_daily: null,
      split_recommended: mt > 1.8,
      is_phantom_rebuild: false
    };
  }

  var __cfJsonlMtAttempts = {};
  var CF_JSONL_MT_RETRIES = 3;

  /**
   * Session turns are cached server-side and built on first request, so the
   * first call for a date can legitimately come back empty and be answered in
   * full moments later. Recording that empty answer as final meant the lanes
   * stayed blank for the rest of the page even though the data had arrived —
   * an empty result is therefore retried a few times before it counts.
   */
  function cfLoadJsonlMtSessions(date, data) {
    if (!date || __cfJsonlMtPending[date]) return;
    var settled = Object.hasOwn(__cfJsonlMtByDate, date);
    var attempts = __cfJsonlMtAttempts[date] || 0;
    if (settled && (__cfJsonlMtByDate[date].length || attempts >= CF_JSONL_MT_RETRIES)) return;
    __cfJsonlMtAttempts[date] = attempts + 1;
    __cfJsonlMtPending[date] = true;
    fetch('/api/session-turns?date=' + encodeURIComponent(date))
      .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error('session-turns ' + response.status)); })
      .then(function (body) {
        __cfJsonlMtByDate[date] = (body.sessions || []).map(cfMtFromJsonlSession).filter(Boolean);
        __lastCfFingerprint = '';
        renderCostForensic(data);
      })
      .catch(function (error) {
        __cfJsonlMtByDate[date] = [];
        if (typeof logClientOptionalErr === 'function') logClientOptionalErr(error);
      })
      .finally(function () { delete __cfJsonlMtPending[date]; });
  }

  var __cfHadProxyDay = false;

  // ── Main render ───────────────────────────────────────────────────────────

  function renderCostForensic(data) {
    var heroEl = document.getElementById('cf-hero-strip');
    if (!heroEl) return;

    var pd = getProxyDay(data);
    if (!pd) {
      // A payload can arrive without proxy days while a parse is still running.
      // Blanking figures that were correct a moment ago turns a transient into
      // something that looks like lost data, so what was shown stays until
      // there is something to replace it with.
      if (!__cfHadProxyDay) {
        setText('cf-hero-spent-value', '\u2014');
        setText('cf-hero-delta-value', '\u2014');
        setText('cf-hero-forecast-value', '\u2014');
      }
      __lastCfFingerprint = '';
      return;
    }
    __cfHadProxyDay = true;

    var fp = (data.proxy?.generated || '') + '|' + (pd.gateway_burn_rate?.current_q7 || 0) + '|' +
      (data.proxy?.proxy_days || []).map(function (d) { return d.date; }).join(',') + '|' +
      (window.__dashboardState?.getFilterProvider?.() || 'all') + '|' +
      (window.__dashboardState?.getFilterAccount?.() || 'all') + '|' +
      (window.__dashboardState?.getFilterHost?.() || '');
    if (fp && fp === __lastCfFingerprint) return;
    __lastCfFingerprint = fp;

    var mt_sessions = pd.gateway_mt_sessions || [];
    if (!mt_sessions.length && __cfJsonlMtByDate[pd.date]?.length) mt_sessions = __cfJsonlMtByDate[pd.date];
    if (!mt_sessions.length) cfLoadJsonlMtSessions(pd.date, data);
    var requestOnly = pd.gateway_cost_fever?.request_only === true && !mt_sessions.length;
    var gwReset = pd.gateway_reset || {};
    var proxyDaysArr = data.proxy?.proxy_days || [];
    var proxyDaysMap = {};
    for (var i = 0; i < proxyDaysArr.length; i++) {
      if (proxyDaysArr[i].date) proxyDaysMap[proxyDaysArr[i].date] = proxyDaysArr[i];
    }
    var plan = cfGetPlan(pd.date, proxyDaysMap);

    // Aggregates
    var totalOverpay = 0;
    var totalRealCost = pd.gateway_cost_fever?.total_cost_usd || pd.estimated_cost?.total || 0;
    for (var i = 0; i < mt_sessions.length; i++) {
      // M(t) intentionally remains a context-growth index. It no longer
      // creates synthetic dollars or an inferred "overpayment".
      totalOverpay += 0;
    }
    var periodMt = cfPeriodMt(mt_sessions);
    var cf = cfCounterFactual(totalRealCost, periodMt);

    // i18n titles
    setText('cf-hero-spent-label', t('cfHeroSpentToday'));
    setText('cf-hero-delta-label', t('cfHeroOverpayment'));
    setText('cf-hero-forecast-label', t('cfHeroForecastReset'));
    setText('cf-recon-title', 'Vendor-Reconciliation \u2014 ausgew\u00e4hlter Tag');
    setText('cf-counter-title', t('cfCounterTitle'));
    setText('cf-cost-fever-title', 'Cost Fever \u2014 Session Concurrency & M(t)');
    setText('cf-top5-title', 'Top 5 Sessions nach Listenkosten');
    setText('cf-decomp-title', 'Token-Decomposition \u00b7 ausgew\u00e4hlter Tag');

    // Render sections
    renderCF_heroStrip(plan, totalRealCost, totalOverpay, periodMt, gwReset, mt_sessions, pd, requestOnly);
    renderCF_reconciliation(plan, totalRealCost, mt_sessions, pd, requestOnly);
    renderCF_counterFactual(cf, totalOverpay, periodMt, mt_sessions, plan, totalRealCost, requestOnly);
    renderCF_costFever(data);
    renderCF_top5Sessions(mt_sessions, plan);
    renderCF_tokenDecomposition(pd);
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── Hero-Strip ────────────────────────────────────────────────────────────

  function renderCF_heroStrip(plan, totalRealCost, totalOverpay, periodMt, gwReset, sessions, proxyDay, requestOnly) {
    var effectiveCost = totalRealCost || 0;
    var callCount = 0;
    for (var i = 0; i < sessions.length; i++) {
      callCount += sessions[i].points_count || 0;
    }
    if (!callCount) callCount = proxyDay?.requests || proxyDay?.gateway_cost_fever?.request_count || 0;

    // Cell 1: Spent today
    setText('cf-hero-spent-value', cfFmtUsd(effectiveCost));
    setText('cf-hero-spent-meta', callCount + ' ' + t('cfHeroCalls') + ' \u00b7 ' +
      (requestOnly ? 'Cache-Fix request telemetry' : sessions.length + ' ' + t('cfHeroSessions')) + ' \u00b7 ' + plan.label);

    // Cell 2: Overpayment / Delta
    var deltaCell = document.getElementById('cf-hero-delta');
    if (deltaCell) {
      deltaCell.className = 'cf-hero-cell' + (totalOverpay >= 0.5 ? ' warn' : '');
    }
    setText('cf-hero-delta-label', requestOnly ? 'Session Forensics' : 'Context Growth');
    setText('cf-hero-delta-value', requestOnly ? '\u2014' : 'M(t) ' + periodMt.toFixed(2) + '\u00d7');
    setText('cf-hero-delta-meta', requestOnly ? 'requires Claude session JSONL' : 'quadratic fit \u00b7 independent of cost');

    // Cell 3: Forecast reset
    var r7d = cfResetCountdown(gwReset.ts_7d);
    var resetLabel = cfResetDayTime(gwReset.ts_7d);
    var forecastCell = document.getElementById('cf-hero-forecast');
    if (forecastCell) {
      forecastCell.className = 'cf-hero-cell' + (r7d.sec > 0 && r7d.sec < 86400 ? ' danger' : '');
    }
    setText('cf-hero-forecast-value', resetLabel);
    setText('cf-hero-forecast-meta', t('cfHeroProjection') + ': ' + r7d.text);
  }

  // ── Vendor-Reconciliation (Placeholder) ───────────────────────────────────

  function renderCF_reconciliation(plan, totalRealCost, sessions, proxyDay, requestOnly) {
    var host = document.getElementById('cf-reconciliation');
    if (!host) return;

    var internalAccounted = totalRealCost || plan.daily;

    host.innerHTML =
      '<div style="font-size:.72rem;color:#6B7280;margin-bottom:14px">' +
        escHtml(t('cfReconVendorSyncPending').replace('{count}', sessions.length)) +
      '</div>' +
      // 3-column grid with dotted separator
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;align-items:start">' +
      // Vendor billed
      '<div style="padding-right:20px">' +
        '<div style="font-family:var(--asseris-font-serif);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;margin-bottom:6px">' + escHtml(t('cfReconVendorBilled')) + '</div>' +
        '<div style="font-family:var(--asseris-font-mono);font-size:38px;font-weight:700;color:#6B7280;line-height:1">\u2014</div>' +
        '<div style="font-size:.68rem;color:#6B7280;margin-top:4px">' + escHtml(t('cfReconVendorNotConnected')) + '</div>' +
      '</div>' +
      // Internal accounted
      '<div style="border-left:1px dotted var(--asseris-dark-border);border-right:1px dotted var(--asseris-dark-border);padding:0 20px">' +
        '<div style="font-family:var(--asseris-font-serif);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;margin-bottom:6px">' + escHtml(t('cfReconInternalAccounted')) + '</div>' +
        '<div style="font-family:var(--asseris-font-mono);font-size:38px;font-weight:700;color:var(--asseris-paper);line-height:1">' + cfFmtUsd(internalAccounted) + '</div>' +
        '<div style="font-size:.68rem;color:#6B7280;margin-top:4px">' +
          (requestOnly
            ? (proxyDay?.requests || 0) + ' Requests \u00b7 ' +
              ((proxyDay?.data_sources?.['claude-code-meter'] || 0) > 0
                ? 'Claude Meter claude-meter.jsonl'
                : 'Cache-Fix usage.jsonl')
            : sessions.length + ' Sessions \u00b7 L1 NDJSON') +
        '</div>' +
      '</div>' +
      // Delta
      '<div style="padding-left:20px">' +
        '<div style="font-family:var(--asseris-font-serif);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;margin-bottom:6px">' + escHtml(t('cfReconDelta')) + '</div>' +
        '<div style="font-family:var(--asseris-font-mono);font-size:38px;font-weight:700;color:#6B7280;line-height:1">\u2014</div>' +
        '<div style="font-size:.68rem;color:#6B7280;margin-top:4px">' + escHtml(t('cfReconPending')) + '</div>' +
      '</div>' +
      '</div>' +
      // Scale bar
      '<div style="height:6px;background:var(--asseris-dark-bg);border-radius:3px;overflow:hidden;margin-top:16px">' +
        '<div style="height:100%;width:100%;background:#22c55e;border-radius:3px"></div>' +
      '</div>' +
      '<div style="font-size:.66rem;color:#6B7280;margin-top:8px;font-style:italic">' +
        escHtml(t('cfReconL3Note')) +
      '</div>';
  }

  // ── Counter-Factual ───────────────────────────────────────────────────────

  function renderCF_counterFactual(cf, totalOverpay, periodMt, sessions, plan, totalRealCost, requestOnly) {
    var host = document.getElementById('cf-counterfactual');
    if (!host) return;
    var actual = totalRealCost || 0;
    host.innerHTML =
      '<div style="font-size:.95rem;color:var(--asseris-paper);margin-bottom:8px">' +
        'List-price estimate from logged usage: <span style="font-family:var(--asseris-font-mono);font-weight:700;color:#22c55e">' + cfFmtUsd(actual) + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        cfPill('Context growth M(t)', requestOnly ? '\u2014' : periodMt.toFixed(2) + '\u00d7', requestOnly ? '#6B7280' : cfMtColor(periodMt)) +
        cfPill('Sessions with fit', String(sessions.length), '#D4AF7F') +
        cfPill('Counter-factual delta', '\u2014', '#6B7280') +
      '</div>' +
      '<div style="font-size:.7rem;color:#6B7280;line-height:1.5">' +
        (requestOnly
          ? '<strong style="color:var(--asseris-gold-soft)">Cache-Fix mode:</strong> list cost and token classes are measured per request. M(t), compactions, phantom resume and session lanes require matching Claude session JSONL.'
          : '<strong style="color:var(--asseris-gold-soft)">M(t)</strong> is the quadratic context-growth fit over session lifetime. It is retained as a diagnostic signal and is not multiplied by the subscription day price. A monetary counter-factual remains unavailable until an observed baseline or vendor reconciliation exists.') +
      '</div>';
  }

  // ── Cost Fever: real usage cost + aligned M(t) session lanes ─────────────

  function cfModelColor(model) {
    var m = String(model || '').toLowerCase();
    if (m.includes('fable') || m.includes('mythos')) return modelFamilyColor('fable');
    if (m.includes('opus')) return modelFamilyColor('opus');
    if (m.includes('sonnet')) return modelFamilyColor('sonnet');
    if (m.includes('haiku')) return modelFamilyColor('haiku');
    return '#8C6A3F';
  }

  function cfShortModel(model) {
    return String(model || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '');
  }

  function cfWireFeverControls(data) {
    __cfFeverLastData = data;
    var days = (data.proxy?.proxy_days || []).filter(function (d) {
      return d.gateway_cost_fever && d.gateway_cost_fever.timeline && d.gateway_cost_fever.timeline.length;
    });
    var latest = days.length ? days[days.length - 1] : null;
    if (!__cfFeverDate && latest) __cfFeverDate = latest.date;
    var select = document.getElementById('cf-fever-date');
    if (select) {
      var wanted = __cfFeverDate;
      select.innerHTML = days.slice().reverse().map(function (d) {
        return '<option value="' + escHtml(d.date) + '">' + escHtml(d.date) + '</option>';
      }).join('');
      if (wanted) select.value = wanted;
      select.style.display = __cfFeverMode === 'history' ? 'block' : 'none';
    }
    var liveBtn = document.getElementById('cf-fever-live');
    var histBtn = document.getElementById('cf-fever-history');
    if (liveBtn) liveBtn.classList.toggle('active', __cfFeverMode === 'live');
    if (histBtn) histBtn.classList.toggle('active', __cfFeverMode === 'history');
    if (__cfFeverControlsWired) return;
    __cfFeverControlsWired = true;
    if (liveBtn) liveBtn.addEventListener('click', function () {
      __cfFeverMode = 'live';
      if (__cfFeverLastData) renderCF_costFever(__cfFeverLastData);
    });
    if (histBtn) histBtn.addEventListener('click', function () {
      __cfFeverMode = 'history';
      if (__cfFeverLastData) renderCF_costFever(__cfFeverLastData);
    });
    if (select) select.addEventListener('change', function () {
      __cfFeverDate = select.value;
      if (__cfFeverLastData) renderCF_costFever(__cfFeverLastData);
    });
  }

  function cfFeverKpis(fever, sessions, proxyDay) {
    var host = document.getElementById('cf-cost-fever-kpis');
    if (!host) return;
    var peakBurn = 0;
    for (var p of fever.timeline || []) peakBurn = Math.max(peakBurn, p.burn_usd_h || 0);
    var weightedMtCost = 0;
    var mtCost = 0;
    for (var s of sessions) {
      if (s.mt == null) continue;
      weightedMtCost += s.mt * (s.cost_usd || 0);
      mtCost += s.cost_usd || 0;
    }
    var mt = mtCost > 0 ? weightedMtCost / mtCost : 1;
    var maxConcurrent = 0;
    var events = [];
    for (var row of sessions) {
      events.push([Date.parse(row.started_at), 1]);
      events.push([Date.parse(row.ended_at), -1]);
    }
    events.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var active = 0;
    for (var ev of events) { active += ev[1]; maxConcurrent = Math.max(maxConcurrent, active); }
    var quotaSamples = (proxyDay?.gateway_quota_timeline || []).filter(function (s) {
      return s && Number.isFinite(Number(s.q5)) && s.ts;
    }).sort(function (a, b) { return Date.parse(a.ts) - Date.parse(b.ts); });
    var latestQuota = quotaSamples.length ? quotaSamples[quotaSamples.length - 1] : null;
    var q5 = latestQuota ? Number(latestQuota.q5) : null;
    var q5DayMax = quotaSamples.reduce(function (max, s) {
      return Math.max(max, Number(s.q5) || 0);
    }, 0);
    var quotaTime = latestQuota
      ? new Date(latestQuota.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '\u2014';
    var q5Color = q5 == null ? '#6B7280' : q5 >= 0.8 ? '#ef4444' : q5 >= 0.5 ? '#EF9F27' : '#22c55e';
    var cells = [
      [
        __cfFeverMode === 'live' ? 'Q5 aktuell \u00b7 ' + quotaTime : 'Q5 letzter Wert \u00b7 ' + quotaTime,
        q5 == null ? '\u2014' : Math.round(q5 * 100) + '% \u00b7 max ' + Math.round(q5DayMax * 100) + '%',
        q5Color
      ],
      ['List cost', cfFmtUsd(fever.total_cost_usd || 0)],
      ['Peak burn', cfFmtUsd(peakBurn) + '/h'],
      ['Sessions', String(fever.total_sessions || sessions.length)],
      ['Max concurrent', String(maxConcurrent)],
      ['Cost-weighted M(t)', mt.toFixed(2) + '\u00d7']
    ];
    host.innerHTML = cells.map(function (c) {
      return '<div class="cf-fever-kpi"><div class="cf-fever-kpi-label">' + escHtml(c[0]) +
        '</div><div class="cf-fever-kpi-value"' + (c[2] ? ' style="color:' + c[2] + '"' : '') + '>' + escHtml(c[1]) + '</div></div>';
    }).join('');
  }

  function cfFeverRenderSession(params, api) {
    var category = api.value(2);
    var start = api.coord([api.value(0), category]);
    var end = api.coord([api.value(1), category]);
    var height = Math.max(8, api.size([0, 1])[1] * 0.56);
    var shape = window.echarts.graphic.clipRectByRect({
      x: start[0],
      y: start[1] - height / 2,
      width: Math.max(2, end[0] - start[0]),
      height: height
    }, {
      x: params.coordSys.x,
      y: params.coordSys.y,
      width: params.coordSys.width,
      height: params.coordSys.height
    });
    if (!shape) return null;
    return {
      type: 'group',
      children: [
        {
          type: 'rect',
          shape: shape,
          style: api.style({ fill: api.value(3), opacity: 0.82, stroke: '#0E1116', lineWidth: 1 })
        },
        {
          type: 'line',
          shape: { x1: shape.x, y1: shape.y - 6, x2: shape.x, y2: shape.y + shape.height + 6 },
          style: { stroke: '#F7F3EC', opacity: 1, lineWidth: 2.5 }
        },
        {
          type: 'line',
          shape: { x1: shape.x + shape.width, y1: shape.y - 6, x2: shape.x + shape.width, y2: shape.y + shape.height + 6 },
          style: { stroke: '#F7F3EC', opacity: 1, lineWidth: 2.5 }
        }
      ]
    };
  }

  function renderCF_costFever(data) {
    var el = document.getElementById('c-cf-cost-fever');
    if (!el || typeof echarts === 'undefined') return;
    cfWireFeverControls(data);
    var days = data.proxy?.proxy_days || [];
    var latest = days.length ? days[days.length - 1] : null;
    var selected = __cfFeverMode === 'live'
      ? latest
      : days.find(function (d) { return d.date === __cfFeverDate; }) || latest;
    var fever = selected?.gateway_cost_fever;
    var select = document.getElementById('cf-fever-date');
    if (select) select.style.display = __cfFeverMode === 'history' ? 'block' : 'none';
    var liveBtn = document.getElementById('cf-fever-live');
    var histBtn = document.getElementById('cf-fever-history');
    if (liveBtn) liveBtn.classList.toggle('active', __cfFeverMode === 'live');
    if (histBtn) histBtn.classList.toggle('active', __cfFeverMode === 'history');
    var subtitle = document.getElementById('cf-cost-fever-subtitle');
    var timeline = (__cfFeverMode === 'live' && fever?.live_timeline?.length)
      ? fever.live_timeline
      : fever?.timeline || [];
    var resolutionLabel = __cfFeverMode === 'live' && fever?.live_timeline?.length ? '1-minute live burn rate' : '15-minute burn rate';
    var requestOnly = fever?.request_only === true;
    if (subtitle) subtitle.textContent = selected
      ? selected.date + ' \u00b7 ' + resolutionLabel + (requestOnly
        ? ' \u00b7 request-level Cache-Fix telemetry; session JSONL not linked'
        : ' \u00b7 session lanes retain M(t) as context-growth fit')
      : 'No cost timeline available';
    if (!fever || !timeline.length) {
      el.classList.add('section-no-data');
      if (__cfFeverChart) { __cfFeverChart.dispose(); __cfFeverChart = null; }
      return;
    }
    el.classList.remove('section-no-data');
    var sessions = (fever.sessions || []).slice(0, 18);
    cfFeverKpis(Object.assign({}, fever, { timeline: timeline }), sessions, selected);
    var laneSessions = [];
    sessions.forEach(function (s) {
      var breakdown = (s.model_breakdown || []).filter(function (m) {
        return (m.requests || 0) > 0;
      });
      if (!breakdown.length) {
        laneSessions.push(s);
        return;
      }
      breakdown.forEach(function (m) {
        laneSessions.push(Object.assign({}, s, {
          model: m.model,
          requests: m.requests,
          cost_usd: m.cost_usd,
          started_at: m.started_at || s.started_at,
          ended_at: m.ended_at || s.ended_at,
          parent_session_cost_usd: s.cost_usd
        }));
      });
    });
    laneSessions.sort(function (a, b) { return (b.cost_usd || 0) - (a.cost_usd || 0); });
    laneSessions = laneSessions.slice(0, 24);
    var labels = laneSessions.map(function (s) {
      return cfShortModel(s.model) + ' \u00b7 M ' + (s.mt == null ? '\u2014' : s.mt.toFixed(2)) +
        ' \u00b7 ' + cfFmtUsd(s.cost_usd || 0);
    });
    var laneData = laneSessions.map(function (s, i) {
      return {
        value: [Date.parse(s.started_at), Date.parse(s.ended_at), i, cfModelColor(s.model), s.cost_usd || 0, s.mt, s.sid, s.requests || 0, s.opus_share || 0],
        itemStyle: { color: cfModelColor(s.model) }
      };
    });
    var sessionBoundaries = [];
    var sessionAreas = [];
    laneSessions.forEach(function (s) {
      var start = Date.parse(s.started_at);
      var end = Date.parse(s.ended_at);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      sessionBoundaries.push({
        name: cfShortModel(s.model) + ' \u00b7 M ' + (s.mt == null ? '\u2014' : s.mt.toFixed(2)),
        xAxis: start,
        lineStyle: { color: cfModelColor(s.model), opacity: 0.9, width: 1.5, type: 'dashed' },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: '{b}',
          color: cfModelColor(s.model),
          fontSize: 8,
          rotate: 90,
          distance: 5
        }
      });
      sessionBoundaries.push({
        xAxis: end,
        lineStyle: { color: cfModelColor(s.model), opacity: 0.9, width: 1.5, type: 'dashed' },
        label: { show: false }
      });
      sessionAreas.push([
        {
          name: cfShortModel(s.model) + ' \u00b7 M ' + (s.mt == null ? '\u2014' : s.mt.toFixed(2)),
          xAxis: start,
          itemStyle: { color: cfModelColor(s.model), opacity: 0.035 }
        },
        { xAxis: end }
      ]);
    });
    var mirrorBoundaries = sessionBoundaries.map(function (b) {
      return Object.assign({}, b, { label: { show: false } });
    });
    var height = requestOnly ? 410 : Math.max(650, Math.min(980, 440 + laneSessions.length * 24));
    el.style.height = height + 'px';
    if (!__cfFeverChart) {
      __cfFeverChart = echarts.init(el, null, { renderer: 'canvas' });
      cfBindFeverToHost(el);
    }
    __cfFeverChart.setOption({
      animation: false,
      grid: requestOnly ? [
        { left: 96, right: 72, top: 34, height: 150 },
        { left: 96, right: 72, top: 224, bottom: 34 }
      ] : [
        { left: 96, right: 72, top: 34, height: 170 },
        { left: 96, right: 72, top: 242, height: 118 },
        { left: 96, right: 72, top: 415, bottom: 34 }
      ],
      legend: {
        data: ['Burn $/h', 'Cumulative $', 'Cache Read $/h', 'Cache Creation $/h', 'Cache Read %', 'Sessions'],
        top: 2,
        textStyle: { color: '#EFE7D6', fontSize: 10 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', snap: true },
        renderMode: 'html',
        confine: true,
        transitionDuration: 0,
        backgroundColor: '#0E1116',
        borderColor: '#8C6A3F',
        borderWidth: 1,
        padding: [8, 10],
        extraCssText: 'opacity:1;backdrop-filter:none;filter:none;box-shadow:none;border-radius:3px;line-height:1.45;',
        textStyle: { color: '#F7F3EC', fontSize: 12, fontFamily: '"Cascadia Code", Consolas, ui-monospace, monospace' },
        position: function (point) {
          return [Math.round(point[0] + 12), Math.round(point[1] + 12)];
        },
        formatter: function (params) {
          var list = Array.isArray(params) ? params : [params];
          if (!list.length) return '';
          var ts = list[0].value?.[0];
          var lines = [ts ? '<strong>' + new Date(ts).toLocaleString() + '</strong>' : ''];
          list.forEach(function (p) {
            var raw = Number(p.value?.[1]) || 0;
            var value = (p.seriesName === 'Cache Read $/h' || p.seriesName === 'Cache Creation $/h' || p.seriesName === 'Cache Read %')
              ? Math.abs(raw) : raw;
            var suffix = p.seriesName.includes('$/h') || p.seriesName === 'Burn $/h' ? '/h' : p.seriesName === 'Cache Read %' ? '%' : '';
            lines.push(p.marker + escHtml(p.seriesName) + ': <strong>' +
              (p.seriesName === 'Cache Read %' ? value.toFixed(1) : cfFmtUsd(value)) + suffix + '</strong>');
          });
          return lines.join('<br>');
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        label: { show: true, backgroundColor: '#0E1116', borderColor: '#8C6A3F', borderWidth: 1, color: '#F7F3EC', shadowBlur: 0, padding: [4, 6] },
        lineStyle: { color: '#A0875E', width: 1, type: 'dashed' },
        crossStyle: { color: '#A0875E', width: 1, type: 'dashed' }
      },
      /* Session rectangles retain their own item tooltip; the upper two
         forensic grids use the linked crosshair above. */
      emphasis: {
        focus: 'series'
      },
      xAxis: requestOnly ? [
        { type: 'time', gridIndex: 0, axisLabel: { color: '#A0875E', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.4)' } } },
        { type: 'time', gridIndex: 1, axisLabel: { color: '#A0875E', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.35)' } } }
      ] : [
        { type: 'time', gridIndex: 0, axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.4)' } } },
        { type: 'time', gridIndex: 1, axisLabel: { color: '#A0875E', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.35)' } } },
        { type: 'time', gridIndex: 2, axisLabel: { color: '#A0875E', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.35)' } } }
      ],
      yAxis: requestOnly ? [
        { type: 'value', gridIndex: 0, name: '$/h', nameTextStyle: { color: '#EF9F27' }, axisLabel: { color: '#EF9F27', formatter: '${value}' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.45)' } } },
        { type: 'value', gridIndex: 0, name: 'cum. $', position: 'right', nameTextStyle: { color: '#D4AF7F' }, axisLabel: { color: '#D4AF7F', formatter: '${value}' }, splitLine: { show: false } },
        { type: 'value', gridIndex: 1, name: 'cache $/h', max: 0, nameTextStyle: { color: '#D4AF7F' }, axisLabel: { color: '#D4AF7F', formatter: function (v) { return '$' + Math.abs(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.3)' } } },
        { type: 'value', gridIndex: 1, name: 'read %', position: 'right', min: -100, max: 0, nameTextStyle: { color: '#22c55e' }, axisLabel: { color: '#22c55e', formatter: function (v) { return Math.abs(v) + '%'; } }, splitLine: { show: false } }
      ] : [
        { type: 'value', gridIndex: 0, name: '$/h', nameTextStyle: { color: '#EF9F27' }, axisLabel: { color: '#EF9F27', formatter: '${value}' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.45)' } } },
        { type: 'value', gridIndex: 0, name: 'cum. $', position: 'right', nameTextStyle: { color: '#D4AF7F' }, axisLabel: { color: '#D4AF7F', formatter: '${value}' }, splitLine: { show: false } },
        { type: 'value', gridIndex: 1, name: 'cache $/h', max: 0, nameTextStyle: { color: '#D4AF7F' }, axisLabel: { color: '#D4AF7F', formatter: function (v) { return '$' + Math.abs(v); } }, splitLine: { lineStyle: { color: 'rgba(42,45,52,.3)' } } },
        { type: 'value', gridIndex: 1, name: 'read %', position: 'right', min: -100, max: 0, nameTextStyle: { color: '#22c55e' }, axisLabel: { color: '#22c55e', formatter: function (v) { return Math.abs(v) + '%'; } }, splitLine: { show: false } },
        { type: 'category', gridIndex: 2, data: labels, inverse: true, axisLabel: { color: '#A0875E', fontSize: 9, width: 88, overflow: 'truncate' }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: 'rgba(42,45,52,.28)' } } }
      ],
      series: [
        {
          name: 'Burn $/h', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
          data: timeline.map(function (p) { return [Date.parse(p.ts), p.burn_usd_h || 0]; }),
          smooth: 0.28, symbol: 'circle', symbolSize: 4,
          lineStyle: { width: 2.5, color: '#EF9F27' },
          itemStyle: { color: '#EF9F27' },
          areaStyle: { color: 'rgba(239,159,39,.15)' },
          markLine: {
            silent: true,
            symbol: 'none',
            data: sessionBoundaries
          },
          markArea: {
            silent: true,
            label: { show: true, position: 'insideTop', color: '#A0875E', fontSize: 8 },
            data: sessionAreas
          }
        },
        {
          name: 'Cumulative $', type: 'line', xAxisIndex: 0, yAxisIndex: 1,
          data: timeline.map(function (p) { return [Date.parse(p.ts), p.cumulative_usd || 0]; }),
          smooth: 0.2, symbol: 'none', lineStyle: { width: 1.5, color: '#D4AF7F' }
        },
        {
          name: 'Cache Read $/h', type: 'line', xAxisIndex: 1, yAxisIndex: 2,
          data: timeline.map(function (p) { return [Date.parse(p.ts), -(p.cache_read_usd_h || 0)]; }),
          smooth: 0.2, symbol: 'none',
          lineStyle: { width: 1.8, color: '#D4AF7F' },
          areaStyle: { color: 'rgba(212,175,127,.12)' },
          markLine: { silent: true, symbol: 'none', data: mirrorBoundaries }
        },
        {
          name: 'Cache Creation $/h', type: 'line', xAxisIndex: 1, yAxisIndex: 2,
          data: timeline.map(function (p) { return [Date.parse(p.ts), -(p.cache_creation_usd_h || 0)]; }),
          smooth: 0.16, symbol: 'none',
          lineStyle: { width: 2, color: '#ef4444' },
          areaStyle: { color: 'rgba(239,68,68,.12)' }
        },
        {
          name: 'Cache Read %', type: 'line', xAxisIndex: 1, yAxisIndex: 3,
          data: timeline.map(function (p) { return [Date.parse(p.ts), p.cache_read_ratio == null ? null : -p.cache_read_ratio]; }),
          connectNulls: false, smooth: 0.12, symbol: 'none',
          lineStyle: { width: 1.4, color: '#22c55e', type: 'dashed' }
        },
        {
          name: 'Sessions', type: 'custom', xAxisIndex: 2, yAxisIndex: 4,
          renderItem: cfFeverRenderSession, encode: { x: [0, 1], y: 2 }, data: laneData,
          tooltip: {
            trigger: 'item',
            formatter: function (p) {
              var v = p.value;
              return '<strong>' + escHtml(String(v[6]).slice(-12)) + '</strong><br>' +
                labels[v[2]] + '<br>Requests: ' + v[7] + '<br>Opus share: ' + v[8] + '%<br>' +
                new Date(v[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' \u2192 ' +
                new Date(v[1]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
          }
        }
      ].filter(function (series) { return !requestOnly || series.name !== 'Sessions'; })
    }, true);
    __cfFeverChart.resize({ width: el.clientWidth, height: el.clientHeight });
  }

  // ── Top-5 Sessions ────────────────────────────────────────────────────────

  function renderCF_top5Sessions(sessions, plan) {
    var host = document.getElementById('cf-top5-sessions');
    if (!host) return;

    if (!sessions || sessions.length === 0) {
      host.innerHTML = '<div style="color:#6B7280;padding:8px 0;font-size:.8rem">' + escHtml(t('cfTop5NoData')) + '</div>';
      return;
    }

    var sorted = sessions.slice().sort(function (a, b) {
      return (b.actual_cost_usd || 0) - (a.actual_cost_usd || 0);
    });
    var top5 = sorted.slice(0, 5);

    // 4-column grid per spec: 1.1 / 1.6 / 0.8 / 1.4
    var rows = top5.map(function (s) {
      var shortSid = s.sid.length > 12 ? s.sid.slice(-12) : s.sid;
      var mtColor = cfMtColor(s.mt);
      var badges = cfBuildBadges(s);

      return '<div style="display:contents">' +
        // Col 1: Session ID + meta
        '<div style="padding:8px 0;font-family:var(--asseris-font-mono);font-size:.73rem;color:var(--asseris-gold);border-bottom:1px solid var(--asseris-dark-border)" title="' + escHtml(s.sid) + '">' +
          escHtml(shortSid) +
          '<div style="font-size:.63rem;color:#6B7280;margin-top:2px">' + escHtml(s.model || '\u2014') + ' \u00b7 ' + s.t_now_h.toFixed(1) + 'h \u00b7 ' + (s.points_count || 0) + ' req</div>' +
        '</div>' +
        // Col 2: Badges
        '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:2px;align-items:center;border-bottom:1px solid var(--asseris-dark-border)">' + badges + '</div>' +
        // Col 3: M(t)
        '<div style="padding:8px 0;text-align:right;font-family:var(--asseris-font-mono);font-size:.9rem;font-weight:700;color:' + mtColor + ';border-bottom:1px solid var(--asseris-dark-border)">' + s.mt.toFixed(2) + '\u00d7</div>' +
        // Col 4: Cost
        '<div style="padding:8px 0;text-align:right;font-family:var(--asseris-font-mono);font-size:.78rem;border-bottom:1px solid var(--asseris-dark-border)">' +
          '<span style="color:var(--asseris-paper)">' + cfFmtUsd(s.real_cost_daily) + '</span>' +
        '</div>' +
        '</div>';
    }).join('');

    host.innerHTML =
      // Header
      '<div style="display:grid;grid-template-columns:1.1fr 1.6fr 0.8fr 1.4fr;gap:0 12px;font-size:.68rem;color:var(--asseris-gold-soft);border-bottom:1px solid var(--asseris-dark-border);padding-bottom:4px;margin-bottom:4px">' +
        '<div>Session</div><div>Flags</div><div style="text-align:right">M(t)</div><div style="text-align:right">Cost</div>' +
      '</div>' +
      // Rows
      '<div style="display:grid;grid-template-columns:1.1fr 1.6fr 0.8fr 1.4fr;gap:0 12px">' +
        rows +
      '</div>' +
      '<div style="font-size:.66rem;color:#6B7280;margin-top:8px">' +
        'Actual list-price estimate from logged usage; M(t) is shown independently.' +
      '</div>';
  }

  function cfBuildBadges(session) {
    var html = '';
    for (var i = 0; i < BADGE_CATALOG.length; i++) {
      var b = BADGE_CATALOG[i];
      if (b.test(session)) {
        html += '<span style="display:inline-block;background:' + b.bg + ';color:' + b.color + ';font-size:.58rem;padding:2px 6px;border-radius:3px;white-space:nowrap">' + escHtml(t(b.i18n)) + '</span>';
      }
    }
    if (session.source) {
      html += '<span style="display:inline-block;background:var(--asseris-dark-bg);color:#6B7280;font-size:.58rem;padding:2px 6px;border-radius:3px;border:1px solid var(--asseris-dark-border)">' + escHtml(session.source) + '</span>';
    }
    if ((session.compaction_count || 0) > 0) {
      html += '<span style="display:inline-block;background:var(--asseris-dark-bg);color:var(--asseris-gold-soft);font-size:.58rem;padding:2px 6px;border-radius:3px;border:1px solid var(--asseris-dark-border)">' + session.compaction_count + ' Compacts</span>';
    }
    return html;
  }

  // ── Token-Decomposition ───────────────────────────────────────────────────

  function renderCF_tokenDecomposition(pd) {
    var host = document.getElementById('cf-token-decomposition');
    if (!host) return;

    var cr = pd.cache_read_tokens || 0;
    var cc = pd.cache_creation_tokens || 0;
    var out = pd.output_tokens || 0;
    var inp = pd.input_tokens || 0;
    var estimated = pd.estimated_cost || {};
    var wCr = estimated.cache_read || 0;
    var wCc = estimated.cache_creation || 0;
    var wOut = estimated.output || 0;
    var wInp = estimated.input || 0;
    var wTotal = wCr + wCc + wOut + wInp;

    if (wTotal === 0) {
      host.innerHTML = '<div style="color:#6B7280;padding:8px 0;font-size:.8rem">' + escHtml(t('cfDecompNoData')) + '</div>';
      return;
    }

    function barRow(labelKey, weighted, color) {
      var pct = Math.round(weighted / wTotal * 1000) / 10;
      var barWidth = Math.max(1, Math.round(weighted / wTotal * 100));
      return '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">' +
          '<span style="font-family:var(--asseris-font-serif);font-size:.78rem;color:var(--asseris-gold-soft)">' + escHtml(t(labelKey)) + '</span>' +
          '<span style="font-family:var(--asseris-font-mono);font-size:.78rem;color:var(--asseris-paper)">' + pct.toFixed(1) + '%</span>' +
        '</div>' +
        '<div style="height:14px;background:var(--asseris-dark-bg);border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + barWidth + '%;background:' + color + ';border-radius:3px;transition:width .3s"></div>' +
        '</div>' +
        '</div>';
    }

    var totalRawTokens = cr + cc + out + inp;
    var fmtTokens = totalRawTokens > 1000000 ? (totalRawTokens / 1000000).toFixed(1) + 'M' : totalRawTokens > 1000 ? (totalRawTokens / 1000).toFixed(0) + 'K' : String(totalRawTokens);
    var outPct = totalRawTokens > 0 ? (out / totalRawTokens * 100).toFixed(2) : '0';

    host.innerHTML =
      '<div style="font-size:.7rem;color:#6B7280;margin-bottom:10px">Model-specific list-price contribution from logged usage classes</div>' +
      barRow('cfDecompCacheRead', wCr, '#D4AF7F') +
      barRow('cfDecompCacheCreation', wCc, '#B8915A') +
      barRow('cfDecompOutput', wOut, '#EF9F27') +
      barRow('cfDecompInput', wInp, '#8C6A3F') +
      '<div style="font-size:.68rem;color:#6B7280;margin-top:8px;border-top:1px solid var(--asseris-dark-border);padding-top:6px">' +
        escHtml(t('cfDecompRawRatio').replace('{pct}', outPct)) + ' \u00b7 ' + fmtTokens + ' Tokens' +
      '</div>';
  }

  // ── Rate card history ─────────────────────────────────────────────────────

  var __rateChart = null;
  var __rateCards = null;

  /**
   * Published token prices over time, one step line per model, with a band at
   * every date a new rate card took effect. Prices change on announced dates,
   * so the interesting part is not the current number but when it moved and
   * which card moved it.
   */
  function renderRateHistory(payload) {
    var el = document.getElementById('c-cf-rate-history');
    if (!el || typeof echarts === 'undefined') return;
    setText('cf-rate-history-title', t('cfRateHistoryTitle'));
    setText('cf-rate-history-subtitle', t('cfRateHistorySubtitle'));

    var history = payload?.history || {};
    var changes = payload?.changes || [];
    var models = Object.keys(history).sort();
    if (!models.length) {
      el.innerHTML = '<div style="color:#8C6A3F;font-size:11px;padding:36px;text-align:center">' +
        escHtml(t('cfRateHistoryEmpty')) + '</div>';
      return;
    }

    var today = new Date().toISOString().slice(0, 10);
    var current = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5'];
    var selected = {};
    for (var model of models) selected[model] = current.indexOf(model) !== -1;

    var series = models.map(function (model, index) {
      var points = history[model].map(function (point) {
        return [point.valid_from, point.input];
      });
      var last = history[model].at(-1);
      if (last && last.valid_from < today) points.push([today, last.input]);
      return {
        name: model,
        type: 'line',
        step: 'end',
        symbol: 'circle',
        symbolSize: 5,
        // Model colours are configured in setup; a chart-local palette would
        // show the same model in a different colour on every surface.
        itemStyle: { color: modelFamilyColor(model) },
        lineStyle: { width: 2, color: modelFamilyColor(model) },
        data: points
      };
    });

    // The bands mark the effective dates themselves, so a jump is read as an
    // event rather than as a coincidence of the line.
    series[0].markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: 'rgba(212,175,127,.35)', type: 'dashed' },
      label: {
        color: '#A0875E', fontSize: 10, formatter: function (item) { return item.name; }
      },
      data: changes.map(function (change) {
        return { xAxis: change.valid_from, name: change.valid_from };
      })
    };

    if (!__rateChart) __rateChart = echarts.init(el, null, { renderer: 'canvas' });
    __rateChart.setOption({
      animation: false,
      grid: { left: 56, right: 24, top: 40, bottom: 28 },
      legend: {
        type: 'scroll', top: 2, textStyle: { color: '#B9B0A1', fontSize: 10 }, selected: selected
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(14,17,22,.95)', borderColor: '#2A2D34',
        textStyle: { color: '#F7F3EC', fontSize: 11 },
        valueFormatter: function (value) { return '$' + value + ' / MTok'; }
      },
      xAxis: {
        type: 'time',
        axisLabel: { color: '#8C6A3F', fontSize: 10 },
        axisLine: { lineStyle: { color: '#2A2D34' } }
      },
      yAxis: {
        type: 'value',
        name: t('cfRateHistoryInput') + ' $/MTok',
        nameTextStyle: { color: '#8C6A3F', fontSize: 10 },
        axisLabel: { color: '#8C6A3F', fontSize: 10, formatter: '${value}' },
        splitLine: { lineStyle: { color: '#1A1D24' } }
      },
      series: series
    }, true);
  }

  window.renderCf_rateHistory = function () {
    if (__rateCards) { renderRateHistory(__rateCards); return; }
    fetch('/api/rate-cards', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        if (!payload) return;
        __rateCards = payload;
        renderRateHistory(payload);
      })
      .catch(function (error) {
        if (window.appLogger) window.appLogger.debugM('cost-intelligence', 'catch', 'rate_cards_failed', error?.message || error);
      });
  };

  // ── Exports ───────────────────────────────────────────────────────────────

  window.renderCostIntelligence = renderCostForensic;
  window.__resetCiFingerprint = function () { __lastCfFingerprint = ''; };
})();
