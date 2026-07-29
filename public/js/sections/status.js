/**
 * @asseris-module       Status
 * @asseris-description  Auto-annotated module metadata for public/js/sections/status.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * sections/status.js — Anthropic Status section module wrapper.
 * Surface: Operations.
 * The status widget lives in the top-bar popup (#anthropic-popup), not a managed
 * <details> collapse element. domId is null — surface nav does not hide/show it.
 * Delegates rendering to window.updateAnthropicPopup (defined in dashboard.client.js).
 */
(function () {
  window.__sections = window.__sections || {};
  window.__sections.status = {
    id: 'anthropic-status',
    surface: 'operations',
    domId: null, // top-bar popup — not managed by surface nav visibility
    render: function (data) {
      if (typeof window.updateAnthropicPopup === 'function') window.updateAnthropicPopup(data);
    }
  };
})();
