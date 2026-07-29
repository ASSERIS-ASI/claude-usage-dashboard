/**
 * @asseris-module       Overview Page
 * @asseris-description  Auto-annotated module metadata for public/js/pages/overview-page.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * pages/overview-page.js — Overview surface definition.
 *
 * The default landing page. Shows health status and key findings.
 * Forensic analysis and deep audit content are intentionally excluded
 * from this surface.
 */
(function () {
  window.__pages = window.__pages || {};
  window.__pages.overview = {
    surfaceId: 'overview',
    label: 'Overview',
    description: 'Health status, key findings and primary KPIs',
    sectionIds: ['health']
  };
})();
