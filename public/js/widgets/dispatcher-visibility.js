/**
 * @asseris-module       Dispatcher Visibility
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/dispatcher-visibility.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Widget Dispatcher — Visibility submodule.
 *
 * Handles section/chart visibility queries, toggling, and DOM sync.
 * Exposes window.__dispatcherVisibility for delegation from widget-dispatcher.js.
 */
'use strict';

(function (global) {

  // ── Internal helpers (delegate to main dispatcher / registry) ──

  function getRegistry() {
    return global.__widgetRegistry || null;
  }

  function getSortedSections() {
    return global.__widgetDispatcher ? global.__widgetDispatcher.getSortedSections() : [];
  }

  function idOccursInWidgetList(widgetsArr, id) {
    if (!widgetsArr || !id) return false;
    for (var w of widgetsArr) {
      if (w.id === id) return true;
    }
    return false;
  }

  function logWdOptionalErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-widget-visibility', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  // ── Visibility queries ─────────────────────────────────────────

  function isSectionVisible(sectionId) {
    if (!global.__prefsStore.prefs) return true;
    var hs = global.__prefsStore.prefs.hiddenSections;
    if (!Array.isArray(hs)) hs = [];
    var reg = getRegistry();
    var secDef = reg?.findSection ? reg.findSection(sectionId) : null;
    // Sections without a layout <details> host (e.g. anthropic-status in the top bar) are not
    // listed in widgets[] — they must stay "visible" so chart visibility only uses hiddenCharts.
    if (secDef?.domId === null && secDef?.reorderable === false) {
      return true;
    }
    if (secDef?.parentSection) {
      if (hs.includes(sectionId)) return false;
      return isSectionVisible(secDef.parentSection);
    }
    if (hs.includes(sectionId)) return false;
    if (global.__prefsStore.prefs.widgets?.length) {
      var wi;
      for (wi = 0; wi < global.__prefsStore.prefs.widgets.length; wi++) {
        if (global.__prefsStore.prefs.widgets[wi].id === sectionId) return true;
      }
      return false;
    }
    return true;
  }

  function isChartVisible(chartId) {
    if (!global.__prefsStore.prefs) return true;
    var reg = getRegistry();
    var secId = null;
    if (reg?.sections) {
      for (var secX of reg.sections) {
        var charts = secX.charts || [];
        for (var chX of charts) {
          if (chX.id === chartId) {
            secId = secX.id;
            break;
          }
        }
        if (secId) break;
      }
    }
    if (secId && !isSectionVisible(secId)) return false;
    var h = global.__prefsStore.prefs.hiddenCharts;
    if (!Array.isArray(h)) return true;
    return !h.includes(chartId);
  }

  function getWidgetSpan(sectionId) {
    if (!global.__prefsStore.prefs?.widgets) return null;
    for (var wgt of global.__prefsStore.prefs.widgets) {
      if (wgt.id === sectionId) return wgt.span;
    }
    return null;
  }

  // ── Visibility application ─────────────────────────────────────

  function applyVisibility() {
    var sections = getSortedSections();
    for (var sec of sections) {
      if (!sec.domId) continue;
      var el = document.getElementById(sec.domId);
      if (!el) continue;
      var vis = isSectionVisible(sec.id);
      el.style.display = vis ? '' : 'none';
      // Hide companion elements too
      var companions = sec.companionIds || [];
      for (var compId of companions) {
        var comp = document.getElementById(compId);
        if (comp) comp.style.display = vis ? '' : 'none';
      }
    }
  }

  /**
   * hiddenSections = (nicht in widgets[]) union (Checkbox-aus, aber noch in widgets[]).
   * So bleibt Sichtbarkeit beim Reload erhalten, ohne Reihenfolge aus widgets[] zu streichen.
   */
  function reconcileHiddenSectionsWithWidgets() {
    if (!global.__prefsStore.prefs?.widgets?.length) return false;
    var reg = getRegistry();
    if (!reg) return false;
    var inW = {};
    for (var pw of global.__prefsStore.prefs.widgets) inW[pw.id] = true;
    var notInWidgets = [];
    for (var rs of reg.sections) {
      if (rs.reorderable === false || rs.parentSection) continue;
      if (!inW[rs.id]) notInWidgets.push(rs.id);
    }
    var curHs = global.__prefsStore.prefs.hiddenSections || [];
    var checkboxHiddenInLayout = [];
    for (var hid of curHs) {
      if (inW[hid]) checkboxHiddenInLayout.push(hid);
    }
    var nextMap = {};
    var u;
    for (u = 0; u < notInWidgets.length; u++) nextMap[notInWidgets[u]] = true;
    for (u = 0; u < checkboxHiddenInLayout.length; u++) nextMap[checkboxHiddenInLayout[u]] = true;
    var next = Object.keys(nextMap).sort();
    var cur = curHs.slice().sort();
    if (cur.length !== next.length) {
      global.__prefsStore.setHiddenSections(next);
      return true;
    }
    for (var kk = 0; kk < next.length; kk++) {
      if (cur[kk] !== next[kk]) {
        global.__prefsStore.setHiddenSections(next);
        return true;
      }
    }
    return false;
  }

  // ── Visibility setters (public API) ────────────────────────────

  function setVisibility(id, visible) {
    global.__prefsStore.ensurePrefs();
    global.__prefsStore.toggleSectionHidden(id, !visible);
    var p = global.__prefsStore.prefs;
    if (visible && p.widgets) {
      var found = false;
      for (var pw2 of p.widgets) {
        if (pw2.id === id) {
          found = true;
          break;
        }
      }
      if (!found) {
        var reg2 = getRegistry();
        var targetSec = reg2 ? reg2.findSection(id) : null;
        var targetOrder = targetSec ? (targetSec.order || 999) : 999;
        var insertIdx = p.widgets.length;
        for (var fi = 0; fi < p.widgets.length; fi++) {
          var existSec = reg2 ? reg2.findSection(p.widgets[fi].id) : null;
          var existOrder = existSec ? (existSec.order || 0) : 0;
          if (targetOrder < existOrder) {
            insertIdx = fi;
            break;
          }
        }
        global.__prefsStore.insertWidgetAtIndex(insertIdx, { id: id, span: 12 });
        global.__prefsStore.syncPrefsOrderFromWidgets();
      }
    }
    global.__prefsStore.savePrefs();
    if (global.__prefsStore.prefs.widgets?.length) {
      if (global.__dispatcherLayout) global.__dispatcherLayout.applyGridLayout();
    } else {
      applyVisibility();
    }
  }

  /** Show/hide all charts in a widgetGroup in one prefs write (leaves stay individually toggleable). */
  function setGroupChartsVisibility(childIds, visible) {
    if (!childIds?.length) return;
    global.__prefsStore.ensurePrefs();
    for (var cid of childIds) {
      if (!cid) continue;
      global.__prefsStore.toggleChartHidden(cid, !visible);
    }
    global.__prefsStore.savePrefs();
    applyAllChartVisibility();
    var needsHealth = false;
    for (var id0 of childIds) {
      if (!id0) continue;
      if (id0.startsWith('health-kpi-') || id0.startsWith('health-finding-')) {
        needsHealth = true;
        break;
      }
    }
    if (needsHealth) {
      if (typeof global.invalidateHealthAndFindingsRender === 'function') {
        global.invalidateHealthAndFindingsRender();
      }
      var dd = global.__dashboardState?.getData();
      if (dd) {
        if (typeof global.renderHealthScore === 'function') global.renderHealthScore(dd);
        if (typeof global.renderKeyFindings === 'function') global.renderKeyFindings(dd);
      }
    }
    scheduleResizeAfterChartVisibility();
  }

  function setChartVisibility(chartId, visible) {
    global.__prefsStore.ensurePrefs();
    global.__prefsStore.toggleChartHidden(chartId, !visible);
    global.__prefsStore.savePrefs();
    applyChartVisibility(chartId, visible);
    if (
      chartId.startsWith('health-kpi-') ||
      chartId.startsWith('health-finding-')
    ) {
      if (typeof global.invalidateHealthAndFindingsRender === 'function') {
        global.invalidateHealthAndFindingsRender();
      }
      var dd = global.__dashboardState?.getData();
      if (dd) {
        if (typeof global.renderHealthScore === 'function') global.renderHealthScore(dd);
        if (typeof global.renderKeyFindings === 'function') global.renderKeyFindings(dd);
      }
      // renderHealthScore / renderKeyFindings replace innerHTML — restores default display; re-sync prefs
      applyAllChartVisibility();
    }
  }

  /** One DOM host (canvas / KPI grid) may map to several registry charts — OR visibility. */
  function syncCanvasGroupVisibility(canvasId) {
    if (!canvasId) return;
    var reg = getRegistry();
    if (!reg) return;
    var show = false;
    for (var regSec of reg.sections) {
      var charts = regSec.charts || [];
      for (var ch of charts) {
        if (ch.canvasId === canvasId && isChartVisible(ch.id)) {
          show = true;
          break;
        }
      }
      if (show) break;
    }
    var el = null;
    if (
      canvasId === 'c-uptime-chart' ||
      canvasId === 'c-incident-history' ||
      canvasId === 'c-outage-timeline' ||
      canvasId === 'c-anthropic-incidents'
    ) {
      var ab = document.getElementById('anthropic-badge');
      if (ab) el = ab.querySelector('#' + canvasId);
    }
    if (!el) el = document.getElementById(canvasId);
    if (!el) return;
    var box = el.closest('.chart-box');
    if (box) {
      box.style.display = show ? '' : 'none';
      return;
    }
    var forensicBlock = el.matches?.('.cf-section,.cf-hero')
      ? el
      : el.closest('.cf-section,.cf-hero');
    if (forensicBlock) {
      forensicBlock.style.display = show ? '' : 'none';
      return;
    }
    el.style.display = show ? '' : 'none';
  }

  /** ECharts mis-measures after host display:none -> visible; defer resize until layout settles. */
  function scheduleResizeAfterChartVisibility() {
    setTimeout(function () {
      if (global.__widgetDispatcher) global.__widgetDispatcher.resizeAll();
    }, 50);
    setTimeout(function () {
      if (global.__widgetDispatcher) global.__widgetDispatcher.resizeAll();
    }, 200);
  }

  function applyChartVisibility(chartId, visible) {
    var reg = getRegistry();
    if (!reg) return;
    var chartDef = reg.findChart(chartId);
    if (!chartDef) return;
    syncCanvasGroupVisibility(chartDef.canvasId);
    scheduleResizeAfterChartVisibility();
  }

  function applyAllChartVisibility() {
    var reg = getRegistry();
    if (!reg) return;
    var seen = {};
    for (var acSec of reg.sections) {
      var charts = acSec.charts || [];
      for (var acCh of charts) {
        var cid = acCh.canvasId;
        if (!cid || seen[cid]) continue;
        seen[cid] = true;
        syncCanvasGroupVisibility(cid);
      }
    }
    scheduleResizeAfterChartVisibility();
  }

  // ── Expose ─────────────────────────────────────────────────────

  global.__dispatcherVisibility = {
    isSectionVisible: isSectionVisible,
    isChartVisible: isChartVisible,
    getWidgetSpan: getWidgetSpan,
    applyVisibility: applyVisibility,
    reconcileHiddenSectionsWithWidgets: reconcileHiddenSectionsWithWidgets,
    setVisibility: setVisibility,
    setGroupChartsVisibility: setGroupChartsVisibility,
    setChartVisibility: setChartVisibility,
    syncCanvasGroupVisibility: syncCanvasGroupVisibility,
    scheduleResizeAfterChartVisibility: scheduleResizeAfterChartVisibility,
    applyChartVisibility: applyChartVisibility,
    applyAllChartVisibility: applyAllChartVisibility
  };

})(typeof window !== 'undefined' ? window : this);
