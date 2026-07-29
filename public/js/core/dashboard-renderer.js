/**
 * @asseris-module       Dashboard Renderer
 * @asseris-description  Auto-annotated module metadata for public/js/core/dashboard-renderer.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * dashboard-renderer.js — Render Orchestration Module (Phase 18a)
 *
 * Extracted from dashboard.client.js: chart state, resize helpers,
 * renderDashboard / renderDashboardCore pipeline, forensic host filter bar,
 * live-release panel chrome, and proxy-day helper.
 *
 * Dependencies (remain in dashboard.client.js, accessed via window):
 *   escHtml, fmt, pct, logClientOptionalErr, apiNote,
 *   getMainChartsScope, setMainChartsScope, syncMainChartsScopeUi,
 *   forensic scoring functions, render*Section helpers
 */
(function () { try {

  /* ── shell wrappers (delegate to core/dashboard-shell.js) ──────────── */
  function updateWarmupOverlay(data) { if (window.__dashboardShell) window.__dashboardShell.updateWarmupOverlay(data); }
  function dismissWarmupOverlay() { if (window.__dashboardShell) window.__dashboardShell.dismissWarmupOverlay(); }

  function showRecomputeOverlay(show) { if (window.__dashboardShell) window.__dashboardShell.showRecomputeOverlay(show); }
  function showMainChartsSkeleton(show) { if (window.__dashboardShell) window.__dashboardShell.showMainChartsSkeleton(show); }
  function chartShellSetLoading(id, loading) { if (window.__dashboardShell) window.__dashboardShell.chartShellSetLoading(id, loading); }
  function fillInitialShellText() { if (window.__dashboardShell) window.__dashboardShell.fillInitialShellText(); }

  /* ── chart registry + coalesce ─────────────────────────────────────── */
  var _charts = {};
  // Phase 17c: __lastUsageData removed — canonical owner is __dashboardState
  /** Stream-Events entkoppeln: voller Core-Lauf max. ~alle N ms (verhindert Chart-Flimmern). User-Aktionen: urgent=true. */
  var DASH_CORE_COALESCE_MS = 400;
  var __dashRenderCoreCoalesce = null;

  /* ── chart utils ───────────────────────────────────────────────────── */
  function chartXLabelsMatch(ch, newLabels) {
    if (!ch?.data?.labels || !newLabels) return false;
    var L = ch.data.labels;
    if (L.length !== newLabels.length) return false;
    for (var i = 0; i < L.length; i++) if (L[i] !== newLabels[i]) return false;
    return true;
  }

  /** Bestehende Chart-X-Achse ist Anfang von newLabels (z. B. SSE-Scan hängt Tage hinten an). Sonst destroy → Flackern. */
  function chartLabelsPrefixMatch(ch, newLabels) {
    if (!ch?.data?.labels || !newLabels) return false;
    var L = ch.data.labels;
    if (!L.length || newLabels.length < L.length) return false;
    for (var i = 0; i < L.length; i++) {
      if (L[i] !== newLabels[i]) return false;
    }
    return true;
  }

  /** ECharts .resize() nur wenn DOM-Element noch angebunden. */
  function __safeChartResize(ch) {
    if (!ch || typeof ch.resize !== "function") return;
    try {
      var dom = ch.getDom ? ch.getDom() : null;
      if (!dom?.isConnected) return;
      ch.resize();
    } catch(e) {
      // dom may have detached between isConnected check and resize()
    }
  }

  var __anthropicHealthResizeT = null;
  function __scheduleAnthropicHealthChartsResize() {
    if (__anthropicHealthResizeT) clearTimeout(__anthropicHealthResizeT);
    __anthropicHealthResizeT = setTimeout(function () {
      __anthropicHealthResizeT = null;
      var pc = window._proxyCharts;
      if (!pc) return;
      __safeChartResize(pc.uptimeChart);
      __safeChartResize(pc.incidentHistory);
      __safeChartResize(pc.anthropicIncidents);
      __safeChartResize(pc.outageTimeline);
    }, 80);
  }

  function __bumpAnthropicHealthCharts() {
    var pc = window._proxyCharts;
    if (!pc) return;
    __safeChartResize(pc.uptimeChart);
    __safeChartResize(pc.incidentHistory);
    __safeChartResize(pc.anthropicIncidents);
    __safeChartResize(pc.outageTimeline);
  }

  /* ── live-release panel chrome (IIFE) ──────────────────────────────── */
  (function wireLiveReleasePanelChrome() {
    // Wire cache-files explorer button independently (not gated on live-release-details)
    window.CacheFilesExplorer?.wireOpenButton("live-cache-files-open");
    function go() {
      var det = document.getElementById("live-release-details");
      if (!det || det.dataset.liveRelChromeWired === "1") return;
      det.dataset.liveRelChromeWired = "1";
      var expandBtn = document.getElementById("live-rel-expand-btn");
      var relOverlay = document.getElementById("release-modal-overlay");
      var relBody = document.getElementById("release-modal-body");
      var relClose = document.getElementById("release-modal-close");
      if (expandBtn && relOverlay && relBody) {
        expandBtn.addEventListener("click", function () {
          relOverlay.classList.add("is-open");
          document.body.style.overflow = "hidden";
          if (relBody.dataset.loaded) return;
          relBody.innerHTML = '<p style="color:#8C6A3F;font-size:.75rem">Loading releases...</p>';
          var rlXhr = new XMLHttpRequest();
          rlXhr.open("GET", "/assets/release-history.json", true);
          rlXhr.onload = function () {
            if (rlXhr.status !== 200) {
              relBody.innerHTML = '<p style="color:#ef4444;font-size:.75rem">Failed to load releases</p>';
              return;
            }
            try {
              var releases = JSON.parse(rlXhr.responseText);
              if (!releases.length) {
                relBody.innerHTML = '<p style="color:#8C6A3F;font-size:.75rem">No releases found</p>';
                return;
              }
              var rh = "";
              var isFirst = true;
              for (var rel of releases) {
                var rDate = rel.published_at ? rel.published_at.slice(0, 10) : "";
                var rBody2 = (rel.body || "").replace(/^## .+\n?/m, "");
                rh += "<details class=\"release-modal-item\"" + (isFirst ? " open" : "") + ">";
                isFirst = false;
                rh += "<summary class=\"release-modal-item-head\">";
                rh += "<span class=\"rel-tag\">" + window.escHtml(rel.tag_name) + "</span>";
                rh += "<span class=\"rel-date\">" + window.escHtml(rDate) + "</span>";
                if (rel.name && rel.name !== rel.tag_name) rh += " — " + window.escHtml(rel.name);
                rh += "</summary>";
                rh += "<div class=\"release-modal-item-body\">" + marked.parse(rBody2) + "</div>";
                rh += "</details>";
              }
              relBody.innerHTML = rh;
              relBody.dataset.loaded = "1";
            } catch (eRel) {
              relBody.innerHTML = '<p style="color:#ef4444;font-size:.75rem">Parse error</p>';
            }
          };
          rlXhr.send();
        });
        if (relClose) {
          relClose.addEventListener("click", function () {
            relOverlay.classList.remove("is-open");
            document.body.style.overflow = "";
          });
        }
        relOverlay.addEventListener("click", function (e) {
          if (e.target === relOverlay) {
            relOverlay.classList.remove("is-open");
            document.body.style.overflow = "";
          }
        });
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", go);
    } else {
      go();
    }
  })();

  /* ── local wrappers (delegate to core/dashboard-state.js) ──────────── */
  var getFilteredDays = function (d) { return window.__dashboardState.getFilteredDays(d); };
  var getFilterHost = function () { return window.__dashboardState.getFilterHost(); };
  var getForensicHostFilterForCharts = function () { return window.__dashboardState.getForensicHostFilter(); };

  /* ── renderDashboard ───────────────────────────────────────────────── */
  function renderDashboard(data, urgent) {
    if (urgent) clearTimeout(__dashRenderCoreCoalesce);
    // `urgent` also covers background refreshes (SSE, extension timeline and
    // reconnect fetches). Those must never blank the whole dashboard. User
    // initiated range recomputations manage the overlay explicitly.
    // data stored via setData below
    window.__dashboardState.setData(data);
    data = window.__dashboardState.getData();
    updateWarmupOverlay(data);
    window.updateGithubTokenPanelMode();
    window.updateLiveSidePanel(data);
    window.updateScanSourcesRow(data);
    window.updateStatePathsRow(data);
    window.updateStatusLamp(data);
    window.initFilterBar(data);
    var filteredData = window.__dashboardState.getFilteredData(data);
    window.renderHealthScore(filteredData);
    window.updateAnthropicPopup(filteredData);
    window.renderKeyFindings(filteredData);
    // Split-Advisor: start auto-refresh once proxy data available
    if (window.__splitAdvisor && !window.__splitAdvisorStarted) {
      var pds = data.proxy?.proxy_days;
      if (pds && pds.length > 0) {
        window.__splitAdvisorStarted = true;
        window.__splitAdvisor.startAutoRefresh(function () {
          var d = window.__dashboardState.getData()?.proxy?.proxy_days;
          return d && d.length > 0 ? d[d.length - 1] : null;
        });
        window.__splitAdvisor.updateBanner(pds[pds.length - 1]);
      }
    }
    var days = getFilteredDays(data.days);
    var sp = data.scan_progress;
    var scanInc = data.scanning && sp?.total > 0 && sp.done < sp.total;
    if (!days?.length) {
      if (data.scanning) showMainChartsSkeleton(true);
      else showMainChartsSkeleton(false);
    } else if (scanInc) {
      showMainChartsSkeleton(true);
    }
    if (scanInc && days && days.length > 0) {
      window.updateMetaDetailsSummary(data);
      clearTimeout(window.__dashRenderDebounce);
      var deferMs = urgent ? 0 : 1000;
      window.__dashRenderDebounce = setTimeout(function () {
        window.__dashRenderDebounce = null;
        renderDashboardCore(window.__dashboardState.getData());
      }, deferMs);
      if (!window.__dashRenderScanMaxWait) {
        window.__dashRenderScanMaxWait = setTimeout(function () {
          window.__dashRenderScanMaxWait = null;
          var d = window.__dashboardState.getData();
          if (!d?.scanning) return;
          clearTimeout(window.__dashRenderDebounce);
          window.__dashRenderDebounce = null;
          renderDashboardCore(d);
        }, 3200);
      }
      return;
    }
    if (window.__dashRenderDebounce) {
      clearTimeout(window.__dashRenderDebounce);
      window.__dashRenderDebounce = null;
    }
    if (window.__dashRenderScanMaxWait) {
      clearTimeout(window.__dashRenderScanMaxWait);
      window.__dashRenderScanMaxWait = null;
    }
    function runCoreNow() {
      clearTimeout(__dashRenderCoreCoalesce);
      __dashRenderCoreCoalesce = null;
      renderDashboardCore(window.__dashboardState.getData());
    }
    if (urgent) {
      runCoreNow();
      return;
    }
    clearTimeout(__dashRenderCoreCoalesce);
    __dashRenderCoreCoalesce = setTimeout(function () {
      __dashRenderCoreCoalesce = null;
      renderDashboardCore(window.__dashboardState.getData());
    }, DASH_CORE_COALESCE_MS);
  }

  /* ── syncForensicHostFilterBar ─────────────────────────────────────── */
  /** Multi-Host: Chip-Leiste über den Forensic-Charts; Signale/Hit-Limit/Cache pro Scan-Quelle, Ausfall weiter Tageswert. */
  function syncForensicHostFilterBar(data) {
    var wrap = document.getElementById("forensic-host-filter-wrap");
    var chipsHost = document.getElementById("forensic-host-filter-chips");
    var hint = document.getElementById("forensic-host-filter-hint");
    if (!wrap || !chipsHost) return;
    var hLabs = data?.host_labels || [];
    if (hLabs.length <= 1) {
      wrap.setAttribute("hidden", "");
      window.__dashboardState.setForensicHostFilter('');
      try {
        sessionStorage.removeItem("usageForensicHostFilter");
      } catch (error) { window.logClientOptionalErr(error); }
      if (hint) {
        hint.style.display = "none";
        hint.textContent = "";
      }
      return;
    }
    wrap.removeAttribute("hidden");
    var stored = "";
    try {
      stored = sessionStorage.getItem("usageForensicHostFilter") || "";
    } catch (error) { window.logClientOptionalErr(error); }
    if (stored && !hLabs.includes(stored)) stored = "";
    window.__dashboardState.setForensicHostFilter(stored);
    var hostSig = hLabs.join("\u0000");
    var lbl = document.getElementById("forensic-host-filter-label");
    if (lbl) lbl.textContent = t("forensicHostFilterLabel");
    wrap.setAttribute("aria-label", t("forensicHostFilterAria"));
    if (!wrap.dataset.filterClickBound) {
      wrap.dataset.filterClickBound = "1";
      chipsHost.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".forensic-host-chip");
        if (btn) {
          var raw = btn.dataset.hostFilter != null ? String(btn.dataset.hostFilter) : "__ALL__";
          var val = raw === "__ALL__" ? "" : raw;
          window.__dashboardState.setForensicHostFilter(val);
          try {
            if (val) sessionStorage.setItem("usageForensicHostFilter", val);
            else sessionStorage.removeItem("usageForensicHostFilter");
          } catch (error) { window.logClientOptionalErr(error); }
          var nodes = chipsHost.querySelectorAll(".forensic-host-chip");
          for (var _node of nodes) {
            var rv = _node.dataset.hostFilter != null ? String(_node.dataset.hostFilter) : "__ALL__";
            var nv = rv === "__ALL__" ? "" : rv;
            var on = nv === window.__dashboardState.getForensicHostFilter();
            _node.classList.toggle("active", on);
            _node.setAttribute("aria-pressed", on ? "true" : "false");
          }
          if (hint) {
            if (window.__dashboardState.getForensicHostFilter()) {
              hint.style.display = "";
              hint.textContent = tr("forensicHostFilterHint", { host: window.__dashboardState.getForensicHostFilter() });
            } else {
              hint.style.display = "none";
              hint.textContent = "";
            }
          }
          if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
        }
      });
    }
    if (wrap.dataset.lastHostSig !== hostSig) {
      wrap.dataset.lastHostSig = hostSig;
      chipsHost.innerHTML = "";
      function addChip(value, text) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "forensic-host-chip";
        b.textContent = text;
        b.dataset.hostFilter = value === "" ? "__ALL__" : value;
        chipsHost.appendChild(b);
      }
      addChip("", t("forensicHostFilterAll"));
      for (var _hl of hLabs) {
        addChip(_hl, _hl);
      }
    }
    var btns = chipsHost.querySelectorAll(".forensic-host-chip");
    for (var bb of btns) {
      var rv2 = bb.dataset.hostFilter != null ? String(bb.dataset.hostFilter) : "__ALL__";
      var nv2 = rv2 === "__ALL__" ? "" : rv2;
      var active = nv2 === window.__dashboardState.getForensicHostFilter();
      bb.classList.toggle("active", active);
      bb.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (hint) {
      if (window.__dashboardState.getForensicHostFilter()) {
        hint.style.display = "";
        hint.textContent = tr("forensicHostFilterHint", { host: window.__dashboardState.getForensicHostFilter() });
      } else {
        hint.style.display = "none";
        hint.textContent = "";
      }
    }
  }

  /* ── renderDashboardCore ───────────────────────────────────────────── */

  /** Build a lightweight fingerprint of the data that matters for chart rendering. */
  function _buildCoreFingerprint(data) {
    var parts = [];
    parts.push('acct=' + (window.__dashboardState.getFilterAccount?.() || 'all'));
    var days = data.days || [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      parts.push(d.date + ':' + (d.total || 0) + ':' + (d.output || 0) + ':' + (d.cache_read || 0) + ':' + (d.hit_limit || 0) + ':' + (d.outage_hours || 0));
    }
    parts.push('s=' + (data.scanning ? '1' : '0'));
    parts.push('g=' + (data.generated || ''));
    var sp = data.scan_progress;
    if (sp) parts.push('p=' + (sp.done || 0) + '/' + (sp.total || 0));
    var pd = data.proxy?.proxy_days;
    if (pd) parts.push('px=' + pd.length + ':' + (pd.length > 0 ? (pd[pd.length - 1].date || '') : ''));
    return parts.join('|');
  }
  var __lastCoreFp = '';
  var __coreRenderCount = 0;

  function reconcileActivePageTemplates() {
    if (!globalThis.__dispatcherLayout?.applyStoredInternalScaffolds) return;
    globalThis.__dispatcherLayout.applyStoredInternalScaffolds();
    setTimeout(function () {
      globalThis.__widgetDispatcher?.resizeAll?.();
    }, 0);
  }

  function renderDashboardCore(data) {
    // Update dev overlay with last sync info
    var devSync = document.getElementById("dev-last-sync");
    if (devSync && data.generated) {
      var ts = new Date(data.generated);
      devSync.textContent = "Last: " + ts.toLocaleTimeString() + (data.dev_source ? " · " + (data.days || []).length + "d" : "");
    }

    // Data fingerprint: skip full section re-render when data is unchanged
    // (preserves chart zoom, pan, scroll, and interactive state across SSE refreshes)
    var coreFp = _buildCoreFingerprint(data);
    if (__coreRenderCount >= 2 && coreFp === __lastCoreFp && coreFp !== '') {
      // Data unchanged — dismiss overlays and update live timestamp only
      showMainChartsSkeleton(false);
      showRecomputeOverlay(false);
      if (!data.scanning && !document.getElementById('initial-sync-dialog')) dismissWarmupOverlay();
      document.getElementById("live-label").textContent = tr("liveConnected",{time:new Date().toLocaleTimeString()});
      return;
    }
    __lastCoreFp = coreFp;
    __coreRenderCount++;

    window.__dashboardState.setReleaseStability(data.release_stability || null);
    var disp = window.__widgetDispatcher;
    if (disp?.init) disp.init();
    // applyGridLayout is called inside init() — no separate call needed
    // Section renders — dispatcher controls order + visibility
    var filteredData = window.__dashboardState.getFilteredData(data);
    window.renderProxyAnalysis(filteredData);
    if (typeof window.renderGatewaySection === 'function') {
      window.renderGatewaySection(filteredData);
    }
    // Cost Intelligence rendered via widget dispatcher (sectionRenderFn)
    if (typeof window.renderSecurityPostures === 'function') {
      window.renderSecurityPostures(filteredData);
    }
    window.renderBudgetEfficiency(data);
    // Intelligence section removed — Saturation/Health now in Proxy KPIs
    window.renderEconomicSection(data, getFilteredDays(data.days));
    window.renderUserProfileCharts(getFilteredDays(data.days));
    window.updateMetaDetailsSummary(data);
    var days = getFilteredDays(data.days);
    if(!days.length){
      var meta0=document.getElementById("meta");
      var ls0=document.getElementById("limit-source");
      if(ls0) ls0.textContent = window.apiNote(data, "limit_source_note", "limit_source_note_en");
      if(data.scanning){

        var selScan=document.getElementById("day-picker");
        if(selScan){
          selScan.innerHTML="<option value=\"\">"+window.escHtml(t("dayPickerScanning"))+"</option>";
          selScan.disabled=true;
        }
        var sp0 = data.scan_progress;
        if (sp0?.total > 0) meta0.textContent = tr("metaScanningExpanded", { done: sp0.done, total: sp0.total, sec: data.refresh_sec || 180 });
        else meta0.textContent=t("metaScanning");
        var sumS=document.getElementById("forensic-summary-line");if(sumS)sumS.textContent=t("metaForensicScanning");
        var fnS=document.getElementById("forensic-note");if(fnS)fnS.textContent=tr("metaForensicNoteFirst",{sec:data.refresh_sec||180});
        document.getElementById("cards").innerHTML="";
        var fcS=document.getElementById("forensic-cards");if(fcS)fcS.innerHTML="";
        if(_charts.cForensic){try{_charts.cForensic.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cForensic=null;}
        if(_charts.cForensicSignals){try{_charts.cForensicSignals.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cForensicSignals=null;}
        if(_charts.cService){try{_charts.cService.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cService=null;}
        chartShellSetLoading("c-forensic", true);
        chartShellSetLoading("c-forensic-signals", true);
        chartShellSetLoading("c-service", true);
        document.getElementById("live-label").textContent=t("liveWaitData");
        reconcileActivePageTemplates();
        return;
      }

      var selNd=document.getElementById("day-picker");
      if(selNd){
        selNd.innerHTML="<option value=\"\">"+window.escHtml(t("dayPickerNoData"))+"</option>";
        selNd.disabled=true;
      }
      if(data.scan_error)meta0.textContent=tr("metaScanError",{msg:String(data.scan_error)});
      else if((data.parsed_files||0)===0)meta0.textContent=t("metaNoFiles");
      else meta0.textContent=tr("metaNoUsage",{files:data.parsed_files||0});
      var sum0=document.getElementById("forensic-summary-line");if(sum0)sum0.textContent=t("forensicSummaryNoData");
      var fn0=document.getElementById("forensic-note");if(fn0)fn0.textContent="";
      var fc0=document.getElementById("forensic-cards");if(fc0)fc0.innerHTML="";
      document.getElementById("cards").innerHTML="";
      if(_charts.cForensic){try{_charts.cForensic.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cForensic=null;}
      if(_charts.cForensicSignals){try{_charts.cForensicSignals.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cForensicSignals=null;}
      if(_charts.cService){try{_charts.cService.dispose();}catch (error) { window.logClientOptionalErr(error); }_charts.cService=null;}
      chartShellSetLoading("c-forensic", false);
      chartShellSetLoading("c-forensic-signals", false);
      chartShellSetLoading("c-service", false);

      // Local scanner fetching — keep the progress overlay visible.
      if (data.agent_pending) {
        updateWarmupOverlay(data);
        reconcileActivePageTemplates();
        return;
      }
      if (!data.scanning) {
        dismissWarmupOverlay();
      }
      reconcileActivePageTemplates();
      return;
    }

    showMainChartsSkeleton(false);
    showRecomputeOverlay(false);
    // Guard: never auto-dismiss while the init-sync dialog is active — the user is mid-flow
    if (!data.scanning && !document.getElementById('initial-sync-dialog')) dismissWarmupOverlay();

    var calToday = data.calendar_today || "";
    var spM = data.scan_progress;
    var metaLine =
      data.scanning && spM?.total > 0 && spM.done < spM.total
        ? tr("metaParsedInProgress", {
            done: spM.done,
            total: spM.total,
            time: new Date(data.generated).toLocaleString(),
            sec: data.refresh_sec || 180
          })
        : tr("metaParsed", { files: data.parsed_files, time: new Date(data.generated).toLocaleString(), sec: data.refresh_sec || 180 });
    var dcm = window.apiNote(data,"day_cache_mode","day_cache_mode_en");
    if (dcm) metaLine += " | " + dcm;
    metaLine += " " + t("metaChartsHint");
    if (window.getMainChartsScope() === "hourly") metaLine += " " + t("metaChartsHintHourly");
    document.getElementById("meta").textContent = metaLine;

    var selEl = document.getElementById("day-picker");
    var prevSel = selEl?.value ? selEl.value : "";
    if (!prevSel) {
      try { prevSel = sessionStorage.getItem("usageDashboardDay") || ""; } catch (error) { window.logClientOptionalErr(error); }
    }
    var valid = {};
    for (var _vd of days) valid[_vd.date] = true;
    var pick = prevSel;
    if (selEl) {
      selEl.innerHTML = "";
      selEl.disabled = false;
      for (var di = days.length - 1; di >= 0; di--) {
        var o = document.createElement("option");
        o.value = days[di].date;
        var lab = days[di].date;
        if (days[di].date === calToday) lab += t("calTodaySuffix");
        if ((days[di].total || 0) === 0) lab += t("zeroLogsSuffix");
        o.textContent = lab;
        selEl.appendChild(o);
      }
      if (!pick || !valid[pick]) {
        pick = (calToday && valid[calToday]) ? calToday : days[days.length - 1].date;
        // In dev mode: skip today if it has no data, pick last day with output
        if (pick === calToday && data.dev_source) {
          for (var dp = days.length - 1; dp >= 0; dp--) {
            if ((days[dp].output || 0) > 0) { pick = days[dp].date; break; }
          }
        }
      }
      selEl.value = pick;
      if (!selEl.dataset.bound) {
        selEl.dataset.bound = "1";
        selEl.addEventListener("change", function () {
          try { sessionStorage.setItem("usageDashboardDay", this.value); } catch (error) { window.logClientOptionalErr(error); }
          if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
        });
      }
    } else {
      if (!pick || !valid[pick]) {
        pick = (calToday && valid[calToday]) ? calToday : days[days.length - 1].date;
        if (pick === calToday && data.dev_source) {
          for (var dp2 = days.length - 1; dp2 >= 0; dp2--) {
            if ((days[dp2].output || 0) > 0) { pick = days[dp2].date; break; }
          }
        }
      }
    }
    var selDay = null;
    for (var _sd of days) {
      if (_sd.date === pick) { selDay = _sd; break; }
    }
    if (!selDay) selDay = days[days.length - 1];
    var hLabs = data.host_labels || [];
    var multiHost = hLabs.length > 1;
    syncForensicHostFilterBar(data);
    window.syncMainChartsScopeUi();
    var prevDPick = window.__usageDetailDayPick;
    window.__usageDetailDayPick = pick;
    if (typeof prevDPick !== "undefined" && prevDPick !== pick) window.__usageDetailHost = null;
    if (window.__usageDetailHost && (!multiHost || !selDay.hosts?.[window.__usageDetailHost])) window.__usageDetailHost = null;
    var hintEl = document.getElementById("day-picker-hint");
    if (hintEl) {
      hintEl.textContent = (pick === calToday && (selDay.total || 0) === 0) ? t("dayPickerHintZero") : "";
    }
    var ddh = document.getElementById("daily-detail-heading");
    if (ddh) {
      if (!ddh.querySelector("#daily-detail-title")) {
        ddh.innerHTML = "<span id=\"daily-detail-title\"></span><button type=\"button\" id=\"daily-detail-clear-host\" style=\"display:none;margin-left:10px;padding:2px 8px;border-radius:4px;border:1px solid #3D3830;background:#1A1D24;color:#A0875E;font-size:.72rem;cursor:pointer\"></button>";
      }
      var ddt = document.getElementById("daily-detail-title");
      var ddc = document.getElementById("daily-detail-clear-host");
      if (ddt) ddt.textContent = t("dailyDetailPrefix") + pick + (window.__usageDetailHost ? " — " + window.__usageDetailHost : "");
      if (ddc) {
        if (window.__usageDetailHost && multiHost) {
          ddc.style.display = "";
          ddc.textContent = t("dailyDetailClearHost");
          if (!ddc.dataset.bound) {
            ddc.dataset.bound = "1";
            ddc.addEventListener("click", function () {
              window.__usageDetailHost = null;
              if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
            });
          }
        } else ddc.style.display = "none";
      }
    }
    var ls = document.getElementById("limit-source");
    ls.textContent = window.apiNote(data, "limit_source_note", "limit_source_note_en");
    ls.title = t("limitSourceTooltip");
    var fn = document.getElementById("forensic-note");
    if(fn) fn.textContent = window.apiNote(data, "forensic_note", "forensic_note_en");
    document.getElementById("live-label").textContent = tr("liveConnected",{time:new Date().toLocaleTimeString()});

    // --- Token Stats + Forensic via extracted sections ---
    var __sectionCtx = { data: data, days: days, selDay: selDay, pick: pick, hLabs: hLabs, multiHost: multiHost };
    if (typeof window.renderTokenStatsSection === 'function') {
      var __tsResult = window.renderTokenStatsSection(__sectionCtx);
      if (typeof window.renderForensicSection === 'function') {
        window.renderForensicSection(__sectionCtx, __tsResult);
      }
    }
    // Render extracted charts in standalone wrappers (after all section contexts are set)
    if (globalThis.__widgetDispatcher?.dispatchRender) {
      globalThis.__widgetDispatcher.dispatchRender(data, days);
    }
    if (globalThis.__widgetDispatcher?.applyAllChartVisibility) {
      globalThis.__widgetDispatcher.applyAllChartVisibility();
    }
    // Dynamic KPI renderers replace their keyed DOM nodes. Reconcile the
    // active page templates after all sections have finished rendering so
    // every editable surface keeps its saved scaffold across live refreshes.
    reconcileActivePageTemplates();
  }

  /* ── resize orchestration ──────────────────────────────────────────── */
  function __mainChartsResizeAll() {
    var keys = ['c1', 'c2', 'c3', 'c4', 'c1hosts', 'cForensic', 'cForensicSignals', 'cService'];
    for (var _ck of keys) {
      if (_charts[_ck] && typeof _charts[_ck].resize === 'function') {
        try { _charts[_ck].resize(); } catch (error) { window.logClientOptionalErr(error); }
      }
    }
  }
  var __effResizeT = null;
  (function () {
    var w = globalThis.window;
    if (!w) return;
    w.addEventListener("resize", function () {
      if (__effResizeT) clearTimeout(__effResizeT);
      __effResizeT = setTimeout(function () {
        var disp = window.__widgetDispatcher;
        if (disp) disp.resizeAll();
        else {
          // Fallback when the dispatcher is unavailable.
          if (typeof window.__effResizeAll === 'function') window.__effResizeAll();
          if (typeof window.__budgetResizeAll === 'function') window.__budgetResizeAll();
          __mainChartsResizeAll();
          if (typeof window.__proxyChartsResizeAll === 'function') window.__proxyChartsResizeAll();
          if (typeof window.__userProfileChartsResizeAll === 'function') window.__userProfileChartsResizeAll();
          if (typeof window.__gatewayChartsResizeAll === 'function') window.__gatewayChartsResizeAll();
        }
        window.resizeLiveScannedJsonlChartIfAny();
        __safeChartResize(window._intelCharts?.seasonality);
      }, 120);
    });
  })();

  function getProxyDay(data) {
    var pd = data?.proxy?.proxy_days;
    if (!pd?.length) return null;
    return pd.at(-1);
  }

  /* ── expose on window ──────────────────────────────────────────────── */
  window.renderDashboard = renderDashboard;
  window._charts = _charts;
  window.__scheduleAnthropicHealthChartsResize = __scheduleAnthropicHealthChartsResize;
  window.__bumpAnthropicHealthCharts = __bumpAnthropicHealthCharts;
  window.getProxyDay = getProxyDay;
  window.__mainChartsResizeAll = __mainChartsResizeAll;
  window.__resetDashboardCoreFingerprint = function () {
    __lastCoreFp = '';
    __coreRenderCount = 0;
  };

} catch (e) { if (window.appLogger) window.appLogger.errorM('ui-core-renderer', 'init', 'fail', e?.message || e); } })();
