/**
 * @asseris-module       Widget Dispatcher
 * @asseris-description  Auto-annotated module metadata for public/js/widget-dispatcher.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Widget Dispatcher — Dispatcher-Core (Phase 11b).
 *
 * Reads __widgetRegistry and controls:
 *   - Render dispatch (which sections render, in what order)
 *   - Unified resize (one handler for all ECharts instances)
 *   - Visibility control (section + chart level, persisted in localStorage)
 *   - Section reordering (DOM reorder via insertBefore)
 *   - Disclosure toggle auto-binding
 *
 * Loads BEFORE dashboard.client.js but AFTER widget-registry.js.
 * All render functions are resolved by name from window[fnName] at dispatch time.
 *
 * Submodules (loaded via <script> before this file):
 *   - widgets/dispatcher-visibility.js  → window.__dispatcherVisibility
 *   - widgets/dispatcher-layout.js      → window.__dispatcherLayout
 *   - widgets/dispatcher-init.js        → window.__dispatcherInit
 */
'use strict';

(function (global) {
  /**
   * Layout-Prefs (Reihenfolge, Sichtbarkeit, widgets[]):
   * - Primärquelle: localStorage unter PREFS_KEY — nach DOM-Reload ist nur das sofort wieder da.
   * - GET/PUT /api/layout: immer derselbe Origin wie die Seite (lokaler dashboard-server).
   *   Die gespeicherte Layout-Datei bleibt im lokalen Produkt-State-Verzeichnis.
   *   loadPrefs: GET + X-Layout-Mtime; ist die Datei neuer als cud_layout_file_mtime, LS aus Datei überschreiben.
   */
  var PREFS_KEY = 'cud_widget_prefs';
  /** Letzter bekannter mtimeMs der Layout-Datei auf dem Server (Abgleich Handedit vs. LS). */
  var LAYOUT_FILE_MTIME_KEY = 'cud_layout_file_mtime';
  var PREFS_VERSION = 1;

  function logWdOptionalErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-widget-dispatcher', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  // ── Registry helpers ────────────────────────────────────────────

  function getRegistry() {
    return global.__widgetRegistry || null;
  }

  function idOccursInWidgetList(widgetsArr, id) {
    if (!widgetsArr || !id) return false;
    for (var w of widgetsArr) {
      if (w.id === id) return true;
    }
    return false;
  }

  function getSortedSections() {
    var reg = getRegistry();
    if (!reg) return [];
    var byId = {};
    for (var sec0 of reg.sections) {
      byId[sec0.id] = sec0;
    }
    /** v2: Reihenfolge exakt aus widgets[] — gleicher Pfad wie applyGridLayout (appendChild). */
    if (global.__prefsStore.prefs?.widgets?.length) {
      var outW = [];
      var seenW = {};
      var ww = global.__prefsStore.prefs.widgets;
      for (var wEnt2 of ww) {
        var wid = wEnt2.id;
        if (seenW[wid]) continue;
        var secW = byId[wid];
        if (!secW) continue;
        if (secW.reorderable === false) continue;
        if (secW.parentSection) continue;
        if (!secW.domId) continue;
        seenW[wid] = true;
        outW.push(secW);
      }
      // Remainder: sections with domId that are not in widgets[] at all
      var remW = Object.keys(byId).sort(function (a, b) {
        return (byId[a].order || 0) - (byId[b].order || 0);
      });
      for (var rid of remW) {
        if (seenW[rid]) continue;
        var s2 = byId[rid];
        if (!s2 || s2.reorderable === false) continue;
        if (s2.parentSection) continue;
        if (!s2.domId) continue;
        if (idOccursInWidgetList(ww, rid)) continue;
        outW.push(s2);
        seenW[rid] = true;
      }
      return outW;
    }
    if (global.__prefsStore.prefs?.order?.length > 0) {
      var result = [];
      for (var oKey of global.__prefsStore.prefs.order) {
        if (byId[oKey]) {
          result.push(byId[oKey]);
          delete byId[oKey];
        }
      }
      var remaining = Object.keys(byId).sort(function (a, b) {
        return (byId[a].order || 0) - (byId[b].order || 0);
      });
      for (var remKey of remaining) {
        result.push(byId[remKey]);
      }
      return result;
    }
    return reg.getSectionsSorted();
  }

  // ── Visibility (delegated to dispatcher-visibility.js) ─────────

  function isSectionVisible(sectionId) {
    return global.__dispatcherVisibility ? global.__dispatcherVisibility.isSectionVisible(sectionId) : true;
  }

  function isChartVisible(chartId) {
    return global.__dispatcherVisibility ? global.__dispatcherVisibility.isChartVisible(chartId) : true;
  }

  function getWidgetSpan(sectionId) {
    return global.__dispatcherVisibility ? global.__dispatcherVisibility.getWidgetSpan(sectionId) : null;
  }

  function applyVisibility() {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.applyVisibility();
  }

  function applyAllChartVisibility() {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.applyAllChartVisibility();
  }

  function setVisibility(id, visible) {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.setVisibility(id, visible);
  }

  function setGroupChartsVisibility(childIds, visible) {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.setGroupChartsVisibility(childIds, visible);
  }

  function setChartVisibility(chartId, visible) {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.setChartVisibility(chartId, visible);
  }

  // ── Layout (delegated to dispatcher-layout.js) ─────────────────

  function applyGridLayout() {
    if (global.__dispatcherLayout) global.__dispatcherLayout.applyGridLayout();
  }

  function applyTemplate(tpl) {
    if (global.__dispatcherLayout) global.__dispatcherLayout.applyTemplate(tpl);
  }

  function setOrder(orderedIds) {
    if (global.__dispatcherLayout) global.__dispatcherLayout.setOrder(orderedIds);
  }

  // ── Init (delegated to dispatcher-init.js) ─────────────────────

  function initFull() {
    if (global.__dispatcherInit) global.__dispatcherInit.initFull();
  }

  // ── Unified Resize ──────────────────────────────────────────────

  function resizeChartOnDomId(domId) {
    var node = document.getElementById(domId);
    if (!node || !node.offsetWidth) return;
    var inst = echarts.getInstanceByDom(node);
    if (inst && typeof inst.resize === 'function') {
      try {
        inst.dispatchAction({ type: 'hideTip' });
        inst.resize();
      } catch (eR) {
        /* detached or tooltip race */
      }
    }
  }

  function resizeAll() {
    var reg = getRegistry();
    if (!reg || typeof echarts === 'undefined') return;
    var sections = reg.sections;
    for (var sec of sections) {
      if (!isSectionVisible(sec.id)) continue;
      if (sec.domId) {
        var det = document.getElementById(sec.domId);
        if (det?.tagName === 'DETAILS' && !det.open) continue;
      }
      var charts = sec.charts || [];
      for (var ch of charts) {
        if (!isChartVisible(ch.id)) continue;
        var el = document.getElementById(ch.canvasId);
        if (!el || !el.offsetWidth) continue;
        var inst = echarts.getInstanceByDom(el);
        if (inst && typeof inst.resize === 'function') {
          try { inst.dispatchAction({ type: 'hideTip' }); inst.resize(); } catch (e) { /* detached */ }
        }
      }
    }
    /* Nicht in sec.charts: Proxy Effizienz-Trend, Live-JSONL, Sidebar-Stats (ECharts auf eigenem Host-DIV) */
    var extraDomIds = [
      'c-proxy-efficiency-heatmap',
      'c-proxy-efficiency-ratio',
      'c-proxy-efficiency-vispct',
      'c-proxy-efficiency-cachemiss',
      'live-files-chart-host',
      'sb-user-versions',
      'sb-user-entrypoints',
      'sb-user-stability'
    ];
    for (var eDomId of extraDomIds) {
      resizeChartOnDomId(eDomId);
    }
    if (typeof global.__gatewayChartsResizeAll === 'function') {
      try { global.__gatewayChartsResizeAll(); } catch (e) { /* detached */ }
    }
    // Several legacy sections own their ECharts instances outside the
    // registry dispatcher. They can be initialized while their product
    // surface is display:none, so resizing registry canvases alone leaves a
    // tiny internal plotting area after navigation/onboarding.
    var ownedResizeFns = [
      '__mainChartsResizeAll',
      '__effResizeAll',
      '__budgetResizeAll',
      '__proxyChartsResizeAll',
      '__userProfileChartsResizeAll'
    ];
    for (var rfi = 0; rfi < ownedResizeFns.length; rfi++) {
      var resizeFn = global[ownedResizeFns[rfi]];
      if (typeof resizeFn !== 'function') continue;
      try { resizeFn(); } catch (ownedResizeError) { /* detached */ }
    }
  }

  // ── Render Dispatch ─────────────────────────────────────────────

  function dispatchRender(data, days) {
    var renderData = global.__dashboardState?.getFilteredData
      ? global.__dashboardState.getFilteredData(data)
      : data;
    var sections = getSortedSections();
    renderSections(sections, renderData, days);

    var reg = getRegistry();
    if (!reg) return;
    // A chart states what it needs; the selected add-ons state what they
    // deliver. Anything that cannot be filled is taken off the surface rather
    // than shown as an empty frame that looks like a defect.
    var available = Array.isArray(renderData?.capabilities) ? renderData.capabilities : null;
    reconcileStoredLayout(available);
    renderPendingCharts(reg, collectPendingCharts(sections, available));
  }

  function renderSections(sections, renderData, days) {
    for (var sec of sections) {
      if (!isSectionVisible(sec.id)) continue;
      if (!sec.sectionRenderFn) continue;
      var fn = global[sec.sectionRenderFn];
      if (typeof fn === 'function') fn(renderData, days);
    }
  }

  /**
   * Correct the stored layout too. Hiding the element alone is not enough:
   * the layout puts the chart back on every load and keeps offering it in the
   * sidebar.
   */
  function reconcileStoredLayout(available) {
    if (!available || !global.__dispatcherVisibility?.reconcileUnavailableCharts) return;
    try {
      global.__dispatcherVisibility.reconcileUnavailableCharts(available);
    } catch (error) { logWdOptionalErr(error); }
  }

  function isUnfillable(chart, available) {
    if (!available || !Array.isArray(chart.requires) || !chart.requires.length) return false;
    return chart.requires.some(function (need) { return !available.includes(need); });
  }

  /**
   * Charts whose drawing lives in their own render function, rather than inside
   * the section renderer. This used to cover extracted charts only — charts the
   * layout had lifted into standalone wrappers — so a chart that simply sat in
   * its section template never had its renderer called at all. It showed its
   * frame and title from the template and stayed blank, which looked like
   * missing data and was missing wiring.
   */
  function collectPendingCharts(sections, available) {
    var pending = {};
    var extracted = global.__extractedChartIds || {};
    for (var ek in extracted) {
      if (Object.hasOwn(extracted, ek)) pending[ek] = true;
    }
    for (var secDef of sections) {
      if (!isSectionVisible(secDef.id)) continue;
      for (var chart of secDef.charts || []) {
        if (isUnfillable(chart, available)) {
          hideUnavailableChart(chart);
          continue;
        }
        // The section renderer already drew these; calling it again per chart
        // would repeat the same work for every chart it owns.
        if (!chart.renderFn || chart.renderFn === secDef.sectionRenderFn) continue;
        if (!chart.canvasId || !document.getElementById(chart.canvasId)) continue;
        if (!isChartVisible(chart.id)) continue;
        pending[chart.id] = true;
      }
    }
    return pending;
  }

  function renderPendingCharts(reg, pending) {
    for (var chartId in pending) {
      if (!Object.hasOwn(pending, chartId)) continue;
      var chartDef = reg.findChart(chartId);
      if (!chartDef?.renderFn) continue;
      var rf = global[chartDef.renderFn];
      if (typeof rf !== 'function') continue;
      try {
        invokeChartRenderFn(chartDef.renderFn, rf);
      } catch (error) { logWdOptionalErr(error); }
    }
  }

  /**
   * Take a chart off the surface when its sources cannot fill it.
   *
   * A chart can be on screen twice over: as the box in its section template,
   * and as the standalone wrapper the layout lifts into the grid. The wrapper
   * carries its own element id and its own canvas, so hiding by the template's
   * canvas id alone left the visible copy untouched.
   */
  function hideUnavailableChart(chart) {
    if (!chart?.id) return;
    var targets = [];
    if (chart.canvasId) {
      var templateCanvas = document.getElementById(chart.canvasId);
      if (templateCanvas) targets.push(templateCanvas.closest?.('.chart-box, .cf-section, .cf-hero') || templateCanvas);
    }
    var wrapper = document.getElementById('widget-' + chart.id);
    if (wrapper) targets.push(wrapper);
    var hoisted = document.querySelector('[data-hoisted-chart="' + chart.id + '"]');
    if (hoisted) targets.push(hoisted);
    for (var target of targets) target.style.display = 'none';
  }

  /** ECharts that need filtered days, _econData, or session picker (cognitive split from invokeChartRenderFn). */
  function invokeEconOrUsageChartRender(rfName, rf) {
    var uDataE = global.__dashboardState?.getData();
    var eDaysE = [];
    if (uDataE?.days?.length) {
      eDaysE = typeof global.getFilteredDays === 'function'
        ? global.getFilteredDays(uDataE.days) : uDataE.days.slice();
    }
    var stEcon = global._econData;
    if (rfName === 'renderMonthlyButterfly' || rfName === 'renderDayComparison') {
      rf(eDaysE);
      return;
    }
    if (rfName === 'renderEfficiencyTimeline') {
      if (stEcon) rf(stEcon);
      return;
    }
    if (rfName === 'renderBudgetDrain') {
      if (stEcon) rf(stEcon, global._econQdData || undefined);
      return;
    }
    if (rfName === 'renderCacheExplosion') {
      var sessEl = document.getElementById('econ-session-picker');
      var selV = sessEl ? sessEl.value : '';
      var sessE = null;
      if (stEcon && typeof global.findSession === 'function') {
        sessE = global.findSession(stEcon, selV);
      }
      if (sessE) rf(sessE);
    }
  }

  /** Invoke a standalone chart render function with the correct context data. */
  function invokeChartRenderFn(rfName, rf) {
    var s = String(rfName);
    if (s.startsWith('renderProxy_')) {
      var dataP = global.__dashboardState?.getData();
      if (dataP && typeof global._computeProxyCtx === 'function') global._computeProxyCtx(dataP);
      if (global.__dashboardState?.getSectionCtx('proxy')) rf(global.__dashboardState?.getSectionCtx('proxy'));
      return;
    }
    if (s.startsWith('renderForensic_')) {
      var fctx = global.__dashboardState?.getSectionCtx('forensic');
      if (fctx) rf(fctx);
      return;
    }
    if (s.startsWith('renderUserProfile_')) {
      var uctx = global.__dashboardState?.getSectionCtx('userProfile');
      if (uctx) rf(uctx);
      return;
    }
    if (s.startsWith('renderBudget_')) {
      var bctx = global.__dashboardState?.getSectionCtx('budget');
      if (!bctx && global.__dashboardState?.getData() && typeof global._computeBudgetCtx === 'function') {
        bctx = global._computeBudgetCtx(global.__dashboardState?.getData());
      }
      if (bctx) rf(bctx);
      return;
    }
    if (s.startsWith('renderTokenStats_')) {
      var tsctx = global.__dashboardState?.getSectionCtx('tokenStats');
      if (tsctx) rf(tsctx);
      return;
    }
    if (s.startsWith('renderGateway_')) {
      var gwData = global.__dashboardState?.getData();
      if (gwData) rf({ data: gwData });
      return;
    }
    if (s.startsWith('renderStatus_')) {
      rf();
      return;
    }
    if (
      rfName === 'renderCacheExplosion' ||
      rfName === 'renderBudgetDrain' || rfName === 'renderEfficiencyTimeline' ||
      rfName === 'renderMonthlyButterfly' || rfName === 'renderDayComparison'
    ) {
      invokeEconOrUsageChartRender(rfName, rf);
      return;
    }
    rf();
  }

  // ── Public helpers ──────────────────────────────────────────────

  function getPrefs() {
    return global.__prefsStore ? global.__prefsStore.getPrefs() : {};
  }

  function resetPrefs() {
    if (global.__prefsStore) global.__prefsStore.resetPrefs();
  }

  function shouldRender(sectionId) {
    return isSectionVisible(sectionId);
  }

  // -- Sidebar delegation stubs (settings-sidebar.js) --------
  function toggleSidebar(force) {
    if (global.__settingsSidebar) global.__settingsSidebar.toggleSidebar(force);
  }
  function bindSidebarEvents() {
    if (global.__settingsSidebar) global.__settingsSidebar.bindSidebarEvents();
  }
  function renderStatsSection() {
    if (global.__settingsSidebar) global.__settingsSidebar.renderStatsSection();
  }
  function renderSettingsSection() {
    if (global.__settingsSidebar) global.__settingsSidebar.renderSettingsSection();
  }
  function renderTemplatesSection() {
    if (global.__settingsSidebar) global.__settingsSidebar.renderTemplatesSection();
  }
  function bindToolsSection() {
    if (global.__settingsSidebar) global.__settingsSidebar.bindToolsSection();
  }
  function bindUserSettingsModal() {
    if (global.__settingsSidebar) global.__settingsSidebar.bindUserSettingsModal();
  }
  function escT(s) {
    return String(s == null ? '' : s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  // -- Tree delegation stubs (layout-tree.js) -----------------
  function renderWidgetTree() {
    if (global.__layoutTree) global.__layoutTree.renderWidgetTree();
  }
  function applyWidgetTreeCheckboxLock(treeEl, editing) {
    if (global.__layoutTree) global.__layoutTree.applyWidgetTreeCheckboxLock(treeEl, editing);
  }

  // -- Template/Sidebar rendering delegated to settings-sidebar.js / prefs-store.js

  function populateGatewaySection() { if (window.__gatewayPanel) window.__gatewayPanel.populateGatewaySection(); }
  function initGatewayBadge() { if (window.__gatewayPanel) window.__gatewayPanel.initGatewayBadge(); }
  function updateGatewayBadge(cfg) { if (window.__gatewayPanel) window.__gatewayPanel.updateGatewayBadge(cfg); }

  global.__widgetDispatcher = {
    init: initFull,
    dispatchRender: dispatchRender,
    resizeAll: resizeAll,
    resizeChartOnDomId: resizeChartOnDomId,
    toggleSidebar: toggleSidebar,
    setVisibility: setVisibility,
    setGroupChartsVisibility: setGroupChartsVisibility,
    setChartVisibility: setChartVisibility,
    setOrder: setOrder,
    getPrefs: getPrefs,
    resetPrefs: resetPrefs,
    shouldRender: shouldRender,
    isSectionVisible: isSectionVisible,
    isChartVisible: isChartVisible,
    getWidgetSpan: getWidgetSpan,
    getSortedSections: getSortedSections,
    renderWidgetTree: renderWidgetTree,
    applyGridLayout: applyGridLayout,
    applyAllChartVisibility: applyAllChartVisibility,
    applyTemplate: applyTemplate,
    getOrderedChartsForSection: function (sec) {
      return global.__layoutTree ? global.__layoutTree.getOrderedChartsForSection(sec) : [];
    },
    getDesktopPageScaffold: function () {
      return global.__templateBuilder ? global.__templateBuilder.tbGetDesktopPageScaffold() : null;
    },
    buildScaffoldTemplate: function () {
      return global.__templateBuilder?.tbNestedModelFromPageScaffold?.() || null;
    }
  };

  // The template builder is loaded before this dispatcher and cannot safely
  // reach into the prefs module while the script graph is still initializing.
  // Wire its persistence/apply helpers once all three modules exist.
  if (global.__templateBuilder && global.__prefsStore) {
    global.__templateBuilder.setTemplateHelpers({
      getAllTemplates: global.__prefsStore.getAllTemplates,
      loadTemplates: global.__prefsStore.loadTemplates,
      saveTemplates: global.__prefsStore.saveTemplates,
      applyTemplate: applyTemplate,
      renderTemplatesSection: renderTemplatesSection
    });
  }

  // Bind sidebar toggle immediately (don't wait for data/init)
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { bindSidebarEvents(); });
    } else {
      bindSidebarEvents();
    }
  }
})(typeof window !== 'undefined' ? window : this);
