/**
 * @asseris-module       Layout Tree
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/layout-tree.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * Layout Tree — widget tree UI, drag-and-drop section reorder.
 *
 * Extracted from widget-dispatcher.js as part of Phase 11b modularization.
 * Responsible for:
 *   - Rendering the widget tree (section + chart visibility checkboxes)
 *   - Drag-and-drop section reordering in the sidebar
 *   - Chart group checkbox sync
 *   - Ordered chart list per section
 *
 * Exposes: window.__layoutTree
 * Calls out: window.__widgetDispatcher.*, window.__prefsStore.*
 */
(function (global) {
  // ── State ──────────────────────────────────────────────────────────
  var _wtreeDragGhost = null;
  var _wtreeDragSrc = null;
  var _wtreeDropState = null;
  var _layoutTreeEditMode = false;

  // ── Logging ────────────────────────────────────────────────────────
  function logErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-widget-layout', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  // ── i18n helper (safe fallback) ────────────────────────────────────
  function _t(key) {
    if (typeof global.t === 'function') return global.t(key);
    var bundles = global.__I18N_BUNDLES;
    if (bundles) {
      var lang = document.documentElement.lang || 'en';
      var o = bundles[lang] || bundles.en || {};
      if (o[key] !== undefined && o[key] !== '') return o[key];
      var en = bundles.en || {};
      if (en[key] !== undefined) return en[key];
    }
    return key;
  }

  function escT(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  // ── Section item collector (across page-group sub-lists) ───────────

  /**
   * Collect all section li elements in document (display) order,
   * across page-group sub-lists and ungrouped root items.
   * querySelectorAll returns document order which matches render order.
   */
  function _collectSectionItems(treeRoot) {
    if (!treeRoot) return [];
    return Array.from(treeRoot.querySelectorAll('li.widget-tree-item[data-section]'));
  }

  // ── Drag-and-drop helpers ──────────────────────────────────────────

  function wtreeNextSectionLi(li) {
    if (!li?.parentNode) return null;
    var n = li.nextSibling;
    while (n) {
      if (n.nodeType === 1 && n.matches?.('li.widget-tree-item[data-section]')) return n;
      n = n.nextSibling;
    }
    return null;
  }

  function wtreePrevSectionLi(li) {
    if (!li?.parentNode) return null;
    var n = li.previousSibling;
    while (n) {
      if (n.nodeType === 1 && n.matches?.('li.widget-tree-item[data-section]')) return n;
      n = n.previousSibling;
    }
    return null;
  }

  function clearWtreeDropUi(ul) {
    if (!ul) return;
    var marks = ul.querySelectorAll(
      '.widget-tree-item--drop-before,.widget-tree-item--drop-after,.widget-tree-item--drop-gap-up,.widget-tree-item--drop-gap-down'
    );
    for (var mark of marks) {
      mark.classList.remove(
        'widget-tree-item--drop-before', 'widget-tree-item--drop-after',
        'widget-tree-item--drop-gap-up', 'widget-tree-item--drop-gap-down'
      );
    }
  }

  function wtreeFindDropState(ul, clientY, dragSrc) {
    var arr = _collectSectionItems(ul);
    if (!arr.length) return null;
    var slot = arr.length;
    for (var j = 0; j < arr.length; j++) {
      var r = arr[j].getBoundingClientRect();
      if (clientY < r.top + r.height * 0.5) { slot = j; break; }
    }
    var fromIdx = -1;
    for (var k = 0; k < arr.length; k++) {
      if (arr[k] === dragSrc) { fromIdx = k; break; }
    }
    if (fromIdx < 0) return null;
    if (slot === fromIdx || slot === fromIdx + 1) return { noop: true };
    var insertBeforeEl = slot < arr.length ? arr[slot] : null;
    return { noop: false, insertBefore: insertBeforeEl };
  }

  function applyWtreeDropUi(ul, state, dragSrc) {
    clearWtreeDropUi(ul);
    if (!state || state.noop || !dragSrc) return;
    if (state.insertBefore) {
      state.insertBefore.classList.add('widget-tree-item--drop-before');
      var prevEl = wtreePrevSectionLi(state.insertBefore);
      if (prevEl && prevEl !== dragSrc) prevEl.classList.add('widget-tree-item--drop-gap-up');
    } else {
      var lastEl = (function () {
        var it = _collectSectionItems(ul);
        return it.length ? it[it.length - 1] : null;
      })();
      if (lastEl) {
        lastEl.classList.add('widget-tree-item--drop-after');
        var nextEl = wtreeNextSectionLi(lastEl);
        if (nextEl && nextEl !== dragSrc) nextEl.classList.add('widget-tree-item--drop-gap-down');
      }
    }
  }

  // ── Checkbox helpers ───────────────────────────────────────────────

  function applyWidgetTreeCheckboxLock(treeEl, editing) {
    if (!treeEl) return;
    var checks = treeEl.querySelectorAll('.widget-tree-check');
    for (var chk of checks) {
      chk.disabled = !editing;
    }
  }

  function syncChartGroupCheckboxFromLeaves(leafCb) {
    if (!leafCb?.parentNode) return;
    var li = leafCb.closest('li.widget-tree-item');
    if (!li) return;
    var groupUl = li.parentNode;
    if (!groupUl?.classList?.contains('widget-tree-group-charts')) return;
    var cluster = groupUl.closest('li.widget-tree-group-cluster');
    if (!cluster) return;
    var head = cluster.querySelector('.widget-tree-group-head');
    if (!head) return;
    var groupCb = head.querySelector('input[data-type="chart-group"]');
    if (!groupCb) return;
    var checks = groupUl.querySelectorAll('.widget-tree-check[data-type="chart"]');
    var total = 0, checked = 0;
    for (var chk of checks) { total++; if (chk.checked) checked++; }
    groupCb.checked = total > 0 && checked === total;
    groupCb.indeterminate = checked > 0 && checked < total;
  }

  function syncAllWidgetTreeGroupCheckboxes(root) {
    if (!root) return;
    var heads = root.querySelectorAll('.widget-tree-group-head input[data-type="chart-group"]');
    for (var gcb of heads) {
      var cluster = gcb.closest('li.widget-tree-group-cluster');
      if (!cluster) continue;
      var ul = cluster.querySelector(':scope > ul.widget-tree-group-charts');
      if (!ul) continue;
      var checks = ul.querySelectorAll('.widget-tree-check[data-type="chart"]');
      var total = 0, checked = 0;
      for (var chk2 of checks) { total++; if (chk2.checked) checked++; }
      gcb.checked = total > 0 && checked === total;
      gcb.indeterminate = checked > 0 && checked < total;
    }
  }

  // ── Ordered chart helpers ──────────────────────────────────────────

  function stableHealthWidgetGroupOrder(arr) {
    if (!arr?.length) return arr;
    var kern = [], kpis = [], rest = [];
    for (var ch of arr) {
      var wg = ch.widgetGroup;
      if (wg === 'kernbefunde') kern.push(ch);
      else if (wg === 'health-kpis') kpis.push(ch);
      else rest.push(ch);
    }
    return kern.concat(kpis).concat(rest);
  }

  function getOrderedChartsForSection(sec) {
    if (!sec?.charts?.length) return [];
    var charts = sec.charts.filter(function (chart) {
      return !(sec.id === 'proxy' && global.__proxyRequestOnly && chart.fullProxyOnly);
    });
    var sw = global.__prefsStore ? global.__prefsStore.getActiveTemplateSectionWidgets() : null;
    var orderIds = sw?.[sec.id] ? sw[sec.id] : null;
    if (!orderIds?.length) {
      charts.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return sec.id === 'health' ? stableHealthWidgetGroupOrder(charts) : charts;
    }
    var byId = {};
    for (var chrt of charts) byId[chrt.id] = chrt;
    var out = [];
    for (var oId of orderIds) { if (byId[oId]) out.push(byId[oId]); }
    for (var chrt2 of charts) {
      var found = false;
      for (var oId2 of orderIds) { if (oId2 === chrt2.id) { found = true; break; } }
      if (!found) out.push(chrt2);
    }
    return sec.id === 'health' ? stableHealthWidgetGroupOrder(out) : out;
  }

  function wtreeGroupDomId(sectionId, widgetGroup) {
    return 'wtg-' + sectionId + '-' + String(widgetGroup).replace(/[^a-z0-9-]/gi, '-');
  }

  function widgetGroupTitleKey(sectionId, widgetGroup) {
    if (sectionId === 'health' && widgetGroup === 'kernbefunde') return 'findingsTitle';
    if (sectionId === 'health' && widgetGroup === 'health-kpis') return 'widgetGroupHealthKpis';
    if (sectionId === 'token-stats' && widgetGroup === 'token-stats-kpis') return 'widgetGroupTokenStatsKpis';
    if (sectionId === 'forensic' && widgetGroup === 'forensic-cards') return 'widgetGroupForensicCards';
    if (sectionId === 'budget' && widgetGroup === 'budget-kpis') return 'widgetGroupBudgetKpis';
    if (sectionId === 'proxy' && widgetGroup === 'proxy-kpis') return 'widgetGroupProxyKpis';
    if (sectionId === 'security-postures' && widgetGroup === 'sec-kpis') return 'widgetGroupSecurityKpis';
    return 'widgetGroupGeneric';
  }

  function buildSectionChartsTreeHtml(sec) {
    var wd = global.__widgetDispatcher;
    var ordered = getOrderedChartsForSection(sec);
    var html = '<ul class="widget-tree-charts" data-charts-for="' + escT(sec.id) + '" style="display:none">';
    var renderedGroups = {};
    var gi = 0;
    while (gi < ordered.length) {
      var ch0 = ordered[gi];
      var wg = ch0.widgetGroup;
      if (!wg) {
        var chVis0 = wd ? wd.isChartVisible(ch0.id) : true;
        html += '<li class="widget-tree-item">';
        html += '<input type="checkbox" class="widget-tree-check" data-type="chart" data-id="' + escT(ch0.id) + '"' + (chVis0 ? ' checked' : '') + '>';
        html += '<span class="widget-tree-label">' + _t(ch0.titleKey) + '</span>';
        html += '</li>';
        gi++;
        continue;
      }
      if (renderedGroups[wg]) {
        gi++;
        continue;
      }
      renderedGroups[wg] = true;
      var groupCharts = [];
      for (var gci = 0; gci < ordered.length; gci++) {
        if (ordered[gci].widgetGroup === wg) groupCharts.push(ordered[gci]);
      }
      var gdom = wtreeGroupDomId(sec.id, wg);
      var childIdsArr = [];
      var allVis = true;
      for (var ck = 0; ck < groupCharts.length; ck++) {
        childIdsArr.push(groupCharts[ck].id);
        if (wd && !wd.isChartVisible(groupCharts[ck].id)) allVis = false;
      }
      var childIdsAttr = childIdsArr.join('|');
      html += '<li class="widget-tree-group-cluster">';
      html += '<div class="widget-tree-group-head">';
      html += '<input type="checkbox" class="widget-tree-check" data-type="chart-group" data-child-ids="' +
        escT(childIdsAttr) + '" title="' + escT(_t('widgetTreeGroupToggleTitle')) + '"' + (allVis ? ' checked' : '') + '>';
      html += '<button type="button" class="widget-tree-expand widget-tree-expand--group" data-wtree-group-id="' + escT(gdom) + '">&#x25B6;</button>';
      html += '<span class="widget-tree-label">' + _t(widgetGroupTitleKey(sec.id, wg)) + '</span>';
      html += '</div>';
      html += '<ul class="widget-tree-group-charts" data-wtree-group-ul="' + escT(gdom) + '" style="display:none">';
      for (var k = 0; k < groupCharts.length; k++) {
        var ch = groupCharts[k];
        var chVis = wd ? wd.isChartVisible(ch.id) : true;
        html += '<li class="widget-tree-item">';
        html += '<input type="checkbox" class="widget-tree-check" data-type="chart" data-id="' + escT(ch.id) + '"' + (chVis ? ' checked' : '') + '>';
        html += '<span class="widget-tree-label">' + _t(ch.titleKey) + '</span>';
        html += '</li>';
      }
      html += '</ul></li>';
      gi++;
    }
    html += '</ul>';
    return html;
  }

  // ── Widget Tree Render ─────────────────────────────────────────────

  function _buildSectionLi(sec, wd) {
    var secVis = wd ? wd.isSectionVisible(sec.id) : true;
    var hasCharts = sec.charts && sec.charts.length > 0;
    var spanVal = wd ? wd.getWidgetSpan(sec.id) : null;
    var spanDisp = spanVal || 12;
    var html = '<li class="widget-tree-item" data-section="' + sec.id + '" draggable="false">';
    html += '<div class="widget-tree-head">';
    html += '<span class="widget-tree-drag" title="Drag to reorder">&#x2630;</span>';
    html += '<input type="checkbox" class="widget-tree-check" data-type="section" data-id="' + sec.id + '"' + (secVis ? ' checked' : '') + '>';
    html += '<span class="widget-tree-label">' + _t(sec.titleKey) + '</span>';
    if (spanDisp !== 12) {
      html += '<span class="widget-tree-span" title="' + escT(_t('settingsLayoutGridSpanTitle')) + '">' + spanDisp + '/12</span>';
    }
    html += '<button type="button" class="widget-tree-expand" data-expand="' + sec.id + '"' + (hasCharts ? '' : ' style="visibility:hidden"') + '>&#x25B6;</button>';
    html += '</div>';
    if (hasCharts) html += buildSectionChartsTreeHtml(sec);
    html += '</li>';
    return html;
  }

  function renderWidgetTree() {
    var body = document.getElementById('sidebar-layout-body');
    if (!body) return;
    var ps = global.__prefsStore;
    var wd = global.__widgetDispatcher;
    if (ps && !ps.prefs) ps.prefs = ps.loadPrefs();
    if (ps) ps.syncVisibilityPrefsFromLocalStorage();
    var reg = global.__widgetRegistry;
    if (!reg) return;

    var sections = wd ? wd.getSortedSections() : (reg.getSectionsSorted ? reg.getSectionsSorted() : []);
    var activeSurface = global.__navState ? global.__navState.getActive() : '';

    // Build page → sections map from __pages registry
    var pages = global.__pages || {};
    var navModel = global.__navModel;
    var editableSurfaces = navModel?.getEditableSurfaces ? navModel.getEditableSurfaces() : [];
    var pageOrder = [];
    for (var epi = 0; epi < editableSurfaces.length; epi++) pageOrder.push(editableSurfaces[epi].id);
    var sectionToPage = {};
    for (var pk in pages) {
      var pg = pages[pk];
      var ids = pg.sectionIds || [];
      for (var si = 0; si < ids.length; si++) {
        sectionToPage[ids[si]] = pg.surfaceId || pk;
      }
    }

    // Group sections by page
    var grouped = {};
    for (var sec of sections) {
      if (sec.reorderable === false) continue;
      if (sec.id === 'proxy' && !global.__proxyHasData) continue;
      if (navModel?.isSectionAvailable && !navModel.isSectionAvailable(sec.id)) continue;
      var pageId = sectionToPage[sec.id];
      if (pageId) {
        if (!grouped[pageId]) grouped[pageId] = [];
        grouped[pageId].push(sec);
      }
    }

    // Page labels from __pages registry
    var pageLabels = {};
    for (var plk in pages) {
      var plp = pages[plk];
      pageLabels[plp.surfaceId || plk] = plp.label || plk;
    }

    var html = '<ul class="widget-tree">';

    // Render grouped by page
    for (var pi = 0; pi < pageOrder.length; pi++) {
      var pid = pageOrder[pi];
      var pageSections = grouped[pid];
      if (!pageSections || !pageSections.length) continue;
      var isActive = pid === activeSurface;
      html += '<li class="widget-tree-page-group">';
      html += '<div class="widget-tree-page-head" data-page-toggle="' + pid + '">';
      html += '<span class="widget-tree-page-arrow" style="display:inline-block;width:12px;text-align:center;font-size:10px;color:#A0875E;transition:transform .15s">' + (isActive ? '&#x25BC;' : '&#x25B6;') + '</span> ';
      html += '<span class="widget-tree-page-label" style="color:#A0875E;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;font-weight:600">' + escT(pageLabels[pid] || pid) + '</span>';
      html += '</div>';
      html += '<ul class="widget-tree-page-sections" data-page-id="' + pid + '" style="' + (isActive ? '' : 'display:none') + '">';
      for (var sj = 0; sj < pageSections.length; sj++) {
        html += _buildSectionLi(pageSections[sj], wd);
      }
      html += '</ul></li>';
    }

    // Registry-only sections are intentionally omitted. A section without a
    // registered, available page is not editable in this product build.

    html += '</ul>';
    body.innerHTML = html;
    syncAllWidgetTreeGroupCheckboxes(body);

    // Page group toggle clicks
    if (!body.dataset.wtreePageBound) {
      body.dataset.wtreePageBound = '1';
      body.addEventListener('click', function (e) {
        var head = e.target.closest('[data-page-toggle]');
        if (!head) return;
        var pid = head.dataset.pageToggle;
        var ul = body.querySelector('[data-page-id="' + pid + '"]');
        if (!ul) return;
        var isOpen = ul.style.display !== 'none';
        ul.style.display = isOpen ? 'none' : '';
        var arrow = head.querySelector('.widget-tree-page-arrow');
        if (arrow) arrow.innerHTML = isOpen ? '&#x25B6;' : '&#x25BC;';
      });
    }

    // Delegated events (once per sidebar body — survives re-renders)
    if (!body.dataset.wtreeChangeBound) {
      body.dataset.wtreeChangeBound = '1';
      body.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb.classList.contains('widget-tree-check')) return;
        if (cb.disabled) return;
        var type = cb.dataset.type;
        var id = cb.dataset.id;
        var dispatcherNow = global.__widgetDispatcher;
        if (type === 'section') {
          if (dispatcherNow) dispatcherNow.setVisibility(id, cb.checked);
        } else if (type === 'chart-group') {
          var raw = cb.getAttribute('data-child-ids') || '';
          var ids = raw.split('|');
          var clean = [];
          for (var idVal of ids) { if (idVal) clean.push(idVal); }
          if (dispatcherNow) dispatcherNow.setGroupChartsVisibility(clean, cb.checked);
          var cluster = cb.closest('li.widget-tree-group-cluster');
          if (cluster) {
            var leafChecks = cluster.querySelectorAll('.widget-tree-group-charts .widget-tree-check[data-type="chart"]');
            for (var lc of leafChecks) lc.checked = cb.checked;
          }
          cb.indeterminate = false;
        } else if (type === 'chart') {
          if (dispatcherNow) dispatcherNow.setChartVisibility(id, cb.checked);
          syncChartGroupCheckboxFromLeaves(cb);
        }
      });

      body.addEventListener('click', function (e) {
        var btn = e.target.closest('.widget-tree-expand');
        if (!btn) return;
        if (btn.dataset.wtreeGroupId) {
          var nest = body.querySelector('[data-wtree-group-ul="' + btn.dataset.wtreeGroupId + '"]');
          if (!nest) return;
          var openG = nest.style.display !== 'none';
          nest.style.display = openG ? 'none' : '';
          btn.style.transform = openG ? '' : 'rotate(90deg)';
          return;
        }
        var secId = btn.dataset.expand;
        var charts = body.querySelector('[data-charts-for="' + secId + '"]');
        if (!charts) return;
        var open = charts.style.display !== 'none';
        charts.style.display = open ? 'none' : '';
        btn.style.transform = open ? '' : 'rotate(90deg)';
      });
    }

    // Drag & Drop for section reorder (once per sidebar body)
    if (!body.dataset.wtreeDndBound) {
      body.dataset.wtreeDndBound = '1';
      body.addEventListener('dragstart', function (e) {
        var item = e.target.closest('.widget-tree-item[data-section]');
        if (!item) { e.preventDefault(); return; }
        var ulEdit = body.querySelector('.widget-tree');
        if (!ulEdit?.classList.contains('widget-tree--edit')) { e.preventDefault(); return; }
        _wtreeDragSrc = item;
        _wtreeDropState = null;
        item.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        if (_wtreeDragGhost?.parentNode) _wtreeDragGhost.parentNode.removeChild(_wtreeDragGhost);
        _wtreeDragGhost = null;
        try {
          var ghost = item.cloneNode(true);
          ghost.classList.add('widget-tree-drag-ghost');
          ghost.removeAttribute('draggable');
          var ghostCtrls = ghost.querySelectorAll('input,button');
          for (var gc of ghostCtrls) gc.remove();
          document.body.appendChild(ghost);
          var r = item.getBoundingClientRect();
          e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
          _wtreeDragGhost = ghost;
        } catch (eGhost) { _wtreeDragGhost = null; }
      });
      body.addEventListener('dragover', function (e) {
        if (!_wtreeDragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var ul = body.querySelector('.widget-tree');
        if (!ul) return;
        var ulRect = ul.getBoundingClientRect();
        if (e.clientX < ulRect.left || e.clientX > ulRect.right ||
            e.clientY < ulRect.top || e.clientY > ulRect.bottom) {
          clearWtreeDropUi(ul); _wtreeDropState = null; return;
        }
        var st = wtreeFindDropState(ul, e.clientY, _wtreeDragSrc);
        _wtreeDropState = st;
        if (!st || st.noop) { clearWtreeDropUi(ul); return; }
        applyWtreeDropUi(ul, st, _wtreeDragSrc);
      });
      body.addEventListener('dragleave', function (e) {
        if (!_wtreeDragSrc) return;
        var ul = body.querySelector('.widget-tree');
        if (!ul) return;
        var rel = e.relatedTarget;
        if (rel && ul.contains(rel)) return;
        clearWtreeDropUi(ul); _wtreeDropState = null;
      });
      body.addEventListener('drop', function (e) {
        e.preventDefault();
        var ul = body.querySelector('.widget-tree');
        if (!ul || !_wtreeDragSrc) return;
        clearWtreeDropUi(ul);
        var st = _wtreeDropState;
        _wtreeDropState = null;
        if (!st || st.noop) return;
        // DOM insert: use target's parent (may be a page-group sub-list)
        if (st.insertBefore) {
          st.insertBefore.parentNode.insertBefore(_wtreeDragSrc, st.insertBefore);
        } else {
          var allItems = _collectSectionItems(ul);
          var lastLi = allItems.length ? allItems[allItems.length - 1] : null;
          if (lastLi) lastLi.parentNode.appendChild(_wtreeDragSrc);
          else ul.appendChild(_wtreeDragSrc);
        }
        var newOrder = [];
        var reordered = _collectSectionItems(ul);
        for (var ni = 0; ni < reordered.length; ni++) newOrder.push(reordered[ni].dataset.section);
        if (global.__widgetDispatcher) global.__widgetDispatcher.setOrder(newOrder);
      });
      body.addEventListener('dragend', function () {
        var ul = body.querySelector('.widget-tree');
        if (ul) clearWtreeDropUi(ul);
        if (_wtreeDragSrc) _wtreeDragSrc.classList.remove('is-dragging');
        _wtreeDragSrc = null; _wtreeDropState = null;
        if (_wtreeDragGhost?.parentNode) _wtreeDragGhost.parentNode.removeChild(_wtreeDragGhost);
        _wtreeDragGhost = null;
      });
    }

    // Reset button
    var resetBtn = document.getElementById('sidebar-layout-reset');
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', function () {
        _layoutTreeEditMode = false;
        if (global.__prefsStore) global.__prefsStore.resetPrefs();
        renderWidgetTree();
      });
    }

    var treeAfter = body.querySelector('.widget-tree');
    var editBtnLbl = document.getElementById('sidebar-layout-edit');
    if (treeAfter && editBtnLbl) {
      var secLisApply = _collectSectionItems(treeAfter);
      var sxa;
      if (_layoutTreeEditMode) {
        treeAfter.classList.add('widget-tree--edit');
        editBtnLbl.textContent = _t('settingsSaveLayout');
        editBtnLbl.classList.add('is-active');
        for (sxa = 0; sxa < secLisApply.length; sxa++) secLisApply[sxa].setAttribute('draggable', 'true');
      } else {
        treeAfter.classList.remove('widget-tree--edit');
        editBtnLbl.textContent = _t('settingsEditLayout');
        editBtnLbl.classList.remove('is-active');
        for (sxa = 0; sxa < secLisApply.length; sxa++) secLisApply[sxa].setAttribute('draggable', 'false');
      }
      applyWidgetTreeCheckboxLock(treeAfter, _layoutTreeEditMode);
    } else if (treeAfter) {
      applyWidgetTreeCheckboxLock(treeAfter, _layoutTreeEditMode);
    }
    if (global.__widgetDispatcher) global.__widgetDispatcher.applyAllChartVisibility();
  }

  // ── Public API ─────────────────────────────────────────────────────

  global.__layoutTree = {
    renderWidgetTree: renderWidgetTree,
    applyWidgetTreeCheckboxLock: applyWidgetTreeCheckboxLock,
    syncChartGroupCheckboxFromLeaves: syncChartGroupCheckboxFromLeaves,
    syncAllWidgetTreeGroupCheckboxes: syncAllWidgetTreeGroupCheckboxes,
    getOrderedChartsForSection: getOrderedChartsForSection,
    buildSectionChartsTreeHtml: buildSectionChartsTreeHtml,
    get layoutTreeEditMode() { return _layoutTreeEditMode; },
    set layoutTreeEditMode(v) { _layoutTreeEditMode = v; }
  };
})(typeof window !== 'undefined' ? window : this);
