'use strict';
/**
 * @asseris-module       Dashboard Boot
 * @asseris-description  Browser bootstrap for dashboard chrome + bindings; initializes
 *                       usage fetch, stream connection and local UI event bindings.
 * @asseris-pillar       decision
 * @asseris-domain       dashboard-ui
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        API Client, Dashboard Renderer, Dashboard Shell, Dev Overlay
 * @asseris-called-by    Dashboard HTML
 * @asseris-emits        UI event bindings
 * @asseris-consumes     static i18n keys, DOM events
 *
 * core/dashboard-boot.js — App bootstrap, chrome initialization, event binding (Phase 18a).
 *
 * Extracted from dashboard.client.js. Runs at load time:
 *   - Language button binding
 *   - Visibility/pageshow listeners
 *   - applyStaticChrome (i18n strings on static DOM)
 *   - Init calls (meta panel, github token, marketplace)
 *   - Live panel toggle, report modal binding
 *   - API boot: fetchUsage + connectStream + scheduleFetchExtensionTimeline
 */
(function () { try {
  // ── applyStaticChrome ──────────────────────────────────────────────
  function applyStaticChrome() {
    document.title = t("pageTitle");
    var lsw = document.getElementById("lang-switch-wrap");
    if (lsw) lsw.setAttribute("aria-label", t("ariaLangGroup"));
    var lswSb = document.getElementById("sidebar-lang-switch");
    if (lswSb) lswSb.setAttribute("aria-label", t("ariaLangGroup"));
    var lsl = document.getElementById("lang-switch-label");
    if (lsl) lsl.textContent = t("langLabel");
    var mh = document.getElementById("main-heading");
    if (mh) mh.textContent = t("heading");
    var sm = document.getElementById("sub-models");
    if (sm) sm.innerHTML = t("subModelsHtml");
    var releaseModalTitle = document.getElementById("release-modal-title");
    if (releaseModalTitle) releaseModalTitle.textContent = t("releaseHistoryTitle");
    var releaseModalOpenSource = document.getElementById("release-modal-open-source");
    if (releaseModalOpenSource) releaseModalOpenSource.textContent = t("openSourceFreeToUse");
    var releaseButton = document.getElementById("sidebar-release-btn");
    if (releaseButton) releaseButton.textContent = t("settingsOpenReleases");
    var sidebarOpenSource = document.getElementById("sidebar-open-source");
    if (sidebarOpenSource) sidebarOpenSource.textContent = t("openSourceFreeToUse");
    var lp = document.getElementById("lbl-day-picker");
    if (lp) lp.textContent = t("dayPickerLabel");
    var selp = document.getElementById("day-picker");
    if (selp) selp.setAttribute("aria-label", t("dayPickerAria"));
    var lfp = document.getElementById("live-files-panel");
    if (lfp) lfp.setAttribute("aria-label", t("livePanelAria"));
    var fh = document.getElementById("forensic-chart-h3");
    if (fh) fh.textContent = t("forensicChartTitle");
    var fb = document.getElementById("forensic-chart-blurb");
    if (fb) fb.innerHTML = t("forensicChartBlurbHtml");
    var fsh = document.getElementById("forensic-signals-chart-h3");
    if (fsh) fsh.textContent = t("forensicSignalsChartTitle");
    var fsb = document.getElementById("forensic-signals-blurb");
    if (fsb) fsb.innerHTML = t("forensicSignalsBlurbHtml");
    var rbl = document.getElementById("report-btn-label");
    if (rbl) rbl.textContent = t("reportBtn");
    var rbt = document.getElementById("forensic-report-btn");
    if (rbt) rbt.setAttribute("title", t("reportBtnTitle"));
    var sh3 = document.getElementById("service-chart-h3");
    if (sh3) sh3.textContent = t("serviceChartTitle");
    var sbl = document.getElementById("service-chart-blurb");
    if (sbl) sbl.innerHTML = t("serviceBlurb");
    var tn = document.getElementById("thinking-note");
    if (tn) tn.textContent = t("thinkingNote");
    var lf = document.getElementById("live-files-hint");
    if (lf) lf.textContent = t("liveFilesHint");
    document.documentElement.lang = getLang();
    var usc = document.getElementById("update-sl-close");
    if (usc) usc.setAttribute("aria-label", t("updateSlideoutClose"));
    var gtl = document.getElementById("github-token-label");
    if (gtl) gtl.textContent = t("githubTokenLabel");
    var gts = document.getElementById("github-token-save");
    if (gts) gts.textContent = t("githubTokenSave");
    var gtc = document.getElementById("github-token-clear");
    if (gtc) gtc.textContent = t("githubTokenClear");
    var gtr = document.getElementById("github-releases-refresh");
    if (gtr) gtr.textContent = t("githubTokenRefreshReleases");
    var mpRef = document.getElementById("marketplace-extension-refresh");
    if (mpRef) mpRef.textContent = t("marketplaceRefreshLabel");
    var gth = document.getElementById("github-token-hint");
    if (gth) gth.textContent = t("githubTokenHint");
    var mskh = document.getElementById("main-charts-skel-hint");
    if (mskh) mskh.textContent = t("mainChartsSkelHint");
    if (typeof window.syncMainChartsScopeUi === 'function') window.syncMainChartsScopeUi();
    var fhLab = document.getElementById("forensic-host-filter-label");
    if (fhLab) fhLab.textContent = t("forensicHostFilterLabel");
    var fhWrap2 = document.getElementById("forensic-host-filter-wrap");
    if (fhWrap2 && !fhWrap2.hasAttribute("hidden")) fhWrap2.setAttribute("aria-label", t("forensicHostFilterAria"));
    var fhChips = document.getElementById("forensic-host-filter-chips");
    if (fhChips) {
      var f0 = fhChips.querySelector(".forensic-host-chip[data-host-filter=\"__ALL__\"]");
      if (f0) f0.textContent = t("forensicHostFilterAll");
    }
    var fhHint2 = document.getElementById("forensic-host-filter-hint");
    if (fhHint2 && fhHint2.style.display !== "none" && window.__dashboardState.getForensicHostFilter()) {
      fhHint2.textContent = tr("forensicHostFilterHint", { host: window.__dashboardState.getForensicHostFilter() });
    }
    if (window.__dashboardShell) window.__dashboardShell.fillInitialShellText();
    updateGithubTokenPanelMode();
    scheduleGithubTokenUiRefresh();
  }
  window.applyStaticChrome = applyStaticChrome;

  // ── Forensic summary toolbar ─────────────────────────────────────
  function initForensicSummaryToolbarOnce() {
    var act = document.getElementById("forensic-summary-actions");
    if (!act || act.dataset.stopPropBound) return;
    act.dataset.stopPropBound = "1";
    act.addEventListener("click", function (ev) { ev.stopPropagation(); });
  }

  // ── Language + visibility + pageshow ──────────────────────────────
  var bde = document.getElementById("lang-de");
  var ben = document.getElementById("lang-en");
  var bko = document.getElementById("lang-ko");
  if (bde) bde.addEventListener("click", function () { setLang("de"); });
  if (ben) ben.addEventListener("click", function () { setLang("en"); });
  if (bko) bko.addEventListener("click", function () { setLang("ko"); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    updateGithubTokenPanelMode();
    scheduleGithubTokenUiRefresh();
  });
  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    updateGithubTokenPanelMode();
    scheduleGithubTokenUiRefresh();
  });

  // ── Init sequence ────────────────────────────────────────────────
  applyStaticChrome();
  initForensicSummaryToolbarOnce();
  initMetaDetailsPanel();
  initGithubTokenPanel();
  initMarketplaceRefreshButton();

  // ── Live panel toggle ────────────────────────────────────────────
  var lp = document.getElementById("live-pop");
  var trEl = document.getElementById("live-trigger");
  if (lp && trEl) {
    function setLivePanelOpen(open) {
      if (open) lp.classList.add("live-files-open");
      else lp.classList.remove("live-files-open");
      trEl.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(function () {
            requestAnimationFrame(resizeLiveScannedJsonlChartIfAny);
          });
        } else {
          setTimeout(resizeLiveScannedJsonlChartIfAny, 50);
        }
      }
    }
    trEl.setAttribute("aria-expanded", "false");
    trEl.addEventListener("click", function (e) {
      e.stopPropagation();
      setLivePanelOpen(!lp.classList.contains("live-files-open"));
    });
    trEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        setLivePanelOpen(!lp.classList.contains("live-files-open"));
      }
    });
    document.addEventListener("click", function () {
      setLivePanelOpen(false);
    });
    lp.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    var lfpanel = document.getElementById("live-files-panel");
    if (lfpanel && !lfpanel.dataset.extOpenBound) {
      lfpanel.dataset.extOpenBound = "1";
      lfpanel.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".live-ext-open");
        if (btn?.dataset.dayIndex == null) return;
        ev.preventDefault();
        ev.stopPropagation();
        initUpdateSlideoutOnce();
        openUpdateSlideout(Number.parseInt(btn.dataset.dayIndex, 10));
      });
    }
  }

  // ── Report modal binding ─────────────────────────────────────────
  var rbtn = document.getElementById("forensic-report-btn");
  if (rbtn) rbtn.addEventListener("click", openReportModal);
  var rcl = document.getElementById("report-close-btn");
  if (rcl) rcl.addEventListener("click", closeReportModal);
  var rdl = document.getElementById("report-download-btn");
  if (rdl) rdl.addEventListener("click", downloadReport);
  var rcp = document.getElementById("report-copy-btn");
  if (rcp) rcp.addEventListener("click", copyReport);
  var rea = document.getElementById("report-expand-all");
  if (rea) rea.addEventListener("click", function () { document.querySelectorAll("#report-content .report-section").forEach(function (s) { s.open = true; }); });
  var rca = document.getElementById("report-collapse-all");
  if (rca) rca.addEventListener("click", function () { document.querySelectorAll("#report-content .report-section").forEach(function (s) { s.open = false; }); });
  var rov = document.getElementById("report-modal-overlay");
  if (rov) rov.addEventListener("click", function (e) { if (e.target === rov) closeReportModal(); });

  // ── Local API boot ───────────────────────────────────────────────
  window.__apiClient.fetchUsage();
  window.__apiClient.connectStream();
  window.__apiClient.scheduleFetchExtensionTimeline(900);
} catch (e) { if (window.appLogger) window.appLogger.errorM('ui-core-boot', 'init', 'fail', e?.message || e); } })();
