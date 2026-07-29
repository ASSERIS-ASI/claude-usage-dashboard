/**
 * @asseris-module       Usage Page
 * @asseris-description  Auto-annotated module metadata for public/js/pages/usage-page.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * pages/usage-page.js — Usage surface definition.
 *
 * Token consumption, budget analysis, session economics and cost trends.
 * This is the primary analytical surface for day-to-day usage review.
 */
(function () {
  window.__pages = window.__pages || {};
  window.__pages.usage = {
    surfaceId: 'usage',
    label: 'Usage',
    description: 'Token consumption, budget, sessions and cost analysis',
    sectionIds: ['token-stats', 'user-profile', 'budget', 'economic']
  };
})();
