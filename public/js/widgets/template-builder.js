/**
 * @asseris-module       Template Builder
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/template-builder.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Template Builder — Canvas, Pool, Drag-Drop, Preview, Save Modal
 * Extracted from widget-dispatcher.js
 *
 * Dependencies (via globals):
 *   window.__widgetDispatcher — getPrefs(), getOrderedChartsForSection(), applyGridLayout(),
 *                               renderWidgetTree(), resizeAll(), getDesktopPageScaffold()
 *   window.__widgetRegistry   — getRegistry() via window.__widgetRegistry
 *   window.t() or window.__I18N_BUNDLES — i18n
 *   window.echarts — chart preview cloning
 *   window.__lastUsageData, window.__lastGatewayConfig
 *   window.renderDashboardCore — post-preview repaint
 *   BUILTIN_TEMPLATES exposed via getAllTemplates/loadTemplates/saveTemplates/applyTemplate/renderTemplatesSection
 *     (these remain in widget-dispatcher for now; accessed via closure-forwarding globals)
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────

  function logOptionalErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-widget-template', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  function _t(key) {
    if (typeof window.t === 'function') return window.t(key);
    var bundles = window.__I18N_BUNDLES;
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
    return String(s == null ? '' : s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function getRegistry() {
    return window.__widgetRegistry || null;
  }

  function getPrefs() {
    var d = window.__widgetDispatcher;
    return d && typeof d.getPrefs === 'function' ? d.getPrefs() : null;
  }

  function getOrderedChartsForSection(sec) {
    var d = window.__widgetDispatcher;
    return d && typeof d.getOrderedChartsForSection === 'function' ? d.getOrderedChartsForSection(sec) : (sec?.charts || []);
  }

  /** Forwarded template helpers — must be set by widget-dispatcher after load. */
  var _templateHelpers = {
    getAllTemplates: function () { return []; },
    loadTemplates: function () { return []; },
    saveTemplates: function () {},
    applyTemplate: function () {},
    renderTemplatesSection: function () {}
  };

  /** Called by widget-dispatcher to wire up template helpers after both files load. */
  function setTemplateHelpers(helpers) {
    if (helpers) {
      for (var k in helpers) {
        if (typeof helpers[k] === 'function') _templateHelpers[k] = helpers[k];
      }
    }
  }

  function getAllTemplates() { return _templateHelpers.getAllTemplates(); }
  function loadTemplates() { return _templateHelpers.loadTemplates(); }
  function saveTemplates(list) { _templateHelpers.saveTemplates(list); }
  function applyTemplate(tpl) { _templateHelpers.applyTemplate(tpl); }
  function renderTemplatesSection() { _templateHelpers.renderTemplatesSection(); }

  var ALL_SECTION_IDS = ['health', 'token-stats', 'forensic', 'user-profile', 'budget', 'proxy', 'security-postures', 'anthropic-status', 'economic'];

  // ── State ────────────────────────────────────────────────────────

  var _tbWidgets = []; // working copy: [{ id, span, children: [{ id, span } | { type:'block', span, bid }] }]
  var _tbBlockSeq = 0;
  var _tbActiveSurface = '';

  function tbEditableSurfaces() {
    var nav = window.__navModel;
    return nav?.getEditableSurfaces ? nav.getEditableSurfaces() : [];
  }

  function tbSectionSurfaceId(sectionId) {
    var nav = window.__navModel;
    var surface = nav?.getSectionSurface ? nav.getSectionSurface(sectionId) : null;
    return surface ? surface.id : '';
  }

  function tbRootSectionId(reg, sectionId) {
    var sec = reg?.findSection ? reg.findSection(sectionId) : null;
    return sec?.parentSection || sectionId;
  }

  function tbIsSectionOnActiveSurface(reg, sectionId) {
    return tbSectionSurfaceId(tbRootSectionId(reg, sectionId)) === _tbActiveSurface;
  }

  function tbIsSectionAvailable(sectionId) {
    var nav = window.__navModel;
    return nav?.isSectionAvailable ? nav.isSectionAvailable(sectionId) : true;
  }

  function tbVisibleWidgetIndices(reg) {
    var out = [];
    for (var i = 0; i < _tbWidgets.length; i++) {
      if (tbIsSectionAvailable(_tbWidgets[i].id) && tbIsSectionOnActiveSurface(reg, _tbWidgets[i].id)) out.push(i);
    }
    return out;
  }

  function tbGlobalInsertIndexForVisibleSlot(reg, visualSlot) {
    var indices = tbVisibleWidgetIndices(reg);
    if (!indices.length) return _tbWidgets.length;
    if (visualSlot < indices.length) return indices[visualSlot];
    return indices[indices.length - 1] + 1;
  }

  function tbLastVisibleWidgetIndex(reg) {
    var indices = tbVisibleWidgetIndices(reg);
    return indices.length ? indices[indices.length - 1] : -1;
  }

  function renderPageTabs() {
    var host = document.getElementById('tb-page-nav');
    if (!host) return;
    var surfaces = tbEditableSurfaces();
    if (!surfaces.length) {
      host.innerHTML = '';
      return;
    }
    var valid = false;
    for (var i = 0; i < surfaces.length; i++) {
      if (surfaces[i].id === _tbActiveSurface) valid = true;
    }
    if (!valid) _tbActiveSurface = surfaces[0].id;
    var html = '';
    for (var j = 0; j < surfaces.length; j++) {
      var s = surfaces[j];
      var count = 0;
      for (var wi = 0; wi < _tbWidgets.length; wi++) {
        if (tbSectionSurfaceId(_tbWidgets[wi].id) === s.id && tbIsSectionAvailable(_tbWidgets[wi].id)) count++;
      }
      html += '<button type="button" class="tb-page-tab' + (s.id === _tbActiveSurface ? ' is-active' : '') +
        '" data-tb-surface="' + escT(s.id) + '">' + escT(s.label) + ' <span>(' + count + ')</span></button>';
    }
    host.innerHTML = html;
  }

  /** Which canvas sections were expanded (details open); keyed by section id, read before each renderCanvas. */
  function tbSnapshotSectionOpenState(canvas) {
    var map = {};
    if (!canvas) return map;
    var ds = canvas.querySelectorAll('details.tb-canvas-section[data-section-id]');
    var di;
    for (di = 0; di < ds.length; di++) {
      var sid = ds[di].dataset.sectionId;
      if (sid) map[sid] = ds[di].open;
    }
    return map;
  }

  function tbIsLayoutBlock(c) {
    return c?.type === 'block';
  }

  function tbNewLayoutBlock(span) {
    _tbBlockSeq++;
    var s = Number.parseInt(span, 10) || 12;
    if (s < 1) s = 1;
    if (s > 12) s = 12;
    return { type: 'block', span: s, bid: 'tbblk_' + _tbBlockSeq, children: [] };
  }

  /** Section-level list (pc < 0) or inner list of layout block at index pc in section.children. */
  function tbGetChildListByParent(si, pc) {
    var sec = _tbWidgets[si];
    if (!sec?.children) return null;
    if (pc < 0) return sec.children;
    var b = sec.children[pc];
    if (!tbIsLayoutBlock(b)) return null;
    if (!b.children) b.children = [];
    return b.children;
  }

  /** Distribute chart rows across scaffold blocks by relative span weight; last block absorbs rounding remainder. */
  function tbPartitionChartsIntoBlocks(blockSpans, chartRows) {
    var ids = [];
    var ri;
    for (ri = 0; ri < chartRows.length; ri++) {
      ids.push({ id: chartRows[ri].id, span: chartRows[ri].span || 6 });
    }
    var nB = blockSpans.length;
    if (!nB) return [];
    var totalW = 0;
    for (ri = 0; ri < nB; ri++) totalW += blockSpans[ri] || 12;
    if (totalW <= 0) totalW = nB * 12;
    var out = [];
    var idx = 0;
    for (var bi = 0; bi < nB; bi++) {
      var cnt = bi === nB - 1 ? ids.length - idx : Math.floor(ids.length * ((blockSpans[bi] || 12) / totalW));
      if (cnt < 0) cnt = 0;
      if (bi === nB - 1) {
        out.push(ids.slice(idx));
      } else {
        out.push(ids.slice(idx, idx + cnt));
        idx += cnt;
      }
    }
    return out;
  }

  /**
   * Legacy flat builder rows: [ block, block, chart, chart, ... ].
   * Moves trailing chart siblings into block.children (partition if all blocks empty; else append to last block).
   */
  function tbMigrateLooseChartsAfterBlocksIntoNested(children) {
    if (!children?.length) return;
    var blocks = [];
    var loose = [];
    var bi;
    for (bi = 0; bi < children.length; bi++) {
      var it = children[bi];
      if (tbIsLayoutBlock(it)) blocks.push(it);
      else if (it?.id) loose.push({ id: it.id, span: it.span || 6 });
    }
    if (!blocks.length || !loose.length) return;
    var allEmpty = true;
    for (bi = 0; bi < blocks.length; bi++) {
      if (blocks[bi].children?.length) {
        allEmpty = false;
        break;
      }
    }
    var spans = [];
    for (bi = 0; bi < blocks.length; bi++) spans.push(blocks[bi].span || 12);
    if (allEmpty) {
      var parts = tbPartitionChartsIntoBlocks(spans, loose);
      for (bi = 0; bi < blocks.length; bi++) {
        blocks[bi].children = parts[bi] ? parts[bi].slice() : [];
      }
    } else {
      var lastB = blocks[blocks.length - 1];
      if (!lastB.children) lastB.children = [];
      var usedId = {};
      for (bi = 0; bi < blocks.length; bi++) {
        var ex = blocks[bi].children || [];
        var ej;
        for (ej = 0; ej < ex.length; ej++) {
          if (ex[ej].id) usedId[ex[ej].id] = true;
        }
      }
      for (var looseItem of loose) {
        if (usedId[looseItem.id]) continue;
        lastB.children.push(looseItem);
        usedId[looseItem.id] = true;
      }
    }
    children.length = 0;
    for (bi = 0; bi < blocks.length; bi++) children.push(blocks[bi]);
  }

  /** Set on dragstart (pool / canvas section / canvas child), cleared on dragend -- dragover cannot read getData reliably. */
  var _tbDrag = null;

  function tbClearCanvasDropUi() {
    var c = document.getElementById('tb-canvas');
    if (!c) return;
    var marks = c.querySelectorAll(
      '.tb-canvas-section--drop-before,.tb-canvas-section--drop-after,' +
        '.tb-canvas-child--drop-before,.tb-canvas-child--drop-after,' +
        '.tb-canvas-children--drop-append,.tb-canvas-placeholder--drop-here,' +
        '.tb-canvas-cell--drop-before,.tb-canvas-children--drop,.tb-canvas-block-inner--drop-append'
    );
    for (var mk of marks) {
      mk.classList.remove(
        'tb-canvas-section--drop-before',
        'tb-canvas-section--drop-after',
        'tb-canvas-child--drop-before',
        'tb-canvas-child--drop-after',
        'tb-canvas-children--drop-append',
        'tb-canvas-placeholder--drop-here',
        'tb-canvas-cell--drop-before',
        'tb-canvas-children--drop',
        'tb-canvas-block-inner--drop-append'
      );
    }
  }

  /** Insert before section at index `slot` (0..n); el = that section node or null = append after all. */
  function tbFindSectionInsertBefore(canvas, clientY) {
    var secs = canvas.querySelectorAll('.tb-canvas-section');
    var n = secs.length;
    if (!n) return { el: null, slot: 0 };
    var j;
    for (j = 0; j < n; j++) {
      var r = secs[j].getBoundingClientRect();
      var mid = r.top + r.height * 0.35;
      if (clientY < mid) {
        return { el: secs[j], slot: j };
      }
    }
    return { el: null, slot: n };
  }

  /** Highlight section insertion line (Layout-Baum-Stil). fromIdx >= 0 -> reorder noop hides bar. */
  function tbApplySectionDropPreview(canvas, clientY, fromIdx) {
    var ti = tbFindSectionInsertBefore(canvas, clientY);
    if (fromIdx >= 0 && (ti.slot === fromIdx || ti.slot === fromIdx + 1)) return;
    var secs = canvas.querySelectorAll('.tb-canvas-section');
    if (!secs.length) {
      var ph = canvas.querySelector('.tb-canvas-placeholder');
      if (ph) ph.classList.add('tb-canvas-placeholder--drop-here');
      return;
    }
    if (ti.el) ti.el.classList.add('tb-canvas-section--drop-before');
    else secs[secs.length - 1].classList.add('tb-canvas-section--drop-after');
  }

  /** Insert before child at slot; el null = append in zone. */
  function tbFindChildInsertBefore(zone, clientY) {
    if (!zone) return { el: null, slot: 0 };
    var kids = [];
    var zc;
    for (zc = 0; zc < zone.children.length; zc++) {
      var el = zone.children[zc];
      if (el?.classList?.contains('tb-canvas-child')) kids.push(el);
    }
    var n = kids.length;
    var i;
    for (i = 0; i < n; i++) {
      var r = kids[i].getBoundingClientRect();
      var mid = r.top + r.height * 0.5;
      if (clientY < mid) {
        return { el: kids[i], slot: i };
      }
    }
    return { el: null, slot: n };
  }

  function tbApplyChildDropPreview(zone, clientY, fromSi, fromPc, fromIx) {
    if (!zone) return;
    fromSi = typeof fromSi === 'number' ? fromSi : -1;
    fromPc = typeof fromPc === 'number' ? fromPc : -1;
    fromIx = typeof fromIx === 'number' ? fromIx : -1;
    var toSi = Number.parseInt(zone.dataset.sidx, 10);
    var inner = zone.classList.contains('tb-canvas-block-inner');
    var toPc = inner ? Number.parseInt(zone.dataset.pcidx, 10) : -1;
    var ti = tbFindChildInsertBefore(zone, clientY);
    if (fromSi >= 0 && fromIx >= 0 && toSi === fromSi) {
      if (inner && fromPc === toPc) {
        if (ti.slot === fromIx || ti.slot === fromIx + 1) return;
      }
      if (!inner && fromPc < 0 && toPc < 0) {
        if (ti.slot === fromIx || ti.slot === fromIx + 1) return;
      }
    }
    if (ti.el) ti.el.classList.add('tb-canvas-child--drop-before');
    else if (inner) zone.classList.add('tb-canvas-block-inner--drop-append');
    else zone.classList.add('tb-canvas-children--drop-append');
  }

  /** Default builder span (12ths) from registry widgetGroup -- matches dashboard CSS grids (#cards, #forensic-cards, ...). */
  function tbPoolDefaultSpanForChart(reg, chartId) {
    if (!chartId) return 6;
    var sid = String(chartId);
    if (!reg?.findChart) {
      if (sid.startsWith('health-finding-')) return 2;
      if (sid.startsWith('health-kpi-')) return 4;
      if (sid.startsWith('token-stats-kpi-')) return 2;
      if (sid.startsWith('budget-kpi-')) return 2;
      if (sid.startsWith('proxy-kpi-')) return 2;
      if (sid.startsWith('forensic-card-')) return 4;
      if (sid === 'intel-saturation' || sid === 'intel-health' || sid === 'intel-quota-eta') return 4;
      return 6;
    }
    var d = reg.findChart(chartId);
    var wg = d?.widgetGroup;
    if (wg === 'kernbefunde') return 2;
    if (wg === 'health-kpis') return 4;
    if (wg === 'token-stats-kpis') return 2;
    if (wg === 'budget-kpis') return 2;
    if (wg === 'proxy-kpis') return 2;
    if (wg === 'forensic-cards') return 4;
    if (wg === 'intel-scores') return 4;
    return 6;
  }

  /** Registry charts for a section + nested child sections (e.g. efficiency-range under economic), minus hiddenCharts. */
  function tbVisibleRegistryChartsForSection(sectionId, ignoreHidden) {
    var reg = getRegistry();
    if (!reg?.findSection) return [];
    var _prefs = getPrefs();
    var hidden = ignoreHidden ? [] : (_prefs && Array.isArray(_prefs.hiddenCharts) ? _prefs.hiddenCharts : []);
    var parts = [];
    var sec = reg.findSection(sectionId);
    if (sec) parts.push(sec);
    for (var rSec of reg.sections) {
      if (rSec.parentSection === sectionId) parts.push(rSec);
    }
    var out = [];
    for (var part of parts) {
      var ordered = getOrderedChartsForSection(part);
      for (var ch of ordered) {
        if (ch.visible === false) continue;
        if (!tbChartIsAvailableForSource(sectionId, ch)) continue;
        if (hidden.includes(ch.id)) continue;
        out.push({ id: ch.id, span: tbPoolDefaultSpanForChart(reg, ch.id) });
      }
    }
    return out;
  }

  /** Flat prefs/template widgets[] -> nested builder model (sections + all visible chart/chip children). */
  function tbFlatWidgetsToNestedModel(flatWidgets) {
    var reg = getRegistry();
    var result = [];
    if (!flatWidgets?.length) return result;
    for (var i = 0; i < flatWidgets.length; i++) {
      var w = flatWidgets[i];
      var wType = w.type || 'section';
      if (wType === 'chart') {
        if (w.section) continue;
        if (result.length) {
          result[result.length - 1].children.push({ id: w.id, span: w.span || 6 });
        }
        continue;
      }
      var children = [];
      var k = i + 1;
      while (k < flatWidgets.length) {
        var nx = flatWidgets[k];
        var nxt = nx.type || 'section';
        if (nxt === 'section') break;
        if (nxt === 'layout') {
          if (nx.section !== w.id) break;
          var spL = nx.span || 12;
          if (spL < 1) spL = 1;
          if (spL > 12) spL = 12;
          var normNested = [];
          var nestedIn = nx.nested;
          if (nestedIn?.length) {
            var ni;
            for (ni = 0; ni < nestedIn.length; ni++) {
              var ne = nestedIn[ni];
              if (ne?.id) normNested.push({ id: ne.id, span: ne.span || 6 });
            }
          }
          children.push({ type: 'block', span: spL, bid: nx.bid || nx.id || 'tbblk_r' + k, children: normNested });
          k++;
          continue;
        }
        if (nxt !== 'chart') break;
        if (nx.section !== w.id) break;
        children.push({ id: nx.id, span: nx.span || 6 });
        k++;
      }
      if (!children.length) {
        children = tbVisibleRegistryChartsForSection(w.id, false);
      } else {
        tbMigrateLooseChartsAfterBlocksIntoNested(children);
      }
      result.push({ id: w.id, span: w.span || 12, children: children });
      if (k > i + 1) i = k - 1;
    }
    return result;
  }

  /**
   * Prefs/widgets[] persist mostly ECharts rows -- chips/HTML stay in the registry only.
   * Reconcile each builder section with tbVisibleRegistryChartsForSection (order + ids),
   * keeping spans from the flat model when ids match; append flat-only ids at the end.
   */
  function tbAugmentBuilderChildrenFromRegistry(nested) {
    if (!nested?.length) return;
    for (var row of nested) {
      var flatKids = row.children || [];
      var hasBlock = false;
      for (var flatKid of flatKids) {
        if (tbIsLayoutBlock(flatKid)) {
          hasBlock = true;
          break;
        }
      }
      if (hasBlock) {
        var usedB = {};
        var spanByIdB = {};
        var hb;
        for (hb = 0; hb < flatKids.length; hb++) {
          var fk0 = flatKids[hb];
          if (tbIsLayoutBlock(fk0)) {
            var in0 = fk0.children || [];
            var hi;
            for (hi = 0; hi < in0.length; hi++) {
              if (in0[hi].id) {
                usedB[in0[hi].id] = true;
                spanByIdB[in0[hi].id] = in0[hi].span || 6;
              }
            }
          } else if (fk0.id) {
            usedB[fk0.id] = true;
            spanByIdB[fk0.id] = fk0.span || 6;
          }
        }
        var fullB = tbVisibleRegistryChartsForSection(row.id, false);
        var lastBlk = null;
        for (hb = flatKids.length - 1; hb >= 0; hb--) {
          if (tbIsLayoutBlock(flatKids[hb])) {
            lastBlk = flatKids[hb];
            break;
          }
        }
        if (lastBlk) {
          if (!lastBlk.children) lastBlk.children = [];
          for (hb = 0; hb < fullB.length; hb++) {
            var cidB = fullB[hb].id;
            if (usedB[cidB]) continue;
            lastBlk.children.push({ id: cidB, span: spanByIdB[cidB] !== undefined ? spanByIdB[cidB] : 6 });
            usedB[cidB] = true;
          }
        }
        var newTop = [];
        for (hb = 0; hb < flatKids.length; hb++) {
          if (!tbIsLayoutBlock(flatKids[hb]) && flatKids[hb].id) continue;
          newTop.push(flatKids[hb]);
        }
        row.children = newTop;
        continue;
      }
      var full = tbVisibleRegistryChartsForSection(row.id, false);
      var spanById = {};
      var fi;
      for (fi = 0; fi < flatKids.length; fi++) {
        if (!tbIsLayoutBlock(flatKids[fi]) && flatKids[fi].id) spanById[flatKids[fi].id] = flatKids[fi].span || 6;
      }
      var merged = [];
      var seen = {};
      for (fi = 0; fi < full.length; fi++) {
        var cid = full[fi].id;
        merged.push({ id: cid, span: spanById[cid] !== undefined ? spanById[cid] : 6 });
        seen[cid] = true;
      }
      for (fi = 0; fi < flatKids.length; fi++) {
        var fk = flatKids[fi];
        if (tbIsLayoutBlock(fk)) continue;
        if (!seen[fk.id]) {
          merged.push({ id: fk.id, span: fk.span || 6 });
          seen[fk.id] = true;
        }
      }
      row.children = merged;
    }
  }

  /** Top-level registry sections (sorted), each with all default-visible widgets (inkl. KPI/HTML). */
  function tbRegistryDefaultNestedModel() {
    var reg = getRegistry();
    if (!reg || typeof reg.getSectionsSorted !== 'function') {
      return ALL_SECTION_IDS.map(function (id) { return { id: id, span: 12, children: tbVisibleRegistryChartsForSection(id, true) }; });
    }
    var secs = reg.getSectionsSorted();
    var out = [];
    for (var sec of secs) {
      if (sec.parentSection) continue;
      out.push({ id: sec.id, span: 12, children: tbVisibleRegistryChartsForSection(sec.id, true) });
    }
    return out;
  }

  /**
   * DOM order of #layout-grid (tpl/dashboard.html) + rough inner row widths as 12-col spans.
   * Each section: layout DIV rows with charts in block.children (incl. chips; efficiency-range merged into economic).
   */
  var TB_PAGE_SCAFFOLD_PLAN = [
    {
      id: 'health',
      blocks: [12, 12],
      slotWidgetGroups: ['health-kpis', 'kernbefunde']
    },
    {
      id: 'forensic',
      blocks: [12, 12, 6, 6],
      slotChartIds: [
        ['forensic-card-code', 'forensic-card-impl', 'forensic-card-budget'],
        ['forensic-hitlimit'],
        ['forensic-signals'],
        ['forensic-service']
      ]
    },
    {
      id: 'economic',
      blocks: [12, 12, 12],
      slotChartIds: [
        ['econ-explosion'],
        ['econ-budget-drain'],
        ['eff-efficiency-timeline', 'eff-monthly-butterfly', 'eff-day-comparison']
      ]
    },
    {
      id: 'token-stats',
      blocks: [12, 6, 6, 12],
      slotWidgetGroups: ['token-stats-kpis', null, null, null]
    },
    {
      id: 'user-profile',
      blocks: [4, 4, 4],
      slotChartIds: [['user-versions'], ['user-entrypoints'], ['user-release-stability']]
    },
    {
      id: 'budget',
      blocks: [12, 12, 6, 6],
      slotChartIds: [
        [
          'budget-kpi-output',
          'budget-kpi-overhead',
          'budget-kpi-cache-miss',
          'budget-kpi-lost',
          'budget-kpi-outage',
          'budget-kpi-truncated'
        ],
        ['budget-sankey'],
        ['budget-trend'],
        ['budget-quota']
      ]
    },
    {
      id: 'proxy',
      blocks: [12, 4, 4, 4, 6, 6, 6, 6, 12, 12],
      slotChartIds: [
        [
          'proxy-kpi-requests',
          'proxy-kpi-latency',
          'proxy-kpi-cache-ratio',
          'proxy-kpi-models',
          'proxy-kpi-quota-5h',
          'proxy-kpi-quota-7d',
          'proxy-kpi-ttl-tier',
          'proxy-kpi-peak-hours',
          'proxy-kpi-saturation',
          'proxy-kpi-health'
        ],
        ['proxy-tokens'],
        ['proxy-models'],
        ['proxy-hourly'],
        ['proxy-latency'],
        ['proxy-hourly-latency'],
        ['proxy-error-trend'],
        ['proxy-cache-trend'],
        ['proxy-ttl-history'],
        ['proxy-cache-fix-activity']
      ]
    }
    // anthropic-status excluded: domId=null, lives in top-bar, not in #layout-grid
  ];

  /** Inner 12-col spans for scaffold block.children (builder canvas); aligns chip rows with dashboard grids. */
  function tbScaffoldApplyInnerSpans(sectionId, blockIndex, picked) {
    if (!picked?.length) return;
    var n = picked.length;
    var i;
    if (sectionId === 'forensic' && blockIndex === 0 && n === 3) {
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: 4 };
    } else if (sectionId === 'intelligence' && blockIndex === 0 && n === 3) {
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: 4 };
    } else if (sectionId === 'budget' && blockIndex === 0 && n >= 6) {
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: 2 };
    } else if (sectionId === 'proxy' && blockIndex === 0) {
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: 2 };
    } else if (sectionId === 'economic' && blockIndex === 3 && n === 3) {
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: 4 };
    } else if (n === 1) {
      picked[0] = { id: picked[0].id, span: 12 };
    } else {
      var each = Math.max(1, Math.floor(12 / n));
      for (i = 0; i < n; i++) picked[i] = { id: picked[i].id, span: each };
    }
  }

  /** Assign registry rows to scaffold blocks; optional slotWidgetGroups on plan entry (see TB_PAGE_SCAFFOLD_PLAN). */
  function tbFillScaffoldBlockChildren(p, children, regs) {
    var blocks = p.blocks || [];
    var reg = getRegistry();
    var regList = [];
    var r0;
    for (r0 = 0; r0 < regs.length; r0++) {
      regList.push({ id: regs[r0].id, span: regs[r0].span || 6 });
    }
    var sci = p.slotChartIds;
    var bi;
    if (sci && sci.length === blocks.length) {
      var regIdSet = {};
      for (r0 = 0; r0 < regList.length; r0++) {
        regIdSet[regList[r0].id] = regList[r0];
      }
      var placedSci = {};
      for (bi = 0; bi < children.length; bi++) {
        var rowIds = sci[bi];
        var pickedSci = [];
        var rj;
        if (rowIds?.length) {
          for (rj = 0; rj < rowIds.length; rj++) {
            var cid = rowIds[rj];
            var entSci = regIdSet[cid];
            if (!entSci) continue;
            pickedSci.push({ id: entSci.id, span: entSci.span || 6 });
            placedSci[cid] = true;
          }
        }
        tbScaffoldApplyInnerSpans(p.id, bi, pickedSci);
        children[bi].children = pickedSci;
      }
      var orphanSci = [];
      for (r0 = 0; r0 < regList.length; r0++) {
        if (!placedSci[regList[r0].id]) orphanSci.push(regList[r0]);
      }
      if (orphanSci.length && children.length) {
        var lastIx = children.length - 1;
        var mergeSci = (children[lastIx].children || []).slice();
        var oi;
        for (oi = 0; oi < orphanSci.length; oi++) {
          mergeSci.push({ id: orphanSci[oi].id, span: orphanSci[oi].span || 6 });
        }
        children[lastIx].children = mergeSci;
      }
      return;
    }
    var slots = p.slotWidgetGroups;
    if (slots && slots.length === blocks.length) {
      var used = {};
      for (bi = 0; bi < children.length; bi++) {
        var slotSpec = slots[bi];
        if (typeof slotSpec === 'string' && slotSpec.length) {
          var picked = [];
          var ri;
          for (ri = 0; ri < regList.length; ri++) {
            var ent = regList[ri];
            if (used[ent.id]) continue;
            var cd = reg?.findChart ? reg.findChart(ent.id) : null;
            var wg = cd?.widgetGroup;
            if (wg === slotSpec) {
              picked.push({ id: ent.id, span: ent.span });
              used[ent.id] = true;
            }
          }
          if (slotSpec === 'token-stats-kpis' && picked.length) {
            for (var ps = 0; ps < picked.length; ps++) {
              picked[ps] = { id: picked[ps].id, span: 2 };
            }
          }
          if (slotSpec === 'health-kpis' && picked.length) {
            for (var ph = 0; ph < picked.length; ph++) {
              picked[ph] = { id: picked[ph].id, span: 4 };
            }
          }
          if (slotSpec === 'kernbefunde' && picked.length) {
            for (var pk = 0; pk < picked.length; pk++) {
              picked[pk] = { id: picked[pk].id, span: 2 };
            }
          }
          children[bi].children = picked;
        }
      }
      var remaining = [];
      for (ri = 0; ri < regList.length; ri++) {
        var ent2 = regList[ri];
        if (!used[ent2.id]) remaining.push(ent2);
      }
      var nullIndices = [];
      var nullSpans = [];
      for (bi = 0; bi < slots.length; bi++) {
        if (slots[bi] == null || slots[bi] === '') {
          nullIndices.push(bi);
          nullSpans.push(blocks[bi] || 12);
        }
      }
      if (remaining.length && nullIndices.length) {
        var parts = tbPartitionChartsIntoBlocks(nullSpans, remaining);
        var ni;
        for (ni = 0; ni < nullIndices.length; ni++) {
          var bix = nullIndices[ni];
          var extra = parts[ni] || [];
          var cur = children[bix].children || [];
          var mergedList = cur.slice();
          var ej;
          for (ej = 0; ej < extra.length; ej++) mergedList.push(extra[ej]);
          children[bix].children = mergedList;
        }
      }
      return;
    }
    var parts0 = tbPartitionChartsIntoBlocks(blocks, regList);
    for (bi = 0; bi < children.length; bi++) {
      children[bi].children = parts0[bi] ? parts0[bi].slice() : [];
    }
  }

  function tbNestedModelFromPageScaffold() {
    var reg = getRegistry();
    var out = [];
    var included = {};
    for (var p of TB_PAGE_SCAFFOLD_PLAN) {
      if (!reg?.findSection?.(p.id)) continue;
      if (!tbIsSectionAvailable(p.id)) continue;
      var children = [];
      var bi;
      for (bi = 0; bi < p.blocks.length; bi++) {
        children.push(tbNewLayoutBlock(p.blocks[bi]));
      }
      var regs = tbVisibleRegistryChartsForSection(p.id, true);
      tbFillScaffoldBlockChildren(p, children, regs);
      out.push({ id: p.id, span: 12, children: children });
      included[p.id] = true;
    }
    // Sections injected by the selected product profile (Security, Cost
    // Forensic, gateway add-ons) are not all part of the historic scaffold
    // constant. Add every actually available page section so the dynamic
    // default always represents the complete current dashboard.
    var surfaces = tbEditableSurfaces();
    for (var si = 0; si < surfaces.length; si++) {
      var sectionIds = surfaces[si].sectionIds || [];
      for (var sj = 0; sj < sectionIds.length; sj++) {
        var sectionId = sectionIds[sj];
        if (included[sectionId] || !tbIsSectionAvailable(sectionId)) continue;
        var secDef = reg?.findSection ? reg.findSection(sectionId) : null;
        if (!secDef) continue;
        var extraChildren = [];
        var sectionCharts = secDef.charts || [];
        for (var sci = 0; sci < sectionCharts.length; sci++) {
          var chartDef = sectionCharts[sci];
          if (chartDef.engine !== 'echarts' || chartDef.kind === 'chip') continue;
          extraChildren.push({ id: chartDef.id, span: tbPoolDefaultSpanForChart(reg, chartDef.id) });
        }
        out.push({ id: sectionId, span: 12, children: extraChildren });
        included[sectionId] = true;
      }
    }
    return out;
  }

  function tbChartIsAvailableForSource(sectionId, chart) {
    var setupSources = window.__productSetup?.sources || {};
    var setupMode = window.__productSetup?.mode || '';
    var requestOnlyProxy = window.__proxyRequestOnly === true ||
      setupSources.cache_fix === true ||
      setupSources.meter === true ||
      setupMode === 'cache-fix' ||
      setupMode === 'meter' ||
      setupMode === 'combined';
    return !(sectionId === 'proxy' && requestOnlyProxy && chart?.fullProxyOnly);
  }

  function tbBuildPageGroups(flatWidgets) {
    var pageGroups = {};
    for (var i = 0; i < flatWidgets.length; i++) {
      var flatItem = flatWidgets[i];
      var ownerSection = flatItem.section || flatItem.id;
      var pageId = tbSectionSurfaceId(ownerSection);
      if (!pageId) continue;
      if (!pageGroups[pageId]) pageGroups[pageId] = { widgets: [] };
      pageGroups[pageId].widgets.push(Object.assign({}, flatItem));
    }
    return pageGroups;
  }

  function tbCurrentDashboardTemplate() {
    var widgets = buildDefaultWidgetsFromScaffold() || [];
    return {
      name: _t('tbCurrentDashboardTemplate'),
      builtin: true,
      version: 4,
      widgets: widgets,
      pages: tbBuildPageGroups(widgets)
    };
  }

  function tbBuilderTemplates() {
    var current = tbCurrentDashboardTemplate();
    var all = getAllTemplates();
    var out = [current];
    for (var i = 0; i < all.length; i++) {
      if (all[i].name !== current.name) out.push(all[i]);
    }
    return out;
  }

  function tbTemplateKey(tpl) {
    return (tpl?.surfaceId || '*') + '::' + (tpl?.name || '');
  }

  function tbRenderTemplateSelect() {
    var select = document.getElementById('tb-template-select');
    if (!select) return;
    var selected = select.value;
    var all = tbBuilderTemplates();
    select.innerHTML = '<option value="">\u2014 Template laden \u2014</option>';
    for (var i = 0; i < all.length; i++) {
      var tpl = all[i];
      if (tpl.surfaceId && tpl.surfaceId !== _tbActiveSurface) continue;
      var opt = document.createElement('option');
      opt.value = tbTemplateKey(tpl);
      var surface = tpl.surfaceId ? window.__navModel?.getSurface?.(tpl.surfaceId) : null;
      opt.textContent = (surface ? '[' + surface.label + '] ' : '') + tpl.name + (tpl.builtin ? '' : ' *');
      select.appendChild(opt);
    }
    var hasSelected = false;
    for (var oi = 0; oi < select.options.length; oi++) {
      if (select.options[oi].value === selected) hasSelected = true;
    }
    select.value = hasSelected ? selected : '';
  }

  function tbClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Stable page-local identity used by saved templates.
   * Registry ids stay untouched for rendering; pageWidgetId prevents a widget
   * with the same registry id from being mistaken for one on another surface.
   * Example: usage_chart_xy.
   */
  function tbPageWidgetId(surfaceId, widgetId) {
    var page = String(surfaceId || 'dashboard').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    var widget = String(widgetId || 'widget').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    return page + '_' + widget;
  }

  function tbAnnotateBuilderNode(node, surfaceId) {
    var copy = tbClone(node);
    copy.surfaceId = surfaceId;
    copy.pageWidgetId = tbPageWidgetId(surfaceId, copy.id || copy.bid);
    var children = copy.children || [];
    for (var i = 0; i < children.length; i++) {
      children[i] = tbAnnotateBuilderNode(children[i], surfaceId);
    }
    return copy;
  }

  function tbAnnotateFlatWidget(widget, surfaceId) {
    var copy = Object.assign({}, widget, {
      surfaceId: surfaceId,
      pageWidgetId: tbPageWidgetId(surfaceId, widget.id || widget.bid)
    });
    if (Array.isArray(widget.nested)) {
      copy.nested = widget.nested.map(function (nested) {
        return Object.assign({}, nested, {
          surfaceId: surfaceId,
          pageWidgetId: tbPageWidgetId(surfaceId, nested.id)
        });
      });
    }
    return copy;
  }

  function tbSectionsForSurface(surfaceId) {
    var out = [];
    for (var i = 0; i < _tbWidgets.length; i++) {
      if (tbSectionSurfaceId(_tbWidgets[i].id) === surfaceId && tbIsSectionAvailable(_tbWidgets[i].id)) {
        out.push(tbAnnotateBuilderNode(_tbWidgets[i], surfaceId));
      }
    }
    return out;
  }

  function tbReplaceSurfaceDraft(surfaceId, sections) {
    var first = -1;
    var kept = [];
    for (var i = 0; i < _tbWidgets.length; i++) {
      if (tbSectionSurfaceId(_tbWidgets[i].id) === surfaceId) {
        if (first < 0) first = kept.length;
      } else {
        kept.push(_tbWidgets[i]);
      }
    }
    if (first < 0) first = kept.length;
    var args = [first, 0].concat(tbClone(sections || []));
    kept.splice.apply(kept, args);
    _tbWidgets = kept;
  }

  function tbLoadTemplateIntoDraft(tpl) {
    if (tpl?.scope === 'page' && tpl.surfaceId) {
      _tbActiveSurface = tpl.surfaceId;
      tbReplaceSurfaceDraft(tpl.surfaceId, tbLoadTemplateIntoBuilder(tpl));
      return;
    }
    _tbWidgets = tbLoadTemplateIntoBuilder(tpl);
  }

  function tbLoadDefaultIntoBuilder() {
    var overlay = document.getElementById('tb-overlay');
    if (!overlay) return;
    var tplSelect = document.getElementById('tb-template-select');
    var val = tplSelect ? tplSelect.value : '';
    if (val) {
      var all = tbBuilderTemplates();
      for (var tplItem of all) {
        if (tbTemplateKey(tplItem) === val) {
          tbLoadTemplateIntoDraft(tplItem);
          renderBuilderRows();
          return;
        }
      }
    }
    _tbWidgets = tbNestedModelFromPageScaffold();
    renderBuilderRows();
  }

  function tbStartNewTemplate() {
    var defaults = tbNestedModelFromPageScaffold();
    var pageDefaults = [];
    for (var i = 0; i < defaults.length; i++) {
      if (tbSectionSurfaceId(defaults[i].id) === _tbActiveSurface) pageDefaults.push(defaults[i]);
    }
    tbReplaceSurfaceDraft(_tbActiveSurface, pageDefaults);
    var nameInput = document.getElementById('tb-name-input');
    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
    var tplSelect = document.getElementById('tb-template-select');
    if (tplSelect) tplSelect.value = '';
    renderBuilderRows();
  }

  /**
   * Load a template (or prefs) into the builder model.
   * For section-only templates (v2 builtins): enriches with scaffold blocks in template order.
   * For v3 templates with layout blocks: loads as-is.
   * Returns the nested _tbWidgets array.
   */
  function tbLoadTemplateIntoBuilder(tpl) {
    if (Array.isArray(tpl?.builderSections)) {
      return tbClone(tpl.builderSections).filter(function (section) {
        return tbIsSectionAvailable(section.id);
      });
    }
    var widgets = tpl?.widgets;
    if ((!widgets || !widgets.length) && tpl?.pages) {
      widgets = [];
      var surfaces = tbEditableSurfaces();
      for (var psi = 0; psi < surfaces.length; psi++) {
        var pageEntry = tpl.pages[surfaces[psi].id];
        var pageWidgets = Array.isArray(pageEntry) ? pageEntry : pageEntry?.widgets;
        if (pageWidgets?.length) widgets = widgets.concat(pageWidgets);
      }
    }
    if (!widgets?.length) return tbNestedModelFromPageScaffold();
    widgets = widgets.filter(function (item) {
      return tbIsSectionAvailable(item.section || item.id);
    });
    // Check if template has layout/chart blocks
    var hasBlocks = false;
    for (var wChk of widgets) {
      if (wChk.type === 'layout' || wChk.type === 'chart') {
        hasBlocks = true; break;
      }
    }
    if (hasBlocks) {
      var result = tbFlatWidgetsToNestedModel(widgets);
      tbAugmentBuilderChildrenFromRegistry(result);
      return result;
    }
    // Section-only: enrich with scaffold blocks in template order
    var scaffoldNested = tbNestedModelFromPageScaffold();
    var scaffoldById = {};
    for (var scSec of scaffoldNested) {
      scaffoldById[scSec.id] = scSec;
    }
    var out = [];
    for (var pw of widgets) {
      if ((pw.type || 'section') !== 'section') continue;
      var scaffSec = scaffoldById[pw.id];
      if (scaffSec) {
        out.push({ id: pw.id, span: pw.span || 12, children: scaffSec.children || [] });
      } else {
        out.push({ id: pw.id, span: pw.span || 12, children: [] });
      }
    }
    return out;
  }

  function openTemplateBuilder(baseTpl) {
    var overlay = document.getElementById('tb-overlay');
    if (!overlay) return;
    var _prefs = getPrefs();
    var nameInput = document.getElementById('tb-name-input');
    var titleEl = document.getElementById('tb-title');
    if (titleEl) titleEl.textContent = _t('tbTitle');
    if (nameInput) nameInput.placeholder = _t('tbNamePlaceholder');

    console.info('[TB open] baseTpl=%s, _prefs.widgets=%s', !!baseTpl, _prefs?.widgets ? _prefs.widgets.length : 'null');
    if (baseTpl?.widgets) {
      console.info('[TB open] -> baseTpl path');
      _tbWidgets = tbLoadTemplateIntoBuilder(baseTpl);
      if (nameInput) nameInput.value = baseTpl.builtin ? '' : (baseTpl.name || '');
    } else if (_prefs?.widgets?.length) {
      console.info('[TB open] -> _prefs path, sections:', _prefs.widgets.filter(function(w){return (w.type||'section')==='section'}).map(function(w){return w.id}));
      _tbWidgets = tbLoadTemplateIntoBuilder(_prefs);
      if (nameInput) {
        var activeName = _prefs.activeTemplate || '';
        var activeTemplate = null;
        var activeTemplates = getAllTemplates();
        for (var ati = 0; ati < activeTemplates.length; ati++) {
          if (activeTemplates[ati].name === activeName) activeTemplate = activeTemplates[ati];
        }
        nameInput.value = activeTemplate && !activeTemplate.builtin ? activeName : '';
      }
    } else {
      _tbWidgets = tbNestedModelFromPageScaffold();
      if (nameInput) nameInput.value = '';
    }

    var activeNavSurface = window.__navState?.getActive ? window.__navState.getActive() : '';
    var editable = tbEditableSurfaces();
    _tbActiveSurface = '';
    if (baseTpl?.surfaceId) _tbActiveSurface = baseTpl.surfaceId;
    for (var esi = 0; esi < editable.length; esi++) {
      if (!_tbActiveSurface && editable[esi].id === activeNavSurface) _tbActiveSurface = activeNavSurface;
    }
    if (!_tbActiveSurface && editable.length) _tbActiveSurface = editable[0].id;
    renderBuilderRows();
    bindCanvasEvents();
    bindPoolEvents();
    var scSum = document.getElementById('tb-scaffold-summary');
    var scPre = document.getElementById('tb-scaffold-pipe');
    if (scSum) scSum.textContent = _t('tbScaffoldSummary');
    if (scPre) {
      var sk = tbGetDesktopPageScaffold();
      scPre.textContent =
        sk.divGeruestAscii +
        '\n\n--- pipe ---\n' +
        sk.fullPipe +
        '\n\n--- shallow ---\n' +
        sk.toShallowDivPipe();
    }
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeTemplateBuilder() {
    var overlay = document.getElementById('tb-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    _tbWidgets = [];
    _tbActiveSurface = '';
  }

  function getUsedIds() {
    var used = {};
    for (var tw of _tbWidgets) used[tw.id] = true;
    return used;
  }

  function getAvailableSections() {
    var used = getUsedIds();
    var reg = getRegistry();
    if (!reg) return [];
    var avail = [];
    for (var s of reg.sections) {
      if (!used[s.id]) avail.push(s);
    }
    return avail;
  }

  // ── Template Builder v2: Nested Grid Canvas + Widget Pool ───────

  function tbName(reg, id, type) {
    if (type === 'chart') {
      var ch = reg.findChart(id);
      return ch ? _t(ch.titleKey) : id;
    }
    var sec = reg.findSection(id);
    return sec ? _t(sec.titleKey) : id;
  }

  /** Same rule as pool: ECharts canvas chart vs KPI/HTML/chip (dashed meta pool); block = layout row. */
  function tbCanvasChildKind(reg, child) {
    if (tbIsLayoutBlock(child)) return 'layout';
    var chartId = child?.id;
    if (!reg || typeof reg.findChart !== 'function') return 'meta';
    var ch = reg.findChart(chartId);
    if (!ch) return 'meta';
    if (ch.engine === 'echarts' && ch.kind !== 'chip') return 'chart';
    return 'meta';
  }

  function tbGetAllUsedIds() {
    var used = {};
    for (var tw of _tbWidgets) {
      used[tw.id] = true;
      var ch = tw.children || [];
      for (var ent of ch) {
        if (tbIsLayoutBlock(ent)) {
          var inn = ent.children || [];
          for (var innEnt of inn) {
            if (innEnt.id) used[innEnt.id] = true;
          }
          continue;
        }
        if (ent.id) used[ent.id] = true;
      }
    }
    return used;
  }

  function renderCanvas() {
    var canvas = document.getElementById('tb-canvas');
    if (!canvas) return;
    var reg = getRegistry();
    if (!reg) return;
    var prevOpen = tbSnapshotSectionOpenState(canvas);
    var html = '';
    var visibleIndices = tbVisibleWidgetIndices(reg);
    for (var vii = 0; vii < visibleIndices.length; vii++) {
      var i = visibleIndices[vii];
      var w = _tbWidgets[i];
      var isOpen = prevOpen[w.id] === true;
      html +=
        '<details class="tb-canvas-section"' +
        (isOpen ? ' open' : '') +
        ' data-sidx="' +
        i +
        '" data-section-id="' +
        escT(w.id) +
        '" draggable="true" style="grid-column:span ' +
        (w.span || 12) +
        '">';
      html += '<summary class="tb-canvas-section-head" title="' + escT(_t('tbSectionToggleTitle')) + '">';
      html += '<span class="tb-canvas-drag">&#x2630;</span>';
      html += '<span class="tb-canvas-name">' + tbName(reg, w.id, 'section') + '</span>';
      html += '<span class="tb-canvas-span">' + (w.span || 12) + '</span>';
      html += '<button type="button" class="tb-canvas-remove" data-sidx="' + i + '">&times;</button>';
      html += '<span class="tb-canvas-resize" data-sidx="' + i + '"></span>';
      html += '</summary>';
      html += '<div class="tb-canvas-section-body">';
      html += '<div class="tb-canvas-layout-bar" data-sidx="' + i + '">';
      for (var spb = 12; spb >= 1; spb--) {
        html +=
          '<button type="button" class="tb-canvas-add-block" data-sidx="' +
          i +
          '" data-span="' +
          spb +
          '" title="' +
          escT(_t('tbAddLayoutBlockTitle')) +
          '">' +
          spb +
          '</button>';
      }
      html += '</div>';
      // Children sub-grid
      var children = w.children || [];
      html += '<div class="tb-canvas-children" data-sidx="' + i + '">';
      for (var ci = 0; ci < children.length; ci++) {
        var c = children[ci];
        var ck = tbCanvasChildKind(reg, c);
        var cspan = c.span || (tbIsLayoutBlock(c) ? 12 : 6);
        var cname = tbIsLayoutBlock(c) ? _t('tbLayoutBlockLabel') + ' ' + String(cspan) + '/12' : tbName(reg, c.id, 'chart');
        if (tbIsLayoutBlock(c)) {
          html += '<div class="tb-canvas-child tb-canvas-child--' + ck + '" data-sidx="' + i + '" data-cidx="' + ci + '" draggable="true" style="grid-column:span ' + cspan + '">';
          html += '<div class="tb-canvas-layout-row">';
          html += '<span class="tb-canvas-drag">&#x2630;</span>';
          html += '<span class="tb-canvas-name">' + cname + '</span>';
          html += '<span class="tb-canvas-span">' + cspan + '</span>';
          html += '<button type="button" class="tb-canvas-child-remove" data-sidx="' + i + '" data-cidx="' + ci + '">&times;</button>';
          html += '<span class="tb-canvas-child-resize" data-sidx="' + i + '" data-cidx="' + ci + '"></span>';
          html += '</div>';
          var inners = c.children || [];
          html +=
            '<div class="tb-canvas-block-inner" data-sidx="' +
            i +
            '" data-pcidx="' +
            ci +
            '" data-inner-cols="' +
            cspan +
            '" style="grid-template-columns:repeat(' +
            cspan +
            ',1fr)">';
          var ii;
          for (ii = 0; ii < inners.length; ii++) {
            var ic = inners[ii];
            var ick = tbCanvasChildKind(reg, ic);
            var icspan = ic.span || 6;
            if (icspan < 1) icspan = 1;
            if (icspan > cspan) icspan = cspan;
            var icname = tbName(reg, ic.id, 'chart');
            html +=
              '<div class="tb-canvas-child tb-canvas-child--' +
              ick +
              '" data-sidx="' +
              i +
              '" data-pcidx="' +
              ci +
              '" data-icc="' +
              ii +
              '" draggable="true" style="grid-column:span ' +
              icspan +
              '">';
            html += '<span class="tb-canvas-drag">&#x2630;</span>';
            html += '<span class="tb-canvas-name">' + icname + '</span>';
            html += '<span class="tb-canvas-span">' + icspan + '</span>';
            html +=
              '<button type="button" class="tb-canvas-child-remove" data-sidx="' +
              i +
              '" data-pcidx="' +
              ci +
              '" data-icc="' +
              ii +
              '">&times;</button>';
            html += '<span class="tb-canvas-child-resize" data-sidx="' + i + '" data-pcidx="' + ci + '" data-icc="' + ii + '"></span>';
            html += '</div>';
          }
          if (!inners.length) {
            html +=
              '<div class="tb-canvas-child-placeholder tb-canvas-child-placeholder--inner" data-sidx="' +
              i +
              '" data-pcidx="' +
              ci +
              '">+ Charts hierher ziehen</div>';
          }
          html += '</div></div>';
          continue;
        }
        html += '<div class="tb-canvas-child tb-canvas-child--' + ck + '" data-sidx="' + i + '" data-cidx="' + ci + '" draggable="true" style="grid-column:span ' + cspan + '">';
        html += '<span class="tb-canvas-drag">&#x2630;</span>';
        html += '<span class="tb-canvas-name">' + cname + '</span>';
        html += '<span class="tb-canvas-span">' + cspan + '</span>';
        html += '<button type="button" class="tb-canvas-child-remove" data-sidx="' + i + '" data-cidx="' + ci + '">&times;</button>';
        html += '<span class="tb-canvas-child-resize" data-sidx="' + i + '" data-cidx="' + ci + '"></span>';
        html += '</div>';
      }
      if (!children.length) {
        html += '<div class="tb-canvas-child-placeholder" data-sidx="' + i + '">+ Charts hierher ziehen</div>';
      }
      html += '</div>';
      html += '</div>';
      html += '</details>';
    }
    if (!visibleIndices.length) {
      html += '<div class="tb-canvas-placeholder">' + _t('tbDropHere') + '</div>';
    }
    canvas.innerHTML = html;
  }

  function renderPool() {
    var elCharts = document.getElementById('tb-pool-charts');
    var elMeta = document.getElementById('tb-pool-meta');
    var elSections = document.getElementById('tb-pool-sections');
    var headL = document.getElementById('tb-pool-left-head');
    var headR = document.getElementById('tb-pool-right-head');
    var labSec = document.getElementById('tb-pool-sections-label');
    if (!elCharts || !elMeta || !elSections) return;
    var reg = getRegistry();
    if (!reg) return;
    var used = tbGetAllUsedIds();

    if (headL) headL.textContent = _t('tbPoolLeftTitle');
    if (headR) headR.textContent = _t('tbPoolRightTitle');
    if (labSec) labSec.textContent = _t('tbPoolSections');

    var htmlSec = '';
    for (var sec of reg.sections) {
      if (sec.parentSection) continue;
      if (!tbIsSectionAvailable(sec.id) || !tbIsSectionOnActiveSurface(reg, sec.id)) continue;
      var clsS = 'tb-pool-chip' + (used[sec.id] ? ' is-used' : '');
      htmlSec += '<div class="' + clsS + '" data-pool-id="' + sec.id + '" data-pool-type="section" draggable="' + (used[sec.id] ? 'false' : 'true') + '">';
      htmlSec += _t(sec.titleKey);
      htmlSec += '</div>';
    }
    elSections.innerHTML = htmlSec;

    var htmlCharts = '';
    for (var gs of reg.sections) {
      if (!tbIsSectionOnActiveSurface(reg, gs.id) || !tbIsSectionAvailable(tbRootSectionId(reg, gs.id))) continue;
      if (!gs.charts?.length) continue;
      var hasCanvas = false;
      for (var chx of gs.charts) {
        if (chx.engine === 'echarts' && chx.kind !== 'chip') {
          hasCanvas = true;
          break;
        }
      }
      if (!hasCanvas) continue;
      var innerCharts = '';
      for (var rc of gs.charts) {
        var isCanvasChart = rc.engine === 'echarts' && rc.kind !== 'chip';
        if (!isCanvasChart) continue;
        if (!tbChartIsAvailableForSource(tbRootSectionId(reg, gs.id), rc)) continue;
        if (used[rc.id]) continue;
        var label = _t(rc.titleKey);
        innerCharts += '<div class="tb-pool-chip tb-pool-chip--chart" data-pool-id="' + rc.id + '" data-pool-type="chart" data-pool-section="' + gs.id + '" draggable="true">';
        innerCharts += label;
        innerCharts += '</div>';
      }
      if (!innerCharts) continue;
      htmlCharts += '<details class="tb-pool-group tb-pool-group--fold">';
      htmlCharts += '<summary class="tb-pool-group-title">' + _t(gs.titleKey) + '</summary>';
      htmlCharts += '<div class="tb-pool-chips">';
      htmlCharts += innerCharts;
      htmlCharts += '</div></details>';
    }
    if (!htmlCharts) htmlCharts = '<div class="tb-pool-empty">' + _t('tbPoolLeftEmpty') + '</div>';
    elCharts.innerHTML = htmlCharts;

    var htmlMeta = '';
    for (var g2 of reg.sections) {
      if (!tbIsSectionOnActiveSurface(reg, g2.id) || !tbIsSectionAvailable(tbRootSectionId(reg, g2.id))) continue;
      if (!g2.charts?.length) continue;
      var hasMeta = false;
      for (var cx of g2.charts) {
        if (!(cx.engine === 'echarts' && cx.kind !== 'chip')) {
          hasMeta = true;
          break;
        }
      }
      if (!hasMeta) continue;
      var innerMeta = '';
      for (var r2 of g2.charts) {
        var isCv = r2.engine === 'echarts' && r2.kind !== 'chip';
        if (isCv) continue;
        if (!tbChartIsAvailableForSource(tbRootSectionId(reg, g2.id), r2)) continue;
        if (used[r2.id]) continue;
        var lab2 = _t(r2.titleKey);
        var metaSub = r2.kind === 'chip' ? _t('tbPoolChipKindChip') : (r2.type === 'table' ? _t('tbPoolChipKindTable') : _t('tbPoolChipKindOther'));
        innerMeta += '<div class="tb-pool-chip tb-pool-chip--meta" data-pool-id="' + r2.id + '" data-pool-type="chart" data-pool-section="' + g2.id + '" draggable="true" role="button" tabindex="0">';
        innerMeta += '<span class="tb-pool-meta-main">' + lab2 + '</span><span class="tb-pool-meta-sub">' + metaSub + '</span></div>';
      }
      if (!innerMeta) continue;
      htmlMeta += '<details class="tb-pool-group tb-pool-group--fold">';
      htmlMeta += '<summary class="tb-pool-group-title">' + _t(g2.titleKey) + '</summary>';
      htmlMeta += '<div class="tb-pool-chips">';
      htmlMeta += innerMeta;
      htmlMeta += '</div></details>';
    }
    if (!htmlMeta) htmlMeta = '<div class="tb-pool-empty">' + _t('tbPoolRightEmpty') + '</div>';
    elMeta.innerHTML = htmlMeta;
  }

  function renderBuilderRows() {
    renderPageTabs();
    tbRenderTemplateSelect();
    renderCanvas();
    renderPool();
    renderGridRuler();
  }

  function renderGridRuler() {
    var ruler = document.querySelector('.tb-grid-ruler');
    if (!ruler || ruler.children.length) return;
    for (var ri = 0; ri < 12; ri++) {
      var col = document.createElement('div');
      col.className = 'tb-grid-ruler-col';
      col.setAttribute('data-col', String(ri + 1));
      ruler.appendChild(col);
    }
  }

  function tbDataFromDragState(data, dragState) {
    if (data || !dragState) return data || '';
    if (dragState.kind === 'tbchild') {
      return 'tbchild:' + dragState.si + ':' + dragState.pc + ':' + dragState.ix;
    }
    if (dragState.kind === 'section') return 'section:' + dragState.fromIdx;
    if (dragState.kind === 'pool') {
      return 'pool:' + dragState.poolId + '|' + dragState.poolType + '|' + dragState.poolSection;
    }
    return '';
  }

  function tbDropIntoInnerBlock(data, inner, clientY, reg) {
    if (!inner) return false;
    var toSi = Number.parseInt(inner.dataset.sidx, 10);
    var toPc = Number.parseInt(inner.dataset.pcidx, 10);
    var targetList = tbGetChildListByParent(toSi, toPc);
    if (!targetList) return false;
    var targetInfo = tbFindChildInsertBefore(inner, clientY);
    var toIx = Number.isNaN(targetInfo.slot) ? targetList.length : targetInfo.slot;

    if (data.startsWith('tbchild:')) {
      var rest = data.slice(8).split(':');
      var fromSi = Number.parseInt(rest[0], 10);
      var fromPc = Number.parseInt(rest[1], 10);
      var fromIx = Number.parseInt(rest[2], 10);
      var sourceList = tbGetChildListByParent(fromSi, fromPc);
      if (!sourceList || fromIx < 0 || fromIx >= sourceList.length) return false;
      var moved = sourceList.splice(fromIx, 1)[0];
      if (sourceList === targetList && fromIx < toIx) toIx--;
      if (toIx < 0) toIx = 0;
      if (toIx > targetList.length) toIx = targetList.length;
      targetList.splice(toIx, 0, moved);
      return true;
    }

    if (data.startsWith('pool:')) {
      var parts = data.slice(5).split('|');
      if ((parts[1] || 'section') !== 'chart') return false;
      if (toIx < 0) toIx = 0;
      if (toIx > targetList.length) toIx = targetList.length;
      targetList.splice(toIx, 0, { id: parts[0], span: tbPoolDefaultSpanForChart(reg, parts[0]) });
      return true;
    }
    return false;
  }

  function bindCanvasEvents() {
    var canvas = document.getElementById('tb-canvas');
    if (!canvas || canvas.dataset.bound) return;
    var regCanvas = getRegistry();
    canvas.dataset.bound = '1';
    var dropHost = canvas.parentElement?.classList.contains('tb-canvas-wrap') ? canvas.parentElement : canvas;

    // Empty inner layout blocks sit inside a draggable parent row. Handle
    // their drag/drop in capture phase so the parent cannot swallow the drop.
    canvas.addEventListener('dragover', function (e) {
      var inner = e.target.closest('.tb-canvas-block-inner');
      if (!inner) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = _tbDrag?.kind === 'pool' ? 'copy' : 'move';
    }, true);
    canvas.addEventListener('drop', function (e) {
      var inner = e.target.closest('.tb-canvas-block-inner');
      if (!inner) return;
      var dragState = _tbDrag;
      var data = tbDataFromDragState(e.dataTransfer.getData('text/plain') || '', dragState);
      if (!tbDropIntoInnerBlock(data, inner, e.clientY, regCanvas)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      _tbDrag = null;
      tbClearCanvasDropUi();
      renderBuilderRows();
    }, true);

    // Pointer fallback for moving already placed widgets. Native HTML5 DnD is
    // unreliable for a draggable child dropped into another draggable child
    // (the layout block). Track the row ourselves and resolve the target under
    // the pointer on mouseup.
    var pointerDrag = null;
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button,.tb-canvas-child-resize,.tb-canvas-resize')) return;
      var child = e.target.closest('.tb-canvas-child');
      if (!child || child.classList.contains('tb-canvas-child--layout')) return;
      var si = Number.parseInt(child.dataset.sidx, 10);
      var pc = child.dataset.pcidx !== undefined && child.dataset.pcidx !== '' ? Number.parseInt(child.dataset.pcidx, 10) : -1;
      var ix = pc >= 0 ? Number.parseInt(child.dataset.icc, 10) : Number.parseInt(child.dataset.cidx, 10);
      pointerDrag = { si: si, pc: pc, ix: ix, x: e.clientX, y: e.clientY, moved: false, el: child };
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!pointerDrag) return;
      if (!pointerDrag.moved && Math.hypot(e.clientX - pointerDrag.x, e.clientY - pointerDrag.y) < 4) return;
      pointerDrag.moved = true;
      pointerDrag.el?.classList.add('is-dragging');
      tbClearCanvasDropUi();
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var inner = under?.closest?.('.tb-canvas-block-inner');
      var children = under?.closest?.('.tb-canvas-children');
      var zone = inner || children;
      if (zone) tbApplyChildDropPreview(zone, e.clientY, pointerDrag.si, pointerDrag.pc, pointerDrag.ix);
    });
    window.addEventListener('mouseup', function (e) {
      if (!pointerDrag) return;
      var state = pointerDrag;
      pointerDrag = null;
      state.el?.classList.remove('is-dragging');
      if (!state.moved) return;
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var inner = under?.closest?.('.tb-canvas-block-inner');
      var data = 'tbchild:' + state.si + ':' + state.pc + ':' + state.ix;
      if (inner && tbDropIntoInnerBlock(data, inner, e.clientY, regCanvas)) {
        tbClearCanvasDropUi();
        renderBuilderRows();
        return;
      }
      var zone = under?.closest?.('.tb-canvas-children');
      if (!zone) {
        tbClearCanvasDropUi();
        return;
      }
      var fromList = tbGetChildListByParent(state.si, state.pc);
      var toSi = Number.parseInt(zone.dataset.sidx, 10);
      var toList = tbGetChildListByParent(toSi, -1);
      if (!fromList || !toList || state.ix < 0 || state.ix >= fromList.length) {
        tbClearCanvasDropUi();
        return;
      }
      var target = tbFindChildInsertBefore(zone, e.clientY);
      var toIx = Number.isNaN(target.slot) ? toList.length : target.slot;
      var moved = fromList.splice(state.ix, 1)[0];
      if (fromList === toList && state.ix < toIx) toIx--;
      if (toIx < 0) toIx = 0;
      if (toIx > toList.length) toIx = toList.length;
      toList.splice(toIx, 0, moved);
      tbClearCanvasDropUi();
      renderBuilderRows();
    });

    // Remove section or child
    canvas.addEventListener('click', function (e) {
      var addBlk = e.target.closest('.tb-canvas-add-block');
      if (addBlk) {
        var sbi = Number.parseInt(addBlk.dataset.sidx, 10);
        var spb = Number.parseInt(addBlk.dataset.span, 10);
        if (_tbWidgets[sbi]) {
          if (!_tbWidgets[sbi].children) _tbWidgets[sbi].children = [];
          _tbWidgets[sbi].children.push(tbNewLayoutBlock(spb));
          renderBuilderRows();
        }
        return;
      }
      var rmChild = e.target.closest('.tb-canvas-child-remove');
      if (rmChild) {
        var si = Number.parseInt(rmChild.dataset.sidx, 10);
        if (rmChild.dataset.pcidx !== undefined && rmChild.dataset.pcidx !== '') {
          var pcR = Number.parseInt(rmChild.dataset.pcidx, 10);
          var iccR = Number.parseInt(rmChild.dataset.icc, 10);
          var blkR = _tbWidgets[si]?.children?.[pcR];
          if (blkR?.children && !Number.isNaN(iccR)) {
            blkR.children.splice(iccR, 1);
          }
        } else {
          var ci = Number.parseInt(rmChild.dataset.cidx, 10);
          if (_tbWidgets[si]?.children) {
            _tbWidgets[si].children.splice(ci, 1);
          }
        }
        renderBuilderRows();
        return;
      }
      var rmSec = e.target.closest('.tb-canvas-remove');
      if (rmSec) {
        e.stopPropagation();
        var idx = Number.parseInt(rmSec.dataset.sidx, 10);
        _tbWidgets.splice(idx, 1);
        renderBuilderRows();
      }
    });

    // Drag canvas child row vs section (child is inside section -- must test child first)
    canvas.addEventListener('dragstart', function (e) {
      var ch = e.target.closest('.tb-canvas-child');
      if (ch) {
        var siD = Number.parseInt(ch.dataset.sidx, 10);
        var pcD = ch.dataset.pcidx !== undefined && ch.dataset.pcidx !== '' ? Number.parseInt(ch.dataset.pcidx, 10) : -1;
        var ixD = pcD >= 0 ? Number.parseInt(ch.dataset.icc, 10) : Number.parseInt(ch.dataset.cidx, 10);
        _tbDrag = { kind: 'tbchild', si: siD, pc: pcD, ix: ixD };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'tbchild:' + siD + ':' + pcD + ':' + ixD);
        ch.classList.add('is-dragging');
        return;
      }
      var sec = e.target.closest('.tb-canvas-section');
      if (!sec) return;
      _tbDrag = { kind: 'section', fromIdx: Number.parseInt(sec.dataset.sidx, 10) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'section:' + sec.dataset.sidx);
      sec.classList.add('is-dragging');
    });

    dropHost.addEventListener('dragover', function (e) {
      e.preventDefault();
      var eff = e.dataTransfer.effectAllowed;
      if (eff === 'move' || eff === 'linkMove') {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (!dropHost.contains(e.target)) return;
      tbClearCanvasDropUi();
      if (!_tbDrag) return;

      if (_tbDrag.kind === 'pool' && _tbDrag.poolType === 'section') {
        tbApplySectionDropPreview(canvas, e.clientY, -1);
        return;
      }
      if (_tbDrag.kind === 'section') {
        tbApplySectionDropPreview(canvas, e.clientY, _tbDrag.fromIdx);
        return;
      }
      if (_tbDrag.kind === 'pool' && _tbDrag.poolType === 'chart') {
        var innerP = e.target.closest('.tb-canvas-block-inner');
        var cz = e.target.closest('.tb-canvas-children');
        var sec = e.target.closest('.tb-canvas-section');
        var zone = innerP || cz || (sec?.querySelector('.tb-canvas-children'));
        if (zone) {
          tbApplyChildDropPreview(zone, e.clientY, -1, -1, -1);
        } else {
          var secs = canvas.querySelectorAll('.tb-canvas-section');
          if (secs.length) {
            var lastZ = secs[secs.length - 1].querySelector('.tb-canvas-children');
            if (lastZ) lastZ.classList.add('tb-canvas-children--drop-append');
          } else {
            var ph0 = canvas.querySelector('.tb-canvas-placeholder');
            if (ph0) ph0.classList.add('tb-canvas-placeholder--drop-here');
          }
        }
        return;
      }
      if (_tbDrag.kind === 'tbchild') {
        var innerZ = e.target.closest('.tb-canvas-block-inner');
        var cz2 = e.target.closest('.tb-canvas-children');
        var sec2 = e.target.closest('.tb-canvas-section');
        var zone2 = innerZ || cz2 || (sec2?.querySelector('.tb-canvas-children'));
        if (zone2) {
          tbApplyChildDropPreview(zone2, e.clientY, _tbDrag.si, _tbDrag.pc, _tbDrag.ix);
        }
      }
    });

    dropHost.addEventListener('dragleave', function (e) {
      if (!dropHost.contains(e.relatedTarget)) {
        tbClearCanvasDropUi();
      }
    });

    dropHost.addEventListener('drop', function (e) {
      e.preventDefault();
      tbClearCanvasDropUi();
      var dragState = _tbDrag;
      _tbDrag = null;

      var data = e.dataTransfer.getData('text/plain') || '';
      // Chromium can return an empty DataTransfer payload when a draggable
      // chart crosses another draggable layout block. Keep the in-memory
      // payload as the authoritative fallback so empty new blocks remain
      // valid drop targets.
      data = tbDataFromDragState(data, dragState);
      var childZone = e.target.closest('.tb-canvas-children');
      var targetSec = e.target.closest('.tb-canvas-section');

      // Reorder / move a chart or chip row on the canvas (section-level or inside layout block)
      if (data.startsWith('tbchild:')) {
        var rest = data.slice(8).split(':');
        var fromSi = Number.parseInt(rest[0], 10);
        var fromPc = -1;
        var fromIx = 0;
        if (rest.length >= 3) {
          fromPc = Number.parseInt(rest[1], 10);
          fromIx = Number.parseInt(rest[2], 10);
        } else {
          fromIx = Number.parseInt(rest[1], 10);
        }
        var srcList = tbGetChildListByParent(fromSi, fromPc);
        if (!srcList || fromIx < 0 || fromIx >= srcList.length) {
          renderBuilderRows();
          return;
        }
        var innerDrop = e.target.closest('.tb-canvas-block-inner');
        var cz = e.target.closest('.tb-canvas-children');
        var ts = e.target.closest('.tb-canvas-section');
        var zone = innerDrop || cz || (ts?.querySelector('.tb-canvas-children'));
        if (!zone) {
          renderBuilderRows();
          return;
        }
        var toSi = Number.parseInt(zone.dataset.sidx, 10);
        var toPc = innerDrop ? Number.parseInt(zone.dataset.pcidx, 10) : -1;
        var ti = tbFindChildInsertBefore(zone, e.clientY);
        var toIx = ti.slot;
        if (Number.isNaN(toIx)) toIx = 0;
        var moved = srcList.splice(fromIx, 1)[0];
        var tgtList = tbGetChildListByParent(toSi, toPc);
        if (!tgtList) {
          srcList.splice(fromIx, 0, moved);
          renderBuilderRows();
          return;
        }
        if (fromSi === toSi && fromPc === toPc && fromIx < toIx) {
          toIx--;
        }
        if (toIx < 0) toIx = 0;
        if (toIx > tgtList.length) toIx = tgtList.length;
        tgtList.splice(toIx, 0, moved);
        renderBuilderRows();
        return;
      }

      // Drop from pool (copy): chart into a section, or add empty section
      if (data.startsWith('pool:')) {
        var parts = data.slice(5).split('|');
        var poolId = parts[0];
        var poolType = parts[1] || 'section';
        var poolSectionId = parts[2] || '';
        if (poolType === 'chart') {
          var innerPool = e.target.closest('.tb-canvas-block-inner');
          if (innerPool) {
            var siIn = Number.parseInt(innerPool.dataset.sidx, 10);
            var pcIn = Number.parseInt(innerPool.dataset.pcidx, 10);
            var listIn = tbGetChildListByParent(siIn, pcIn);
            if (listIn) {
              var tiIn = tbFindChildInsertBefore(innerPool, e.clientY);
              var slotIn = tiIn.slot;
              if (Number.isNaN(slotIn)) slotIn = 0;
              if (slotIn < 0) slotIn = 0;
              if (slotIn > listIn.length) slotIn = listIn.length;
              listIn.splice(slotIn, 0, { id: poolId, span: tbPoolDefaultSpanForChart(regCanvas, poolId) });
            }
            renderBuilderRows();
            return;
          }
          var cz2 = e.target.closest('.tb-canvas-children');
          var ts2 = e.target.closest('.tb-canvas-section');
          var zone2 = cz2 || (ts2?.querySelector('.tb-canvas-children'));
          var sidx = -1;
          var toCi2 = 0;
          if (zone2) {
            sidx = Number.parseInt(zone2.dataset.sidx, 10);
            var ti2 = tbFindChildInsertBefore(zone2, e.clientY);
            toCi2 = ti2.slot;
            if (Number.isNaN(toCi2)) toCi2 = 0;
          } else {
            sidx = tbLastVisibleWidgetIndex(regCanvas);
            var allSecEls = canvas.querySelectorAll('.tb-canvas-section');
            var lastSecEl = allSecEls.length ? allSecEls[allSecEls.length - 1] : null;
            var lz = lastSecEl ? lastSecEl.querySelector('.tb-canvas-children') : null;
            if (lz) {
              var ti3 = tbFindChildInsertBefore(lz, e.clientY);
              toCi2 = ti3.slot;
            } else {
              toCi2 = _tbWidgets[sidx].children ? _tbWidgets[sidx].children.length : 0;
            }
            if (Number.isNaN(toCi2)) toCi2 = 0;
          }
          if (sidx >= 0 && _tbWidgets[sidx]) {
            if (!_tbWidgets[sidx].children) _tbWidgets[sidx].children = [];
            if (toCi2 < 0) toCi2 = 0;
            if (toCi2 > _tbWidgets[sidx].children.length) toCi2 = _tbWidgets[sidx].children.length;
            _tbWidgets[sidx].children.splice(toCi2, 0, { id: poolId, span: tbPoolDefaultSpanForChart(regCanvas, poolId) });
          } else {
            var newSecId = poolSectionId || 'custom';
            _tbWidgets.push({
              id: newSecId,
              span: 12,
              children: [{ id: poolId, span: tbPoolDefaultSpanForChart(regCanvas, poolId) }]
            });
          }
          renderBuilderRows();
          return;
        }
        if (poolType === 'section') {
          var tiS = tbFindSectionInsertBefore(canvas, e.clientY);
          var insS = tbGlobalInsertIndexForVisibleSlot(regCanvas, tiS.slot);
          _tbWidgets.splice(insS, 0, { id: poolId, span: 12, children: [] });
        }
        renderBuilderRows();
        return;
      }

      // Reorder sections within canvas
      if (data.startsWith('section:')) {
        var fromIdx = Number.parseInt(data.slice(8), 10);
        if (fromIdx < 0 || fromIdx >= _tbWidgets.length) {
          renderBuilderRows();
          return;
        }
        var tiM = tbFindSectionInsertBefore(canvas, e.clientY);
        var globalTarget = tbGlobalInsertIndexForVisibleSlot(regCanvas, tiM.slot);
        if (globalTarget === fromIdx || globalTarget === fromIdx + 1) {
          renderBuilderRows();
          return;
        }
        var item = _tbWidgets.splice(fromIdx, 1)[0];
        var insM = globalTarget;
        if (fromIdx < insM) insM--;
        _tbWidgets.splice(insM, 0, item);
        renderBuilderRows();
      }
    });

    canvas.addEventListener('dragend', function () {
      _tbDrag = null;
      tbClearCanvasDropUi();
      var marks = canvas.querySelectorAll('.is-dragging');
      for (var mk of marks) mk.classList.remove('is-dragging');
    });

    // Resize section
    var _resizeTarget = null;
    var _resizeStartX = 0;
    var _resizeStartSpan = 0;
    var _colWidth = 0;

    canvas.addEventListener('mousedown', function (e) {
      var handle = e.target.closest('.tb-canvas-resize');
      var childHandle = e.target.closest('.tb-canvas-child-resize');
      if (childHandle) {
        var si = Number.parseInt(childHandle.dataset.sidx, 10);
        if (childHandle.dataset.pcidx !== undefined && childHandle.dataset.pcidx !== '') {
          var pcH = Number.parseInt(childHandle.dataset.pcidx, 10);
          var ixH = Number.parseInt(childHandle.dataset.icc, 10);
          _resizeTarget = { type: 'childInner', si: si, pc: pcH, ix: ixH, maxSpan: 12 };
          var blkH = _tbWidgets[si]?.children?.[pcH];
          var rowH = blkH?.children?.[ixH];
          _resizeStartSpan = rowH ? rowH.span : 6;
        } else {
          var ci = Number.parseInt(childHandle.dataset.cidx, 10);
          _resizeTarget = { type: 'child', si: si, ci: ci };
          _resizeStartSpan = (_tbWidgets[si]?.children?.[ci]) ? _tbWidgets[si].children[ci].span : 6;
        }
        var childGrid = childHandle.closest('.tb-canvas-block-inner') || childHandle.closest('.tb-canvas-children');
        var gridCols = 12;
        if (childGrid?.classList.contains('tb-canvas-block-inner')) {
          var icd = Number.parseInt(childGrid.getAttribute('data-inner-cols'), 10);
          if (!Number.isNaN(icd) && icd >= 1 && icd <= 12) gridCols = icd;
        }
        _colWidth = childGrid ? childGrid.offsetWidth / gridCols : canvas.offsetWidth / 12;
        if (_resizeTarget.type === 'childInner') _resizeTarget.maxSpan = gridCols;
      } else if (handle) {
        var idx = Number.parseInt(handle.dataset.sidx, 10);
        _resizeTarget = { type: 'section', si: idx };
        _resizeStartSpan = _tbWidgets[idx] ? _tbWidgets[idx].span : 12;
        _colWidth = canvas.offsetWidth / 12;
      } else {
        return;
      }
      e.preventDefault();
      _resizeStartX = e.clientX;
      document.body.classList.add('tb-resizing');
    });

    window.addEventListener('mousemove', function (e) {
      if (!_resizeTarget || !_colWidth) return;
      var dx = e.clientX - _resizeStartX;
      var colDelta = Math.round(dx / _colWidth);
      var maxSpanClamp = 12;
      if (_resizeTarget.type === 'childInner' && _resizeTarget.maxSpan) maxSpanClamp = _resizeTarget.maxSpan;
      var newSpan = Math.max(1, Math.min(maxSpanClamp, _resizeStartSpan + colDelta));
      if (_resizeTarget.type === 'section') {
        if (_tbWidgets[_resizeTarget.si] && _tbWidgets[_resizeTarget.si].span !== newSpan) {
          _tbWidgets[_resizeTarget.si].span = newSpan;
          renderCanvas();
        }
      } else if (_resizeTarget.type === 'childInner') {
        var chI = _tbWidgets[_resizeTarget.si]?.children;
        var blkI = chI?.[_resizeTarget.pc];
        var rowI = blkI?.children?.[_resizeTarget.ix];
        if (rowI && rowI.span !== newSpan) {
          rowI.span = newSpan;
          renderCanvas();
        }
      } else {
        var ch = _tbWidgets[_resizeTarget.si]?.children;
        if (ch?.[_resizeTarget.ci] && ch[_resizeTarget.ci].span !== newSpan) {
          ch[_resizeTarget.ci].span = newSpan;
          renderCanvas();
        }
      }
    });

    window.addEventListener('mouseup', function () {
      if (_resizeTarget) {
        _resizeTarget = null;
        document.body.classList.remove('tb-resizing');
        renderPool();
      }
    });
  }

  function bindPoolEvents() {
    var host = document.getElementById('tb-body');
    if (!host || host.dataset.tbPoolBound) return;
    host.dataset.tbPoolBound = '1';

    // Click: sections add to canvas, charts add to last section (or first); meta chips add layout section + default charts
    host.addEventListener('click', function (e) {
      var pageTab = e.target.closest('.tb-page-tab[data-tb-surface]');
      if (pageTab) {
        _tbActiveSurface = pageTab.dataset.tbSurface || _tbActiveSurface;
        renderBuilderRows();
        return;
      }
      var chip = e.target.closest('.tb-pool-chip');
      if (!chip || chip.classList.contains('is-used')) return;

      var id = chip.dataset.poolId;
      var type = chip.dataset.poolType || 'section';
      if (type === 'section') {
        _tbWidgets.push({ id: id, span: 12, children: [] });
      } else {
        var regPoolClick = getRegistry();
        var dropSp = tbPoolDefaultSpanForChart(regPoolClick, id);
        // A click has no spatial drop target: prefer the widget's owning
        // section so KPI/HTML entries never land in an unrelated page block.
        var targetSectionId = chip.dataset.poolSection || '';
        var targetSectionDef = targetSectionId ? regPoolClick.findSection(targetSectionId) : null;
        if (targetSectionDef?.parentSection) targetSectionId = targetSectionDef.parentSection;
        var targetWidgetIndex = -1;
        for (var twi = 0; twi < _tbWidgets.length; twi++) {
          if (_tbWidgets[twi].id === targetSectionId) {
            targetWidgetIndex = twi;
            break;
          }
        }
        if (targetWidgetIndex < 0) targetWidgetIndex = tbLastVisibleWidgetIndex(regPoolClick);
        if (targetWidgetIndex < 0) {
          var secId = targetSectionId || 'custom';
          _tbWidgets.push({ id: secId, span: 12, children: [] });
          targetWidgetIndex = _tbWidgets.length - 1;
        }
        var last = _tbWidgets[targetWidgetIndex];
        if (!last.children) last.children = [];
        var blkLast = null;
        var qq;
        for (qq = last.children.length - 1; qq >= 0; qq--) {
          if (tbIsLayoutBlock(last.children[qq])) {
            blkLast = last.children[qq];
            break;
          }
        }
        if (blkLast) {
          if (!blkLast.children) blkLast.children = [];
          blkLast.children.push({ id: id, span: dropSp });
        } else {
          last.children.push({ id: id, span: dropSp });
        }
      }
      renderBuilderRows();
    });

    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var meta = e.target.closest('.tb-pool-chip--meta');
      if (!meta || meta.classList.contains('is-used')) return;
      e.preventDefault();
      meta.click();
    });

    // Drag from pool
    host.addEventListener('dragstart', function (e) {
      var chip = e.target.closest('.tb-pool-chip');
      if (!chip) return;
      if (chip.classList.contains('is-used')) {
        e.preventDefault();
        return;
      }
      _tbDrag = {
        kind: 'pool',
        poolId: chip.dataset.poolId,
        poolType: chip.dataset.poolType || 'section',
        poolSection: chip.dataset.poolSection || ''
      };
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', 'pool:' + chip.dataset.poolId + '|' + (chip.dataset.poolType || 'section') + '|' + (chip.dataset.poolSection || ''));
    });

    host.addEventListener('dragend', function () {
      _tbDrag = null;
      tbClearCanvasDropUi();
    });
  }

  /** ECharts canvas chart (not chip / HTML) -- gets clone-or-render preview path. */
  function tbPreviewIsCanvasChart(def) {
    return !!(def?.engine === 'echarts' && def?.kind !== 'chip');
  }

  function tbPreviewWidgetTitle(def, fallbackId) {
    if (def?.kind === 'chip') return '';
    var label = def?.titleKey ? _t(def.titleKey) : fallbackId;
    return '<div class="tb-pv-widget-title">' + escT(label || fallbackId || '') + '</div>';
  }

  /** KPI / HTML / table: clone live DOM from #canvasId so preview matches dashboard chips. */
  /** Adapt cloned KPI chip grids to preview container width (simulates @media breakpoints). */
  function tbPreviewAdaptChipGrid(pvEl) {
    var w = pvEl.offsetWidth || 0;
    if (!w) return;
    var gridSels = ['.grid', '.health-grid', '.key-findings-grid'];
    for (var gSel of gridSels) {
      var grids = pvEl.querySelectorAll(gSel);
      for (var g of grids) {
        var isHealth = gSel === '.health-grid';
        var cols;
        if (w > 580) cols = isHealth ? 3 : 6;
        else if (w > 400) cols = isHealth ? 2 : 4;
        else if (w > 250) cols = isHealth ? 2 : 3;
        else if (w > 150) cols = 2;
        else cols = 1;
        g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      }
    }
    if (w < 300) {
      var vals = pvEl.querySelectorAll('.value, .health-badge-value');
      for (var val of vals) val.style.fontSize = '0.85rem';
      var labs = pvEl.querySelectorAll('.label, .health-badge-label');
      for (var lab of labs) lab.style.fontSize = '0.6rem';
      var subs = pvEl.querySelectorAll('.sub, .health-badge-sub');
      for (var sub of subs) sub.style.fontSize = '0.6rem';
    }
  }

  /** Map widgetGroup -> live DOM container that holds all chips of that group. */
  var _chipGroupContainers = {
    'health-kpis': 'health-score',
    'kernbefunde': 'key-findings',
    'token-stats-kpis': 'cards'
  };

  function tbPreviewCloneHtmlMeta(slot) {
    var pvEl = document.getElementById(slot.pvId);
    if (!pvEl || !slot.def) return;
    var def = slot.def;
    pvEl.innerHTML = '';
    pvEl.style.width = '100%';
    pvEl.style.height = 'auto';
    pvEl.style.minHeight = '0';
    var origEl = def.canvasId ? document.getElementById(def.canvasId) : null;
    window.appLogger?.debug('ui-widget-template', 'previewClone', 'info', 'canvasId=' + def.canvasId + ' found=' + !!origEl + ' group=' + (def.widgetGroup || '-'));
    if (!origEl && def.widgetGroup && _chipGroupContainers[def.widgetGroup]) {
      var secBody = pvEl.closest('.tb-pv-section-body') || pvEl.closest('.tb-pv-layout-charts');
      if (secBody?.querySelector('[data-tb-group-clone="' + def.widgetGroup + '"]')) {
        pvEl.style.display = 'none';
        return;
      }
      var groupEl = document.getElementById(_chipGroupContainers[def.widgetGroup]);
      if (groupEl?.children.length) {
        origEl = groupEl;
      }
    }
    if (origEl) {
      var clone = origEl.cloneNode(true);
      clone.removeAttribute('id');
      clone.setAttribute('data-tb-preview-clone', '1');
      if (def.widgetGroup && _chipGroupContainers[def.widgetGroup]) {
        clone.dataset.tbGroupClone = def.widgetGroup;
      }
      var walk = clone.querySelectorAll('[id]');
      var wi;
      for (wi = 0; wi < walk.length; wi++) {
        walk[wi].removeAttribute('id');
      }
      pvEl.appendChild(clone);
      tbPreviewAdaptChipGrid(pvEl);
      return;
    }
    pvEl.innerHTML =
      '<div class="tb-pv-meta-fallback">' + escT(_t('tbPreviewNotRendered')) + '</div>';
  }

  /** Preview one builder slot: ECharts clone/render or HTML/chip clone. */
  function tbPreviewRenderSlot(slot) {
    if (!slot?.def) return;
    if (tbPreviewIsCanvasChart(slot.def)) {
      tbPreviewCloneOrRender(slot);
    } else {
      tbPreviewCloneHtmlMeta(slot);
    }
  }

  /** Preview: clone live ECharts option, or temp-ID-swap and invoke the chart renderFn. */
  function tbPreviewCloneOrRender(slot) {
    var pvEl = document.getElementById(slot.pvId);
    if (!pvEl || typeof echarts === 'undefined') return;
    var def = slot.def;
    if (!def?.canvasId) return;

    var origEl = document.getElementById(def.canvasId);
    var origInst = origEl ? echarts.getInstanceByDom(origEl) : null;
    if (origInst) {
      try {
        var ex0 = echarts.getInstanceByDom(pvEl);
        if (ex0) ex0.dispose();
        var inst0 = echarts.init(pvEl, null, { renderer: 'canvas' });
        var opts0 = origInst.getOption();
        if (opts0) inst0.setOption(opts0, true);
      } catch (error) { logOptionalErr(error); }
      return;
    }

    var rfName = def.renderFn;
    var rf = rfName && window[rfName];
    if (typeof rf !== 'function') return;

    var realEl = origEl;
    var stashed = false;
    var realOldId = '';
    if (realEl && realEl !== pvEl) {
      realOldId = realEl.id;
      realEl.id = '__tb_pv_stash_' + def.canvasId;
      stashed = true;
    }
    var pvOldId = pvEl.id;
    pvEl.id = def.canvasId;

    function restoreIds() {
      pvEl.id = pvOldId;
      if (stashed && realEl) realEl.id = realOldId;
    }

    try {
      try {
        var ex1 = echarts.getInstanceByDom(pvEl);
        if (ex1) ex1.dispose();
      } catch (error) { logOptionalErr(error); }

      if (String(rfName).startsWith('renderProxy_')) {
        var dataP = window.__dashboardState?.getData();
        if (dataP && typeof window._computeProxyCtx === 'function') window._computeProxyCtx(dataP);
        if (window.__dashboardState?.getSectionCtx('proxy')) rf(window.__dashboardState.getSectionCtx('proxy'));
      } else if (rfName === 'renderIntel_seasonality') {
        rf();
      } else if (String(rfName).startsWith('renderStatus_')) {
        rf();
      } else if (String(rfName).startsWith('renderForensic_')) {
        var fctx = window.__dashboardState?.getSectionCtx('forensic');
        if (fctx) rf(fctx);
      } else if (String(rfName).startsWith('renderUserProfile_')) {
        var uctx = window.__dashboardState?.getSectionCtx('userProfile');
        if (uctx) rf(uctx);
      } else if (String(rfName).startsWith('renderBudget_')) {
        var bctx = window.__dashboardState?.getSectionCtx('budget');
        if (!bctx && window.__dashboardState?.getData() && typeof window._computeBudgetCtx === 'function') {
          bctx = window._computeBudgetCtx(window.__dashboardState.getData());
        }
        if (bctx) rf(bctx);
      } else if (
        rfName === 'renderCacheExplosion' ||
        rfName === 'renderBudgetDrain' ||
        rfName === 'renderEfficiencyTimeline' ||
        rfName === 'renderMonthlyButterfly' ||
        rfName === 'renderDayComparison'
      ) {
        var uDataE = window.__dashboardState?.getData();
        var eDaysE = [];
        if (uDataE?.days?.length) {
          eDaysE = window.__dashboardState
            ? window.__dashboardState.getFilteredDays(uDataE.days)
            : uDataE.days.slice();
        }
        var stEcon = window._econData;
        if (rfName === 'renderMonthlyButterfly') {
          rf(eDaysE);
        } else if (rfName === 'renderDayComparison') {
          rf(eDaysE);
        } else if (rfName === 'renderEfficiencyTimeline') {
          if (stEcon) rf(stEcon);
        } else if (rfName === 'renderBudgetDrain') {
          if (stEcon) rf(stEcon, window._econQdData || undefined);
        } else if (rfName === 'renderWasteCurve' || rfName === 'renderCacheExplosion') {
          var sessEl = document.getElementById('econ-session-picker');
          var selV = sessEl ? sessEl.value : '';
          var sessE = null;
          if (stEcon && typeof window.findSession === 'function') {
            sessE = window.findSession(stEcon, selV);
          }
          if (sessE) rf(sessE);
        }
      }
    } finally {
      restoreIds();
    }
  }

  function saveTemplateFromBuilder() {
    var nameInput = document.getElementById('tb-name-input');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      name = prompt(_t('tbNamePrompt'));
      if (!name?.trim()) return;
      name = name.trim();
    }
    // Flatten nested model back to v3 format (only ECharts canvas rows: chips stay in section DOM / hiddenCharts)
    var flatW = [];
    var regSv = getRegistry();
    for (var tbSec of _tbWidgets) {
      if (tbSectionSurfaceId(tbSec.id) !== _tbActiveSurface) continue;
      if (!tbIsSectionAvailable(tbSec.id)) continue;
      flatW.push(tbAnnotateFlatWidget({ id: tbSec.id, span: tbSec.span || 12 }, _tbActiveSurface));
      var ch = tbSec.children || [];
      for (var ci = 0; ci < ch.length; ci++) {
        var chEnt = ch[ci];
        if (tbIsLayoutBlock(chEnt)) {
          var nestedOut = [];
          var innSv = chEnt.children || [];
          for (var innItem of innSv) {
            var idef = regSv?.findChart ? regSv.findChart(innItem.id) : null;
            if (idef && (idef.kind === 'chip' || idef.engine !== 'echarts')) continue;
            nestedOut.push({ id: innItem.id, span: innItem.span || 6 });
          }
          // Skip empty layout blocks (chips-only rows)
          if (nestedOut.length) {
            flatW.push(tbAnnotateFlatWidget({
              type: 'layout',
              span: chEnt.span || 12,
              section: tbSec.id,
              bid: chEnt.bid || chEnt.id || 'tbblk_s' + ci,
              nested: nestedOut
            }, _tbActiveSurface));
          }
          continue;
        }
        var cdef = regSv?.findChart ? regSv.findChart(chEnt.id) : null;
        if (cdef && (cdef.kind === 'chip' || cdef.engine !== 'echarts')) continue;
        flatW.push(tbAnnotateFlatWidget(
          { id: chEnt.id, span: chEnt.span || 6, type: 'chart', section: tbSec.id },
          _tbActiveSurface
        ));
      }
    }
    var pageGroups = tbBuildPageGroups(flatW);
    var tpl = {
      name: name,
      version: 5,
      scope: 'page',
      surfaceId: _tbActiveSurface,
      widgets: flatW,
      pages: pageGroups,
      builderSections: tbSectionsForSurface(_tbActiveSurface)
    };
    var userTpls = loadTemplates();
    var found = false;
    for (var i = 0; i < userTpls.length; i++) {
      if (userTpls[i].name === name && (userTpls[i].surfaceId || '') === _tbActiveSurface) {
        userTpls[i] = tpl;
        found = true;
        break;
      }
    }
    if (!found) userTpls.push(tpl);
    saveTemplates(userTpls);
    applyTemplate(tpl);
    renderTemplatesSection();
    closeTemplateBuilder();
  }

  function openBuilderPreview() {
    var overlay = document.getElementById('tb-preview-overlay');
    var body = document.getElementById('tb-preview-body');
    if (!overlay || !body) return;
    var reg = getRegistry();
    if (!reg) return;

    // Build DOM with real chart containers
    var html = '<div class="tb-pv-grid">';
    var chartSlots = []; // {chartDef, domId} to render after innerHTML
    for (var pvSec of _tbWidgets) {
      if (!tbIsSectionAvailable(pvSec.id) || !tbIsSectionOnActiveSurface(reg, pvSec.id)) continue;
      var secDef = reg.findSection(pvSec.id);
      var secName = secDef ? _t(secDef.titleKey) : pvSec.id;
      html += '<div class="tb-pv-section" style="grid-column:span ' + (pvSec.span || 12) + '">';
      html += '<div class="tb-pv-section-head">' + secName + ' <span style="opacity:.4;font-weight:400">(' + (pvSec.span || 12) + '/12)</span></div>';
      html += '<div class="tb-pv-section-body">';
      var children = pvSec.children || [];
      if (children.length) {
        for (var ci = 0; ci < children.length; ci++) {
          var c = children[ci];
          if (tbIsLayoutBlock(c)) {
            var bspPv = c.span || 12;
            if (bspPv < 1) bspPv = 1;
            if (bspPv > 12) bspPv = 12;
            html +=
              '<div class="tb-pv-layout" style="grid-column:span ' +
              bspPv +
              ';min-width:0;max-width:100%"><div class="tb-pv-layout-inner">' +
              escT(_t('tbLayoutBlockLabel')) +
              ' ' +
              String(bspPv) +
              '/12</div><div class="tb-pv-layout-charts" data-inner-cols="' +
              bspPv +
              '" style="grid-template-columns:repeat(' +
              bspPv +
              ',minmax(0,1fr))">';
            var inPv = c.children || [];
            var pi;
            for (pi = 0; pi < inPv.length; pi++) {
              var icp = inPv[pi];
              var chDefIn = reg.findChart(icp.id);
              var pvIdIn = 'tb-pv-' + pvSec.id + '-' + icp.id + '-b' + ci + '-' + pi;
              var isCanvasIn = tbPreviewIsCanvasChart(chDefIn);
              var icSpPv = icp.span || 6;
              if (icSpPv < 1) icSpPv = 1;
              if (icSpPv > bspPv) icSpPv = bspPv;
              // At narrow section spans, force meta chips to full block width
              if (!isCanvasIn && (pvSec.span || 12) <= 6) icSpPv = bspPv;
              html +=
                '<div class="tb-pv-chart' +
                (isCanvasIn ? '' : ' tb-pv-chart--meta') +
                '" style="grid-column:span ' +
                icSpPv +
                '">';
              html += tbPreviewWidgetTitle(chDefIn, icp.id);
              html +=
                '<div class="tb-pv-chart-container' +
                (isCanvasIn ? '' : ' tb-pv-chart-container--html') +
                '" id="' +
                pvIdIn +
                '" style="width:100%;' +
                (isCanvasIn ? 'height:200px' : 'height:auto') +
                '"></div>';
              html += '</div>';
              if (chDefIn) chartSlots.push({ def: chDefIn, pvId: pvIdIn });
            }
            html += '</div></div>';
            continue;
          }
          var chDef = reg.findChart(c.id);
          var pvId = 'tb-pv-' + pvSec.id + '-' + c.id;
          var isCanvas = tbPreviewIsCanvasChart(chDef);
          var directSpan = c.span || 6;
          // At narrow section spans, force meta chips to full width
          if (!isCanvas && (pvSec.span || 12) <= 6) directSpan = 12;
          html +=
            '<div class="tb-pv-chart' +
            (isCanvas ? '' : ' tb-pv-chart--meta') +
            '" style="grid-column:span ' +
            directSpan +
            '">';
          html += tbPreviewWidgetTitle(chDef, c.id);
          html +=
            '<div class="tb-pv-chart-container' +
            (isCanvas ? '' : ' tb-pv-chart-container--html') +
            '" id="' +
            pvId +
            '" style="width:100%;' +
            (isCanvas ? 'height:200px' : 'height:auto') +
            '"></div>';
          html += '</div>';
          if (chDef) chartSlots.push({ def: chDef, pvId: pvId });
        }
      } else {
        html += '<div style="grid-column:span 12;text-align:center;color:#3D3830;font-size:.65rem;padding:12px">(' + _t('tbNoCharts') + ')</div>';
      }
      html += '</div></div>';
    }
    html += '</div>';
    body.innerHTML = html;
    overlay.classList.add('is-open');

    // Render charts after DOM is ready (clone live options or paint via renderFn + temp id swap)
    setTimeout(function () {
      for (var slot of chartSlots) {
        tbPreviewRenderSlot(slot);
      }
      // Adapt all cloned KPI chip grids to their actual container width
      var pvSections = body.querySelectorAll('.tb-pv-section');
      for (var pvs of pvSections) {
        var metaEls = pvs.querySelectorAll('.tb-pv-chart-container--html');
        for (var metaEl of metaEls) {
          tbPreviewAdaptChipGrid(metaEl);
        }
      }
    }, 150);
  }

  function closeBuilderPreview() {
    var overlay = document.getElementById('tb-preview-overlay');
    var body = document.getElementById('tb-preview-body');
    if (overlay) overlay.classList.remove('is-open');
    // Dispose ECharts instances to free memory
    if (body && typeof echarts !== 'undefined') {
      var containers = body.querySelectorAll('.tb-pv-chart-container');
      for (var ctr of containers) {
        var inst = echarts.getInstanceByDom(ctr);
        if (inst) try { inst.dispose(); } catch (error) { logOptionalErr(error); }
      }
    }
    // Phase 18 review: repaint via canonical renderDashboard (not direct renderDashboardCore)
    if (typeof window.renderDashboard === 'function' && window.__dashboardState?.getData()) {
      try { window.renderDashboard(window.__dashboardState.getData(), true); } catch (error) { logOptionalErr(error); }
    }
  }

  function bindTemplateBuilder() {
    var buildBtn = document.getElementById('sidebar-build-template');
    // Template Builder is available in the local standalone dashboard.
    if (buildBtn && !buildBtn.dataset.bound) {
      buildBtn.dataset.bound = '1';
      buildBtn.style.display = '';
      buildBtn.textContent = _t('tbBuild');
      buildBtn.addEventListener('click', function () { openTemplateBuilder(); });
    }
    var saveBtn = document.getElementById('tb-save');
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', saveTemplateFromBuilder);
    }
    var newBtn = document.getElementById('tb-new');
    if (newBtn && !newBtn.dataset.bound) {
      newBtn.dataset.bound = '1';
      newBtn.textContent = _t('tbNewTemplate');
      newBtn.addEventListener('click', tbStartNewTemplate);
    }
    var closeBtn = document.getElementById('tb-close');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', closeTemplateBuilder);
    }
    var overlay = document.getElementById('tb-overlay');
    if (overlay && !overlay.dataset.bound) {
      overlay.dataset.bound = '1';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeTemplateBuilder();
      });
    }
    var loadDefBtn = document.getElementById('tb-load-default');
    if (loadDefBtn && !loadDefBtn.dataset.bound) {
      loadDefBtn.dataset.bound = '1';
      loadDefBtn.textContent = _t('tbLoadDefault');
      loadDefBtn.addEventListener('click', tbLoadDefaultIntoBuilder);
    }
    var tplSelect = document.getElementById('tb-template-select');
    if (tplSelect && !tplSelect.dataset.bound) {
      tplSelect.dataset.bound = '1';
      tplSelect.addEventListener('change', function () {
        var val = tplSelect.value;
        if (!val) return;
        var all = tbBuilderTemplates();
        for (var tplSel of all) {
          if (tbTemplateKey(tplSel) === val) {
            var tpl = tplSel;
            tbLoadTemplateIntoDraft(tpl);
            var nameInput = document.getElementById('tb-name-input');
            if (nameInput) nameInput.value = tpl.builtin ? '' : (tpl.name || '');
            renderBuilderRows();
            break;
          }
        }
      });
    }
    var previewBtn = document.getElementById('tb-preview');
    if (previewBtn && !previewBtn.dataset.bound) {
      previewBtn.dataset.bound = '1';
      previewBtn.addEventListener('click', openBuilderPreview);
    }
    var pvCloseBtn = document.getElementById('tb-preview-close');
    if (pvCloseBtn && !pvCloseBtn.dataset.bound) {
      pvCloseBtn.dataset.bound = '1';
      pvCloseBtn.addEventListener('click', closeBuilderPreview);
    }
    var pvOverlay = document.getElementById('tb-preview-overlay');
    if (pvOverlay && !pvOverlay.dataset.bound) {
      pvOverlay.dataset.bound = '1';
      pvOverlay.addEventListener('click', function (e) {
        if (e.target === pvOverlay) closeBuilderPreview();
      });
    }
    bindCanvasEvents();
    bindPoolEvents();
  }

  // ── Desktop Page Scaffold ────────────────────────────────────────

  function tbGetDesktopPageScaffold() {
    var topChromePipe =
      'body > header.top-bar[flex] | body > div#filter-bar.filter-bar[collapsible]';
    var layoutRoot = '#layout-grid.layout-grid';
    var layoutGridPipe =
      layoutRoot +
      '[css:grid;12\u00d71fr;gap row/col;children use data-span 1\u201312;@media max900px \u2192 each child span 12]';
    var sections = [
      {
        id: 'health-collapse',
        tag: 'details',
        summaryClass: 'health-collapse-summary',
        innerPipe:
          'div.health-collapse-inner stacked: (1) div#health-score > div#health-grid[3-col KPI chips; 900\u21922;520\u21921] (2) div#key-findings > div#key-findings-grid[responsive 6\u21924\u21923\u21922\u21921 col; minmax(0,1fr)]'
      },
      {
        id: 'forensic-collapse',
        tag: 'details',
        innerPipe:
          'div.forensic-inner > div#forensic-cards.grid[3\u21922\u21921 col minmax(0,1fr)] + div#forensic-charts-stack > (details.forensic-chart-disclosure > \u2026) + div.forensic-charts-pair[grid 2\u00d71fr;720\u21921col]'
      },
      {
        id: 'economic-collapse',
        tag: 'details',
        innerPipe:
          'div.forensic-inner > div.forensic-charts-stack > flex-rows (inline flex 1:2 waste/explosion) + flex drain + details#econ-range-collapse (inner flex triple charts)'
      },
      {
        id: 'report-modal-overlay',
        tag: 'div',
        innerPipe: 'modal overlay (fixed-style panel; not a chart grid)'
      },
      { id: 'day-picker-row', tag: 'div', innerPipe: 'row controls' },
      { id: 'main-charts-scope-wrap', tag: 'div', innerPipe: 'hidden scope chips (display none in css)' },
      {
        id: 'token-stats-collapse',
        tag: 'details',
        innerPipe:
          'div.forensic-inner > div#cards.grid[KPI 6\u21924\u21923\u21922\u21921 col] + div#main-charts-wrap > div#charts.charts[2 or 3 col] + div#charts-host-sub.charts-pair[3 col / 2 if no-host] + div#token-stats-daily-detail.chart-box'
      },
      {
        id: 'user-profile-collapse',
        tag: 'details',
        innerPipe: 'div.forensic-inner > div#user-profile-charts.charts.has-session-row[3\u00d71fr responsive]'
      },
      {
        id: 'budget-collapse',
        tag: 'details',
        innerPipe:
          'div.forensic-inner > #budget-cards.grid[6\u21924\u21923\u21922\u21921 col] + details budget-sankey + div#budget-trend-row.charts[2 col]'
      },
      {
        id: 'proxy-collapse',
        tag: 'details',
        innerPipe:
          'div.forensic-inner.proxy-inner > #proxy-cards.grid[KPI 6\u21924\u21923\u21922\u21921 col] + div.proxy-charts-grid-3[3 col\u21922\u21921] + div.proxy-charts-grid[2 col]\u00d72 rows + chart-box full + efficiency-small-multiples[3 col subgrid]'
      }
    ];
    var childPipe = sections
      .map(function (s) {
        return s.tag + '#' + s.id;
      })
      .join(' | ');
    var fullPipe =
      topChromePipe +
      ' || ' +
      layoutGridPipe +
      ' :: ' +
      childPipe;
    var divGeruestAscii = [
      '+------------------------------------------------------------------+',
      '| body                                                             |',
      '+------------------------------------------------------------------+',
      '  |',
      '  +-- header.top-bar',
      '  +-- div#filter-bar',
      '  +-- div#layout-grid ................ [CSS grid: 12 x 1fr tracks]',
      '        |',
      '        +-- details#health-collapse',
      '        |     +-- div.health-collapse-inner (stacked full-width rows)',
      '        |           +-- div#health-score',
      '        |           |     +-- div#health-grid .... [each KPI in own cell; 3 col]',
      '        |           +-- div#key-findings',
      '        |                 +-- div#key-findings-grid [each finding in own cell]',
      '        +-- details#intelligence-collapse',
      '        |     +-- div.intelligence-inner',
      '        |           +-- div#intelligence-scores .. [3\u21922\u21921 col]',
      '        |           +-- div#intelligence-narrative',
      '        |           +-- div#intelligence-rootcause',
      '        |           +-- div#intelligence-seasonality',
      '        +-- details#forensic-collapse',
      '        |     +-- div.forensic-inner',
      '        |           +-- div#forensic-cards ....... [3\u21922\u21921 col; minmax(0,1fr)]',
      '        |           +-- div#forensic-charts-stack',
      '        |                 +-- div (flex/pair rows, chart shells)',
      '        +-- details#economic-collapse',
      '        |     +-- div.forensic-inner',
      '        |           +-- div.forensic-charts-stack [flex 1:2 rows etc]',
      '        +-- div#report-modal-overlay',
      '        +-- div#day-picker-row',
      '        +-- div#main-charts-scope-wrap',
      '        +-- details#token-stats-collapse',
      '        |     +-- div.forensic-inner',
      '        |           +-- div#cards ............. [KPI 6\u21924\u21923\u21922\u21921 col; token-stats-kpis]',
      '        |           +-- div#main-charts-wrap',
      '        |           |     +-- div#charts ....... [2-3 col charts]',
      '        |           |     +-- div#charts-host-sub [charts-pair]',
      '        |           +-- div#token-stats-daily-detail',
      '        +-- details#user-profile-collapse',
      '        |     +-- div.forensic-inner',
      '        |           +-- div#user-profile-charts [3-col charts row]',
      '        +-- details#budget-collapse',
      '        |     +-- div.forensic-inner',
      '        |           +-- div#budget-cards ....... [6\u21924\u21923\u21922\u21921 col]',
      '        |           +-- div#budget-charts / div#budget-trend-row',
      '        +-- details#proxy-collapse',
      '              +-- div.forensic-inner.proxy-inner',
      '                    +-- div#proxy-cards ......... [6\u21924\u21923\u21922\u21921 col]',
      '                    +-- div.proxy-charts-grid-3',
      '                    +-- div.proxy-charts-grid (x2 rows)',
      '                    +-- div.chart-box (efficiency block)',
      '                    +-- div.efficiency-small-multiples [3 col]',
      '+------------------------------------------------------------------+',
      '| (Modals / slideouts / template builder live outside this tree)  |',
      '+------------------------------------------------------------------+'
    ].join('\n');
    var layoutSpanPalette = [];
    for (var ps = 12; ps >= 1; ps--) layoutSpanPalette.push(ps);
    return {
      version: 1,
      layoutSpanPalette: layoutSpanPalette,
      divGeruestAscii: divGeruestAscii,
      topChromePipe: topChromePipe,
      layoutGrid: {
        selector: '#layout-grid',
        className: 'layout-grid',
        outerGridColumns: 12,
        cssNote:
          'grid-template-columns: repeat(12,1fr); children [data-span] use --span; max-width 900px forces span 12 per child'
      },
      layoutGridChildrenPipe: childPipe,
      fullPipe: fullPipe,
      sections: sections,
      templateBuilderNote:
        '#tb-canvas uses a uniform 12-col sub-grid per section; the live dashboard mixes grids (2/3/auto-fit) and flex inside each details block.',
      scaffoldPlan: TB_PAGE_SCAFFOLD_PLAN,
      toShallowDivPipe: function () {
        return (
          'header|div#filter-bar|div#layout-grid>' +
          sections
            .map(function (s) {
              return s.tag + '#' + s.id;
            })
            .join('|')
        );
      }
    };
  }

  /**
   * Build default flat widgets[] from TB_PAGE_SCAFFOLD_PLAN + Registry.
   * Same flatten logic as saveTemplateFromBuilder but without UI dependency.
   */
  function buildDefaultWidgetsFromScaffold() {
    var nested = tbNestedModelFromPageScaffold();
    if (!nested?.length) return null;
    var flatW = [];
    var regSv = window.__widgetRegistry;
    for (var nSec of nested) {
      flatW.push({ id: nSec.id, span: nSec.span || 12 });
      var ch = nSec.children || [];
      for (var ci = 0; ci < ch.length; ci++) {
        var chEnt = ch[ci];
        if (tbIsLayoutBlock(chEnt)) {
          var nestedOut = [];
          var innSv = chEnt.children || [];
          for (var innE of innSv) {
            var idef = regSv?.findChart ? regSv.findChart(innE.id) : null;
            if (idef && (idef.kind === 'chip' || idef.engine !== 'echarts')) continue;
            nestedOut.push({ id: innE.id, span: innE.span || 6 });
          }
          if (nestedOut.length) {
            flatW.push({
              type: 'layout',
              span: chEnt.span || 12,
              section: nSec.id,
              bid: chEnt.bid || chEnt.id || 'tbblk_s' + ci,
              nested: nestedOut
            });
          }
          continue;
        }
        var cdef = regSv?.findChart ? regSv.findChart(chEnt.id) : null;
        if (cdef && (cdef.kind === 'chip' || cdef.engine !== 'echarts')) continue;
        flatW.push({ id: chEnt.id, span: chEnt.span || 6, type: 'chart', section: nSec.id });
      }
    }
    // Append optional top-level sections when they exist in both DOM and registry.
    var optionalSectionIds = ['cost-intelligence', 'security-postures'];
    for (var pii = 0; pii < optionalSectionIds.length; pii++) {
      var pid = optionalSectionIds[pii];
      var pSec = regSv?.findSection ? regSv.findSection(pid) : null;
      if (!pSec?.domId) continue;
      if (!document.getElementById(pSec.domId)) continue;
      // Skip if already included (shouldn't happen, but guard)
      var already = false;
      for (var fi2 = 0; fi2 < flatW.length; fi2++) {
        if (flatW[fi2].id === pid) { already = true; break; }
      }
      if (!already) flatW.push({ id: pid, span: 12 });
    }
    return flatW.length ? flatW : null;
  }

  // ── Public API ───────────────────────────────────────────────────

  window.__templateBuilder = {
    openTemplateBuilder: openTemplateBuilder,
    closeTemplateBuilder: closeTemplateBuilder,
    tbNestedModelFromPageScaffold: tbNestedModelFromPageScaffold,
    tbGetDesktopPageScaffold: tbGetDesktopPageScaffold,
    tbIsLayoutBlock: tbIsLayoutBlock,
    buildDefaultWidgetsFromScaffold: buildDefaultWidgetsFromScaffold,
    getAvailableTemplates: tbBuilderTemplates,
    getCurrentDashboardTemplate: tbCurrentDashboardTemplate,
    bindTemplateBuilder: bindTemplateBuilder,
    setTemplateHelpers: setTemplateHelpers
  };
})();
