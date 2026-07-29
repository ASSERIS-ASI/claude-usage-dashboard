/**
 * @asseris-module       Nav Model
 * @asseris-description  Auto-annotated module metadata for public/js/navigation/nav-model.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * nav-model.js — Surface taxonomy and section-to-surface mapping.
 *
 * Derives surfaces from window.__pages (registered by pages/*.js modules).
 * Falls back to a static definition if __pages is not yet populated.
 * SURFACE_ORDER defines the canonical display order.
 *
 * Consumed by nav-state.js and nav-renderer.js.
 */
(function () {
  /** Canonical display order of product surfaces. */
  var SURFACE_ORDER = ['overview', 'usage', 'proxy', 'security', 'audit', 'cost-intelligence', 'settings'];

  /**
   * Build the surfaces array from window.__pages.
   * Each page module registers { surfaceId, label, sectionIds, ... }.
   */
  function buildSurfaces() {
    var pages = window.__pages || {};
    var surfaces = [];
    for (var i = 0; i < SURFACE_ORDER.length; i++) {
      var id = SURFACE_ORDER[i];
      var page = pages[id];
      if (page) {
        surfaces.push({
          id: page.surfaceId,
          label: page.label,
          sectionIds: (page.sectionIds || []).slice()
        });
      }
    }
    return surfaces;
  }

  /**
   * Maps section IDs to the DOM id of their <details> collapse element.
   * null = section has no managed <details> (e.g. lives in a top-bar popup).
   *
   * Omitted entries:
   *   'efficiency-range' — nested inside economic-collapse, inherits visibility
   *   'anthropic-status' — top-bar popup, not managed by surface nav
   */
  var SECTION_DOM_IDS = {
    'health':            'health-collapse',
    'token-stats':       'token-stats-collapse',
    'user-profile':      'user-profile-collapse',
    'budget':            'budget-collapse',
    'economic':          'economic-collapse',
    'forensic':          'forensic-collapse',
    'proxy':             'proxy-collapse'
  };
  // Optional sections — only add if HTML was injected by the server.
  if (document.getElementById('cost-intelligence-collapse')) SECTION_DOM_IDS['cost-intelligence'] = 'cost-intelligence-collapse';
  if (document.getElementById('security-postures-collapse')) SECTION_DOM_IDS['security-postures'] = 'security-postures-collapse';

  var SURFACES = buildSurfaces();

  function getSurface(id) {
    for (var i = 0; i < SURFACES.length; i++) {
      if (SURFACES[i].id === id) return SURFACES[i];
    }
    return null;
  }

  function getSectionSurface(sectionId) {
    for (var i = 0; i < SURFACES.length; i++) {
      if (SURFACES[i].sectionIds.indexOf(sectionId) !== -1) return SURFACES[i];
    }
    return null;
  }

  function isSectionAvailable(sectionId) {
    var domId = SECTION_DOM_IDS[sectionId];
    return !!(domId && document.getElementById(domId));
  }

  function getEditableSurfaces() {
    var out = [];
    for (var i = 0; i < SURFACES.length; i++) {
      var surface = SURFACES[i];
      var availableIds = [];
      for (var j = 0; j < surface.sectionIds.length; j++) {
        if (isSectionAvailable(surface.sectionIds[j])) availableIds.push(surface.sectionIds[j]);
      }
      if (availableIds.length) {
        out.push({ id: surface.id, label: surface.label, sectionIds: availableIds });
      }
    }
    return out;
  }

  window.__navModel = {
    surfaces: SURFACES,
    sectionDomIds: SECTION_DOM_IDS,
    SURFACE_ORDER: SURFACE_ORDER,
    DEFAULT_SURFACE: 'overview',
    getSurface: getSurface,
    getSectionSurface: getSectionSurface,
    isSectionAvailable: isSectionAvailable,
    getEditableSurfaces: getEditableSurfaces
  };
})();
