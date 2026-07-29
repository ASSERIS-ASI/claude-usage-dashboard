/**
 * @asseris-module       Economic
 * @asseris-description  Auto-annotated module metadata for public/js/sections/economic.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
(function () {
  'use strict';

  /**
   * sections/economic.js — Economic section renderer.
   * Extracted from dashboard.client.js (lines 10872-13427).
   *
   * Dependencies (via window / globals):
   *   fmt, pct, escHtml, t, tr, logClientOptionalErr
   *   _charts, echarts, _effCharts, __effInitOrSet
   *   __lastUsageData, getFilteredDays
   *   window.__metricsEngine
   */

  // ── State ───────────────────────────────────────────────────────────
  var _econCharts = {};
  var _econData = null;
  var _econQdData = null;

  // ── Section registration ────────────────────────────────────────────
  window.__sections = window.__sections || {};
  window.__sections.economic = {
    id: 'economic',
    surface: 'usage',
    domId: 'economic-collapse',
    render: function (data, filteredDays) {
      renderEconomicSection(data, filteredDays);
    }
  };

  // ── renderEconomicSection ───────────────────────────────────────────

  function renderEconomicSection(data, filteredDays) {
    var collapse = document.getElementById("economic-collapse");
    if (!collapse) return;
    var sumEl = document.getElementById("economic-summary-line");
    var sessPicker = document.getElementById("econ-session-picker");
    var infoEl = document.getElementById("econ-session-info");
    var mainPicker = document.getElementById("day-picker");
    var currentDay = mainPicker?.value ? mainPicker.value : "";

    // Invalidate only when the selected day changes. Re-renders happen often;
    // never overwrite a valid cached session summary with the empty-state text.
    if (_econData?.date !== currentDay) _econData = null;
    if (_econData?.sessions) {
      populateSessionPicker(_econData, sessPicker, infoEl, sumEl);
    } else if (sumEl) {
      sumEl.textContent = t("econSummaryNoData");
    }

    // Set labels — hide redundant date picker, keep session picker
    var lblSess = document.getElementById("lbl-econ-session");
    if (lblSess) lblSess.textContent = t("econSessionLabel");
    var lblDate = document.getElementById("lbl-econ-date");
    var datePicker = document.getElementById("econ-date-picker");
    if (lblDate) lblDate.style.display = "none";
    if (datePicker) datePicker.style.display = "none";

    // Section header titles
    var wH = document.getElementById("econ-waste-h3");
    var wmH = document.getElementById("econ-waste-month-h3");
    var eH = document.getElementById("econ-efficiency-h3");
    var dH = document.getElementById("econ-daycompare-h3");
    var exH = document.getElementById("econ-explosion-h3");
    if (wH) wH.textContent = t("econWasteTitle");
    if (wmH) wmH.textContent = t("econWasteMonthTitle");
    if (eH) eH.textContent = t("econEfficiencyTitle");
    if (dH) dH.textContent = t("econDayCompareTitle");
    if (exH) exH.textContent = t("econExplosionTitle");
    var wB = document.getElementById("econ-waste-blurb");
    var wmB = document.getElementById("econ-waste-month-blurb");
    var eB = document.getElementById("econ-efficiency-blurb");
    var dB = document.getElementById("econ-daycompare-blurb");
    var exB = document.getElementById("econ-explosion-blurb");
    if (wB) wB.textContent = t("econWasteBlurb");
    if (wmB) wmB.textContent = t("econWasteMonthBlurbCache");
    if (eB) eB.textContent = t("econEfficiencyBlurb");
    if (dB) dB.textContent = t("econDayCompareBlurb");
    if (exB) exB.textContent = t("econExplosionBlurb");

    // Range charts: render on toggle open (collapsed by default)
    var econDays = filteredDays || data.days || [];
    // Build proxy-days map for plan detection: { 'YYYY-MM-DD': proxyDay }
    var proxyDaysMap = {};
    var _pdArr = data.proxy?.proxy_days || [];
    for (var _pdi = 0; _pdi < _pdArr.length; _pdi++) {
      if (_pdArr[_pdi].date) proxyDaysMap[_pdArr[_pdi].date] = _pdArr[_pdi];
    }
    var rangeCollapse = document.getElementById("econ-range-collapse");
    function _renderRangeCharts() {
      renderDayComparison(econDays, proxyDaysMap);
      initButterflyToggle();
      renderMonthlyButterfly(econDays);
      renderEfficiencyTimeline(_econData);
    }
    if (rangeCollapse) {
      if (rangeCollapse.open) _renderRangeCharts();
      if (!rangeCollapse.dataset.bound) {
        rangeCollapse.dataset.bound = "1";
        rangeCollapse.addEventListener("toggle", function () {
          if (rangeCollapse.open) _renderRangeCharts();
        });
      }
    } else {
      renderDayComparison(econDays, proxyDaysMap);
      initButterflyToggle();
      renderMonthlyButterfly(econDays);
    }

    // Session-turn charts: lazy-load only when section is opened
    function fetchSessionTurns() {
      var selectedDate = mainPicker?.value ? mainPicker.value
        : data.days?.length ? data.days[data.days.length - 1].date
        : new Date().toISOString().slice(0, 10);
      if (sumEl) sumEl.textContent = tr("econSummaryLine", { sessions: "…", ratio: "…" });
      fetch("/api/session-turns?date=" + encodeURIComponent(selectedDate))
        .then(function (r) { return r.json(); })
        .then(function (stData) {
          // Server returns 202 with building:true when cache is being built — retry after delay
          if (stData.building) {
            if (sumEl) sumEl.textContent = t("econSummaryBuilding") || "Building session data…";
            setTimeout(fetchSessionTurns, 5000);
            return;
          }
          _econData = stData;
          populateSessionPicker(stData, sessPicker, infoEl, sumEl);
          var sel = sessPicker ? sessPicker.value : "";
          var session = findSession(stData, sel);
          if (session) {
            renderCacheExplosion(session);

            renderEfficiencyTimeline(stData);
            renderBudgetDrain(stData);
          }
          // Fetch quota-divisor data, then re-render Budget Drain with Q5 overlay
          fetch("/api/quota-divisor?date=" + encodeURIComponent(selectedDate))
            .then(function (r) { return r.json(); })
            .then(function (qdData) {
              _econQdData = qdData;
              renderBudgetDrain(stData, qdData);
            })
            .catch(function () { /* no proxy data — keep single-grid */ });
        })
        .catch(function () {
          if (sumEl) sumEl.textContent = t("econSummaryNoData");
        });
    }

    var mainPicker2 = mainPicker;

    // Summary needs data even when collapsed; charts render on open
    // Skip fetch while scan is in progress to avoid blocking the server with 30s+ synchronous parses
    if (!_econData && !data.scanning) {
      fetchSessionTurns();
    }
    if (!collapse.dataset.bound) {
      collapse.dataset.bound = "1";
      collapse.addEventListener("toggle", function () {
        if (!collapse.open) return;
        if (!_econData) {
          fetchSessionTurns();
        } else {
          // Data already fetched while collapsed — re-render charts now that container is visible
          var sel = sessPicker ? sessPicker.value : "";
          var session = findSession(_econData, sel);
          if (session) {
            renderCacheExplosion(session);

            renderEfficiencyTimeline(_econData);
            renderBudgetDrain(_econData, _econQdData);
          }
        }
      });
    }

    // Re-fetch session data when day-picker changes
    if (mainPicker2 && !mainPicker2.dataset.econBound) {
      mainPicker2.dataset.econBound = "1";
      mainPicker2.addEventListener("change", function () {
        _econData = null;
        if (sumEl) sumEl.textContent = "Loading sessions…";
      });
    }

    if (sessPicker && !sessPicker.dataset.bound) {
      sessPicker.dataset.bound = "1";
      function _onSessionChange() {
        if (!_econData) return;
        var session = findSession(_econData, sessPicker.value);
        if (session) {
          var info = document.getElementById("econ-session-info");
          updateSessionInfo(session, info);
          renderCacheExplosion(session);
          renderContextLoss(session);
        }
      }
      sessPicker.addEventListener("change", _onSessionChange);
      sessPicker.addEventListener("input", _onSessionChange);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function populateSessionPicker(stData, picker, infoEl, sumEl) {
    if (!picker || !stData?.sessions) return;
    var previousSelection = picker.value;
    picker.innerHTML = "";
    var sessions = stData.sessions;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var opt = document.createElement("option");
      opt.value = s.session_id_hash;
      var timeRange = (s.edge_start ? "\u2192 " : "") + s.first_ts.slice(11, 16) + "\u2013" + s.last_ts.slice(11, 16) + (s.edge_end ? " \u2192" : "");
      opt.textContent = s.session_id_hash.slice(0, 8) + " (" + timeRange + ", " + s.turn_count + " turns)";
      picker.appendChild(opt);
    }
    if (previousSelection) {
      for (var pi = 0; pi < picker.options.length; pi++) {
        if (picker.options[pi].value === previousSelection) {
          picker.value = previousSelection;
          break;
        }
      }
    }
    if (sessions.length && !picker.value) picker.value = sessions[0].session_id_hash;
    var sel = findSession(stData, picker.value);
    if (sel) updateSessionInfo(sel, infoEl);

    if (sumEl) {
      if (!sessions.length) {
        sumEl.textContent = t("econSummaryNoData");
      } else {
        var totalOut = sessions.reduce(function (s, x) { return s + x.total_output; }, 0);
        var totalAll = sessions.reduce(function (s, x) { return s + x.total_all; }, 0);
        var ratio = totalAll > 0 ? (totalOut / totalAll * 100).toFixed(2) : "0";
        sumEl.textContent = tr("econSummaryLine", { sessions: sessions.length, ratio: ratio });
      }
    }
  }

  function findSession(stData, hash) {
    if (!stData?.sessions) return null;
    for (var i = 0; i < stData.sessions.length; i++) {
      if (stData.sessions[i].session_id_hash === hash) return stData.sessions[i];
    }
    return stData.sessions[0] || null;
  }

  function updateSessionInfo(session, infoEl) {
    if (!infoEl || !session) return;
    infoEl.textContent = tr("econSessionInfo", {
      turns: session.turn_count,
      output: fmt(session.total_output),
      cacheRead: fmt(session.total_cache_read),
      total: fmt(session.total_all)
    });
  }

  /** renderContextLoss — stub (no-op, referenced in session change handler) */
  function renderContextLoss() {}

  // ── renderWasteCurve ────────────────────────────────────────────────

  function renderWasteCurve(session) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-waste");
    if (!el || !session?.turns?.length) return;

    var econLegFit = t("econLegendQuadraticFit");
    var econLegAct = t("econLegendTotalActual");
    var econLegProj = t("econLegendTotalProjected");

    var turns = session.turns;
    var n = turns.length;
    var cumTotal = [];
    var cT = 0;

    for (var i = 0; i < n; i++) {
      var T = turns[i];
      cT += (T.output || 0) + (T.input || 0) + (T.cache_read || 0) + (T.cache_creation || 0);
      cumTotal.push(cT);
    }

    // Quadratic fit: cumTotal ≈ a*t² + b*t + c via least-squares
    var s1 = 0, s2 = 0, s3 = 0, s4 = 0, sy = 0, s1y = 0, s2y = 0;
    for (var fi = 0; fi < n; fi++) {
      var ti = fi;
      var t2 = ti * ti;
      s1 += ti; s2 += t2; s3 += t2 * ti; s4 += t2 * t2;
      sy += cumTotal[fi]; s1y += ti * cumTotal[fi]; s2y += t2 * cumTotal[fi];
    }
    var det = n * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    var a = 0, b = 0, c = 0;
    if (Math.abs(det) > 1e-10) {
      c = (sy * (s2 * s4 - s3 * s3) - s1 * (s1y * s4 - s2y * s3) + s2 * (s1y * s3 - s2y * s2)) / det;
      b = (n * (s1y * s4 - s2y * s3) - sy * (s1 * s4 - s3 * s2) + s2 * (s1 * s2y - s1y * s2)) / det;
      a = (n * (s2 * s2y - s3 * s1y) - s1 * (s1 * s2y - s1y * s2) + sy * (s1 * s3 - s2 * s2)) / det;
    }

    var projectTurns = Math.max(Math.round(n * 0.5), 20);
    var totalTurns = n + projectTurns;

    var actualPairs = [];
    var projectedPairs = [];
    var fitPairs = [];
    var fitMin = 0;

    for (var xi = 0; xi < totalTurns; xi++) {
      var turnNum = xi + 1;
      var fitted = Math.round(a * xi * xi + b * xi + c);
      if (fitted < fitMin) fitMin = fitted;
      fitPairs.push([turnNum, fitted]);
      if (xi < n) {
        actualPairs.push([turnNum, cumTotal[xi]]);
        if (xi === n - 1) projectedPairs.push([turnNum, cumTotal[xi]]);
      } else {
        projectedPairs.push([turnNum, fitted]);
      }
    }

    var currentTotal = cumTotal[n - 1];
    var burnThresh = currentTotal * 1.5;
    var burnStart = -1;
    for (var wi = n; wi < totalTurns; wi++) {
      if (fitPairs[wi] && fitPairs[wi][1] >= burnThresh) {
        burnStart = wi + 1;
        break;
      }
    }
    var wallTurn = burnStart;
    var remainLabel = wallTurn > 0 ? "~" + (wallTurn - n) + " turns to burn" : "";

    var disc = b * b - 4 * a * c;
    var zeroCross = disc > 0 ? Math.round((-b + Math.sqrt(disc)) / (2 * a)) : -1;

    var yMin = fitMin < 0 ? Math.round(fitMin * 1.2) : undefined;

    // Check if session day had hit limits + detect forced restart gap
    var sessionDate = session.first_ts?.slice(0, 10) || "";
    var dayHitLimit = 0;
    var _udata = window.__dashboardState.getData() || null;
    if (sessionDate && _udata?.days) {
      var _matchDay = _udata.days.find(function (d) { return d.date === sessionDate; });
      if (_matchDay) dayHitLimit = _matchDay.hit_limit || 0;
    }
    var _nextGapMin = -1;
    if (_econData?.sessions && session.last_ts) {
      var lastMs = new Date(session.last_ts).getTime();
      var minGap = Infinity;
      for (var ni of _econData.sessions) {
        if (ni.session_id_hash === session.session_id_hash) continue;
        var gap = new Date(ni.first_ts).getTime() - lastMs;
        if (gap > 0 && gap < minGap) minGap = gap;
      }
      if (minGap < Infinity) _nextGapMin = Math.round(minGap / 60000);
    }
    var _forcedRestart = dayHitLimit > 0 && _nextGapMin >= 0 && _nextGapMin <= 5;

    var option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          if (!params?.length) return "";
          var turnNum = params[0].value[0];
          var turnIdx = turnNum - 1;
          var lines = ["<b>Turn " + turnNum + "</b>"];
          for (var p = 0; p < params.length; p++) {
            if (params[p].value != null) {
              lines.push(params[p].marker + " " + params[p].seriesName + ": " + fmt(params[p].value[1]));
            }
          }
          if (turnIdx < n) {
            var TT = turns[turnIdx];
            if (TT) {
              lines.push("<span style='color:#8C6A3F'>out=" + fmt(TT.output || 0) + " cr=" + fmt(TT.cache_read || 0) + "</span>");
            }
          } else {
            lines.push("<span style='color:#8C6A3F'>(projected)</span>");
          }
          if (wallTurn > 0 && turnNum >= wallTurn) {
            lines.push(
              "",
              "<span style='color:#ef4444'><b>" + t("econBurnZoneTitle") + "</b></span>",
              "<span style='color:#ef4444'>" + t("econBurnZoneLine1") + "</span>",
              "<span style='color:#ef4444'>" + t("econBurnZoneLine2") + "</span>",
              "<span style='color:#ef4444'>" + t("econBurnZoneLine3") + "</span>"
            );
          }
          return lines.join("<br>");
        }
      },
      legend: { top: 4, textStyle: { color: "#A0875E", fontSize: 11 }, data: [econLegFit, econLegAct, econLegProj] },
      grid: { top: 50, right: 20, bottom: 40, left: 60 },
      xAxis: {
        type: "value",
        min: 1,
        max: totalTurns,
        axisLine: { show: true, onZero: true, lineStyle: { color: "#A0875E", width: 2 } },
        axisLabel: { color: "#8C6A3F", fontSize: 9 },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        min: yMin,
        axisLine: { show: true, onZero: true, lineStyle: { color: "#A0875E", width: 2 } },
        axisLabel: { color: "#8C6A3F", formatter: function (v) { return fmt(v); } },
        splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
      },
      series: [
        {
          name: econLegFit,
          type: "line",
          showSymbol: false,
          lineStyle: { color: "#ef4444", width: 2, type: "dotted" },
          z: 1,
          data: fitPairs,
          markPoint: {
            data: [
              zeroCross > 0 ? {
                coord: [zeroCross, 0],
                symbol: "circle",
                symbolSize: 10,
                itemStyle: { color: "#fbbf24", shadowBlur: 6, shadowColor: "rgba(251,191,36,0.5)" },
                label: { show: false }
              } : null,
              {
                coord: [n, cumTotal[n - 1]],
                symbol: "circle",
                symbolSize: 10,
                itemStyle: (function () {
                  var c = "#B8915A", sc = "rgba(184,145,90,0.5)";
                  if (_forcedRestart) { c = "#ef4444"; sc = "rgba(239,68,68,0.5)"; }
                  else if (dayHitLimit > 0) { c = "#f59e0b"; sc = "rgba(245,158,11,0.5)"; }
                  return { color: c, shadowBlur: 6, shadowColor: sc };
                })(),
                label: (function () {
                  var txt = "Session End", col = "#D4AF7F";
                  if (_forcedRestart) { txt = "Forced End (" + _nextGapMin + "min)"; col = "#f87171"; }
                  else if (dayHitLimit > 0) { txt = "Session End (Limit Day)"; col = "#fbbf24"; }
                  return { show: true, formatter: txt, position: "top", color: col, fontSize: 10 };
                })()
              }
            ].filter(Boolean)
          },
          markLine: wallTurn > 0 ? {
            silent: true,
            symbol: "none",
            data: [{
              xAxis: wallTurn,
              lineStyle: { color: "#ef4444", type: "dashed", width: 1.5 },
              label: { show: false }
            }]
          } : undefined,
          markArea: (function () {
            var areas = [];
            if (wallTurn > 0 && wallTurn > n + 1) {
              areas.push([
                { xAxis: n, name: "Safe (" + (wallTurn - n) + " turns)", itemStyle: { color: "rgba(250,204,21,0.10)" }, label: { color: "rgba(250,204,21,0.5)" } },
                { xAxis: wallTurn }
              ]);
            }
            if (wallTurn > 0) {
              areas.push([
                { xAxis: wallTurn, name: "Burn Zone", itemStyle: { color: "rgba(239,68,68,0.12)" }, label: { color: "rgba(239,68,68,0.4)" } },
                { xAxis: totalTurns }
              ]);
            }
            if (!areas.length) return undefined;
            return {
              silent: false,
              label: { show: true, color: "rgba(148,163,184,0.6)", fontSize: 11, position: "insideTop" },
              emphasis: { label: { fontSize: 13, fontWeight: "bold" } },
              data: areas
            };
          })()
        },
        {
          name: econLegAct,
          type: "line",
          showSymbol: false,
          areaStyle: { color: "rgba(134,239,172,0.25)", origin: 0 },
          lineStyle: { color: "#86efac", width: 2 },
          z: 2,
          data: actualPairs
        },
        {
          name: econLegProj,
          type: "line",
          showSymbol: false,
          areaStyle: { color: "rgba(239,68,68,0.15)", origin: 0 },
          lineStyle: { color: "#ef4444", width: 2, type: "dashed" },
          z: 3,
          data: projectedPairs
        }
      ]
    };

    // Info box
    var infoLines = [];
    if (fitMin < 0) infoLines.push("\u26a0 Warmup: " + fmt(fitMin));
    if (zeroCross > 0) infoLines.push("\u25cf Break-even: Turn " + zeroCross);
    infoLines.push("\u25b2 Session End: Turn " + n + " (" + fmt(cumTotal[n - 1]) + ")");
    if (_forcedRestart) {
      var _nextSession = null;
      if (_econData?.sessions && session.last_ts) {
        var _lastMs = new Date(session.last_ts).getTime();
        var _bestGap = Infinity;
        for (var nsi = 0; nsi < _econData.sessions.length; nsi++) {
          var _ns = _econData.sessions[nsi];
          if (_ns.session_id_hash === session.session_id_hash) continue;
          var _g = new Date(_ns.first_ts).getTime() - _lastMs;
          if (_g > 0 && _g < _bestGap) { _bestGap = _g; _nextSession = _ns; }
        }
      }
      var rebuildCost = 0;
      if (_nextSession?.turns) {
        var warmupN = Math.min(10, _nextSession.turns.length);
        for (var wi2 = 0; wi2 < warmupN; wi2++) {
          var wt = _nextSession.turns[wi2];
          rebuildCost += (wt.input || 0) + (wt.output || 0) + (wt.cache_read || 0) + (wt.cache_creation || 0);
        }
      }
      var contextInvestment = cumTotal[n - 1] - (n * cumTotal[0]);
      infoLines.push("\u26a0 Forced End \u2192 " + _nextGapMin + "min \u2192 cold restart");
      infoLines.push("\u274c Context lost: " + fmt(contextInvestment));
      infoLines.push("\u274c Rebuild cost: " + fmt(rebuildCost));
    } else if (dayHitLimit > 0) {
      infoLines.push("\u26a0 Limit Day (" + dayHitLimit + "\u00d7 hits)");
    }
    var costFactor = n > 1 ? ((actualPairs[n - 1][1] / n) / (actualPairs[0][1])).toFixed(1) : "?";
    infoLines.push("\u00d7 Cost Factor: " + costFactor + "\u00d7");
    if (wallTurn > 0 && wallTurn > n) {
      var safeTokens = Math.round(a * (wallTurn - 1) * (wallTurn - 1) + b * (wallTurn - 1) + c) - cumTotal[n - 1];
      infoLines.push("\u2705 Safe: " + (wallTurn - n) + " turns (" + fmt(safeTokens) + ")");
      infoLines.push("\u26d4 " + remainLabel);
    } else if (wallTurn > 0) {
      infoLines.push("\u26d4 in burn zone");
    }

    __effInitOrSet("econWaste", el, option, true);

    // HTML overlay for collapsible info box
    var existingWasteOverlay = el.querySelector(".waste-info-overlay");
    if (existingWasteOverlay) existingWasteOverlay.remove();

    var wasteOverlay = document.createElement("div");
    wasteOverlay.className = "waste-info-overlay";
    wasteOverlay.style.cssText = "position:absolute;left:8px;top:8px;z-index:10;cursor:pointer;user-select:none";
    var wasteTab = '<div class="waste-info-tab" style="background:rgba(14,17,22,0.85);border:1px solid rgba(184,145,90,0.3);border-radius:4px;padding:4px 6px;font:bold 9px monospace;color:#D4AF7F">\u25bc INFO</div>';
    var wasteBox = '<div class="waste-info-box" style="display:none;background:rgba(14,17,22,0.92);border:1px solid rgba(184,145,90,0.4);border-radius:6px;padding:6px 10px;font:10px monospace;color:#F7F3EC;white-space:pre;line-height:1.5;box-shadow:0 0 10px rgba(184,145,90,0.2)">' + infoLines.join("\n") + '</div>';
    wasteOverlay.innerHTML = wasteTab + wasteBox;
    wasteOverlay.addEventListener("click", function () {
      var wt = wasteOverlay.querySelector(".waste-info-tab");
      var wb = wasteOverlay.querySelector(".waste-info-box");
      if (wt.style.display === "none") {
        wt.style.display = "";
        wb.style.display = "none";
      } else {
        wt.style.display = "none";
        wb.style.display = "";
      }
    });
    el.style.position = "relative";
    el.appendChild(wasteOverlay);
  }

  // ── renderCacheExplosion ────────────────────────────────────────────

  function renderCacheExplosion(session) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-explosion");
    if (!el || !session?.turns?.length) return;

    var turns = session.turns;
    var n = turns.length;

    // 1. Per-turn cost
    var cost = [];
    for (var i = 0; i < n; i++) {
      var T = turns[i];
      cost.push((T.input || 0) + (T.output || 0) + (T.cache_read || 0) + (T.cache_creation || 0));
    }

    // 2. Quadratic least-squares fit on per-turn cost
    var s1 = 0, s2 = 0, s3 = 0, s4 = 0, sy = 0, s1y = 0, s2y = 0;
    for (var fi = 0; fi < n; fi++) {
      var ti = fi, t2 = ti * ti;
      s1 += ti; s2 += t2; s3 += t2 * ti; s4 += t2 * t2;
      sy += cost[fi]; s1y += ti * cost[fi]; s2y += t2 * cost[fi];
    }
    var det = n * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    var a = 0, b = 0, c = 0;
    if (Math.abs(det) > 1e-10) {
      c = (sy * (s2 * s4 - s3 * s3) - s1 * (s1y * s4 - s2y * s3) + s2 * (s1y * s3 - s2y * s2)) / det;
      b = (n * (s1y * s4 - s2y * s3) - sy * (s1 * s4 - s3 * s2) + s2 * (s1 * s2y - s1y * s2)) / det;
      a = (n * (s2 * s2y - s3 * s1y) - s1 * (s1 * s2y - s1y * s2) + sy * (s1 * s3 - s2 * s2)) / det;
    }

    // 3. Baseline: median of first min(50, n) turns
    var baseN = Math.min(50, n);
    var baseSorted = cost.slice(0, baseN).sort(function (x, y) { return x - y; });
    var baseline = baseSorted[Math.floor(baseSorted.length / 2)];
    if (baseline < 1) baseline = 1;

    // 4. Zone thresholds
    var threshYellow = baseline * 1.5;
    var threshRed = baseline * 3;

    // 6. Detect compaction events
    var compactions = [];
    for (var ci = 1; ci < n; ci++) {
      var prev = turns[ci - 1], cur = turns[ci];
      var prevCR = prev.cache_read || 0, curCR = cur.cache_read || 0;
      var curCC = cur.cache_creation || 0, prevCC = prev.cache_creation || 0;
      if (prevCR > 10000 && curCR < prevCR * 0.3 && curCC > prevCC * 10) {
        compactions.push(ci);
      } else if (prevCR > 10000 && curCR === 0 && curCC > 50000) {
        compactions.push(ci);
      }
    }

    // 7. Build series data
    var xData = [];
    var scatterData = [];
    var fitLine = [];
    var isCompaction = {};
    for (var cci = 0; cci < compactions.length; cci++) isCompaction[compactions[cci]] = true;

    for (var di = 0; di < n; di++) {
      xData.push(di + 1);
      var val = cost[di];
      var fitVal = Math.round(a * di * di + b * di + c);
      var color;
      if (isCompaction[di]) {
        color = "rgba(212,175,127,0.9)";
      } else if (val <= threshYellow) {
        color = "rgba(34,197,94,0.7)";
      } else if (val <= threshRed) {
        color = "rgba(250,204,21,0.7)";
      } else {
        color = "rgba(239,68,68,0.7)";
      }
      scatterData.push({
        value: val,
        itemStyle: { color: color },
        symbolSize: isCompaction[di] ? 8 : 4
      });
      fitLine.push(fitVal);
    }

    // 7b. Compaction vertical lines with labels
    var compactionLines = [];
    for (var cli = 0; cli < compactions.length; cli++) {
      var cIdx = compactions[cli];
      var cVal = cost[cIdx];
      var cTurn = turns[cIdx];
      var cColor = cVal <= threshYellow ? "rgba(34,197,94,0.5)"
                 : cVal <= threshRed   ? "rgba(250,204,21,0.5)"
                 :                       "rgba(239,68,68,0.5)";
      var cType = (cTurn.cache_read || 0) === 0 ? "Rebuild" : "Compact";
      compactionLines.push({
        xAxis: cIdx,
        lineStyle: { color: cColor, type: "solid", width: 1 },
        label: {
          formatter: "C" + (cli + 1) + " " + cType,
          color: "rgba(212,175,127,0.8)",
          fontSize: 9,
          position: "insideStartTop",
          rotate: 90,
          distance: 5
        }
      });
    }

    // 7c. Detect if THIS session is a forced restart
    var _isRebuiltSession = false;
    var _rebuildTurns = 0;
    var _rebuildCostExp = 0;
    var _udataExp = window.__dashboardState.getData() || null;
    var _sessionDateExp = session.first_ts?.slice(0, 10) || "";
    var _dayHitExp = 0;
    if (_sessionDateExp && _udataExp?.days) {
      var _matchDayExp = _udataExp.days.find(function (d) { return d.date === _sessionDateExp; });
      if (_matchDayExp) _dayHitExp = _matchDayExp.hit_limit || 0;
    }
    if (_dayHitExp > 0 && _econData?.sessions && session.first_ts) {
      var _thisStart = new Date(session.first_ts).getTime();
      var _prevGap = Infinity;
      for (var _ps of _econData.sessions) {
        if (_ps.session_id_hash === session.session_id_hash) continue;
        var _pEnd = new Date(_ps.last_ts).getTime();
        var _pg = _thisStart - _pEnd;
        if (_pg > 0 && _pg < _prevGap) _prevGap = _pg;
      }
      if (_prevGap < 5 * 60000) {
        _isRebuiltSession = true;
        for (var ri = 0; ri < Math.min(50, n); ri++) {
          _rebuildCostExp += cost[ri];
          if (ri > 3 && cost[ri] <= baseline * 1.2) { _rebuildTurns = ri + 1; break; }
        }
        if (_rebuildTurns === 0) _rebuildTurns = Math.min(10, n);
      }
    }

    // 7d. Accumulated context-loss + cumulative usage data for lower grid
    var hasCL = compactions.length > 0;
    var cumLossData = [];
    var cumTotalData = [];
    var lossAtEvent = {};
    var cumT = 0;
    var cumL = 0;
    for (var ldi = 0; ldi < n; ldi++) {
      cumT += cost[ldi];
      cumTotalData.push(cumT);
      if (hasCL && isCompaction[ldi] && ldi > 0) {
        var lprev = turns[ldi - 1].cache_read || 0;
        var lcur = turns[ldi].cache_read || 0;
        var ldiff = lprev - lcur;
        if (ldiff > 0) {
          cumL += ldiff;
          lossAtEvent[ldi] = { loss: ldiff, prevCR: lprev, curCR: lcur, pct: lprev > 0 ? Math.round((ldiff / lprev) * 100) : 0 };
        }
      }
      cumLossData.push(cumL);
    }
    var clMarkLines = [];
    if (hasCL) {
      for (var clmi = 0; clmi < compactions.length; clmi++) {
        var clIdx = compactions[clmi];
        var clEvt = lossAtEvent[clIdx];
        if (clEvt) {
          clMarkLines.push({
            xAxis: clIdx,
            lineStyle: { color: "rgba(239,68,68,0.6)", type: "solid", width: 1.5 },
            label: {
              formatter: "Lost " + fmt(clEvt.loss) + " (" + clEvt.pct + "%)",
              color: "#ffffff",
              fontSize: 10,
              position: "insideStartTop",
              rotate: 90,
              distance: 4,
              backgroundColor: "rgba(30,58,138,0.85)",
              padding: [3, 5],
              borderRadius: 2
            }
          });
        }
      }
    }

    // 8. Zone label helpers
    var warmupLabel = t("econExplosionWarmup") || "Warmup";
    var linearLabel = t("econExplosionLinear") || "Linear";
    var drainLabel  = t("econExplosionDrain")  || "Drain";

    // 8. Build markAreas for zones (horizontal bands)
    var yMax = Math.max.apply(null, cost) * 1.1;
    var markAreaData = [
      [{ yAxis: 0, itemStyle: { color: "rgba(34,197,94,0.06)" } },
       { yAxis: threshYellow }],
      [{ yAxis: threshYellow, itemStyle: { color: "rgba(250,204,21,0.06)" } },
       { yAxis: threshRed }],
      [{ yAxis: threshRed, itemStyle: { color: "rgba(239,68,68,0.06)" } },
       { yAxis: yMax }]
    ];

    // 8b. Rebuild zone overlay
    if (_isRebuiltSession && _rebuildTurns > 0) {
      markAreaData.push([
        { xAxis: 0, name: "Rebuild (" + fmt(_rebuildCostExp) + ")", itemStyle: { color: "rgba(245,158,11,0.12)" }, label: { color: "rgba(245,158,11,0.6)", fontSize: 10, position: "insideTop" } },
        { xAxis: _rebuildTurns }
      ]);
    }

    // 9. Zone threshold lines
    var markLineData = [];
    markLineData.push(
      {
        yAxis: threshYellow,
        label: { formatter: warmupLabel + " / " + linearLabel, color: "#fbbf24", fontSize: 9, position: "insideEndTop" },
        lineStyle: { color: "rgba(250,204,21,0.4)", type: "dashed", width: 1 }
      },
      {
        yAxis: threshRed,
        label: { formatter: linearLabel + " / " + drainLabel, color: "#ef4444", fontSize: 9, position: "insideEndTop" },
        lineStyle: { color: "rgba(239,68,68,0.4)", type: "dashed", width: 1 }
      }
    );

    var legCostPerTurn = t("econLegendCostPerTurn");
    var legQuadFitLine = t("econLegendQuadraticFitLine");
    // This series was historically labelled "Context Size" while its data
    // was actually cache_read / (cache_read + cache_creation) * 15. Keep the
    // real metric and name it honestly; it gets its own 0–100% axis below.
    var legCacheHealth = "Cache Health";
    var legCostFactor = t("econLegendCostFactor");
    var legTipMap = {};
    legTipMap[legCostPerTurn] = t("econLegendTipCostPerTurn");
    legTipMap[legQuadFitLine] = t("econLegendTipQuadraticFit");
    legTipMap[legCacheHealth] = "Cache-read share of cache traffic. Gaps mean no cache usage was reported.";
    legTipMap[legCostFactor] = t("econLegendTipCostFactor");

    // Pre-build cumulative curve data for lower grid toggle
    var cumFitA = 0, cumFitB = 0, cumFitC = 0;
    (function () {
      var cs1 = 0, cs2 = 0, cs3 = 0, cs4 = 0, csy = 0, cs1y = 0, cs2y = 0;
      for (var cfi = 0; cfi < n; cfi++) {
        var ct2 = cfi * cfi;
        cs1 += cfi; cs2 += ct2; cs3 += ct2 * cfi; cs4 += ct2 * ct2;
        csy += cumTotalData[cfi]; cs1y += cfi * cumTotalData[cfi]; cs2y += ct2 * cumTotalData[cfi];
      }
      var cdet = n * (cs2 * cs4 - cs3 * cs3) - cs1 * (cs1 * cs4 - cs3 * cs2) + cs2 * (cs1 * cs3 - cs2 * cs2);
      if (Math.abs(cdet) > 1e-10) {
        cumFitC = (csy * (cs2 * cs4 - cs3 * cs3) - cs1 * (cs1y * cs4 - cs2y * cs3) + cs2 * (cs1y * cs3 - cs2y * cs2)) / cdet;
        cumFitB = (n * (cs1y * cs4 - cs2y * cs3) - csy * (cs1 * cs4 - cs3 * cs2) + cs2 * (cs1 * cs2y - cs1y * cs2)) / cdet;
        cumFitA = (n * (cs2 * cs2y - cs3 * cs1y) - cs1 * (cs1 * cs2y - cs1y * cs2) + csy * (cs1 * cs3 - cs2 * cs2)) / cdet;
      }
    })();
    var cumProjectN = Math.max(Math.round(n * 0.5), 20);
    var cumTotalTurns = n + cumProjectN;
    var cumActualPairs = [];
    var cumProjectedPairs = [];
    var cumFitPairs = [];
    for (var cxi = 0; cxi < cumTotalTurns; cxi++) {
      var ctn = cxi + 1;
      var cfitted = Math.round(cumFitA * cxi * cxi + cumFitB * cxi + cumFitC);
      cumFitPairs.push([ctn, cfitted]);
      if (cxi < n) {
        cumActualPairs.push([ctn, cumTotalData[cxi]]);
        if (cxi === n - 1) cumProjectedPairs.push([ctn, cumTotalData[cxi]]);
      } else {
        cumProjectedPairs.push([ctn, cfitted]);
      }
    }
    var cumCurrentTotal = cumTotalData[n - 1];
    var cumBurnThresh = cumCurrentTotal * 1.5;
    var cumWallTurn = -1;
    for (var cwi = n; cwi < cumTotalTurns; cwi++) {
      if (cumFitPairs[cwi] && cumFitPairs[cwi][1] >= cumBurnThresh) {
        cumWallTurn = cwi + 1;
        break;
      }
    }

    var option = {
      axisPointer: hasCL ? { link: [{ xAxisIndex: [0, 1] }] } : undefined,
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          var idx = -1;
          for (var fp = 0; fp < params.length; fp++) {
            if (params[fp].seriesName === legCostPerTurn) { idx = params[fp].dataIndex; break; }
          }
          if (idx < 0) idx = params[0].dataIndex;
          var lines = ["Turn " + (idx + 1)];
          if (idx < n && cost[idx] != null) {
            var val = cost[idx];
            var factor = (baseline > 0) ? (val / baseline).toFixed(1) : "-";
            var zone = val <= threshYellow ? warmupLabel : val <= threshRed ? linearLabel : drainLabel;
            lines.push("Cost: " + fmt(val) + " (" + factor + "\u00d7)");
            var TT = turns[idx];
            if (TT) {
              var ttCacheTotal = (TT.cache_read || 0) + (TT.cache_creation || 0);
              lines.push(
                "out=" + fmt(TT.output || 0) + " cr=" + fmt(TT.cache_read || 0),
                "cc=" + fmt(TT.cache_creation || 0) + " in=" + fmt(TT.input || 0)
              );
              if (ttCacheTotal > 0) {
                lines.push("Cache health: " + (((TT.cache_read || 0) / ttCacheTotal) * 100).toFixed(1) + "%");
              }
            }
            if (isCompaction[idx]) {
              var prevCR2 = idx > 0 ? (turns[idx - 1].cache_read || 0) : 0;
              var curCR2 = turns[idx].cache_read || 0;
              var lossP = prevCR2 > 0 ? Math.round((1 - curCR2 / prevCR2) * 100) : 0;
              lines.push(
                "<span style='color:#D4AF7F'>" + t("econCompactionLabel") + "</span>",
                "<span style='color:#D4AF7F'>Context lost: " + lossP + "% (" + fmt(prevCR2) + " \u2192 " + fmt(curCR2) + ")</span>"
              );
            } else {
              lines.push("Zone: " + zone);
            }
            for (var pi = 1; pi < params.length; pi++) {
              if (params[pi].seriesName === legQuadFitLine && params[pi].value != null) {
                lines.push("Fit: " + fmt(params[pi].value));
                break;
              }
            }
            if (hasCL && cumLossData[idx] > 0 && cumTotalData[idx] > 0) {
              var idealVal = cumTotalData[idx] - cumLossData[idx];
              var wastePct = Math.round(cumLossData[idx] / cumTotalData[idx] * 100);
              lines.push("<span style='color:#ef4444'>Overhead: " + fmt(cumLossData[idx]) + " (" + wastePct + "% wasted)</span>");
              lines.push("<span style='color:#D4AF7F'>Without loss: " + fmt(idealVal) + "</span>");
            }
          } else {
            lines[0] = "Turn " + (idx + 1) + " <span style='color:#8C6A3F'>(projected)</span>";
            var projFit = Math.round(cumFitA * idx * idx + cumFitB * idx + cumFitC);
            if (projFit > 0) lines.push("<span style='color:#ef4444'>Projected: " + fmt(projFit) + "</span>");
            if (cumWallTurn > 0 && idx + 1 >= cumWallTurn) {
              lines.push("<span style='color:#ef4444;font-weight:bold'>Burn Zone</span>");
            }
          }
          return lines.join("<br>");
        }
      },
      legend: {
        top: 4,
        textStyle: { color: "#A0875E", fontSize: 11 },
        data: [legCostPerTurn, legQuadFitLine, legCacheHealth, legCostFactor],
        tooltip: {
          show: true,
          formatter: function (p) {
            return legTipMap[p.name] || "";
          }
        }
      },
      grid: hasCL
        ? [
          { top: 50, right: 74, bottom: "35%", left: 60 },
          { top: "72%", right: 74, bottom: 30, left: 60 }
        ]
        : [{ top: 50, right: 74, bottom: 40, left: 60 }],
      xAxis: hasCL
        ? [
          { type: "category", gridIndex: 0, data: xData, axisLabel: { show: false }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
          { type: "category", gridIndex: 1, data: xData, axisLabel: { color: "#8C6A3F", fontSize: 9, interval: function (idx) { return idx % Math.ceil(n / 20) === 0; } }, splitLine: { show: false } }
        ]
        : [{
          type: "category", data: xData,
          axisLabel: { color: "#8C6A3F", fontSize: 9, interval: function (idx) { return idx % Math.ceil(n / 20) === 0; } },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
        }],
      yAxis: hasCL
        ? [
          { type: "value", gridIndex: 0, axisLabel: { color: "#8C6A3F", formatter: function (v) { return fmt(v); } }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
          { type: "value", gridIndex: 0, position: "right", axisLabel: { color: "#db27b4", fontSize: 9, inside: true, formatter: function (v) { return v.toFixed(0) + "\u00d7"; } }, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: "rgba(219,39,180,0.3)" } } },
          { type: "value", gridIndex: 1, axisLabel: { color: "#ef4444", fontSize: 9, formatter: function (v) { return v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v); } }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
          { type: "value", gridIndex: 0, position: "right", offset: 42, min: 0, max: 105, axisLabel: { color: "#38bdf8", fontSize: 9, formatter: function (v) { return v > 100 ? "" : v + "%"; } }, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: "rgba(56,189,248,0.35)" } } }
        ]
        : [
          { type: "value", axisLabel: { color: "#8C6A3F", formatter: function (v) { return fmt(v); } }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
          { type: "value", position: "right", axisLabel: { color: "#db27b4", fontSize: 9, inside: true, formatter: function (v) { return v.toFixed(0) + "\u00d7"; } }, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: "rgba(219,39,180,0.3)" } } },
          { type: "value", position: "right", offset: 42, min: 0, max: 105, axisLabel: { color: "#38bdf8", fontSize: 9, formatter: function (v) { return v > 100 ? "" : v + "%"; } }, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: "rgba(56,189,248,0.35)" } } }
        ],
      series: (function () {
        var s = [
          {
            name: legCostPerTurn,
            type: "scatter",
            xAxisIndex: 0, yAxisIndex: 0,
            symbolSize: 4,
            data: scatterData,
            markArea: { silent: true, data: markAreaData },
            markLine: { silent: true, symbol: "none", data: markLineData.concat(compactionLines) }
          },
          {
            name: legQuadFitLine,
            type: "line",
            xAxisIndex: 0, yAxisIndex: 0,
            lineStyle: { color: "rgba(251,191,36,0.7)", width: 2, type: "dashed" },
            symbol: "none", data: fitLine, z: 5
          },
          {
            name: legCacheHealth,
            type: "line",
            xAxisIndex: 0, yAxisIndex: hasCL ? 3 : 2,
            lineStyle: { color: "#38bdf8", width: 1.3, type: "solid" },
            symbol: "none",
            connectNulls: false,
            z: 6,
            data: turns.map(function (T) {
              var cIO = (T.cache_read || 0) + (T.cache_creation || 0);
              if (cIO <= 0) return null;
              return +(((T.cache_read || 0) / cIO) * 100).toFixed(1);
            }),
            z: 2
          },
          {
            name: legCostFactor,
            type: "line",
            xAxisIndex: 0, yAxisIndex: 1,
            lineStyle: { color: "rgba(219,39,180,0.6)", width: 1.5 },
            symbol: "none",
            data: cost.map(function (v) { return +(v / (cost[0] || 1)).toFixed(1); }),
            z: 4
          }
        ];
        if (hasCL) {
          s.push({
            name: "Accumulated Loss",
            type: "line",
            xAxisIndex: 1, yAxisIndex: 2,
            step: "end",
            lineStyle: { color: "rgba(239,68,68,0.8)", width: 2 },
            itemStyle: { color: "rgba(239,68,68,0.8)" },
            symbol: "none",
            data: cumLossData,
            markLine: { silent: true, symbol: "none", data: clMarkLines }
          });
        }
        return s;
      })()
    };

    el.style.height = hasCL ? "480px" : "300px";
    __effInitOrSet("econExplosion", el, option, true);

    // Toggle switch: Context Loss / Cumulative Usage in lower grid
    if (hasCL) {
      var toggleId = "econ-explosion-lower-toggle";
      var existing = document.getElementById(toggleId);
      if (existing) existing.remove();
      var toggle = document.createElement("div");
      toggle.id = toggleId;
      toggle.style.cssText = "display:flex;gap:4px;margin:4px 0 0 60px;";
      var btnLoss = document.createElement("button");
      btnLoss.textContent = t("econBtnContextLoss") || "Context Loss";
      btnLoss.className = "sidebar-btn-sm";
      btnLoss.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;";
      var btnCum = document.createElement("button");
      btnCum.textContent = t("econBtnCumulative") || "Cumulative";
      btnCum.className = "sidebar-btn-sm";
      btnCum.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;opacity:0.5;";
      toggle.appendChild(btnLoss);
      toggle.appendChild(btnCum);

      el.parentElement.insertBefore(toggle, el);

      // Safe/Burn zone areas for cumulative view
      var cumZoneAreas = [];
      cumZoneAreas.push([
        { xAxis: 1, itemStyle: { color: "rgba(34,197,94,0.06)" } },
        { xAxis: n }
      ]);
      if (cumWallTurn > 0 && cumWallTurn > n + 1) {
        cumZoneAreas.push([
          { xAxis: n, name: "Safe (" + (cumWallTurn - n) + " turns)", itemStyle: { color: "rgba(250,204,21,0.12)" }, label: { color: "rgba(250,204,21,0.6)", fontSize: 10 } },
          { xAxis: cumWallTurn }
        ]);
      }
      if (cumWallTurn > 0) {
        cumZoneAreas.push([
          { xAxis: cumWallTurn, name: "Burn Zone", itemStyle: { color: "rgba(239,68,68,0.14)" }, label: { color: "rgba(239,68,68,0.5)", fontSize: 10 } },
          { xAxis: cumTotalTurns }
        ]);
      }
      var cumWallLine = cumWallTurn > 0 ? [{
        xAxis: cumWallTurn,
        lineStyle: { color: "#ef4444", type: "dashed", width: 1.5 },
        label: { show: false }
      }] : [];

      var _lowerMode = "loss";
      function _updateLower(mode) {
        _lowerMode = mode;
        btnLoss.style.opacity = mode === "loss" ? "1" : "0.5";
        btnCum.style.opacity = mode === "cumulative" ? "1" : "0.5";
        btnLoss.classList.toggle("is-active", mode === "loss");
        btnCum.classList.toggle("is-active", mode === "cumulative");
        btnLoss.setAttribute("aria-pressed", mode === "loss" ? "true" : "false");
        btnCum.setAttribute("aria-pressed", mode === "cumulative" ? "true" : "false");
        var chart = _effCharts.econExplosion;
        if (!chart) return;
        var isLoss = mode === "loss";
        var lowerSeries = [];
        var lowerXAxis, lowerYAxis;
        if (isLoss) {
          lowerXAxis = { type: "category", gridIndex: 1, data: xData, axisLabel: { color: "#8C6A3F", fontSize: 9, interval: function (idx) { return idx % Math.ceil(n / 20) === 0; } }, splitLine: { show: false } };
          lowerYAxis = {
            type: "value", gridIndex: 1,
            axisLabel: { color: "#ef4444", fontSize: 9, formatter: function (v) { return v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v); } },
            splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
          };
          lowerSeries.push({
            name: "Accumulated Loss",
            type: "line", xAxisIndex: 1, yAxisIndex: 2,
            step: "end",
            areaStyle: { color: "rgba(239,68,68,0.15)" },
            lineStyle: { color: "rgba(239,68,68,0.8)", width: 2 },
            itemStyle: { color: "rgba(239,68,68,0.8)" },
            symbol: "none", data: cumLossData,
            markLine: { silent: true, symbol: "none", data: clMarkLines }
          });
        } else {
          // Per-turn cache_read: Actual (saw-tooth) vs Envelope (no drops)
          var actualCR = [];
          var envelopeCR = [];
          var adjustment = 0;
          var compMeta = {};
          for (var opi = 0; opi < n; opi++) {
            var cr = turns[opi].cache_read || 0;
            if (isCompaction[opi] && opi > 0) {
              var prevCR = turns[opi - 1].cache_read || 0;
              var drop = prevCR - cr;
              if (drop > 0) {
                var ft = a * opi * opi + b * opi + c;
                var favg = (a * opi * opi / 3) + (b * opi / 2) + c;
                var mt = favg > 0 ? ft / favg : 1;
                if (mt < 1) mt = 1;
                var mreal = 1 + mt;
                adjustment += drop * mreal;
                compMeta[opi] = { drop: drop, mt: mt, mreal: mreal, realCost: Math.round(drop * mreal), prevCR: prevCR, curCR: cr };
              }
            }
            actualCR.push(cr);
            envelopeCR.push(cr + adjustment);
          }
          var totalLostCR = adjustment;

          lowerXAxis = { type: "category", gridIndex: 1, data: xData, axisLabel: { color: "#8C6A3F", fontSize: 9, interval: function (idx) { return idx % Math.ceil(n / 20) === 0; } }, splitLine: { show: false } };
          lowerYAxis = {
            type: "value", gridIndex: 1,
            axisLabel: { color: "#8C6A3F", fontSize: 9, formatter: function (v) { return v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v); } },
            splitLine: { lineStyle: { color: "rgba(42,45,52,.15)" } }
          };
          var deltaData = [];
          for (var dli = 0; dli < n; dli++) {
            deltaData.push(envelopeCR[dli] - actualCR[dli]);
          }
          lowerSeries.push(
            {
              name: t("econSeriesActualCR") || "Actual cache_read",
              type: "line", xAxisIndex: 1, yAxisIndex: 2,
              stack: "crStack",
              showSymbol: false,
              lineStyle: { color: "#A0875E", width: 2 },
              areaStyle: { color: "transparent" },
              z: 2, data: actualCR
            },
            {
              name: t("econSeriesLostContext") || "Lost context",
              type: "line", xAxisIndex: 1, yAxisIndex: 2,
              stack: "crStack",
              showSymbol: false,
              lineStyle: { color: "transparent", width: 0 },
              areaStyle: { color: "rgba(239,68,68,0.25)" },
              z: 2, data: deltaData
            },
            {
              name: t("econSeriesWithoutLoss") || "Without loss",
              type: "line", xAxisIndex: 1, yAxisIndex: 2,
              showSymbol: false,
              lineStyle: { color: "#86efac", width: 2 },
              z: 3, data: envelopeCR,
              markLine: (function () {
                var cmLines = [];
                var cmKeys = Object.keys(compMeta);
                for (var cmi = 0; cmi < cmKeys.length; cmi++) {
                  var cmIdx = Number(cmKeys[cmi]);
                  var cm = compMeta[cmIdx];
                  cmLines.push({
                    xAxis: cmIdx,
                    lineStyle: { color: "rgba(212,175,127,0.5)", type: "solid", width: 1 },
                    label: {
                      formatter: fmt(cm.realCost) + " (" + cm.mreal.toFixed(1) + "\u00d7)",
                      color: "#ffffff",
                      fontSize: 9,
                      position: "end",
                      rotate: 0,
                      distance: -14,
                      backgroundColor: "rgba(212,175,127,0.8)",
                      padding: [2, 4],
                      borderRadius: 2
                    }
                  });
                }
                return cmLines.length ? { silent: true, symbol: "none", data: cmLines } : undefined;
              })(),
              markArea: (function () {
                var fitYellow = -1, fitRed = -1;
                for (var bzi = 0; bzi < n; bzi++) {
                  var fitVal = a * bzi * bzi + b * bzi + c;
                  if (fitYellow < 0 && fitVal >= threshYellow) fitYellow = bzi;
                  if (fitRed < 0 && fitVal >= threshRed) fitRed = bzi;
                }
                var zones = [];
                var zy = fitYellow > 0 ? fitYellow : n - 1;
                zones.push([
                  { xAxis: 0, itemStyle: { color: "rgba(34,197,94,0.06)" } },
                  { xAxis: zy }
                ]);
                if (fitYellow > 0 && fitYellow < n) {
                  var zr = fitRed > 0 ? fitRed : n - 1;
                  zones.push([
                    { xAxis: fitYellow, name: linearLabel, itemStyle: { color: "rgba(250,204,21,0.08)" }, label: { color: "rgba(250,204,21,0.5)", fontSize: 9, position: "insideTop", distance: 4 } },
                    { xAxis: zr }
                  ]);
                  if (fitRed > 0 && fitRed < n) {
                    zones.push([
                      { xAxis: fitRed, name: drainLabel, itemStyle: { color: "rgba(239,68,68,0.12)" }, label: { color: "rgba(239,68,68,0.6)", fontSize: 9, position: "insideTop", distance: 4 } },
                      { xAxis: n - 1 }
                    ]);
                  }
                }
                return zones.length ? { silent: true, data: zones } : undefined;
              })()
            }
          );
        }
        // Preserve upper axes, especially Cache Health at yAxisIndex 3.
        // Rebuilding from only axes 0/1 made that series reference a missing
        // axis, so ECharts rejected the mode switch.
        var ya = option.yAxis.slice();
        ya[2] = Array.isArray(lowerYAxis) ? lowerYAxis[0] : lowerYAxis;
        var xa = option.xAxis.slice();
        xa[1] = lowerXAxis;
        var upperSeries = option.series.slice(0, 4);
        var newTooltip = isLoss ? option.tooltip : {
          trigger: "axis",
          formatter: function (params) {
            var idx = params[0]?.dataIndex;
            if (idx == null || idx < 0) return "";
            var lines = ["<b>Turn " + (idx + 1) + "</b>"];
            var aCR = actualCR[idx] || 0;
            var eCR = envelopeCR[idx] || 0;
            var gap = eCR - aCR;
            lines.push("cache_read: " + fmt(aCR));
            if (gap > 0) {
              lines.push("Envelope: " + fmt(eCR));
              lines.push("<span style='color:#ef4444'>Gap: " + fmt(gap) + "</span>");
            }
            var cm = compMeta[idx];
            if (cm) {
              var ftVal = Math.round(a * idx * idx + b * idx + c);
              var favgVal = Math.round((a * idx * idx / 3) + (b * idx / 2) + c);
              lines.push("");
              lines.push("<span style='color:#D4AF7F'>\u25c6 Compaction</span>");
              lines.push(fmt(cm.prevCR) + " \u2192 " + fmt(cm.curCR) + " (Drop " + fmt(cm.drop) + ")");
              lines.push("");
              lines.push("<span style='color:#ef4444'>f(t) = " + fmt(ftVal) + "  (cost at turn " + (idx + 1) + ")</span>");
              lines.push("<span style='color:#86efac'>f_avg = " + fmt(favgVal) + "  (avg cost turns 0-" + (idx + 1) + ")</span>");
              lines.push("<span style='color:#fbbf24'>M(t) = " + fmt(ftVal) + " / " + fmt(favgVal) + " = " + cm.mt.toFixed(2) + "\u00d7</span>");
              lines.push("<span style='color:#ef4444'>M_real = 1 + " + cm.mt.toFixed(2) + " = " + cm.mreal.toFixed(2) + "\u00d7</span>");
              lines.push("");
              lines.push("<span style='color:#ef4444;font-weight:bold'>Real cost: " + fmt(cm.drop) + " \u00d7 " + cm.mreal.toFixed(2) + " = " + fmt(cm.realCost) + "</span>");
            }
            return lines.join("<br>");
          }
        };
        chart.setOption({
          tooltip: newTooltip,
          axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
          xAxis: xa,
          yAxis: ya,
          visualMap: [],
          series: upperSeries.concat(lowerSeries)
        }, { replaceMerge: ['series', 'xAxis', 'yAxis'] });
      }
      // Zone boundaries for cumulative view
      var zoneYellowTurn = -1, zoneRedTurn = -1;
      for (var zi = 10; zi < n; zi++) {
        var cumFit = a * zi * zi + b * zi + c;
        var cumLin = b * zi + c;
        var zRatio = cumLin > 0 ? cumFit / cumLin : 1;
        if (zoneYellowTurn < 0 && zRatio >= 1.5) zoneYellowTurn = zi;
        if (zoneRedTurn < 0 && zRatio >= 3) zoneRedTurn = zi;
      }
      var cumZoneAreas2 = [];
      if (zoneYellowTurn > 0) {
        cumZoneAreas2.push([
          { xAxis: 0, itemStyle: { color: "rgba(34,197,94,0.08)" } },
          { xAxis: zoneYellowTurn }
        ]);
      }
      if (zoneYellowTurn >= 0 && zoneRedTurn > zoneYellowTurn) {
        cumZoneAreas2.push([
          { xAxis: zoneYellowTurn, itemStyle: { color: "rgba(250,204,21,0.08)" } },
          { xAxis: zoneRedTurn }
        ]);
      }
      if (zoneRedTurn >= 0) {
        cumZoneAreas2.push([
          { xAxis: zoneRedTurn, itemStyle: { color: "rgba(239,68,68,0.08)" } },
          { xAxis: n - 1 }
        ]);
      } else if (zoneYellowTurn < 0) {
        cumZoneAreas2.push([
          { xAxis: 0, itemStyle: { color: "rgba(34,197,94,0.08)" } },
          { xAxis: n - 1 }
        ]);
      }
      var cumZoneLines = [];
      if (zoneYellowTurn > 0) {
        cumZoneLines.push({
          xAxis: zoneYellowTurn,
          lineStyle: { color: "rgba(250,204,21,0.5)", type: "dashed", width: 1 },
          label: { formatter: warmupLabel + " / " + linearLabel, color: "#fbbf24", fontSize: 8, position: "insideEndTop" }
        });
      }
      if (zoneRedTurn > 0) {
        cumZoneLines.push({
          xAxis: zoneRedTurn,
          lineStyle: { color: "rgba(239,68,68,0.5)", type: "dashed", width: 1 },
          label: { formatter: linearLabel + " / " + drainLabel, color: "#ef4444", fontSize: 8, position: "insideEndTop" }
        });
      }

      btnLoss.addEventListener("click", function () { _updateLower("loss"); });
      btnCum.addEventListener("click", function () { _updateLower("cumulative"); });
      btnLoss.classList.add("is-active");
      btnLoss.setAttribute("aria-pressed", "true");
      btnCum.setAttribute("aria-pressed", "false");
    }
  }

  // ── renderEfficiencyTimeline ────────────────────────────────────────

  function renderEfficiencyTimeline(stData) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-efficiency");
    if (!el || !stData?.sessions) return;

    var hourly = {};
    for (var si = 0; si < stData.sessions.length; si++) {
      var turns = stData.sessions[si].turns;
      for (var ti = 0; ti < turns.length; ti++) {
        var T = turns[ti];
        var h = Number.parseInt(T.ts.slice(11, 13), 10);
        if (!hourly[h]) hourly[h] = { output: 0, total: 0 };
        hourly[h].output += T.output;
        hourly[h].total += T.input + T.output + T.cache_read + T.cache_creation;
      }
    }

    var hours = Object.keys(hourly).map(Number).sort(function (a, b) { return a - b; });
    if (!hours.length) return;
    var xData = hours.map(function (h) { return (h < 10 ? "0" : "") + h + ":00"; });
    var outputData = hours.map(function (h) { return hourly[h].output; });
    var totalData = hours.map(function (h) { return hourly[h].total; });

    var peakStart = 13;
    var peakEnd = 19;

    var option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          var lines = [params[0].axisValue];
          for (var p = 0; p < params.length; p++) {
            lines.push(params[p].marker + " " + params[p].seriesName + ": " + fmt(params[p].value));
          }
          var idx = params[0].dataIndex;
          var h = hours[idx];
          if (h >= peakStart && h < peakEnd) lines.push("\u26a0 " + t("econEfficiencyPeakBand"));
          var tot = totalData[idx];
          var out = outputData[idx];
          if (tot > 0) lines.push(t("econEfficiencyRatio") + ": " + (out / tot * 100).toFixed(2) + "%");
          return lines.join("<br>");
        }
      },
      legend: { top: 4, textStyle: { color: "#A0875E", fontSize: 11 } },
      grid: { top: 50, right: 50, bottom: 40, left: 60 },
      xAxis: { type: "category", data: xData, axisLabel: { color: "#8C6A3F", fontSize: 9, rotate: 45 }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
      yAxis: [
        { type: "value", name: t("econEfficiencyTotal"), axisLabel: { color: "#8C6A3F", formatter: function (v) { return fmt(v); } }, position: "left", splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
        { type: "value", name: t("econEfficiencyOutput"), axisLabel: { color: "#34d399", fontSize: 9, formatter: function (v) { return fmt(v); } }, position: "right", splitLine: { show: false } }
      ],
      series: [
        {
          name: t("econEfficiencyTotal"),
          type: "bar",
          yAxisIndex: 0,
          itemStyle: { color: "rgba(100,116,139,0.45)" },
          data: totalData,
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(251,146,60,0.1)" },
            label: { show: true, formatter: t("econEfficiencyPeakBand"), color: "rgba(251,146,60,0.5)", fontSize: 9, position: "insideTop" },
            data: [[{ xAxis: (peakStart < 10 ? "0" : "") + peakStart + ":00" }, { xAxis: (peakEnd < 10 ? "0" : "") + peakEnd + ":00" }]]
          }
        },
        {
          name: t("econEfficiencyOutput"),
          type: "bar",
          yAxisIndex: 1,
          itemStyle: { color: "rgba(52,211,153,0.7)" },
          data: outputData
        }
      ]
    };

    __effInitOrSet("econEfficiency", el, option, true);
  }

  // ── renderMonthlyButterfly ──────────────────────────────────────────

  var _butterflyMode = "cache";
  var _butterflyDays = null;
  var _butterflyGran = "day"; // "day" | "turn"

  // Flatten the selected day's session turns into Butterfly-shaped rows so the
  // same render path works at turn granularity. Per-turn cache_read/cache_creation
  // and input/output come from the JSONL session logs (session-turns-core.js).
  function __butterflyTurnRows() {
    if (!_econData || !_econData.sessions || !_econData.sessions.length) return null;
    var dateKey = _econData.date || "";
    var sess = _econData.sessions.slice().sort(function (a, b) { return a.first_ts < b.first_ts ? -1 : 1; });
    var rows = [];
    for (var si = 0; si < sess.length; si++) {
      var rawTurns = sess[si].turns || [];
      var turns = dateKey ? rawTurns.filter(function (tt) { return tt.ts && tt.ts.slice(0, 10) === dateKey; }) : rawTurns;
      for (var ti = 0; ti < turns.length; ti++) {
        var T = turns[ti];
        rows.push({ date: T.ts || "", input: T.input || 0, output: T.output || 0, cache_read: T.cache_read || 0, cache_creation: T.cache_creation || 0 });
      }
    }
    return rows.length ? rows : null;
  }

  /** Linear regression helper */
  function __econLinReg(vals) {
    var n = vals.length;
    if (n < 2) return { data: vals.slice(), slope: 0 };
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var k = 0; k < n; k++) {
      sx += k;
      sy += vals[k];
      sxy += k * vals[k];
      sxx += k * k;
    }
    var sl = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    var ic = (sy - sl * sx) / n;
    var line = [];
    for (var j = 0; j < n; j++) line.push(Math.round((ic + sl * j) * 100) / 100);
    return { data: line, slope: sl };
  }

  function renderMonthlyButterfly(days, mode) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-waste-month");
    if (mode) _butterflyMode = mode;
    if (days && days.length) _butterflyDays = days; // remember the DAY source only

    // Turn granularity only applies to I/O — Cache×Turn is redundant with the
    // Cache-Explosion chart, so Cache always stays at day granularity.
    var isTurn = (_butterflyGran === "turn" && _butterflyMode === "io");
    if (isTurn) {
      var _tr = __butterflyTurnRows();
      days = (_tr && _tr.length >= 2) ? _tr : (_butterflyDays || days);
    } else {
      days = _butterflyDays || days;
    }
    if (!el || !days || days.length < 2) return;

    var xData = [];
    var blurbKey;
    var blurbEl = document.getElementById("econ-waste-month-blurb");

    for (var i = 0; i < days.length; i++) {
      xData.push(isTurn ? String(i + 1) : days[i].date.slice(5));
    }

    var option;

    if (_butterflyMode === "cache") {
      blurbKey = "econWasteMonthBlurbCache";
      if (blurbEl) blurbEl.textContent = t(blurbKey);

      var ratioData = [];
      for (var ci = 0; ci < days.length; ci++) {
        var cc = days[ci].cache_creation || 0;
        var cr = days[ci].cache_read || 0;
        var cTotal = cc + cr;
        ratioData.push(cTotal > 0 ? Math.round(cc / cTotal * 10000) / 100 : 0);
      }

      var cacheTrend = (function () {
        var n = ratioData.length;
        if (n < 3) return __econLinReg(ratioData);
        var s1=0,s2=0,s3=0,s4=0,sy=0,s1y=0,s2y=0;
        for(var i=0;i<n;i++){var t2=i*i;s1+=i;s2+=t2;s3+=t2*i;s4+=t2*t2;sy+=ratioData[i];s1y+=i*ratioData[i];s2y+=t2*ratioData[i];}
        var det=n*(s2*s4-s3*s3)-s1*(s1*s4-s3*s2)+s2*(s1*s3-s2*s2);
        if(Math.abs(det)<1e-10) return __econLinReg(ratioData);
        var qc=(sy*(s2*s4-s3*s3)-s1*(s1y*s4-s2y*s3)+s2*(s1y*s3-s2y*s2))/det;
        var qb=(n*(s1y*s4-s2y*s3)-sy*(s1*s4-s3*s2)+s2*(s1*s2y-s1y*s2))/det;
        var qa=(n*(s2*s2y-s3*s1y)-s1*(s1*s2y-s1y*s2)+sy*(s1*s3-s2*s2))/det;
        var line=[];
        for(var j=0;j<n;j++) line.push(Math.round((qa*j*j+qb*j+qc)*100)/100);
        var trend=line[n-1]-line[0];
        return { data: line, slope: trend };
      })();

      option = {
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            var idx = params[0].dataIndex;
            var d = days[idx];
            var cc2 = d.cache_creation || 0;
            var cr2 = d.cache_read || 0;
            return d.date + "<br>"
              + t("econMonthCacheCreate") + ": " + fmt(cc2) + "<br>"
              + t("econMonthCacheRead") + ": " + fmt(cr2) + "<br>"
              + "Creation %: " + ratioData[idx] + "%";
          }
        },
        legend: {
          top: 4,
          textStyle: { color: "#A0875E", fontSize: 11 },
          data: [
            { name: "Creation %", icon: "roundRect", itemStyle: { color: "#fbbf24" } },
            { name: "Trend" }
          ]
        },
        grid: { top: 40, right: 20, bottom: 40, left: 50 },
        xAxis: {
          type: "category",
          data: xData,
          axisLabel: { color: "#8C6A3F", rotate: 45, fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
        },
        yAxis: {
          type: "value",
          name: "%",
          axisLabel: { color: "#8C6A3F", formatter: function (v) { return v + "%"; } },
          max: function (v) { return Math.max(v.max * 1.3, 1); },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.2)" } }
        },
        series: [
          {
            name: "Creation %",
            type: "bar",
            itemStyle: {
              color: function (params) {
                var v = params.value;
                return v > 5 ? "#ef4444" : v > 2 ? "#fbbf24" : "#34d399";
              }
            },
            label: { show: true, position: "top", formatter: "{c}%", fontSize: 9, color: "#A0875E" },
            data: ratioData
          },
          {
            name: "Trend",
            type: "line",
            smooth: true,
            symbol: "none",
            data: cacheTrend.data,
            lineStyle: { color: cacheTrend.slope <= 0 ? "#34d399" : "#ef4444", width: 1.5 }
          }
        ]
      };

    } else {
      blurbKey = "econWasteMonthBlurbIO";
      if (blurbEl) blurbEl.textContent = t(blurbKey);

      var upLabel = t("econMonthInput");
      var downLabel = t("econMonthOutput");
      var upRaw = [];
      var downRaw = [];

      for (var ii = 0; ii < days.length; ii++) {
        upRaw.push(days[ii].input || 0);
        downRaw.push(days[ii].output || 0);
      }

      var maxUp = Math.max.apply(null, upRaw) || 1;
      var maxDown = Math.max.apply(null, downRaw) || 1;
      var upNorm = upRaw.map(function (v) { return Math.round(v / maxUp * 1000) / 1000; });
      var downNorm = downRaw.map(function (v) { return -Math.round(v / maxDown * 1000) / 1000; });

      var upTrend = __econLinReg(upNorm);
      var downTrend = __econLinReg(downNorm);

      option = {
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            var idx = params[0].dataIndex;
            var d = days[idx];
            var lines = [d.date];
            for (var p = 0; p < params.length; p++) {
              var sn = params[p].seriesName;
              if (sn === upLabel) lines.push(params[p].marker + " " + sn + ": " + fmt(upRaw[idx]));
              else if (sn === downLabel) lines.push(params[p].marker + " " + sn + ": " + fmt(downRaw[idx]));
            }
            return lines.join("<br>");
          }
        },
        legend: {
          top: 4,
          textStyle: { color: "#A0875E", fontSize: 11 },
          data: [upLabel, downLabel]
        },
        grid: { top: 40, right: 20, bottom: 40, left: 60 },
        xAxis: {
          type: "category",
          data: xData,
          axisLabel: { color: "#8C6A3F", rotate: 45, fontSize: 10 },
          axisLine: { lineStyle: { color: "rgba(148,163,184,.5)", width: 2 } },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
        },
        yAxis: {
          type: "value",
          min: -1,
          max: 1,
          axisLabel: {
            color: "#8C6A3F",
            formatter: function (v) {
              if (v === 0) return "0";
              if (v > 0) return fmt(Math.round(v * maxUp));
              return fmt(Math.round(Math.abs(v) * maxDown));
            }
          },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.2)" } }
        },
        series: [
          {
            name: upLabel,
            type: "bar",
            stack: "butterfly",
            barWidth: "60%",
            itemStyle: { color: "rgba(212,175,127,0.6)" },
            data: upNorm
          },
          {
            name: downLabel,
            type: "bar",
            stack: "butterfly",
            barWidth: "60%",
            itemStyle: { color: "rgba(52,211,153,0.7)" },
            data: downNorm
          },
          {
            name: "trend_up",
            type: "line",
            smooth: false,
            symbol: "none",
            showInLegend: false,
            data: upTrend.data,
            lineStyle: { color: upTrend.slope >= 0 ? "#34d399" : "#ef4444", width: 1.5 }
          },
          {
            name: "trend_down",
            type: "line",
            smooth: false,
            symbol: "none",
            showInLegend: false,
            data: downTrend.data,
            lineStyle: { color: downTrend.slope <= 0 ? "#34d399" : "#ef4444", width: 1.5 }
          }
        ]
      };
    }

    // notMerge: true to fully replace config when switching between cache/IO modes
    if (!_effCharts["econWasteMonth"]) {
      if (typeof echarts !== "undefined") {
        _effCharts["econWasteMonth"] = echarts.init(el, null, { renderer: "canvas" });
      }
    }
    if (_effCharts["econWasteMonth"]) {
      _effCharts["econWasteMonth"].setOption(option, { notMerge: true, lazyUpdate: false });
    }
  }

  function initButterflyToggle() {
    var toggle = document.getElementById("econ-butterfly-toggle");
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = "1";
      toggle.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-mode]");
        if (!btn) return;
        var mode = btn.dataset.mode;
        if (mode === _butterflyMode) return;
        var buttons = toggle.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].style.background = buttons[i] === btn ? "rgba(100,116,139,.3)" : "transparent";
          buttons[i].style.color = buttons[i] === btn ? "#F7F3EC" : "#A0875E";
        }
        // Tag/Turn only makes sense for I/O (Cache×Turn is the Cache-Explosion chart).
        var granT = document.getElementById("econ-butterfly-gran-toggle");
        if (granT) granT.style.display = (mode === "io") ? "inline-flex" : "none";
        renderMonthlyButterfly(_butterflyDays, mode);
      });
    }
    // Tag/Turn granularity toggle (I/O only).
    var gran = document.getElementById("econ-butterfly-gran-toggle");
    if (gran) gran.style.display = (_butterflyMode === "io") ? "inline-flex" : "none";
    if (gran && !gran.dataset.bound) {
      gran.dataset.bound = "1";
      gran.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-gran]");
        if (!btn) return;
        var g = btn.dataset.gran;
        if (g === _butterflyGran) return;
        _butterflyGran = g;
        var buttons = gran.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].style.background = buttons[i] === btn ? "rgba(100,116,139,.3)" : "transparent";
          buttons[i].style.color = buttons[i] === btn ? "#F7F3EC" : "#A0875E";
        }
        renderMonthlyButterfly(_butterflyDays, _butterflyMode);
      });
    }
  }

  // ── renderDayComparison ─────────────────────────────────────────────

  function renderDayComparison(days, proxyDaysMap) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-daycompare");
    if (!el || !days || days.length < 2) return;

    var _getPlanPrice = typeof window.getPlanPriceForDate === 'function'
      ? window.getPlanPriceForDate
      : function() { return typeof window.getSelectedPlanPrice === 'function' ? window.getSelectedPlanPrice() : 100; };

    // Detect plan-change boundary: first date where plan differs from first day
    var _planChangeXLabel = null;
    var _firstPlan = _getPlanPrice(days[0].date, proxyDaysMap);
    for (var _pi = 1; _pi < days.length; _pi++) {
      if (_getPlanPrice(days[_pi].date, proxyDaysMap) !== _firstPlan) {
        _planChangeXLabel = days[_pi].date.slice(5);
        break;
      }
    }

    var xData = [];
    var ratioData = [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      var total = (d.input || 0) + (d.output || 0) + (d.cache_read || 0) + (d.cache_creation || 0);
      var ratio = total > 0 ? (d.output || 0) / total * 100 : 0;
      xData.push(d.date.slice(5));
      ratioData.push(Math.round(ratio * 100) / 100);
    }

    var option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          var idx = params[0].dataIndex;
          var d = days[idx];
          return d.date + "<br>" + t("econEfficiencyRatio") + ": " + params[0].value + "%<br>Output: " + fmt(d.output || 0) + "<br>Total: " + fmt((d.input || 0) + (d.output || 0) + (d.cache_read || 0) + (d.cache_creation || 0));
        }
      },
      grid: { top: 30, right: 20, bottom: 40, left: 60 },
      xAxis: { type: "category", data: xData, axisLabel: { color: "#8C6A3F", rotate: 45, fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
      yAxis: [
        { type: "value", name: "%", axisLabel: { color: "#8C6A3F" }, max: function (v) { return Math.max(v.max * 1.2, 1); }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
        { type: "value", show: false, max: function (v) { return Math.max(v.max * 1.8, 1); }, splitLine: { show: false }, position: "right" }
      ],
      series: [
        {
          name: t("econEfficiencyRatio"),
          type: "bar",
          yAxisIndex: 0,
          data: ratioData,
          itemStyle: {
            color: function (params) {
              var v = params.value;
              return v > 0.5 ? "#34d399" : v > 0.1 ? "#fbbf24" : "#ef4444";
            }
          },
          label: { show: true, position: "top", formatter: "{c}%", fontSize: 9, color: "#A0875E" },
          markLine: _planChangeXLabel ? { silent: true, symbol: 'none',
            lineStyle: { color: 'rgba(212,175,127,0.7)', type: 'dashed', width: 1.5 },
            label: { color: '#D4AF7F', fontSize: 9, formatter: 'Plan ↑' },
            data: [{ xAxis: _planChangeXLabel }] } : undefined
        },
        (function () {
          var n = ratioData.length;
          if (n < 2) return { name: "Trend", type: "line", yAxisIndex: 1, smooth: true, symbol: "none", data: ratioData, itemStyle: { color: "#A0875E" },
          lineStyle: { color: "#A0875E", width: 1.5 } };
          var s1 = 0, s2 = 0, s3 = 0, s4 = 0, sy = 0, s1y = 0, s2y = 0;
          for (var i = 0; i < n; i++) {
            var t2 = i * i;
            s1 += i; s2 += t2; s3 += t2 * i; s4 += t2 * t2;
            sy += ratioData[i]; s1y += i * ratioData[i]; s2y += t2 * ratioData[i];
          }
          var det = n * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
          var qa = 0, qb = 0, qc = 0;
          if (Math.abs(det) > 1e-10) {
            qc = (sy * (s2 * s4 - s3 * s3) - s1 * (s1y * s4 - s2y * s3) + s2 * (s1y * s3 - s2y * s2)) / det;
            qb = (n * (s1y * s4 - s2y * s3) - sy * (s1 * s4 - s3 * s2) + s2 * (s1 * s2y - s1y * s2)) / det;
            qa = (n * (s2 * s2y - s3 * s1y) - s1 * (s1 * s2y - s1y * s2) + sy * (s1 * s3 - s2 * s2)) / det;
          }
          var line = [];
          for (var j = 0; j < n; j++) line.push(Math.round((qa * j * j + qb * j + qc) * 10000) / 10000);
          var trend = line[n - 1] - line[0];
          return {
            name: "Trend",
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            symbol: "none",
            data: line,
            lineStyle: { color: trend >= 0 ? "#34d399" : "#ef4444", width: 1.5 }
          };
        })()
      ]
    };

    __effInitOrSet("econDayCompare", el, option);
  }

  // ── renderBudgetDrain ───────────────────────────────────────────────

  function renderBudgetDrain(stData, qdData) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-drain");
    if (!el || !stData?.sessions?.length) return;
    var drainH3 = document.getElementById("econ-drain-h3");
    if (drainH3) drainH3.textContent = t("econDrainTitle");
    var drainBlurb = document.getElementById("econ-drain-blurb");
    if (drainBlurb) drainBlurb.textContent = t("econDrainBlurb");

    var dateKey = stData.date || "";
    var proxyMsgEl = document.getElementById("econ-drain-proxy-msg");
    var q5PairsLen = qdData && Array.isArray(qdData.request_pairs) ? qdData.request_pairs.length : -1;
    var hasQ5Overlay = q5PairsLen > 0;
    var useDualGrid = hasQ5Overlay;
    var msgDateStr = qdData?.requested_date ? qdData.requested_date : dateKey;
    var showNoProxyMsg = !!(qdData && q5PairsLen === 0 && Array.isArray(qdData.request_pairs) && msgDateStr);
    var sessions = stData.sessions.slice().sort(function (a, b) { return a.first_ts < b.first_ts ? -1 : 1; });
    var dayTotal = sessions.reduce(function (s, x) { return s + x.total_all; }, 0);
    if (dayTotal === 0) return;

    var econLQ5A = t("econLegendQ5Actual");
    var econLQ5I = t("econLegendQ5Ideal");
    var econLQ5PL = t("econLegendQ5PenaltyLower");
    var econLTokVis = t("econLegendTokenVisible");
    var econLCacheHealth = t("econLegendCacheHealth");
    var econLCompaction = t("econLegendCompaction");
    var econLColdCache = t("econLegendColdCache");
    var econLQ5Pen = t("econLegendQ5Penalty");

    // 1. Group into quota windows (gap > 30 min)
    var windows = [];
    var curWin = [];
    for (var i = 0; i < sessions.length; i++) {
      if (curWin.length > 0) {
        var prevEnd = new Date(curWin[curWin.length - 1].last_ts).getTime();
        var thisStart = new Date(sessions[i].first_ts).getTime();
        if ((thisStart - prevEnd) > 30 * 60000) { windows.push(curWin); curWin = []; }
      }
      curWin.push(sessions[i]);
    }
    if (curWin.length) windows.push(curWin);

    // 2. Build turn-based data
    var xData = [];
    var timeLabels = [];
    var remaining = [];
    var sessionAreas = [];
    var rebuildAreas = [];
    var compactionPoints = [];
    var sessionBoundaries = [];
    var totalRebuild = 0;
    var forcedCount = 0;
    var turnCounter = 0;
    var sessionSpans = [];
    var rebuildMarkers = [];
    var cacheRebuildData = [];

    for (var wi = 0; wi < windows.length; wi++) {
      var win = windows[wi];
      var winTotal = win.reduce(function (s, x) { return s + x.total_all; }, 0);
      if (winTotal <= 0) continue;

      var winConsumed = 0;

      for (var si = 0; si < win.length; si++) {
        var sess = win[si];
        var rawTurns = sess.turns || [];
        var turns = dateKey ? rawTurns.filter(function (tt) { return tt.ts && tt.ts.slice(0, 10) === dateKey; }) : rawTurns;
        if (!turns.length) continue;
        var sessFirstTurn = turnCounter + 1;

        var forced = false;
        if (si > 0) {
          var pEnd = new Date(win[si - 1].last_ts).getTime();
          var gap = new Date(sess.first_ts).getTime() - pEnd;
          forced = gap <= 5 * 60000;
        }

        var sessIdx = sessions.indexOf(sess);

        // Forced restart rebuild
        var rebuildCost = 0;
        if (forced && turns.length) {
          forcedCount++;
          var warmupN = Math.min(10, turns.length);
          for (var ti = 0; ti < warmupN; ti++) {
            var T = turns[ti];
            rebuildCost += (T.input || 0) + (T.output || 0) + (T.cache_read || 0) + (T.cache_creation || 0);
          }
          totalRebuild += rebuildCost;
          rebuildMarkers.push({ turn: turnCounter + 1, cost: rebuildCost });
          rebuildAreas.push([
            { xAxis: turnCounter + 1, itemStyle: { color: "rgba(239,68,68,0.15)" }, label: { show: false } },
            { xAxis: turnCounter + warmupN }
          ]);
        }

        sessionBoundaries.push({
          _rawTurn: sessFirstTurn,
          lineStyle: { color: forced ? "#ef4444" : "#B8915A", type: "solid", width: forced ? 2 : 1.5 },
          label: forced && rebuildCost > 0 ? {
            show: true,
            formatter: "Rebuild " + fmt(rebuildCost),
            color: "#fff",
            fontSize: 8,
            backgroundColor: "rgba(239,68,68,0.8)",
            borderRadius: 3,
            padding: [2, 5],
            position: "insideEndTop",
            rotate: 90,
            distance: 5
          } : { show: false }
        });

        // Detect compactions
        var compactIdx = {};
        for (var ci = 1; ci < turns.length; ci++) {
          var cPrev = turns[ci - 1], cCur = turns[ci];
          var cPrevCR = cPrev.cache_read || 0, cCurCR = cCur.cache_read || 0;
          var cCurCC = cCur.cache_creation || 0, cPrevCC = cPrev.cache_creation || 0;
          if (cPrevCR > 10000 && cCurCR < cPrevCR * 0.3 && cCurCC > cPrevCC * 10) compactIdx[ci] = true;
          else if (cPrevCR > 10000 && cCurCR === 0 && cCurCC > 50000) compactIdx[ci] = true;
        }

        // Add turns
        for (var ti2 = 0; ti2 < turns.length; ti2++) {
          var T2 = turns[ti2];
          var turnCost = (T2.input || 0) + (T2.output || 0) + (T2.cache_read || 0) + (T2.cache_creation || 0);
          winConsumed += turnCost;
          var pct = Math.max(0, Math.round((1 - winConsumed / winTotal) * 10000) / 100);
          turnCounter++;

          if (compactIdx[ti2]) {
            compactionPoints.push({ turn: turnCounter, pct: pct, type: (T2.cache_read || 0) === 0 ? "Rebuild" : "Compact" });
          }
          var cacheIO = (T2.cache_read || 0) + (T2.cache_creation || 0);
          var cacheHealth = cacheIO > 0 ? Math.round((T2.cache_read || 0) / cacheIO * 100) : 0;
          cacheRebuildData.push([turnCounter, cacheHealth]);
          var isEdge = ti2 === 0 || ti2 === turns.length - 1;
          if (turns.length > 200 && ti2 % 3 !== 0 && !isEdge && !compactIdx[ti2]) continue;
          remaining.push([turnCounter, pct]);
          timeLabels.push({ turn: turnCounter, time: T2.ts.slice(11, 16) });
          if (!sess._drainData) sess._drainData = [];
          sess._drainData.push([turnCounter, pct]);
        }

        sessionBoundaries.push({
          _rawTurn: turnCounter,
          lineStyle: { color: "rgba(100,116,139,0.3)", type: "dotted", width: 1 },
          label: { show: false }
        });

        sessionSpans.push({
          firstTurn: sessFirstTurn,
          lastTurn: turnCounter,
          label: (sess.edge_start ? "\u2192 " : "") + "S" + (sessIdx + 1) + " " + turns[0].ts.slice(11, 16) + "\u2013" + turns[turns.length - 1].ts.slice(11, 16) + (sess.edge_end ? " \u2192" : ""),
          turns: turns.length,
          total: sess.total_all,
          forced: forced,
          color: forced ? "#ef4444" : "#B8915A"
        });
      }
    }

    var rebuildPct = dayTotal > 0 ? Math.round(totalRebuild / dayTotal * 10000) / 100 : 0;

    for (var ri = 0; ri < sessionBoundaries.length; ri++) {
      if (typeof sessionBoundaries[ri]._rawTurn === "number") {
        sessionBoundaries[ri].xAxis = sessionBoundaries[ri]._rawTurn;
        delete sessionBoundaries[ri]._rawTurn;
      }
    }

    if (turnCounter < 1) return;

    var blurbOhEarly = document.getElementById("econ-overhead-blurb");
    if (blurbOhEarly && !hasQ5Overlay) blurbOhEarly.textContent = "";

    if (useDualGrid) el.style.height = "650px";
    else el.style.height = "460px";

    var gridCfg = useDualGrid
      ? [
        { top: 36, right: 52, bottom: "50%", left: 60 },
        { top: "50%", right: 52, bottom: 18, left: 60 }
      ]
      : [{ top: 30, right: 20, bottom: 50, left: 60 }];
    var drainMutedAxisLine = { color: "rgba(100,116,139,0.38)", width: 1 };
    var xAxisCfg = useDualGrid
      ? [
        { type: "value", gridIndex: 0, min: 1, max: turnCounter, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: true, lineStyle: drainMutedAxisLine } },
        { type: "value", gridIndex: 1, min: 1, max: turnCounter, axisLabel: { color: "#8C6A3F", fontSize: 9 }, splitLine: { show: false }, axisLine: { show: true, lineStyle: drainMutedAxisLine } }
      ]
      : [{ type: "value", gridIndex: 0, min: 1, max: turnCounter, axisLabel: { color: "#8C6A3F", fontSize: 9 }, splitLine: { show: false } }];
    var yAxisCfg = useDualGrid
      ? [
        {
          type: "value",
          gridIndex: 0,
          min: 0,
          max: 100,
          axisLine: { show: true, lineStyle: drainMutedAxisLine },
          axisLabel: { color: "#8C6A3F", formatter: "{value}%" },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } }
        },
        { type: "value", gridIndex: 0, position: "right", min: 0, max: 100, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: "value",
          gridIndex: 1,
          position: "right",
          axisLabel: { color: "#f97316", fontSize: 8, formatter: "{value}%", margin: 8 },
          axisLine: { show: true, lineStyle: { color: "rgba(249,115,22,0.35)" } },
          splitLine: { lineStyle: { color: "rgba(42,45,52,.2)" } }
        },
        {
          type: "value",
          gridIndex: 1,
          position: "left",
          min: 0,
          max: 100,
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          minorSplitLine: { show: false },
          axisLine: { show: true, lineStyle: drainMutedAxisLine },
          axisPointer: { show: false }
        }
      ]
      : [
        { type: "value", gridIndex: 0, min: 0, max: 100, axisLabel: { color: "#8C6A3F", formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(42,45,52,.3)" } } },
        { type: "value", gridIndex: 0, position: "right", min: 0, max: 100, axisLabel: { show: false }, splitLine: { show: false } }
      ];
    var legendCfg = useDualGrid
      ? {
        data: [econLQ5A, econLQ5I, econLQ5PL, econLTokVis],
        top: 4,
        left: "center",
        itemGap: 10,
        textStyle: { color: "#A0875E", fontSize: 9 },
        itemWidth: 14, itemHeight: 8
      }
      : { show: false };

    var option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          if (!params?.length) return "";
          var lines = [];
          for (var p = 0; p < params.length; p++) {
            if (params[p].seriesName === econLCompaction) {
              lines.push("<span style='color:#D4AF7F'>\u25c6 " + params[p].data[2] + "</span>");
            } else if (params[p].seriesName === econLCacheHealth) {
              var chVal = params[p].data[1];
              var chLabel = chVal > 80 ? "Warm" : chVal > 40 ? "Cooling" : chVal > 10 ? "Cold" : "Frozen";
              lines.push("<span style='color:#f59e0b'>Cache: " + chVal + "% (" + chLabel + ")</span>");
            } else if (params[p].seriesName === econLColdCache) {
              lines.push("<span style='color:#f59e0b'>\u26a0 Cold Cache: " + params[p].data[1] + "% — rebuild in progress</span>");
              if (params[p].data[2]) lines.push("<span style='color:#A0875E'>" + params[p].data[2] + "</span>");
            } else if (params[p].seriesName === econLQ5A) {
              lines.push("<span style='color:#f97316'>Q5 Actual: " + params[p].data[1] + "%</span>");
            } else if (params[p].seriesName === econLQ5I) {
              lines.push("<span style='color:#34d399'>Q5 Ideal: " + params[p].data[1] + "%</span>");
            } else if (params[p].seriesName === econLQ5PL) {
              lines.push("<span style='color:#ef4444'>\u26a0 Q5 Penalty: +" + params[p].data[1] + "%</span>");
            } else if (params[p].seriesName === econLTokVis) {
              lines.push("<span style='color:#D4AF7F'>Token (visible): " + params[p].data[1] + "%</span>");
            } else if (params[p].seriesName === econLQ5Pen) {
              var pd = params[p].data;
              lines.push("<span style='color:#ef4444'>\u25bc Q5 Penalty: +" + (pd._delta || "") + "%</span>");
            } else if (p === 0) {
              var turn = params[p].data[0];
              var time = "";
              for (var tli = 0; tli < timeLabels.length; tli++) {
                if (timeLabels[tli].turn === turn) { time = timeLabels[tli].time; break; }
                if (timeLabels[tli].turn > turn) { time = timeLabels[tli > 0 ? tli - 1 : 0].time; break; }
              }
              lines.push("<b>" + time + "</b> (Turn " + turn + ")<br>Window remaining: " + params[p].data[1] + "%");
            }
          }
          var qa = null, qi = null;
          for (var p2 = 0; p2 < params.length; p2++) {
            if (params[p2].seriesName === econLQ5A) qa = params[p2].data[1];
            if (params[p2].seriesName === econLQ5I) qi = params[p2].data[1];
          }
          if (qa != null && qi != null) {
            lines.push("<b>Q5 Gap: " + (Math.round((qa - qi) * 10) / 10) + "% overhead</b>");
          }
          return lines.join("<br>");
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        lineStyle: { color: "#A0875E", width: 1, type: "dashed" }
      },
      legend: legendCfg,
      grid: gridCfg,
      xAxis: xAxisCfg,
      yAxis: yAxisCfg,
      series: (function () {
        var allSeries = [];
        var winDataMap = {};
        for (var ssi = 0; ssi < sessions.length; ssi++) {
          var sess = sessions[ssi];
          var sData = sess._drainData || [];
          delete sess._drainData;
          if (!sData.length) continue;
          var wIdx = 0;
          for (var wwi = 0; wwi < windows.length; wwi++) {
            if (windows[wwi].includes(sess)) { wIdx = wwi; break; }
          }
          if (!winDataMap[wIdx]) winDataMap[wIdx] = [];
          winDataMap[wIdx] = winDataMap[wIdx].concat(sData);
        }
        var winKeys = Object.keys(winDataMap);
        for (var wki = 0; wki < winKeys.length; wki++) {
          var wData = winDataMap[winKeys[wki]];
          var isFirst = wki === 0;
          allSeries.push({
            name: "W" + (Number.parseInt(winKeys[wki]) + 1),
            type: "line",
            showSymbol: false,
            clip: false,
            areaStyle: {
              color: {
                type: "linear", x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: "rgba(34,197,94,0.3)" },
                  { offset: 0.4, color: "rgba(250,204,21,0.2)" },
                  { offset: 0.75, color: "rgba(239,120,68,0.25)" },
                  { offset: 1, color: "rgba(239,68,68,0.4)" }
                ]
              }
            },
            lineStyle: { color: "#86efac", width: 2 },
            data: wData,
            markLine: isFirst ? { silent: true, symbol: "none", data: sessionBoundaries } : undefined,
            markArea: isFirst ? {
              silent: false,
              label: { show: true, fontSize: 8, position: "top", distance: 2 },
              data: rebuildAreas.concat(sessionSpans.map(function (sp2) {
                return [
                  {
                    xAxis: sp2.firstTurn,
                    yAxis: 100,
                    name: sp2.label,
                    itemStyle: { color: sp2.forced ? "rgba(239,68,68,0.06)" : "rgba(184,145,90,0.04)" },
                    label: {
                      color: sp2.color,
                      fontSize: 8,
                      position: "top",
                      distance: 2,
                      fontWeight: sp2.forced ? "bold" : "normal"
                    }
                  },
                  { xAxis: sp2.lastTurn, yAxis: 92 }
                ];
              }))
            } : undefined
          });
        }
        // Cache health line
        var coldSpikes = [];
        for (var csi = 0; csi < cacheRebuildData.length; csi++) {
          var ch = cacheRebuildData[csi][1];
          if (ch < 50) {
            var cTurn = cacheRebuildData[csi][0];
            var cSessLabel = "";
            for (var csj = 0; csj < sessionSpans.length; csj++) {
              if (cTurn >= sessionSpans[csj].firstTurn && cTurn <= sessionSpans[csj].lastTurn) {
                cSessLabel = sessionSpans[csj].label;
                break;
              }
            }
            coldSpikes.push([cTurn, ch, cSessLabel]);
          }
        }
        allSeries.push({
          name: econLCacheHealth,
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: "rgba(245,158,11,0.5)", width: 1, type: "dotted" },
          areaStyle: { color: "rgba(245,158,11,0.08)" },
          data: cacheRebuildData,
          z: 1
        });
        allSeries.push({
          name: econLColdCache,
          type: "scatter",
          yAxisIndex: 1,
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { color: "#f59e0b", borderColor: "#fff", borderWidth: 1 },
          z: 15,
          data: coldSpikes
        });

        allSeries.push({
          name: econLCompaction,
          type: "scatter",
          symbol: "diamond",
          symbolSize: 10,
          z: 10,
          itemStyle: { color: "#D4AF7F", shadowBlur: 4, shadowColor: "rgba(212,175,127,0.5)" },
          label: { show: true, formatter: function (p) { return p.data[2]; }, position: "top", color: "#D4AF7F", fontSize: 8 },
          data: compactionPoints
        });
        for (var asi = 0; asi < allSeries.length; asi++) {
          if (allSeries[asi].xAxisIndex === undefined) allSeries[asi].xAxisIndex = 0;
        }
        // Q5 overhead curves in lower grid
        if (qdData?.request_pairs?.length > 0) {
          var ohPairs2 = qdData.request_pairs.slice().sort(function (a2, b2) { return a2.ts < b2.ts ? -1 : a2.ts > b2.ts ? 1 : 0; });
          var co5 = qdData.carryover_q5;
          var seedA = (co5 && typeof co5.actual === "number") ? co5.actual : 0;
          var seedI = (co5 && typeof co5.ideal === "number") ? co5.ideal : 0;
          var q5a2 = [], q5i2 = [], q5sc2 = [];
          var cq2 = seedA;
          var cqi2 = seedI;
          var tt2 = [];
          var ss2 = stData.sessions.slice().sort(function (a2, b2) { return a2.first_ts < b2.first_ts ? -1 : 1; });
          for (var s2i = 0; s2i < ss2.length; s2i++) {
            var st2 = ss2[s2i].turns || [];
            for (var t2i = 0; t2i < st2.length; t2i++) {
              var tts2 = st2[t2i].ts || "";
              if (dateKey && tts2.slice(0, 10) !== dateKey) continue;
              tt2.push(tts2);
            }
          }
          for (var q2i = 0; q2i < ohPairs2.length; q2i++) {
            var qp2 = ohPairs2[q2i];
            var qTs2 = qp2.ts.slice(0, 19);
            var qTurn2 = 1;
            for (var qt2 = 0; qt2 < tt2.length; qt2++) {
              if (tt2[qt2].slice(0, 19) <= qTs2) qTurn2 = qt2 + 1;
            }
            if (q2i === 0 && tt2.length && (seedA !== 0 || seedI !== 0 || qTurn2 > 1)) {
              q5a2.push([1, Math.round(cq2 * 10) / 10]);
              q5i2.push([1, Math.round(cqi2 * 10) / 10]);
              if (qTurn2 > 1) {
                q5a2.push([qTurn2, Math.round(cq2 * 10) / 10]);
                q5i2.push([qTurn2, Math.round(cqi2 * 10) / 10]);
              }
            }
            var qd2 = qp2.delta * 100;
            cq2 += qd2;
            var isOh2 = qp2.delta >= 0.03;
            if (!isOh2) cqi2 += qd2;
            else q5sc2.push([1, Math.round(cq2 * 10) / 10]);
            q5a2.push([qTurn2, Math.round(cq2 * 10) / 10]);
            q5i2.push([qTurn2, Math.round(cqi2 * 10) / 10]);
            if (isOh2) q5sc2[q5sc2.length - 1] = [qTurn2, Math.round(cq2 * 10) / 10];
          }
          allSeries.push({
            name: econLQ5A, type: "line", xAxisIndex: 1, yAxisIndex: 2,
            data: q5a2, smooth: false, symbol: "none",
            lineStyle: { color: "#f97316", width: 2 },
            areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(249,115,22,0.15)" }, { offset: 1, color: "rgba(249,115,22,0.02)" }]
            }}
          });
          allSeries.push({
            name: econLQ5I, type: "line", xAxisIndex: 1, yAxisIndex: 2,
            data: q5i2, smooth: false, symbol: "none",
            lineStyle: { color: "#34d399", width: 2, type: "dashed" }
          });
          allSeries.push({
            name: econLQ5PL, type: "scatter", xAxisIndex: 1, yAxisIndex: 2,
            data: q5sc2, symbolSize: 8,
            itemStyle: { color: "#ef4444" }, z: 10
          });
          // Token-visible line
          var tokVis = [];
          var cumTok = 0;
          var dayTokTotal = 0;
          var ss3 = stData.sessions.slice().sort(function (a3, b3) { return a3.first_ts < b3.first_ts ? -1 : 1; });
          for (var s3i = 0; s3i < ss3.length; s3i++) {
            var t3 = ss3[s3i].turns || [];
            for (var t3i = 0; t3i < t3.length; t3i++) {
              if (dateKey && t3[t3i].ts && t3[t3i].ts.slice(0, 10) !== dateKey) continue;
              dayTokTotal += (t3[t3i].cache_read || 0) + (t3[t3i].cache_creation || 0) + (t3[t3i].output || 0);
            }
          }
          if (dayTokTotal > 0) {
            var tIdx = 0;
            for (var s3j = 0; s3j < ss3.length; s3j++) {
              var t3b = ss3[s3j].turns || [];
              for (var t3jb = 0; t3jb < t3b.length; t3jb++) {
                if (dateKey && t3b[t3jb].ts && t3b[t3jb].ts.slice(0, 10) !== dateKey) continue;
                cumTok += (t3b[t3jb].cache_read || 0) + (t3b[t3jb].cache_creation || 0) + (t3b[t3jb].output || 0);
                tIdx++;
                if (tIdx % 5 === 0 || tIdx === 1) {
                  tokVis.push([tIdx, Math.round(cumTok / dayTokTotal * cq2 * 10) / 10]);
                }
              }
            }
            allSeries.push({
              name: econLTokVis, type: "line", xAxisIndex: 1, yAxisIndex: 2,
              data: tokVis, smooth: false, symbol: "none",
              lineStyle: { color: "#D4AF7F", width: 1.5, type: "dotted" }
            });
          }

          // Update blurb
          var cq2Day = cq2 - seedA;
          var cqi2Day = cqi2 - seedI;
          var gap2 = Math.round((cq2Day - cqi2Day) * 10) / 10;
          var ratio2 = cq2Day > 0 ? Math.round((cq2Day - cqi2Day) / cq2Day * 100) : 0;
          var nOh2 = ohPairs2.filter(function (p) { return p.delta >= 0.03; }).length;
          var blurb2 = document.getElementById("econ-overhead-blurb");
          if (blurb2) {
            blurb2.textContent = tr("econOverheadSummary", { actual: Math.round(cq2Day), ideal: Math.round(cqi2Day), ratio: ratio2, gap: gap2, events: nOh2 });
            // Surface the per-model implied divisor (cost per 1% Q5) for the day —
            // the post's "is quota a linear map of cost?" metric, now per-model correct.
            const ds2 = (qdData.date_summaries || []).find(function (d) { return d.date === msgDateStr; });
            if (ds2 && typeof ds2.weighted_divisor === "number") {
              blurb2.textContent += " · Divisor (per-Modell, gewichtet): $" + ds2.weighted_divisor.toFixed(2) + " / 1% Q5";
            }
          }
        }
        return allSeries;
      })(),
      graphic: []
    };

    __effInitOrSet("econDrain", el, option, true);
    if (_effCharts.econDrain && typeof _effCharts.econDrain.resize === "function") {
      try {
        requestAnimationFrame(function () {
          if (_effCharts.econDrain && typeof _effCharts.econDrain.resize === "function") _effCharts.econDrain.resize();
        });
      } catch (error) { logClientOptionalErr(error); }
    }

    // HTML overlay for collapsible info box
    var existingOverlay = el.querySelector(".drain-info-overlay");
    if (existingOverlay) existingOverlay.remove();

    var infoText = forcedCount + " forced | Tax: " + fmt(totalRebuild) + " (" + rebuildPct + "%)\n" + sessionSpans.map(function (sp) {
      return sp.label + " " + sp.turns + "t " + fmt(sp.total) + (sp.forced ? " \u26a0" : "");
    }).join("\n");

    var overlay = document.createElement("div");
    overlay.className = "drain-info-overlay";
    overlay.style.cssText = "position:absolute;right:8px;top:55px;z-index:10;cursor:pointer;user-select:none";
    var tab = '<div class="drain-info-tab" style="background:rgba(14,17,22,0.85);border:1px solid rgba(100,116,139,0.3);border-radius:4px 0 0 4px;padding:6px 4px;font:bold 9px monospace;color:#A0875E;line-height:1.3;text-align:center">\u25c0<br>I<br>N<br>F<br>O</div>';
    var box = '<div class="drain-info-box" style="display:none;background:rgba(14,17,22,0.9);border:1px solid rgba(100,116,139,0.3);border-radius:4px;padding:6px 8px;font:10px monospace;color:#EFE7D6;white-space:pre;line-height:1.4">' + infoText + ' <span style="color:#8C6A3F">\u25b6</span></div>';
    overlay.innerHTML = tab + box;
    overlay.addEventListener("click", function () {
      var t = overlay.querySelector(".drain-info-tab");
      var b = overlay.querySelector(".drain-info-box");
      if (t.style.display === "none") {
        t.style.display = "";
        b.style.display = "none";
      } else {
        t.style.display = "none";
        b.style.display = "";
      }
    });
    el.style.position = "relative";
    el.appendChild(overlay);

    if (proxyMsgEl) {
      if (showNoProxyMsg) {
        proxyMsgEl.removeAttribute("hidden");
        proxyMsgEl.classList.add("econ-drain-proxy-msg--visible");
        proxyMsgEl.textContent = tr("econDrainNoProxyLogs", { date: msgDateStr });
      } else {
        proxyMsgEl.setAttribute("hidden", "hidden");
        proxyMsgEl.classList.remove("econ-drain-proxy-msg--visible");
        proxyMsgEl.textContent = "";
      }
    }
  }

  // ── renderEconOverhead ──────────────────────────────────────────────

  function renderEconOverhead(qdData, stData) {
    if (typeof echarts === "undefined") return;
    var el = document.getElementById("chart-shell-econ-overhead");
    if (!el) return;

    var hasProxy = qdData?.request_pairs?.length > 0;
    var hasJsonl = stData?.sessions?.length > 0;

    if (!hasProxy && !hasJsonl) {
      el.innerHTML = '<div style="color:#8C6A3F;font-size:11px;padding:40px;text-align:center">No data available.</div>';
      return;
    }

    var OVERHEAD_THRESHOLD = 0.03;

    var turnTimes = [];
    if (hasJsonl) {
      var sortedSess = stData.sessions.slice().sort(function (a, b) { return a.first_ts < b.first_ts ? -1 : 1; });
      for (var si = 0; si < sortedSess.length; si++) {
        var sTurns = sortedSess[si].turns || [];
        for (var tti = 0; tti < sTurns.length; tti++) {
          turnTimes.push(sTurns[tti].ts || "");
        }
      }
    }

    function tsToTurn(ts) {
      var tsShort = ts.slice(0, 19);
      var best = 0;
      for (var i = 0; i < turnTimes.length; i++) {
        if (turnTimes[i].slice(0, 19) <= tsShort) best = i + 1;
      }
      return best || 1;
    }

    var q5Actual = [], q5Ideal = [], q5Scatter = [];
    var cumQ5 = 0, cumQ5Ideal = 0, q5Events = 0, q5Overhead = 0;
    var pairs = [];

    if (hasProxy) {
      pairs = qdData.request_pairs.slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        var delta = p.delta * 100;
        cumQ5 += delta;
        var turnX = hasJsonl ? tsToTurn(p.ts) : i;
        var isOh = p.delta >= OVERHEAD_THRESHOLD;
        if (!isOh) {
          cumQ5Ideal += delta;
        } else {
          q5Events++;
          q5Overhead += delta;
          q5Scatter.push([turnX, Math.round(cumQ5 * 10) / 10]);
        }
        q5Actual.push([turnX, Math.round(cumQ5 * 10) / 10]);
        q5Ideal.push([turnX, Math.round(cumQ5Ideal * 10) / 10]);
      }
    }

    var tokActual = [], tokIdeal = [];
    var cumTokAll = 0, cumTokIdeal = 0, tokDayTotal = 0;

    if (hasJsonl) {
      var sessions = stData.sessions.slice().sort(function (a, b) { return a.first_ts < b.first_ts ? -1 : 1; });
      for (var siA = 0; siA < sessions.length; siA++) {
        var turnsA = sessions[siA].turns || [];
        for (var tiA = 0; tiA < turnsA.length; tiA++) {
          tokDayTotal += (turnsA[tiA].cache_read || 0) + (turnsA[tiA].cache_creation || 0) + (turnsA[tiA].output || 0);
        }
      }

      var tokIdx = 0;
      for (var siB = 0; siB < sessions.length; siB++) {
        var turns = sessions[siB].turns || [];
        var warmupDone = false, prevCR = 0, maxCR = 0, inRebuild = false, rebuildN = 0;
        for (var ti = 0; ti < turns.length; ti++) {
          var T = turns[ti];
          var cc = T.cache_creation || 0, cr = T.cache_read || 0, out = T.output || 0;
          var total = cc + cr + out;
          var overhead = 0;

          if (!warmupDone) {
            if (cr > cc && ti > 0) { warmupDone = true; }
            else { overhead = cc; }
          } else {
            if (prevCR > 10000 && cr < prevCR * 0.4 && cc > prevCR * 0.3) { inRebuild = true; rebuildN = 0; }
            if (inRebuild) { overhead = cc; rebuildN++; if (cr > maxCR * 0.5 && rebuildN > 1) inRebuild = false; }
          }
          prevCR = cr > 0 ? cr : prevCR;
          maxCR = Math.max(maxCR, cr);

          cumTokAll += total;
          cumTokIdeal += (total - overhead);

          if (hasProxy && tokDayTotal > 0) {
            var pctAll = Math.round(cumTokAll / tokDayTotal * cumQ5 * 10) / 10;
            var pctIdeal = Math.round(cumTokIdeal / tokDayTotal * cumQ5 * 10) / 10;
            tokActual.push([tokIdx, pctAll]);
            tokIdeal.push([tokIdx, pctIdeal]);
          }
          tokIdx++;
        }
      }
    }

    var gapQ5 = Math.round((cumQ5 - cumQ5Ideal) * 10) / 10;
    var q5Ratio = cumQ5 > 0 ? Math.round(q5Overhead / cumQ5 * 100) : 0;
    var tokOverheadPct = tokDayTotal > 0 ? Math.round((cumTokAll - cumTokIdeal) / cumTokAll * 1000) / 10 : 0;

    var h3 = document.getElementById("econ-overhead-h3");
    if (h3) {
      if (hasProxy) {
        h3.textContent = t("econOverheadTitle") + " \u2014 Q5: " + q5Ratio + "% Overhead | Tokens: " + tokOverheadPct + "% Overhead";
      } else {
        h3.textContent = t("econOverheadTitle") + " \u2014 " + tokOverheadPct + "% Token Overhead (no proxy data)";
      }
    }

    var blurb = document.getElementById("econ-overhead-blurb");
    if (blurb && hasProxy) {
      blurb.textContent = q5Events + " overhead events consumed " + gapQ5 + "% Q5 (" + q5Ratio + "% of budget). Visible token overhead is only " + tokOverheadPct + "% \u2014 the gap reveals hidden costs (thinking tokens, internal overhead).";
      // Append the per-model implied divisor ($ per 1% Q5) for the selected day.
      // This is the actually-rendered overhead line; renderBudgetDrain writes the
      // same element (econ-overhead-blurb) but is overwritten here.
      const ds3 = (qdData.date_summaries || []).find(function (d) { return d.date === qdData.requested_date; });
      if (ds3 && typeof ds3.weighted_divisor === "number") {
        blurb.textContent += " \u00b7 Divisor (per-Modell, gewichtet): $" + ds3.weighted_divisor.toFixed(2) + " / 1% Q5";
      }
    }

    var ohQ5A = t("econLegendQ5Actual");
    var ohQ5I = t("econLegendQ5Ideal");
    var ohOverheadEv = t("econLegendOverheadEvent");
    var ohTokA = t("econLegendTokenActual");
    var ohTokI = t("econLegendTokenIdeal");
    var ohAxisTurns = t("econAxisTurns");
    var ohAxisPct = t("econAxisPctConsumed");

    var series = [];

    if (hasProxy) {
      series.push({
        name: ohQ5A,
        type: "line", data: q5Actual, smooth: false, symbol: "none",
        lineStyle: { color: "#f97316", width: 2 },
        areaStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: "rgba(249,115,22,0.15)" }, { offset: 1, color: "rgba(249,115,22,0.02)" }]
          }
        }
      });
      series.push({
        name: ohQ5I,
        type: "line", data: q5Ideal, smooth: false, symbol: "none",
        lineStyle: { color: "#34d399", width: 2, type: "dashed" }
      });
      series.push({
        name: ohOverheadEv,
        type: "scatter", data: q5Scatter, symbolSize: 8,
        itemStyle: { color: "#ef4444" }, z: 10
      });
    }

    if (hasJsonl && hasProxy) {
      series.push({
        name: ohTokA,
        type: "line", data: tokActual, smooth: false, symbol: "none",
        lineStyle: { color: "#D4AF7F", width: 1.5, type: "dotted" }
      });
      series.push({
        name: ohTokI,
        type: "line", data: tokIdeal, smooth: false, symbol: "none",
        lineStyle: { color: "#D4AF7F", width: 1.5, type: "dotted" }
      });
    }

    var legendData = series.map(function (s) { return s.name; });

    var option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          if (!params?.length) return "";
          var turnNum = params[0].value[0];
          var tip = '<div style="font-size:11px">Turn ' + turnNum;
          var q5a = null, q5i = null;
          for (var k = 0; k < params.length; k++) {
            var pm = params[k];
            if (!pm.value) continue;
            tip += "<br>" + pm.marker + " " + pm.seriesName + ": " + pm.value[1] + "%";
            if (pm.seriesName === ohQ5A) q5a = pm.value[1];
            if (pm.seriesName === ohQ5I) q5i = pm.value[1];
          }
          if (q5a != null && q5i != null) {
            tip += "<br><b>Q5 Gap: " + (Math.round((q5a - q5i) * 10) / 10) + "%</b>";
          }
          if (hasProxy) {
            for (var oi = 0; oi < pairs.length; oi++) {
              if (pairs[oi].delta >= OVERHEAD_THRESHOLD) {
                var oTurn = hasJsonl ? tsToTurn(pairs[oi].ts) : oi;
                if (oTurn === turnNum) {
                  tip += '<br><span style="color:#ef4444">\u26a0 +' + (pairs[oi].delta * 100) + '% Q5</span>';
                  break;
                }
              }
            }
          }
          tip += "</div>";
          return tip;
        }
      },
      legend: {
        data: legendData, top: 0, right: 10,
        textStyle: { color: "#A0875E", fontSize: 10 },
        itemWidth: 14, itemHeight: 8
      },
      grid: { left: 50, right: 20, top: 30, bottom: 25 },
      xAxis: {
        type: "value", name: ohAxisTurns,
        min: 1,
        nameTextStyle: { color: "#8C6A3F", fontSize: 9 },
        axisLabel: { color: "#A0875E", fontSize: 9 },
        splitLine: { lineStyle: { color: "rgba(100,116,139,0.15)" } }
      },
      yAxis: {
        type: "value", name: ohAxisPct,
        nameTextStyle: { color: "#8C6A3F", fontSize: 9 },
        axisLabel: { color: "#A0875E", fontSize: 9, formatter: function (v) { return v + "%"; } },
        splitLine: { lineStyle: { color: "rgba(100,116,139,0.15)" } }
      },
      series: series
    };

    __effInitOrSet("econOverhead", el, option, true);

    // Info overlay
    var existingOverlay = el.querySelector(".overhead-info-overlay");
    if (existingOverlay) existingOverlay.remove();

    var infoLines = [];
    if (hasProxy) {
      infoLines.push("Q5 Actual:   " + Math.round(cumQ5) + "% consumed");
      infoLines.push("Q5 Ideal:    " + Math.round(cumQ5Ideal) + "%");
      infoLines.push("Q5 Overhead: " + gapQ5 + "% (" + q5Ratio + "%)");
    }
    if (hasJsonl) {
      infoLines.push("Tok Overhead:" + tokOverheadPct + "%");
    }
    if (hasProxy && hasJsonl) {
      var phantom = q5Ratio - tokOverheadPct;
      infoLines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      infoLines.push("Phantom:     " + Math.round(phantom) + "% (hidden)");
      infoLines.push("Events:      " + q5Events);
    }

    var overlay = document.createElement("div");
    overlay.className = "overhead-info-overlay";
    overlay.style.cssText = "position:absolute;right:8px;top:35px;z-index:10;cursor:pointer;user-select:none";
    var tab = '<div class="overhead-info-tab" style="background:rgba(14,17,22,0.85);border:1px solid rgba(100,116,139,0.3);border-radius:4px 0 0 4px;padding:6px 4px;font:bold 9px monospace;color:#A0875E;line-height:1.3;text-align:center">\u25C0<br>I<br>N<br>F<br>O</div>';
    var box = '<div class="overhead-info-box" style="display:none;background:rgba(14,17,22,0.9);border:1px solid rgba(100,116,139,0.3);border-radius:4px;padding:6px 8px;font:10px monospace;color:#EFE7D6;white-space:pre;line-height:1.4">' + infoLines.join("\n") + ' <span style="color:#8C6A3F">\u25B6</span></div>';
    overlay.innerHTML = tab + box;
    overlay.addEventListener("click", function () {
      var tt = overlay.querySelector(".overhead-info-tab");
      var bb = overlay.querySelector(".overhead-info-box");
      if (tt.style.display === "none") { tt.style.display = ""; bb.style.display = "none"; }
      else { tt.style.display = "none"; bb.style.display = ""; }
    });
    el.style.position = "relative";
    el.appendChild(overlay);
  }

  // ── Window exports ──────────────────────────────────────────────────
  window.renderEconomicSection = renderEconomicSection;
  window.renderEconOverhead = renderEconOverhead;

})();
