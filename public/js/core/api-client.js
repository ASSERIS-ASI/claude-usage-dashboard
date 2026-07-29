/**
 * @asseris-module       Api Client
 * @asseris-description  Auto-annotated module metadata for public/js/core/api-client.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/api-client.js — Central API access layer for the dashboard (Phase 17c).
 *
 * Owns the __apiClient contract. stream-client.js registers its
 * implementation via __apiClient.register() after loading.
 *
 * Consumers call __apiClient.fetchUsage(), __apiClient.connectStream(), etc.
 * without depending on stream-client.js load order.
 *
 * API: window.__apiClient
 */
(function () {
  var _impl = {};

  window.__apiClient = {
    /** Called by stream-client.js to supply real implementations. */
    register: function (methods) {
      for (var k in methods) {
        if (Object.hasOwn(methods, k)) _impl[k] = methods[k];
      }
    },

    fetchUsage: function () {
      if (_impl.fetchUsage) return _impl.fetchUsage();
      return Promise.resolve(null);
    },
    connectStream: function () {
      if (_impl.connectStream) _impl.connectStream();
    },
    scheduleFetchExtensionTimeline: function (delayMs) {
      if (_impl.scheduleFetchExtensionTimeline) _impl.scheduleFetchExtensionTimeline(delayMs);
    },
    getSessionGithubToken: function () {
      return _impl.getSessionGithubToken ? _impl.getSessionGithubToken() : '';
    },
    apiGithubTokenHeader: function () {
      return _impl.apiGithubTokenHeader ? _impl.apiGithubTokenHeader() : {};
    },

    /** The standalone dashboard has no accounts or privileged control plane. */
    isAdmin: function () {
      return true;
    },

    /** Thin fetch wrapper kept as the shared API-client contract. */
    fetch: function (url, opts) {
      return fetch(url, opts);
    }
  };
})();
