/**
 * @asseris-module       Dispatcher Layout
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/dispatcher-layout.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Widget Dispatcher — Layout submodule.
 *
 * Handles DOM reordering, grid layout, template application, and section panel expansion.
 * Exposes window.__dispatcherLayout for delegation from widget-dispatcher.js.
 */
'use strict';

(function (global) {
  var _internalLayoutState = [];
  var _internalLayoutHosts = [];
  var _internalShellState = [];
  // Every section exposed by the page-scoped template builder must honor the
  // same builderSections contract. Renderer-owned DOM is reconciled by stable
  // widget ids after every data render.
  var INTERNAL_SCAFFOLD_SECTIONS = {
    health: true,
    economic: true,
    'token-stats': true,
    budget: true,
    'user-profile': true,
    forensic: true,
    proxy: true,
    'security-postures': true,
    'cost-intelligence': true
  };

  // ── Internal helpers (delegate to main dispatcher / registry) ──

  function getRegistry() {
    return global.__widgetRegistry || null;
  }

  function isSectionVisible(sectionId) {
    return global.__dispatcherVisibility
      ? global.__dispatcherVisibility.isSectionVisible(sectionId)
      : true;
  }

  function applyVisibility() {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.applyVisibility();
  }

  function applyAllChartVisibility() {
    if (global.__dispatcherVisibility) global.__dispatcherVisibility.applyAllChartVisibility();
  }

  function resizeAll() {
    if (global.__widgetDispatcher) global.__widgetDispatcher.resizeAll();
  }

  function renderWidgetTree() {
    if (global.__layoutTree) global.__layoutTree.renderWidgetTree();
  }

  function getSortedSections() {
    return global.__widgetDispatcher ? global.__widgetDispatcher.getSortedSections() : [];
  }

  // ── DOM Reorder ─────────────────────────────────────────────────

  function applyOrder() {
    if (!global.__prefsStore.prefs?.order?.length) return;
    var sections = getSortedSections();
    // Find the parent container of sections
    var firstSec = null;
    for (var secF of sections) {
      if (secF.domId) {
        firstSec = document.getElementById(secF.domId);
        if (firstSec) break;
      }
    }
    if (!firstSec?.parentNode) return;
    var parent = firstSec.parentNode;

    // Collect all section elements + their companions in desired order
    for (var si = sections.length - 1; si >= 0; si--) {
      var sec = sections[si];
      if (!sec.domId || sec.reorderable === false) continue;
      var el = document.getElementById(sec.domId);
      if (!el) continue;
      // Insert companions after section (in reverse order)
      var companions = sec.companionIds || [];
      for (var ci = companions.length - 1; ci >= 0; ci--) {
        var comp = document.getElementById(companions[ci]);
        if (comp && el.nextSibling !== comp) {
          parent.insertBefore(comp, el.nextSibling);
        }
      }
    }
  }

  // ── Section panel expansion ─────────────────────────────────────

  /** Sichtbare Haupt-Sektionen (<details>) und verschachtelte Chart-Disclosures oeffnen (z. B. nach Vorlagenwechsel). */
  function expandVisibleSectionPanels() {
    var reg = getRegistry();
    if (!reg?.sections) return;
    for (var sec of reg.sections) {
      if (!sec.domId) continue;
      if (!isSectionVisible(sec.id)) continue;
      var el = document.getElementById(sec.domId);
      if (!el || el?.tagName !== 'DETAILS') continue;
      el.open = true;
      var nested = el.querySelectorAll('details');
      for (var nDet of nested) {
        nDet.open = true;
      }
    }
  }

  // ── Template application ────────────────────────────────────────

  function restoreInternalScaffold(sectionIds) {
    var filter = null;
    if (Array.isArray(sectionIds)) {
      filter = {};
      for (var fi = 0; fi < sectionIds.length; fi++) filter[sectionIds[fi]] = true;
    }
    var keptStates = [];
    for (var i = _internalLayoutState.length - 1; i >= 0; i--) {
      var state = _internalLayoutState[i];
      if (filter && !filter[state.sectionId]) {
        keptStates.unshift(state);
        continue;
      }
      var replacement = null;
      if (state.el.id) {
        var current = document.getElementById(state.el.id);
        if (current && current !== state.el) replacement = current;
      }
      if (replacement) {
        state.el.remove();
        state.placeholder?.remove();
      } else if (state.placeholder?.parentNode) {
        state.placeholder.parentNode.insertBefore(state.el, state.placeholder);
        state.placeholder.remove();
      }
      state.el.style.display = state.display;
      state.el.style.removeProperty('--widget-inner-span');
      state.el.classList.remove('widget-internal-item');
    }
    var keptShells = [];
    for (var shi = 0; shi < _internalShellState.length; shi++) {
      var shellState = _internalShellState[shi];
      if (filter && !filter[shellState.sectionId]) keptShells.push(shellState);
      else shellState.el.style.display = shellState.display;
    }
    var keptHosts = [];
    for (var hi = 0; hi < _internalLayoutHosts.length; hi++) {
      var hostState = _internalLayoutHosts[hi];
      if (filter && !filter[hostState.sectionId]) keptHosts.push(hostState);
      else hostState.el.remove();
    }
    _internalLayoutState = keptStates;
    _internalShellState = keptShells;
    _internalLayoutHosts = keptHosts;
  }

  function internalWidgetElement(chartDef, sectionRoot) {
    if (!chartDef || !sectionRoot) return null;
    var node = document.getElementById(chartDef.canvasId || chartDef.id);
    if (!node || !sectionRoot.contains(node)) return null;
    if (node.matches?.('.cf-hero,.chart-box,.cf-section,.forensic-chart-panel,[data-widget-id]')) return node;
    return node.closest('.cf-section,.chart-box,.forensic-chart-panel,[data-widget-id]') || node;
  }

  function rememberInternalOrigin(el, sectionId) {
    for (var i = 0; i < _internalLayoutState.length; i++) {
      if (_internalLayoutState[i].el === el) return;
    }
    var marker = document.createComment('widget-origin:' + (el.id || 'item'));
    el.parentNode.insertBefore(marker, el);
    _internalLayoutState.push({ el: el, placeholder: marker, display: el.style.display, sectionId: sectionId });
  }

  function rememberInternalShell(el, sectionId) {
    if (!el) return;
    for (var i = 0; i < _internalShellState.length; i++) {
      if (_internalShellState[i].el === el) return;
    }
    _internalShellState.push({ el: el, display: el.style.display, sectionId: sectionId });
  }

  function internalContentRoot(sectionRoot) {
    if (!sectionRoot) return null;
    return sectionRoot.querySelector(':scope > .forensic-inner,:scope > .health-collapse-inner') || sectionRoot;
  }

  function directChildUnder(node, ancestor) {
    if (!node || !ancestor || !ancestor.contains(node)) return null;
    var current = node;
    while (current.parentElement && current.parentElement !== ancestor) current = current.parentElement;
    return current.parentElement === ancestor ? current : null;
  }

  /**
   * Apply the exact nested builder scaffold inside a page section. Unlike the
   * outer dispatcher this moves existing renderer-owned DOM blocks; it never
   * clones charts or creates duplicate standalone wrappers.
   */
  function applyInternalScaffold(tpl) {
    if (!Array.isArray(tpl?.builderSections) || !tpl.builderSections.length) {
      if (!tpl?.surfaceId) restoreInternalScaffold();
      return;
    }
    var supportedSections = tpl.builderSections.filter(function (section) {
      return !!INTERNAL_SCAFFOLD_SECTIONS[section.id];
    });
    if (!supportedSections.length) return;
    var targetSectionIds = supportedSections.map(function (section) { return section.id; });
    restoreInternalScaffold(targetSectionIds);
    var reg = getRegistry();
    if (!reg) return;

    for (var si = 0; si < supportedSections.length; si++) {
      var sectionModel = supportedSections[si];
      var sectionDef = reg.findSection(sectionModel.id);
      var sectionRoot = sectionDef?.domId ? document.getElementById(sectionDef.domId) : null;
      if (!sectionRoot) continue;
      var contentRoot = internalContentRoot(sectionRoot);
      if (!contentRoot) continue;

      var allDefs = (sectionDef.charts || []).slice();
      var registrySections = reg.sections || [];
      for (var rsi = 0; rsi < registrySections.length; rsi++) {
        if (registrySections[rsi].parentSection !== sectionModel.id) continue;
        allDefs = allDefs.concat(registrySections[rsi].charts || []);
      }
      var elementByWidget = {};
      var defByWidget = {};
      for (var di = 0; di < allDefs.length; di++) {
        var resolved = internalWidgetElement(allDefs[di], sectionRoot);
        if (resolved) {
          elementByWidget[allDefs[di].id] = resolved;
          defByWidget[allDefs[di].id] = allDefs[di];
        }
      }

      var selectedElements = [];
      var sourceShells = [];
      var host = document.createElement('div');
      host.className = 'widget-internal-grid';
      host.setAttribute('data-template-surface', tpl.surfaceId || '');

      var children = sectionModel.children || [];
      for (var ci = 0; ci < children.length; ci++) {
        var child = children[ci];
        var isBlock = child.type === 'block';
        var row = isBlock ? document.createElement('div') : host;
        if (isBlock) {
          row.className = 'widget-internal-row';
          row.style.setProperty('--widget-row-span', String(child.span || 12));
        }
        var rowChildren = isBlock ? (child.children || []) : [child];

        for (var wi = 0; wi < rowChildren.length; wi++) {
          var widget = rowChildren[wi];
          var widgetDef = defByWidget[widget.id];
          if (sectionModel.id === 'proxy' && global.__proxyRequestOnly && widgetDef?.fullProxyOnly) {
            continue;
          }
          var el = elementByWidget[widget.id];
          if (!el || selectedElements.indexOf(el) !== -1) continue;
          var sourceShell = directChildUnder(el, contentRoot);
          if (sourceShell && sourceShell !== el && sourceShells.indexOf(sourceShell) === -1) {
            sourceShells.push(sourceShell);
          }
          rememberInternalOrigin(el, sectionModel.id);
          el.style.display = '';
          el.classList.add('widget-internal-item');
          var rowSpan = child.span || 12;
          var widgetSpan = isBlock ? Math.min(widget.span || rowSpan, rowSpan) : rowSpan;
          el.style.setProperty('--widget-inner-span', String(widgetSpan));
          row.appendChild(el);
          selectedElements.push(el);
        }
        if (isBlock && row.children.length) {
          row.style.setProperty('--widget-row-columns', String(child.span || 12));
          host.appendChild(row);
        }
      }

      var uniqueAll = [];
      for (var key in elementByWidget) {
        var candidate = elementByWidget[key];
        if (uniqueAll.indexOf(candidate) === -1) uniqueAll.push(candidate);
      }
      for (var ai = 0; ai < uniqueAll.length; ai++) {
        var candidateShell = directChildUnder(uniqueAll[ai], contentRoot);
        if (candidateShell && candidateShell !== uniqueAll[ai] && sourceShells.indexOf(candidateShell) === -1) {
          sourceShells.push(candidateShell);
        }
        if (selectedElements.indexOf(uniqueAll[ai]) !== -1) continue;
        rememberInternalOrigin(uniqueAll[ai], sectionModel.id);
        uniqueAll[ai].style.display = 'none';
      }

      for (var ssi = 0; ssi < sourceShells.length; ssi++) {
        rememberInternalShell(sourceShells[ssi], sectionModel.id);
        sourceShells[ssi].style.display = 'none';
      }

      contentRoot.appendChild(host);
      _internalLayoutHosts.push({ el: host, sectionId: sectionModel.id });
    }
  }

  function applyStoredInternalScaffolds() {
    var prefs = global.__prefsStore?.prefs;
    var active = prefs?.activeTemplates;
    var templates = prefs?.templates;
    if (!active || !Array.isArray(templates)) return;
    for (var surfaceId in active) {
      for (var ti = 0; ti < templates.length; ti++) {
        if (templates[ti].surfaceId === surfaceId && templates[ti].name === active[surfaceId]) {
          applyInternalScaffold(templates[ti]);
          break;
        }
      }
    }
  }

  function applyTemplate(tpl) {
    global.__prefsStore.applyTemplateToPrefs(tpl);
    applyGridLayout();
    applyAllChartVisibility();
    expandVisibleSectionPanels();
    renderWidgetTree();
    setTimeout(function () {
      resizeAll();
    }, 280);
  }

  // ── Chart wrapper creation ──────────────────────────────────────

  /**
   * Create a standalone wrapper for a chart extracted from its section.
   * Returns the wrapper DOM element (creates if not exists).
   */
  function getOrCreateChartWrapper(chartDef) {
    var wrapperId = 'widget-' + chartDef.id;
    var existing = document.getElementById(wrapperId);
    if (existing) return existing;

    var wrapper = document.createElement('div');
    wrapper.id = wrapperId;
    wrapper.className = 'chart-box chart-box--standalone';

    var title = document.createElement('h3');
    title.textContent = typeof t === 'function' ? t(chartDef.titleKey || chartDef.id) : chartDef.id;
    wrapper.appendChild(title);

    if (chartDef.engine === 'echarts') {
      var canvas = document.createElement('div');
      canvas.id = wrapperId + '-canvas';
      var h = (chartDef.size?.minHeight) || 260;
      canvas.style.cssText = 'width:100%;height:' + h + 'px';
      wrapper.appendChild(canvas);
    } else {
      var content = document.createElement('div');
      content.id = wrapperId + '-content';
      wrapper.appendChild(content);
    }
    return wrapper;
  }

  // ── Grid layout ─────────────────────────────────────────────────

  /** Render sections into a 12-column CSS grid based on widgets[] */
  function applyGridLayout() {
    var widgets = global.__prefsStore.prefs?.widgets;
    if (!widgets?.length) {
      applyVisibility();
      applyOrder();
      return;
    }
    var reg = getRegistry();
    if (!reg) return;

    var gridEl = document.getElementById('layout-grid');
    if (!gridEl) return;

    // Hide all existing standalone chart wrappers (will re-show only those in current template)
    var existingWrappers = gridEl.querySelectorAll('[id^="widget-"]');
    for (var ew of existingWrappers) {
      ew.style.display = 'none';
    }

    // Collect all direct children that are NOT sections (table, day-picker, etc.)
    var nonSectionNodes = [];
    var children = gridEl.children;
    for (var ni = children.length - 1; ni >= 0; ni--) {
      var child = children[ni];
      if (!child.id?.match(/-collapse$/)) {
        // Also skip standalone chart wrappers
        if (child.id?.startsWith('widget-')) continue;
        nonSectionNodes.push(child);
      }
    }

    var placed = {};
    var extractedCharts = {};
    var managedSurfaces = {};
    var activeTemplates = global.__prefsStore.prefs?.activeTemplates || {};
    var savedTemplates = global.__prefsStore.prefs?.templates || [];
    for (var activeSurface in activeTemplates) {
      for (var sti = 0; sti < savedTemplates.length; sti++) {
        if (
          savedTemplates[sti].surfaceId === activeSurface &&
          savedTemplates[sti].name === activeTemplates[activeSurface] &&
          Array.isArray(savedTemplates[sti].builderSections)
        ) {
          managedSurfaces[activeSurface] = true;
          break;
        }
      }
    }

    // Move sections and charts into grid in widget order
    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      var wType = w.type || 'section';
      var ownerSurface = w.surfaceId || global.__navModel?.getSectionSurface?.(w.section || w.id)?.id || '';
      if ((wType === 'layout' || wType === 'chart') && managedSurfaces[ownerSurface]) {
        // Exact builderSections owns this page's internal layout. Legacy flat
        // chart rows would otherwise create duplicate standalone wrappers.
        continue;
      }

      if (wType === 'layout') {
        // Layout blocks describe internal section structure (builder metadata).
        // Charts stay inside their section DOM — no standalone extraction.
        continue;
      }

      if (wType === 'chart') {
        // Chart-level widget: create standalone wrapper
        var chartDef = reg.findChart(w.id);
        if (!chartDef) continue;
        var wrapper = getOrCreateChartWrapper(chartDef);
        wrapper.setAttribute('data-span', String(w.span || 6));
        wrapper.style.display = '';
        gridEl.appendChild(wrapper);
        extractedCharts[w.id] = true;
        continue;
      }

      // Section-level widget (existing logic)
      var sec = reg.findSection(w.id);
      if (!sec?.domId) continue;
      // Skip nested sections — they stay inside their parent
      if (sec.parentSection) continue;
      var el = document.getElementById(sec.domId);
      if (!el) continue;

      var vis = isSectionVisible(sec.id);
      el.setAttribute('data-span', String(w.span || 12));
      el.style.display = vis ? '' : 'none';
      gridEl.appendChild(el);
      placed[w.id] = true;
      // If this section has child sections, mark them as placed too
      for (var csSec of reg.sections) {
        if (csSec.parentSection === w.id) placed[csSec.id] = true;
      }

      // Move companions after their section
      if (sec.companionIds) {
        for (var compId of sec.companionIds) {
          var comp = document.getElementById(compId);
          if (comp) {
            comp.setAttribute('data-span', String(w.span || 12));
            comp.style.display = vis ? '' : 'none';
            gridEl.appendChild(comp);
          }
        }
      }
    }

    // Store extracted chart IDs so section renderers can skip them
    window.__extractedChartIds = extractedCharts;

    // Append non-section elements at the end (table, day-picker, etc.)
    for (var ri = nonSectionNodes.length - 1; ri >= 0; ri--) {
      var node = nonSectionNodes[ri];
      node.setAttribute('data-span', '12');
      gridEl.appendChild(node);
    }

    // Hide sections not in the template (skip nested)
    for (var hSec of reg.sections) {
      if (!hSec.domId || placed[hSec.id] || hSec.parentSection) continue;
      var hEl = document.getElementById(hSec.domId);
      if (hEl) hEl.style.display = 'none';
    }

    // Resize all ECharts after layout shift
    applyStoredInternalScaffolds();
    setTimeout(function () { resizeAll(); }, 200);
  }

  // ── Order setter (public API) ──────────────────────────────────

  function setOrder(orderedIds) {
    global.__prefsStore.ensurePrefs();
    var list = orderedIds.slice();
    global.__prefsStore.setPrefsOrder(list);
    if (global.__prefsStore.prefs.widgets?.length) {
      global.__prefsStore.syncPrefsWidgetsFromDraggableOrder(list);
      global.__prefsStore.savePrefs();
      applyGridLayout();
      return;
    }
    global.__prefsStore.savePrefs();
    applyOrder();
  }

  // ── Expose ─────────────────────────────────────────────────────

  global.__dispatcherLayout = {
    applyOrder: applyOrder,
    expandVisibleSectionPanels: expandVisibleSectionPanels,
    applyTemplate: applyTemplate,
    applyInternalScaffold: applyInternalScaffold,
    restoreInternalScaffold: restoreInternalScaffold,
    applyStoredInternalScaffolds: applyStoredInternalScaffolds,
    getOrCreateChartWrapper: getOrCreateChartWrapper,
    applyGridLayout: applyGridLayout,
    setOrder: setOrder
  };

})(typeof window !== 'undefined' ? window : this);
