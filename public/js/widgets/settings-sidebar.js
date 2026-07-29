/**
 * @asseris-module       Settings Sidebar
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/settings-sidebar.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * Settings Sidebar — sidebar open/close, settings sections, user settings modal.
 *
 * Extracted from widget-dispatcher.js as part of Phase 11b modularization.
 * Responsible for:
 *   - Sidebar open/close/restore
 *   - Stats section (mini charts in sidebar)
 *   - Settings section (lang + plan clone)
 *   - Templates section (apply / delete)
 *   - Tools section (explorer button)
 *   - User Settings Modal (lang, plan, profile, PAT, marketplace)
 *
 * Exposes: window.__settingsSidebar
 * Calls out: window.__widgetDispatcher.*, window.__prefsStore.*, window.__layoutTree.*
 */
(function (global) {
  // ── State ──────────────────────────────────────────────────────────
  var _sidebarOpen = false;
  var _sidebarEventsBound = false;
  var _sidebarRestoreScheduled = false;
  var _statsCharts = {};
  var _userSettingsOrigParents = {};

  // ── Logging ────────────────────────────────────────────────────────
  function logErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-widget-settings', 'catch', 'optional_err', err?.message == null ? err : err.message);
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

  // ── Sidebar Open / Close ───────────────────────────────────────────

  function toggleSidebar(force) {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    if (typeof force === 'boolean' && force === _sidebarOpen) return;
    _sidebarOpen = typeof force === 'boolean' ? force : !_sidebarOpen;
    sb.classList.toggle('is-open', _sidebarOpen);
    document.body.classList.toggle('sidebar-open', _sidebarOpen);
    var btn = document.getElementById('settings-nav-btn');
    if (btn) btn.classList.toggle('is-active', _sidebarOpen);
    // Match sidebar-head height to top-bar
    var topBar = document.querySelector('.top-bar');
    var sbHead = document.querySelector('.sidebar-head');
    if (topBar && sbHead) sbHead.style.minHeight = topBar.offsetHeight + 'px';

    if (_sidebarOpen) {
      if (global.__layoutTree) global.__layoutTree.renderWidgetTree();
      renderSettingsSection();
      renderTemplatesSection();
      bindToolsSection();
      if (global.__exportPanel) global.__exportPanel.renderExportSection();
      bindUserSettingsModal();
      if (global.__templateBuilder) global.__templateBuilder.bindTemplateBuilder();
      setTimeout(function () {
        if (global.__widgetDispatcher) global.__widgetDispatcher.resizeAll();
      }, 250);
    }
    try { localStorage.setItem('cud_sidebar_open', _sidebarOpen ? '1' : '0'); } catch (error) { logErr(error); }
  }

  function bindSidebarEvents() {
    if (_sidebarEventsBound) return;
    _sidebarEventsBound = true;
    var btn = document.getElementById('settings-nav-btn');
    if (btn) btn.addEventListener('click', function () { toggleSidebar(); });
    var close = document.getElementById('sidebar-close');
    if (close) close.addEventListener('click', function () { toggleSidebar(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _sidebarOpen) toggleSidebar(false);
    });
    try {
      if (localStorage.getItem('cud_sidebar_open') === '1' && !_sidebarRestoreScheduled) {
        _sidebarRestoreScheduled = true;
        setTimeout(function () { toggleSidebar(true); }, 100);
      }
    } catch (error) { logErr(error); }
  }

  // ── Stats Section (mini sidebar charts) ───────────────────────────

  function renderStatsSection() {
    var body = document.getElementById('sidebar-stats-body');
    if (!body) return;
    if (!body.dataset.built) {
      body.dataset.built = '1';
      body.innerHTML =
        '<div id="sb-user-versions" style="width:100%;height:220px"></div>' +
        '<div id="sb-user-entrypoints" style="width:100%;height:220px;margin-top:12px"></div>' +
        '<div id="sb-user-stability" style="width:100%;height:220px;margin-top:12px"></div>';
    }
    if (typeof echarts === 'undefined') return;
    var data = window.__dashboardState.getData();
    if (!data) return;
    var days = typeof global.getFilteredDays === 'function' ? global.getFilteredDays(data.days) : data.days || [];
    if (!days.length) return;
    var relStab = data.release_stability || null;

    var verEl = document.getElementById('sb-user-versions');
    if (verEl) {
      if (!_statsCharts.versions) _statsCharts.versions = echarts.init(verEl, null, { renderer: 'canvas' });
      var verCounts = {};
      for (var dayV of days) {
        var dv = dayV.versions;
        if (!dv) continue;
        for (var vk in dv) verCounts[vk] = (verCounts[vk] || 0) + dv[vk];
      }
      var verLabels = Object.keys(verCounts).sort(function (a, b) { return verCounts[a] - verCounts[b]; });
      _statsCharts.versions.setOption({
        animation: false,
        grid: { left: 100, right: 16, top: 8, bottom: 20 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'value', axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'category', data: verLabels, axisLabel: { color: '#A0875E', fontSize: 10 } },
        series: [{ type: 'bar', data: verLabels.map(function (k) { return verCounts[k]; }), itemStyle: { color: 'rgba(184,145,90,0.7)' } }]
      }, true);
    }

    var epEl = document.getElementById('sb-user-entrypoints');
    if (epEl) {
      if (!_statsCharts.entrypoints) _statsCharts.entrypoints = echarts.init(epEl, null, { renderer: 'canvas' });
      var epCounts = {};
      for (var dayE of days) {
        var de = dayE.entrypoints;
        if (!de) continue;
        for (var ek in de) epCounts[ek] = (epCounts[ek] || 0) + de[ek];
      }
      var epLabels = Object.keys(epCounts).sort(function (a, b) { return epCounts[a] - epCounts[b]; });
      _statsCharts.entrypoints.setOption({
        animation: false,
        grid: { left: 100, right: 16, top: 8, bottom: 20 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'value', axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'category', data: epLabels, axisLabel: { color: '#A0875E', fontSize: 10 } },
        series: [{ type: 'bar', data: epLabels.map(function (k) { return epCounts[k]; }), itemStyle: { color: 'rgba(6,182,212,0.7)' } }]
      }, true);
    }

    var rsEl = document.getElementById('sb-user-stability');
    if (rsEl && relStab) {
      if (!_statsCharts.stability) _statsCharts.stability = echarts.init(rsEl, null, { renderer: 'canvas' });
      var rsLabels = [], rsGood = [], rsBad = [];
      for (var r of relStab) {
        rsLabels.push(r.version || '?');
        rsGood.push(r.good || 0);
        rsBad.push(r.bad || 0);
      }
      _statsCharts.stability.setOption({
        animation: false,
        grid: { left: 100, right: 16, top: 8, bottom: 20 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'value', axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
        yAxis: { type: 'category', data: rsLabels, axisLabel: { color: '#A0875E', fontSize: 10 } },
        series: [
          { name: 'Good', type: 'bar', stack: 's', data: rsGood, itemStyle: { color: 'rgba(34,197,94,0.7)' } },
          { name: 'Bad', type: 'bar', stack: 's', data: rsBad, itemStyle: { color: 'rgba(239,68,68,0.7)' } }
        ]
      }, true);
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        var wd = global.__widgetDispatcher;
        if (wd) {
          wd.resizeChartOnDomId('sb-user-versions');
          wd.resizeChartOnDomId('sb-user-entrypoints');
          wd.resizeChartOnDomId('sb-user-stability');
        }
      });
    }
  }

  // ── Settings Section (Language + Plan) ────────────────────────────

  function renderSettingsSection() {
    var langSlot = document.getElementById('sidebar-lang-slot');
    var planSlot = document.getElementById('sidebar-plan-slot');
    if (langSlot && !langSlot.dataset.filled) {
      langSlot.dataset.filled = '1';
      var origLang = document.getElementById('lang-switch-wrap');
      if (origLang) {
        langSlot.innerHTML = '<label>' + _t('settingsLangLabel') + '</label>';
        var clone = origLang.cloneNode(true);
        clone.id = 'sidebar-lang-switch';
        clone.style.display = 'flex';
        clone.style.gap = '4px';
        var cloneLabel = clone.querySelector('.lang-switch-label');
        if (cloneLabel) cloneLabel.remove();
        langSlot.appendChild(clone);
        var cloneBtnsForId = clone.querySelectorAll('.lang-btn');
        for (var clBtn of cloneBtnsForId) clBtn.removeAttribute('id');
        var btns = clone.querySelectorAll('.lang-btn');
        for (var btn of btns) {
          btn.addEventListener('click', function () {
            var origBtn = document.getElementById('lang-' + this.dataset.lang);
            if (origBtn) origBtn.click();
          });
        }
      }
    }
    if (planSlot && !planSlot.dataset.filled) {
      planSlot.dataset.filled = '1';
      var origPlan = document.getElementById('plan-select');
      if (origPlan) {
        planSlot.innerHTML = '<label>' + _t('settingsPlanLabel') + '</label>';
        var planClone = origPlan.cloneNode(true);
        planClone.id = 'sidebar-plan-select';
        planSlot.appendChild(planClone);
        planClone.value = origPlan.value;
        planClone.addEventListener('change', function () {
          origPlan.value = this.value;
          origPlan.dispatchEvent(new Event('change'));
        });
      }
    }
  }

  // ── Templates Section ──────────────────────────────────────────────

  function renderTemplatesSection() {
    var body = document.getElementById('sidebar-templates-body');
    if (!body) return;
    var ps = global.__prefsStore;
    var all = global.__templateBuilder?.getAvailableTemplates
      ? global.__templateBuilder.getAvailableTemplates()
      : (ps ? ps.getAllTemplates() : []);
    var html = '';
    var ordered = [];
    var navOrder = global.__navModel?.SURFACE_ORDER || [];
    for (var ai = 0; ai < all.length; ai++) {
      if (all[ai].builtin && !all[ai].surfaceId) ordered.push({ tpl: all[ai], originalIndex: ai, group: 'all' });
    }
    for (var noi = 0; noi < navOrder.length; noi++) {
      for (var api = 0; api < all.length; api++) {
        if (all[api].surfaceId === navOrder[noi]) ordered.push({ tpl: all[api], originalIndex: api, group: navOrder[noi] });
      }
    }
    for (var li = 0; li < all.length; li++) {
      if (!all[li].builtin && !all[li].surfaceId) ordered.push({ tpl: all[li], originalIndex: li, group: 'legacy' });
    }
    var lastGroup = '';
    for (var i = 0; i < ordered.length; i++) {
      var entry = ordered[i];
      var tpl = entry.tpl;
      if (entry.group !== lastGroup) {
        var surface = global.__navModel?.getSurface ? global.__navModel.getSurface(entry.group) : null;
        var groupLabel = surface ? surface.label : (entry.group === 'legacy' ? _t('settingsTemplateLegacy') : _t('settingsTemplateAllPages'));
        html += '<div class="template-page-group">' + escT(groupLabel) + '</div>';
        lastGroup = entry.group;
      }
      var activeName = ps ? ps.getActiveTemplateName(tpl.surfaceId || '') : '';
      var isActive = tpl.name === activeName;
      html += '<div class="template-item' + (isActive ? ' is-active' : '') + '" data-tpl-idx="' + entry.originalIndex + '">';
      html += '<span class="template-item-name">' + escT(tpl.name) +
        (tpl.builtin ? ' <span style="color:#3D3830;font-size:.6rem">(' + _t('settingsTemplateBuiltin') + ')</span>' : '') + '</span>';
      html += '<span class="template-item-actions">';
      html += '<button type="button" data-tpl-action="apply" data-tpl-idx="' + entry.originalIndex + '" title="' + _t('settingsTemplateApply') + '">&#x25B6;</button>';
      if (!tpl.builtin) {
        html += '<button type="button" data-tpl-action="delete" data-tpl-idx="' + entry.originalIndex + '" title="' + _t('settingsTemplateDelete') + '">&#x2715;</button>';
      }
      html += '</span></div>';
    }
    html += '<div style="margin-top:10px;display:flex;gap:6px"></div>';
    body.innerHTML = html;

    if (!body.dataset.bound) {
      body.dataset.bound = '1';
      body.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tpl-action]');
        if (!btn) return;
        var action = btn.dataset.tplAction;
        var idx = Number.parseInt(btn.dataset.tplIdx, 10);
        var psNow = global.__prefsStore;
        var all2 = global.__templateBuilder?.getAvailableTemplates
          ? global.__templateBuilder.getAvailableTemplates()
          : (psNow ? psNow.getAllTemplates() : []);
        if (idx < 0 || idx >= all2.length) return;
        if (action === 'apply') {
          var wd = global.__widgetDispatcher;
          if (wd && wd.applyTemplate) wd.applyTemplate(all2[idx]);
          renderTemplatesSection();
        } else if (action === 'delete') {
          var userTpls = psNow ? psNow.loadTemplates() : [];
          var userIdx = -1;
          for (var uti = 0; uti < userTpls.length; uti++) {
            if (userTpls[uti].name === all2[idx].name &&
                (userTpls[uti].surfaceId || '') === (all2[idx].surfaceId || '')) {
              userIdx = uti;
              break;
            }
          }
          if (userIdx >= 0 && userIdx < userTpls.length) {
            userTpls.splice(userIdx, 1);
            if (psNow) psNow.saveTemplates(userTpls);
            if (psNow && psNow.getActiveTemplateName(all2[idx].surfaceId || '') === all2[idx].name) {
              psNow.setActiveTemplateName('', all2[idx].surfaceId || '');
            }
            renderTemplatesSection();
          }
        }
      });
    }
  }

  // ── Tools Section ──────────────────────────────────────────────────

  function bindToolsSection() {
    var explorerBtn = document.getElementById('sidebar-open-explorer');
    if (explorerBtn && !explorerBtn.dataset.bound) {
      explorerBtn.dataset.bound = '1';
      explorerBtn.addEventListener('click', function () {
        var origBtn = document.getElementById('dev-cache-files-open') || document.getElementById('live-cache-files-open');
        if (origBtn) origBtn.click();
      });
    }
  }

  // ── User Settings Modal ────────────────────────────────────────────

  function _saveDomPos(el, key) {
    if (!el) return;
    _userSettingsOrigParents[key] = { parent: el.parentNode, next: el.nextSibling };
  }

  function _restoreDomPos(el, key) {
    var info = _userSettingsOrigParents[key];
    if (!el || !info) return;
    if (info.next && info.next.parentNode === info.parent) info.parent.insertBefore(el, info.next);
    else if (info.parent) info.parent.appendChild(el);
  }

  function populateLangSection() {
    var body = document.getElementById('us-lang-body');
    if (!body || body.dataset.filled) return;
    body.dataset.filled = '1';
    var langs = ['de', 'en', 'ko'];
    var labels = { de: 'DE', en: 'EN', ko: 'KO' };
    var currentLang = (typeof global.getLang === 'function') ? global.getLang() : (localStorage.getItem('usageDashboardLang') || 'en');
    var html = '<div class="us-lang-row">';
    for (var l of langs) {
      html += '<button type="button" class="lang-btn' + (l === currentLang ? ' active' : '') + '" data-lang="' + l + '">' + labels[l] + '</button>';
    }
    html += '<span class="us-lang-saved" id="us-lang-indicator">' + _t('usPlanActive') + ': ' + (labels[currentLang] || 'EN') + '</span>';
    html += '</div>';
    body.innerHTML = html;
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lang]');
      if (!btn) return;
      var origBtn = document.getElementById('lang-' + btn.dataset.lang);
      if (origBtn) origBtn.click();
      var all = body.querySelectorAll('.lang-btn');
      for (var ab of all) ab.classList.remove('active');
      btn.classList.add('active');
      var indicator = document.getElementById('us-lang-indicator');
      if (indicator) indicator.textContent = _t('usPlanActive') + ': ' + btn.textContent;
    });
  }

  function populatePlanSection() {
    var body = document.getElementById('us-plan-body');
    if (!body || body.dataset.filled) return;
    body.dataset.filled = '1';
    var plans = { pro: 'Pro', max5: 'MAX 5', max20: 'MAX 20', api: 'API' };
    // Historical M(t) correction only compares quota-backed subscriptions.
    // API is a current billing mode, not a previous quota-plan baseline.
    var previousPlans = { pro: 'Pro', max5: 'MAX 5', max20: 'MAX 20' };
    var current = localStorage.getItem('cud_plan') || 'pro';
    if (!plans[current]) current = 'pro';
    var html = '<div class="us-plan-row">';
    html += '<select class="plan-select" id="us-plan-select">';
    for (var k in plans) {
      html += '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + plans[k] + '</option>';
    }
    html += '</select>';
    html += '<span class="us-plan-active" id="us-plan-badge">' + _t('usPlanActive') + '</span>';
    html += '</div>';
    html += '<p class="us-plan-info">' + _t('usPlanInfo') + '</p>';
    // Plan-change history: manual fallback until cc_plan detected from NDJSON
    var savedChangeDate = localStorage.getItem('cud_plan_change_date') || '';
    var savedPrevPlan = localStorage.getItem('cud_plan_previous') || '';
    if (!previousPlans[savedPrevPlan]) savedPrevPlan = '';
    html += '<div style="margin-top:10px;border-top:1px solid rgba(184,145,90,0.2);padding-top:8px">';
    html += '<div style="font-size:.72rem;color:#A0875E;margin-bottom:4px">Plan upgrade date (for historical M(t) correction)</div>';
    html += '<div style="display:flex;gap:6px;align-items:center">';
    html += '<select id="us-plan-prev-select" style="font-size:.75rem;background:#1a1d24;color:#EFE7D6;border:1px solid rgba(184,145,90,0.3);border-radius:4px;padding:2px 4px">';
    for (var pk in previousPlans) {
      html += '<option value="' + pk + '"' + (pk === (savedPrevPlan || 'max5') ? ' selected' : '') + '>' + previousPlans[pk] + '</option>';
    }
    html += '</select>';
    html += '<span style="color:#6B7280;font-size:.72rem">→ upgraded on</span>';
    html += '<input type="date" id="us-plan-change-date" value="' + savedChangeDate + '" style="font-size:.75rem;background:#1a1d24;color:#EFE7D6;border:1px solid rgba(184,145,90,0.3);border-radius:4px;padding:2px 4px">';
    html += '<button id="us-plan-change-save" style="font-size:.72rem;background:rgba(184,145,90,0.2);color:#D4AF7F;border:1px solid rgba(184,145,90,0.4);border-radius:4px;padding:2px 8px;cursor:pointer">Save</button>';
    html += '</div>';
    html += '<div id="us-plan-change-status" style="font-size:.7rem;color:#6B7280;margin-top:3px">';
    if (savedChangeDate) {
      html += savedPrevPlan.toUpperCase() + ' until ' + savedChangeDate + ' (manual fallback)';
    } else {
      html += 'Not set — cc_plan auto-detected from gateway NDJSON when available';
    }
    html += '</div></div>';
    body.innerHTML = html;
    var sel = document.getElementById('us-plan-select');
    if (sel) {
      sel.addEventListener('change', function () {
        var origPlan = document.getElementById('plan-select');
        if (origPlan) { origPlan.value = this.value; origPlan.dispatchEvent(new Event('change')); }
        var sidebarPlan = document.getElementById('sidebar-plan-select');
        if (sidebarPlan) sidebarPlan.value = this.value;
      });
    }
    var saveBtn = document.getElementById('us-plan-change-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var dateVal = (document.getElementById('us-plan-change-date') || {}).value || '';
        var prevVal = (document.getElementById('us-plan-prev-select') || {}).value || '';
        if (dateVal) {
          localStorage.setItem('cud_plan_change_date', dateVal);
          localStorage.setItem('cud_plan_previous', prevVal);
          var st = document.getElementById('us-plan-change-status');
          if (st) st.textContent = prevVal.toUpperCase() + ' until ' + dateVal + ' — saved. Reload to apply.';
        } else {
          localStorage.removeItem('cud_plan_change_date');
          localStorage.removeItem('cud_plan_previous');
          var st2 = document.getElementById('us-plan-change-status');
          if (st2) st2.textContent = 'Cleared — using auto-detect only.';
        }
      });
    }
  }

  function populateSecurityPoliciesSection() {
    var body = document.getElementById('us-security-body');
    if (!body) return;
    body.innerHTML = '<div style="color:#A0875E;font-size:.75rem">Security classification uses the bundled read-only policy set.</div>';
  }

  var SP_CLIENTS = ['cursor', 'vscode', 'desktop', 'claude'];
  var SP_CLIENT_COL = { cursor: '#D4AF7F', vscode: '#D4AF7F', desktop: '#D4AF7F', claude: '#B8915A' };
  var SP_SEV_COL = { critical: '#ef4444', high: '#f59e0b', medium: '#B8915A' };

  function renderSecPolicyEditor(body, policies, useBuiltins) {
    var h = '<table id="sec-pol-table" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:.85rem">';
    h += '<colgroup><col style="width:34px"><col style="width:180px"><col style="width:90px"><col><col style="width:60px"><col style="width:70px">';
    for (var _c = 0; _c < 4; _c++) h += '<col style="width:50px">';
    h += '<col style="width:30px"></colgroup>';
    h += '<thead><tr style="border-bottom:2px solid #2A2D34">';
    h += '<th style="padding:8px 4px;color:#8C6A3F;font-size:.7rem;font-weight:600"></th>';
    h += '<th style="padding:8px 6px;color:#8C6A3F;font-size:.7rem;font-weight:600;text-align:left">ID</th>';
    h += '<th style="padding:8px 4px;color:#8C6A3F;font-size:.7rem;font-weight:600;text-align:center">Severity</th>';
    h += '<th style="padding:8px 6px;color:#8C6A3F;font-size:.7rem;font-weight:600;text-align:left">Pattern</th>';
    h += '<th style="padding:8px 4px;color:#8C6A3F;font-size:.7rem;font-weight:600;text-align:center">Scope</th>';
    h += '<th style="padding:8px 4px;color:#8C6A3F;font-size:.7rem;font-weight:600;text-align:center">Action</th>';
    for (var ci = 0; ci < SP_CLIENTS.length; ci++) {
      h += '<th style="padding:8px 0;font-size:.68rem;color:' + SP_CLIENT_COL[SP_CLIENTS[ci]] + ';font-weight:700;text-align:center" title="' + SP_CLIENTS[ci] + '">' + SP_CLIENTS[ci] + '</th>';
    }
    h += '<th></th></tr></thead>';
    h += '<tbody id="sec-pol-tbody">';
    for (var i = 0; i < policies.length; i++) h += spRow(policies[i]);
    h += '</tbody></table>';
    h += '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">';
    h += '<button id="sec-pol-add" style="padding:3px 10px;background:#2A2D34;color:#F7F3EC;border:1px solid #3D3830;border-radius:4px;font-size:.7rem;cursor:pointer">+ Add</button>';
    h += '<button id="sec-pol-reset" style="padding:3px 10px;background:#2A2D34;color:#f59e0b;border:1px solid #3D3830;border-radius:4px;font-size:.7rem;cursor:pointer">Reset</button>';
    h += '<span style="font-size:.65rem;color:#3D3830">' + policies.length + ' policies' + (useBuiltins ? ' (built-in)' : '') + '</span>';
    h += '<div style="flex:1"></div>';
    h += '<button id="sec-pol-save" style="padding:3px 14px;background:#B8915A;color:#fff;border:none;border-radius:4px;font-size:.7rem;cursor:pointer;font-weight:600">Save</button>';
    h += '</div>';
    h += '<div id="sec-pol-status" style="font-size:.65rem;margin-top:4px;color:#A0875E"></div>';
    body.innerHTML = h;

    document.getElementById('sec-pol-add').onclick = function () {
      var tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #1A1D24';
      tr.innerHTML = spRowCells({ id: 'new_policy', severity: 'medium', pattern: '', cmdOnly: true, enabled: true, action: 'detect' });
      document.getElementById('sec-pol-tbody').appendChild(tr);
    };
    document.getElementById('sec-pol-reset').onclick = function () {
      // Re-fetch from config (builtins always present via mergeDefaults)
      populateSecurityPoliciesSection();
    };
    document.getElementById('sec-pol-save').onclick = function () {
      var rows = document.querySelectorAll('#sec-pol-tbody tr');
      var result = [];
      for (var r of rows) {
        var idI = r.querySelector('.sp-id'), patI = r.querySelector('.sp-pat');
        if (!idI || !patI) continue;
        var id = idI.value.trim(), pat = patI.value.trim();
        if (!id || !pat) continue;
        var cbs = r.querySelectorAll('.sp-client:checked'), clients = [];
        for (var cb of cbs) clients.push(cb.value);
        var entry = { id: id, severity: r.querySelector('.sp-sev').value, pattern: pat, enabled: r.querySelector('.sp-enabled')?.checked !== false, action: r.querySelector('.sp-action')?.value || 'detect' };
        if (clients.length && clients.length < 4) entry.clients = clients;
        if (r.querySelector('.sp-scope')?.value === 'all') entry.cmdOnly = false;
        result.push(entry);
      }
      var st = document.getElementById('sec-pol-status');
      if (st) st.textContent = 'Saving...';
      if (st) {
        st.style.color = '#A0875E';
        st.textContent = 'Bundled policies are read-only in this dashboard.';
      }
    };
    body.addEventListener('click', function (ev) {
      var del = ev.target.closest('.sp-del');
      if (del) { var tr = del.closest('tr'); if (tr) tr.remove(); }
    });
  }

  function spRow(p) { return '<tr style="border-bottom:1px solid #1A1D24">' + spRowCells(p) + '</tr>'; }

  function spRowCells(p) {
    var en = p.enabled !== false ? ' checked' : '';
    var sc = SP_SEV_COL[p.severity] || '#B8915A';
    var ac = p.clients || [], allC = !ac.length;
    var c = '';
    c += '<td style="padding:8px 4px;text-align:center"><input type="checkbox" class="sp-enabled"' + en + ' style="cursor:pointer;width:16px;height:16px"></td>';
    c += '<td style="padding:8px 6px"><input class="sp-id" value="' + escT(p.id) + '" style="background:transparent;color:#F7F3EC;border:none;border-bottom:1px solid #2A2D34;font-size:.82rem;padding:2px 0;width:100%;outline:none"></td>';
    c += '<td style="padding:8px 4px;text-align:center"><select class="sp-sev" style="background:' + sc + '18;color:' + sc + ';border:1px solid ' + sc + '44;border-radius:10px;font-size:.72rem;padding:2px 8px;font-weight:600;cursor:pointer;-webkit-appearance:none;text-align:center;width:100%">';
    for (var s of ['critical', 'high', 'medium']) c += '<option value="' + s + '"' + (p.severity === s ? ' selected' : '') + '>' + s.toUpperCase() + '</option>';
    c += '</select></td>';
    c += '<td style="padding:8px 6px"><input class="sp-pat" value="' + escT(p.pattern) + '" style="background:transparent;color:#EFE7D6;border:none;border-bottom:1px solid #2A2D34;font-size:.8rem;padding:2px 0;width:100%;font-family:ui-monospace,monospace;outline:none" title="' + escT(p.pattern) + '"></td>';
    c += '<td style="padding:8px 4px;text-align:center"><select class="sp-scope" style="background:transparent;color:#A0875E;border:none;font-size:.72rem;cursor:pointer">';
    c += '<option value="cmd"' + (p.cmdOnly !== false ? ' selected' : '') + '>cmd</option><option value="all"' + (p.cmdOnly === false ? ' selected' : '') + '>all</option></select></td>';
    var actCol = p.action === 'block' ? '#ef4444' : '#A0875E';
    c += '<td style="padding:8px 4px;text-align:center"><select class="sp-action" style="background:transparent;color:' + actCol + ';border:none;font-size:.72rem;cursor:pointer;font-weight:' + (p.action === 'block' ? '700' : '400') + '">';
    c += '<option value="detect"' + (p.action !== 'block' ? ' selected' : '') + '>detect</option><option value="block"' + (p.action === 'block' ? ' selected' : '') + '>block</option></select></td>';
    for (var i = 0; i < SP_CLIENTS.length; i++) {
      var cl = SP_CLIENTS[i], on = allC || ac.indexOf(cl) >= 0;
      c += '<td style="padding:8px 0;text-align:center"><input type="checkbox" class="sp-client" value="' + cl + '"' + (on ? ' checked' : '') + ' style="cursor:pointer;width:16px;height:16px;accent-color:' + SP_CLIENT_COL[cl] + '"></td>';
    }
    c += '<td style="padding:8px 0;text-align:center"><button class="sp-del" style="background:none;border:none;color:#3D3830;cursor:pointer;font-size:1rem;line-height:1">&times;</button></td>';
    return c;
  }

  function populatePatSection() {
    var body = document.getElementById('us-pat-body');
    if (!body) return;
    var patPanel = document.getElementById('github-token-panel');
    if (patPanel) { _saveDomPos(patPanel, 'pat'); body.appendChild(patPanel); patPanel.style.display = ''; }
  }

  function populateMarketplaceSection() {
    var body = document.getElementById('us-marketplace-body');
    if (!body) return;
    var mkRow = document.querySelector('.github-token-row');
    if (mkRow) {
      _saveDomPos(mkRow, 'marketplace');
      body.appendChild(mkRow);
      mkRow.style.display = '';
      var btn = mkRow.querySelector('#marketplace-extension-refresh');
      if (btn) btn.className = 'us-marketplace-btn';
    }
    var syncEl = document.getElementById('us-marketplace-sync-time');
    if (!syncEl) {
      syncEl = document.createElement('p');
      syncEl.className = 'us-marketplace-sync';
      syncEl.id = 'us-marketplace-sync-time';
      body.insertBefore(syncEl, body.firstChild);
    }
    var data = window.__dashboardState.getData();
    if (data?.versionTimeline?.marketplace_fetched_at) {
      syncEl.textContent = _t('usMarketplaceLastSync') + ': ' + new Date(data.versionTimeline.marketplace_fetched_at).toLocaleString();
    } else {
      syncEl.textContent = _t('usMarketplaceLastSync') + ': —';
    }
  }

  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function openUserSettingsModal() {
    var overlay = document.getElementById('user-settings-overlay');
    if (!overlay) return;
    var titleEl = document.getElementById('user-settings-modal-title');
    if (titleEl) titleEl.textContent = _t('userSettingsTitle');
    var sectionTitles = {
      'us-lang-title': 'usLangTitle',
      'us-plan-title': 'usPlanTitle', 'us-health-title': 'usHealthTitle',
      'us-pat-title': 'usPatTitle', 'us-marketplace-title': 'usMarketplaceTitle'
    };
    for (var id in sectionTitles) {
      var el = document.getElementById(id);
      if (el) el.textContent = _t(sectionTitles[id]);
    }
    populateLangSection();
    populatePlanSection();
    populatePatSection();
    populateMarketplaceSection();
    // Tab switching
    var tabBar = document.getElementById('us-tab-bar');

    if (tabBar && !tabBar.dataset.bound) {
      tabBar.dataset.bound = '1';
      tabBar.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.us-tab-btn');
        if (!btn) return;
        var tabId = btn.dataset.tab;
        var panels = document.querySelectorAll('.us-tab-panel');
        var btns = tabBar.querySelectorAll('.us-tab-btn');
        for (var b of btns) { b.classList.remove('is-active'); b.style.borderBottomColor = 'transparent'; b.style.color = '#8C6A3F'; }
        for (var p of panels) { p.style.display = 'none'; p.classList.remove('is-flex'); }
        btn.classList.add('is-active');
        btn.style.borderBottomColor = '#B8915A';
        btn.style.color = '#F7F3EC';
        var panel = document.getElementById(tabId);
        if (panel) {
          panel.style.display = '';
          if (tabId === 'us-tab-security') panel.classList.add('is-flex');
        }
        if (tabId === 'us-tab-security') populateSecurityPoliciesSection();
      });
    }
    // Reset to Settings tab on open
    var settingsTab = tabBar?.querySelector('[data-tab="us-tab-settings"]');
    if (settingsTab) settingsTab.click();

    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeUserSettingsModal() {
    var overlay = document.getElementById('user-settings-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    _restoreDomPos(document.getElementById('github-token-panel'), 'pat');
    var mkRow = document.querySelector('#us-marketplace-body > .github-token-row');
    _restoreDomPos(mkRow, 'marketplace');
    _userSettingsOrigParents = {};
  }

  function bindUserSettingsModal() {
    var openBtn = document.getElementById('sidebar-open-user-settings');
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = '1';
      openBtn.addEventListener('click', function () { openUserSettingsModal(); });
    }
    var closeBtn = document.getElementById('user-settings-modal-close');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', closeUserSettingsModal);
    }
    var overlay = document.getElementById('user-settings-overlay');
    if (overlay && !overlay.dataset.bound) {
      overlay.dataset.bound = '1';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeUserSettingsModal();
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  global.__settingsSidebar = {
    toggleSidebar: toggleSidebar,
    bindSidebarEvents: bindSidebarEvents,
    renderStatsSection: renderStatsSection,
    renderSettingsSection: renderSettingsSection,
    renderTemplatesSection: renderTemplatesSection,
    bindToolsSection: bindToolsSection,
    openUserSettingsModal: openUserSettingsModal,
    closeUserSettingsModal: closeUserSettingsModal,
    bindUserSettingsModal: bindUserSettingsModal,
    populateLangSection: populateLangSection,
    populatePlanSection: populatePlanSection,
    populateSecurityPoliciesSection: populateSecurityPoliciesSection,
    populatePatSection: populatePatSection,
    populateMarketplaceSection: populateMarketplaceSection
  };
})(typeof window !== 'undefined' ? window : this);
