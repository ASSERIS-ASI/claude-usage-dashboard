/**
 * @asseris-module       Settings Page
 * @asseris-description  Auto-annotated module metadata for public/js/pages/settings-page.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * pages/settings-page.js — Settings surface definition.
 *
 * Dashboard layout and configuration.
 * Section layout settings are accessed via the ⚙ gear button in the top bar
 * (widget-dispatcher sidebar). No separate section layout is defined here.
 */
(function () {
  window.__pages = window.__pages || {};
  window.__pages.settings = {
    surfaceId: 'settings',
    label: 'Settings',
    description: 'Dashboard layout and configuration (use ⚙ in the top bar)',
    sectionIds: [] // settings are managed by widget-dispatcher sidebar
  };
})();
