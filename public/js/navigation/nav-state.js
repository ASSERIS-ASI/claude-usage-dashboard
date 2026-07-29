/**
 * @asseris-module       Nav State
 * @asseris-description  Auto-annotated module metadata for public/js/navigation/nav-state.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * nav-state.js — Active surface state with sessionStorage persistence.
 *
 * Manages which product surface is currently active.
 * Persists to sessionStorage so the surface survives page refresh within the same tab.
 *
 * API:
 *   window.__navState.getActive()        → current surface id (string)
 *   window.__navState.setActive(id)      → switch surface, notify listeners
 *   window.__navState.onChange(fn)       → register change listener fn(surfaceId)
 */
(function () {
  var STORAGE_KEY = 'dashboardActiveSurface';
  var _active = 'overview';
  var _listeners = [];
  var _lastWasAction = false;

  /**
   * Action-only surfaces: not persisted to sessionStorage and do not replace
   * _active. Listeners still fire so the renderer can react (e.g. open sidebar).
   */
  var ACTION_SURFACES = { settings: true };

  function load() {
    try {
      var stored = sessionStorage.getItem(STORAGE_KEY);
      // Ignore action-only surfaces that may have been persisted by older code
      if (stored && !ACTION_SURFACES[stored] && window.__navModel) {
        var surfaces = window.__navModel.surfaces;
        for (var i = 0; i < surfaces.length; i++) {
          if (surfaces[i].id === stored) { _active = stored; return; }
        }
      }
    } catch (e) { /* sessionStorage unavailable */ }
    _active = (window.__navModel && window.__navModel.DEFAULT_SURFACE) || 'overview';
  }

  function setActive(surfaceId) {
    // Action-only surfaces: fire listeners but do not persist or change _active
    if (ACTION_SURFACES[surfaceId]) {
      _lastWasAction = true;
      for (var k = 0; k < _listeners.length; k++) {
        try { _listeners[k](surfaceId); } catch (e) { /* ignore */ }
      }
      return;
    }
    // Re-apply even when _active matches if the last click was an action surface
    // (e.g. Settings opened the sidebar, nav buttons are out of sync)
    if (_active === surfaceId && !_lastWasAction) return;
    _lastWasAction = false;
    _active = surfaceId;
    try { sessionStorage.setItem(STORAGE_KEY, surfaceId); } catch (e) { /* ignore */ }
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](surfaceId); } catch (e) { /* ignore */ }
    }
  }

  function getActive() { return _active; }

  function onChange(fn) { _listeners.push(fn); }

  load();

  window.__navState = { getActive: getActive, setActive: setActive, onChange: onChange };
})();
