/**
 * @asseris-module       Dispatcher Init
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/dispatcher-init.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Widget Dispatcher — Init submodule.
 *
 * Handles initialization, disclosure toggle binding, and full init with i18n/sidebar/UI setup.
 * Exposes window.__dispatcherInit for delegation from widget-dispatcher.js.
 */
'use strict';

(function (global) {

  var _initialized = false;

  // ── Internal helpers (delegate to submodules) ──────────────────

  function getRegistry() {
    return global.__widgetRegistry || null;
  }

  function resizeAll() {
    if (global.__widgetDispatcher) global.__widgetDispatcher.resizeAll();
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

  function reconcileHiddenSectionsWithWidgets() {
    return global.__dispatcherVisibility
      ? global.__dispatcherVisibility.reconcileHiddenSectionsWithWidgets()
      : false;
  }

  function applyGridLayout() {
    if (global.__dispatcherLayout) global.__dispatcherLayout.applyGridLayout();
  }

  function applyOrder() {
    if (global.__dispatcherLayout) global.__dispatcherLayout.applyOrder();
  }

  function expandVisibleSectionPanels() {
    if (global.__dispatcherLayout) global.__dispatcherLayout.expandVisibleSectionPanels();
  }

  // -- Sidebar delegation stubs (settings-sidebar.js) --------
  function bindSidebarEvents() {
    if (global.__settingsSidebar) global.__settingsSidebar.bindSidebarEvents();
  }

  function initGatewayBadge() { if (window.__gatewayPanel) window.__gatewayPanel.initGatewayBadge(); }

  // ── i18n helper (safe fallback) ─────────────────────────────────

  function _t(key) {
    // Try dashboard.client.js t() first
    if (typeof global.t === 'function') return global.t(key);
    // Fallback: read directly from inline i18n bundles
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

  // ── Disclosure Toggle Auto-Binding ──────────────────────────────

  function bindDisclosureToggles() {
    var reg = getRegistry();
    if (!reg) return;
    var sections = reg.sections;
    for (var sec of sections) {
      if (!sec.domId) continue;
      var det = document.getElementById(sec.domId);
      if (!det || det?.tagName !== 'DETAILS') continue;
      if (det.dataset.dispatcherBound) continue;
      det.dataset.dispatcherBound = '1';
      (function (sectionId) {
        det.addEventListener('toggle', function () {
          if (this.open) {
            setTimeout(function () { resizeAll(); }, 60);
            setTimeout(function () {
              resizeAll();
              // Re-render sections that may have initialized while closed (0x0 ECharts)
              var secReg = getRegistry();
              if (!secReg) return;
              for (var sr of secReg.sections) {
                if (sr.id !== sectionId || !sr.sectionRenderFn) continue;
                var rfName = sr.sectionRenderFn;
                var rf = global[rfName];
                if (typeof rf !== 'function') continue;
                if (rfName.startsWith('renderUserProfile')) {
                  var uctx = global.__dashboardState?.getSectionCtx('userProfile');
                  if (uctx) {
                    if (typeof global.renderUserProfile_versions === 'function') global.renderUserProfile_versions(uctx);
                    if (typeof global.renderUserProfile_entrypoints === 'function') global.renderUserProfile_entrypoints(uctx);
                    if (typeof global.renderUserProfile_releaseStability === 'function') global.renderUserProfile_releaseStability(uctx);
                  }
                }
              }
            }, 250);
          }
        });
      })(sec.id);
    }
  }

  // ── Init ────────────────────────────────────────────────────────

  function buildDefaultWidgetsFromScaffold() {
    return global.__templateBuilder ? global.__templateBuilder.buildDefaultWidgetsFromScaffold() : null;
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    // Persist prefs on page close/refresh (sendBeacon survives page unload)
    global.addEventListener('beforeunload', function () {
      if (global.__prefsStore) global.__prefsStore.savePrefsSync();
    });
    global.__prefsStore.loadPrefs();
    if (global.__prefsStore.migrateHiddenChartsLegacy()) global.__prefsStore.savePrefs();
    // Append any top-level sections that were added to the registry after the user's layout was saved.
    // Without this, newly registered sections remain invisible until the user resets their layout.
    (function () {
      var ws = global.__prefsStore.prefs?.widgets;
      var reg = global.__widgetRegistry;
      if (!Array.isArray(ws) || !ws.length || !reg?.sections) return;
      var knownIds = {};
      for (var wEntry of ws) knownIds[wEntry.id] = true;
      var added = false;
      for (var sec of reg.sections) {
        if (sec.parentSection) continue; // sub-sections managed by parent
        if (!knownIds[sec.id]) {
          ws.push({ id: sec.id, span: 12 });
          added = true;
        }
      }
      if (added) global.__prefsStore.savePrefs();
    })();
    // Append registry charts added after the user's layout was saved, into their
    // section's positional run. New SECTIONS auto-fill from the registry; a new
    // CHART inside an EXISTING section with an explicit chart run would otherwise
    // stay invisible until the user resets their layout. Purely additive (splice
    // in), guarded so a bad position can never drop or corrupt existing entries.
    (function () {
      try {
        const ws = global.__prefsStore.prefs?.widgets;
        const reg = global.__widgetRegistry;
        if (!Array.isArray(ws) || !ws.length || !reg?.sections) return;
        const present = {};
        for (const w of ws) {
          if (w.id && (w.type === 'chart' || !w.type)) present[w.id] = true;
          if (w.type === 'layout' && Array.isArray(w.nested)) {
            for (const ne of w.nested) { if (ne.id) present[ne.id] = true; }
          }
        }
        let added = false;
        for (const sec of reg.sections) {
          if (sec.parentSection || !Array.isArray(sec.charts)) continue;
          let secIdx = -1;
          for (let i = 0; i < ws.length; i++) {
            if ((ws[i].type || 'section') === 'section' && ws[i].id === sec.id) { secIdx = i; break; }
          }
          if (secIdx < 0) continue; // not in layout -> section-append / auto-fill covers it
          let runEnd = secIdx;
          let hasExplicit = false;
          for (let j = secIdx + 1; j < ws.length; j++) {
            const t = ws[j].type || 'section';
            if (t !== 'chart' && t !== 'layout') break;
            runEnd = j;
            hasExplicit = true;
          }
          if (!hasExplicit) continue; // empty run -> flat->nested auto-fills from registry
          for (const c of sec.charts) {
            if (!c.canvasId || c.kind === 'chip' || c.engine !== 'echarts' || present[c.id]) continue;
            const span = (c.size && c.size.cols === 2) ? 12 : 6;
            ws.splice(runEnd + 1, 0, { id: c.id, span: span, type: 'chart', section: sec.id });
            runEnd++;
            present[c.id] = true;
            added = true;
          }
        }
        if (added) global.__prefsStore.savePrefs();
      } catch (e) {
        window.appLogger?.warn('ui-widget-dispatcher', 'chart-append', 'fail', e?.message || e);
      }
    })();
    // Migrate prefs to v2 if needed (auch widgets: [] mit gueltigem order[])
    if ((!global.__prefsStore.prefs.widgets?.length) && global.__prefsStore.prefs.order?.length) {
      var migrated = global.__prefsStore.migrateTemplateV1toV2({ order: global.__prefsStore.prefs.order, hiddenSections: global.__prefsStore.prefs.hiddenSections });
      global.__prefsStore.setWidgets(migrated.widgets);
      global.__prefsStore.savePrefs();
    }
    // No widgets at all AND server had no saved layout -> generate from scaffold (same as TB "Load Default")
    if (!global.__prefsStore.prefs.widgets?.length && !global.__prefsStore.serverHasLayout()) {
      var scaffoldWidgets = buildDefaultWidgetsFromScaffold();
      if (scaffoldWidgets) {
        global.__prefsStore.setWidgets(scaffoldWidgets);
        global.__prefsStore.savePrefs();
        console.info('[widget-dispatcher] scaffold default applied — %d widgets generated from global.__templateBuilder?.TB_PAGE_SCAFFOLD_PLAN', scaffoldWidgets.length);
        if (console.table) console.table(scaffoldWidgets.map(function(w) { return { id: w.id || '—', type: w.type || 'section', span: w.span, section: w.section || '' }; }));
      } else {
        window.appLogger?.warn('ui-widget-dispatcher', 'scaffold', 'fail', 'no registry or no scaffold plan');
      }
    }
    if (global.__prefsStore.prefs.widgets?.length) {
      if (global.__prefsStore.syncPrefsOrderFromWidgets()) global.__prefsStore.savePrefs();
      if (reconcileHiddenSectionsWithWidgets()) global.__prefsStore.savePrefs();
      applyGridLayout();
      expandVisibleSectionPanels();
    } else {
      applyVisibility();
      applyOrder();
    }
    applyAllChartVisibility();
    bindDisclosureToggles();
  }

  // ── Enhanced Init ───────────────────────────────────────────────

  function initFull() {
    init();
    bindSidebarEvents();
    // Sidebar title + section titles via i18n (set once DOM is ready)
    var titleEl = document.getElementById('sidebar-title');
    if (titleEl) titleEl.textContent = _t('settingsTitle');
    var titles = {
      'sidebar-layout-title': 'settingsLayoutTitle',
      'sidebar-templates-title': 'settingsTemplatesTitle',
      'sidebar-settings-title': 'settingsSettingsTitle',
      'sidebar-tools-title': 'settingsToolsTitle',
      'sidebar-open-explorer': 'settingsOpenExplorer',
      'sidebar-export-title': 'settingsExportTitle',
      'sidebar-layout-edit': 'settingsEditLayout',
      'sidebar-layout-reset': 'settingsResetLayout',
      'sidebar-export-jsonl': 'settingsExportJsonl',
      'sidebar-export-template': 'settingsExportTemplate',
      'sidebar-import-template': 'settingsImportTemplate',
      'settings-nav-btn': 'settingsBtnTitle',
      'sidebar-open-user-settings': 'settingsUserSettings',
      'sidebar-build-template': 'tbBuild'
    };
    for (var id in titles) {
      var el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'BUTTON' && id === 'settings-nav-btn') el.title = _t(titles[id]);
        else el.textContent = _t(titles[id]);
      }
    }
    // Filter bar toggle
    var filterBtn = document.getElementById('filter-toggle-btn');
    var filterBar = document.getElementById('filter-bar');
    if (filterBtn && filterBar && !filterBtn.dataset.bound) {
      filterBtn.dataset.bound = '1';
      filterBtn.textContent = _t('filterToggle');
      filterBtn.addEventListener('click', function () {
        filterBar.classList.toggle('is-open');
        filterBtn.classList.toggle('is-active');
      });
    }
    // Bind template builder (modal buttons + sidebar button)
    if (window.__templateBuilder) window.__templateBuilder.bindTemplateBuilder();
    // Edit layout: Bearbeiten -> Speichern while editing; Save persists and exits edit mode
    var editBtn = document.getElementById('sidebar-layout-edit');
    if (editBtn && !editBtn.dataset.bound) {
      editBtn.dataset.bound = '1';
      editBtn.addEventListener('click', function () {
        var tree = document.querySelector('.widget-tree');
        if (!tree) return;
        var wasEdit = tree.classList.contains('widget-tree--edit');
        var secLis = tree.querySelectorAll('li.widget-tree-item[data-section]');
        var si;
        if (wasEdit) {
          global.__prefsStore.savePrefs();
          if (global.__layoutTree) global.__layoutTree.layoutTreeEditMode = false;
          tree.classList.remove('widget-tree--edit');
          editBtn.classList.remove('is-active');
          editBtn.textContent = _t('settingsEditLayout');
          for (si = 0; si < secLis.length; si++) secLis[si].setAttribute('draggable', 'false');
        } else {
          if (global.__layoutTree) global.__layoutTree.layoutTreeEditMode = true;
          tree.classList.add('widget-tree--edit');
          editBtn.classList.add('is-active');
          editBtn.textContent = _t('settingsSaveLayout');
          for (si = 0; si < secLis.length; si++) secLis[si].setAttribute('draggable', 'true');
        }
        if (global.__layoutTree) global.__layoutTree.applyWidgetTreeCheckboxLock(tree, global.__layoutTree.layoutTreeEditMode);
      });
    }
    // Version — set immediately from inline global
    var verEl = document.getElementById('sidebar-version');
    if (verEl && global.__APP_VERSION) {
      verEl.textContent = global.__APP_VERSION;
    }
    // Release Notes button
    var relBtn = document.getElementById('sidebar-release-btn');
    if (relBtn && !relBtn.dataset.bound) {
      relBtn.dataset.bound = '1';
      relBtn.addEventListener('click', function () {
        // Try direct expand button first, fall back to opening modal directly
        var origBtn = document.getElementById('live-rel-expand-btn');
        if (origBtn) { origBtn.click(); return; }
        var relOverlay = document.getElementById('release-modal-overlay');
        var relBody = document.getElementById('release-modal-body');
        var relClose = document.getElementById('release-modal-close');
        if (!relOverlay) return;
        relOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        // Wire close if not yet
        if (relClose && !relClose.dataset.bound) {
          relClose.dataset.bound = '1';
          relClose.addEventListener('click', function () {
            relOverlay.classList.remove('is-open');
            document.body.style.overflow = '';
          });
          relOverlay.addEventListener('click', function (e) {
            if (e.target === relOverlay) {
              relOverlay.classList.remove('is-open');
              document.body.style.overflow = '';
            }
          });
        }
        // Load content if not yet
        if (relBody && !relBody.dataset.loaded) {
          relBody.innerHTML = '<p style="color:#8C6A3F;font-size:.75rem">Loading releases...</p>';
          var xhr = new XMLHttpRequest();
          xhr.open('GET', '/assets/release-history.json', true);
          xhr.onload = function () {
            if (xhr.status !== 200) { relBody.innerHTML = '<p style="color:#ef4444">Failed to load releases</p>'; return; }
            try {
              var releases = JSON.parse(xhr.responseText);
              if (!releases.length) { relBody.innerHTML = '<p style="color:#8C6A3F">No releases found</p>'; return; }
              var html = '';
              for (var i = 0; i < releases.length; i++) {
                var rel = releases[i];
                var rDate = rel.published_at ? rel.published_at.slice(0, 10) : '';
                html += '<details class="release-modal-item"' + (i === 0 ? ' open' : '') + '>';
                html += '<summary class="release-modal-item-head"><span class="rel-tag">' + rel.tag_name + '</span> <span class="rel-date">' + rDate + '</span></summary>';
                var rawBody = (rel.body || '').replace(/^## .+\n?/m, '');
                var bodyHtml = marked.parse(rawBody);
                html += '<div class="release-modal-item-body">' + bodyHtml + '</div></details>';
              }
              relBody.innerHTML = html;
              relBody.dataset.loaded = '1';
            } catch (e) { relBody.innerHTML = '<p style="color:#ef4444">Parse error</p>'; }
          };
          xhr.send();
        }
      });
    }
    // Gateway badge — fetch status + bind click toggle
    initGatewayBadge();
  }

  // ── Expose ─────────────────────────────────────────────────────

  global.__dispatcherInit = {
    init: init,
    initFull: initFull,
    bindDisclosureToggles: bindDisclosureToggles
  };

})(typeof window !== 'undefined' ? window : this);
