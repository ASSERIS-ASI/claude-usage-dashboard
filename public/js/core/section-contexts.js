/**
 * @asseris-module       Section Contexts
 * @asseris-description  Auto-annotated module metadata for public/js/core/section-contexts.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/section-contexts.js — Facade for cached section render contexts (Phase 17d).
 *
 * Delegates to __dashboardState.getSectionCtx / setSectionCtx.
 * Kept for backward compat — new code should use __dashboardState directly.
 *
 * API:
 *   window.__sectionContexts.get('proxy')        → cached proxy render ctx or null
 *   window.__sectionContexts.set('proxy', ctx)   → store render ctx
 */
(function () {
  window.__sectionContexts = {
    get: function (sectionId) {
      var name = sectionId.replace(/-/g, '_');
      return window.__dashboardState ? window.__dashboardState.getSectionCtx(name) : null;
    },
    set: function (sectionId, ctx) {
      var name = sectionId.replace(/-/g, '_');
      if (window.__dashboardState) window.__dashboardState.setSectionCtx(name, ctx);
    }
  };
})();
