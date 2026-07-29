/**
 * @asseris-module       Nav Renderer
 * @asseris-description  Auto-annotated module metadata for public/js/navigation/nav-renderer.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * nav-renderer.js — Navigation bar rendering and surface visibility control.
 *
 * Responsibilities:
 *   1. Inject CSS for the nav bar and surface-hidden sections.
 *   2. Render <nav id="surface-nav"> after the top-bar header.
 *   3. Wire nav button clicks → __navState.setActive().
 *   4. Subscribe to state changes → applySurface() to show/hide sections.
 *
 * Section visibility works via the CSS class .section-surface-hidden
 * (display:none!important), which takes priority over widget-dispatcher
 * inline styles while still letting the dispatcher control user-pref visibility
 * within the active surface.
 */
(function () {
  function getModel() { return window.__navModel; }
  function getState() { return window.__navState; }

  function injectStyles() {
    if (document.getElementById('surface-nav-styles')) return;
    var s = document.createElement('style');
    s.id = 'surface-nav-styles';
    s.textContent = [
      '#surface-nav{',
      '  display:flex;gap:0;padding:0 8px;',
      '  background:#0E1116;border-bottom:1px solid #1A1D24;',
      '  flex-wrap:wrap;align-items:stretch;',
      '  position:sticky;top:calc(var(--dev-bar-h,0px) + 44px);z-index:499;',
      '}',
      '.surface-nav-btn{',
      '  padding:9px 18px;border:0;border-bottom:2px solid transparent;',
      '  background:transparent;color:#8C6A3F;cursor:pointer;',
      '  font-size:.8rem;font-weight:500;transition:color .15s,border-color .15s;',
      '  white-space:nowrap;line-height:1;',
      '}',
      '.surface-nav-btn:hover{color:#EFE7D6;}',
      '.surface-nav-btn.is-active{color:#F7F3EC;border-bottom-color:#B8915A;}',
      '.section-surface-hidden{display:none!important;}',
      '.section-no-data{display:none!important;}'
    ].join('');
    document.head.appendChild(s);
  }

  /**
   * Show sections for the given surface, hide all others.
   * Only sections listed in __navModel.sectionDomIds are managed.
   *
   * Special surfaces:
   *   - 'settings': opens the widget-dispatcher sidebar instead of showing sections
   *   - Capability-gated sections (e.g. gateway): hidden when data indicates
   *     the capability is not active (checked via __sections[id].capabilityGated)
   */
  function applySurface(surfaceId) {
    var model = getModel();
    if (!model) return;

    // Settings surface: open sidebar, keep previous section visibility
    if (surfaceId === 'settings') {
      var disp = window.__widgetDispatcher;
      if (disp && typeof disp.toggleSidebar === 'function') {
        disp.toggleSidebar(true);
      }
      // Sync nav button active state (highlight Settings briefly)
      var sbtns = document.querySelectorAll('.surface-nav-btn');
      for (var si = 0; si < sbtns.length; si++) {
        sbtns[si].classList.toggle('is-active', sbtns[si].dataset.surface === surfaceId);
      }
      return;
    }

    var surface = model.getSurface(surfaceId);
    if (!surface) return;

    // Build active section set, respecting capability gating
    var active = {};
    var sections = window.__sections || {};
    for (var i = 0; i < surface.sectionIds.length; i++) {
      var secId = surface.sectionIds[i];
      var secDef = sections[secId];
      // Capability gating disabled — nav system shows all sections,
      // renderers handle empty data gracefully

      active[secId] = true;
    }

    // Add / remove section-surface-hidden on managed <details> elements
    var domIds = model.sectionDomIds;
    for (var sectionId in domIds) {
      if (!Object.hasOwn(domIds, sectionId)) continue;
      var domId = domIds[sectionId];
      if (!domId) continue; // null = not managed (e.g. anthropic-status popup)
      var el = document.getElementById(domId);
      if (!el) continue;
      if (active[sectionId]) {
        el.classList.remove('section-surface-hidden');
        el.style.removeProperty('display'); // clear any dispatcher-set display:none
      } else {
        el.classList.add('section-surface-hidden');
      }
    }

    // Sync nav button active state
    var btns = document.querySelectorAll('.surface-nav-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('is-active', btns[j].dataset.surface === surfaceId);
    }

    // Flush deferred section renders + resize for newly visible charts
    // Reset fingerprints so sections actually re-render (not skipped as "unchanged")
    if (typeof window.__resetDashboardCoreFingerprint === 'function') window.__resetDashboardCoreFingerprint();
    window.__forensicLastFp = '';
    if (typeof window.__resetSecFingerprint === 'function') window.__resetSecFingerprint();
    if (typeof window.__resetGatewayFingerprint === 'function') window.__resetGatewayFingerprint();
    if (typeof window.__resetProxyFingerprint === 'function') window.__resetProxyFingerprint();
    if (typeof window.__resetCiFingerprint === 'function') window.__resetCiFingerprint();
    setTimeout(function () {
      try {
        var data = window.__dashboardState?.getData?.();
        if (data && typeof window.renderDashboard === 'function') {
          window.renderDashboard(data, true);
        }
        window.dispatchEvent(new Event('resize'));
      } catch (e) { /* ignore */ }
    }, 60);
    // ECharts may initialize during the first visible frame while grid/template
    // re-parenting is still settling. Repeat the centralized resize after the
    // browser has committed the new surface geometry.
    [180, 420].forEach(function (delay) {
      setTimeout(function () {
        try { window.__widgetDispatcher?.resizeAll?.(); } catch (e) { /* ignore */ }
      }, delay);
    });
  }

  function renderNavBar() {
    var model = getModel();
    var state = getState();
    if (!model || !state) return;
    if (document.getElementById('surface-nav')) return;

    var nav = document.createElement('nav');
    nav.id = 'surface-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Product surfaces');

    for (var i = 0; i < model.surfaces.length; i++) {
      var surface = model.surfaces[i];
      // Settings is accessed via the gear icon, not the nav bar
      if (surface.id === 'settings') continue;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'surface-nav-btn';
      btn.textContent = surface.label;
      btn.dataset.surface = surface.id;
      if (surface.id === state.getActive()) btn.classList.add('is-active');
      nav.appendChild(btn);
    }

    nav.addEventListener('click', function (ev) {
      var target = ev.target.closest('.surface-nav-btn');
      if (target && target.dataset.surface) {
        state.setActive(target.dataset.surface);
        // Close sidebar on explicit page navigation (not on settings which opens it)
        if (target.dataset.surface !== 'settings') {
          var disp2 = window.__widgetDispatcher;
          if (disp2 && typeof disp2.toggleSidebar === 'function') disp2.toggleSidebar(false);
        }
      }
    });

    // Insert immediately after the top-bar header
    var header = document.querySelector('header.top-bar');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(nav, header.nextSibling);
    } else {
      document.body.insertBefore(nav, document.body.firstChild);
    }

    // Apply initial surface visibility and subscribe to changes
    applySurface(state.getActive());
    state.onChange(function (id) { applySurface(id); });
  }

  injectStyles();
  renderNavBar();

  window.__navRenderer = { renderNavBar: renderNavBar, applySurface: applySurface };
})();
