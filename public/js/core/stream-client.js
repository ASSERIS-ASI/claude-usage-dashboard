/**
 * @asseris-module       Stream Client
 * @asseris-description  Auto-annotated module metadata for public/js/core/stream-client.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/stream-client.js — SSE stream, fetch-usage, GitHub token, extension timeline.
 *
 * Extracted from dashboard.client.js (Phase 11a).
 * Replaces the previous api-client.js facade with a real implementation.
 *
 * Exposes on window:
 *   fetchUsageJsonOnce()
 *   connectUsageStream()
 *   syncGithubSessionThenReconnectStream()
 *   apiGithubTokenHeader()
 *   getSessionGithubToken() / setSessionGithubToken(val)
 *   updateGithubTokenPanelMode()
 *   scheduleGithubTokenUiRefresh()
 *   showGithubTokenStatus(msg, isWarn)
 *   initGithubTokenPanel()
 *   initMarketplaceRefreshButton()
 *   mergeExtensionTimelineIntoUsage(data)
 *   fetchExtensionTimelineOnce()
 *   window.__apiClient.fetchUsage() / connectStream()
 */
(function () {
  function logStreamErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-core-stream', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  // ── GitHub Token ────────────────────────────────────────────────────────────

  var GITHUB_TOKEN_SESSION_KEY = 'usageDashboardGithubToken';

  function getSessionGithubToken() {
    try {
      return sessionStorage.getItem(GITHUB_TOKEN_SESSION_KEY) || '';
    } catch (eGt) {
      return '';
    }
  }

  function setSessionGithubToken(val) {
    try {
      if (val && String(val).trim()) {
        sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY, String(val).trim());
      } else {
        sessionStorage.removeItem(GITHUB_TOKEN_SESSION_KEY);
      }
    } catch (error) { logStreamErr(error); }
  }

  function apiGithubTokenHeader() {
    return { 'X-GitHub-Token': getSessionGithubToken() };
  }

  function updateGithubTokenPanelMode() {
    var edit = document.getElementById('github-token-edit-block');
    var saved = document.getElementById('github-token-saved-block');
    var savedLabel = document.getElementById('github-token-saved-label');
    if (!edit || !saved) return;
    var t = window.t || function (k) { return k; };
    if (getSessionGithubToken()) {
      edit.style.display = 'none';
      saved.style.display = 'block';
      if (savedLabel) savedLabel.textContent = t('githubTokenSavedLine');
    } else {
      saved.style.display = 'none';
      edit.style.display = 'block';
      if (savedLabel) savedLabel.textContent = '';
    }
  }

  function scheduleGithubTokenUiRefresh() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(updateGithubTokenPanelMode);
      });
    } else {
      setTimeout(updateGithubTokenPanelMode, 0);
    }
  }

  function showGithubTokenStatus(msg, isWarn) {
    var el = document.getElementById('github-token-status');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
    el.classList.toggle('is-warn', !!isWarn);
  }

  // ── Extension Timeline ──────────────────────────────────────────────────────

  var __extensionTimelinePayload = null;
  var __extensionTimelineCoalesceTimer = null;
  var __extensionTimelineInFlight = false;

  function cloneVersionChangeForMerge(vc) {
    if (!vc) return null;
    var o = {
      added: vc.added ? vc.added.slice() : [],
      from: vc.from != null ? vc.from : null,
      highlights: vc.highlights ? vc.highlights.slice() : [],
      release_when: vc.release_when || '',
      release_utc_ymd: vc.release_utc_ymd || '',
      release_local_ymd: vc.release_local_ymd || ''
    };
    if (vc.github_release_links?.length) {
      o.github_release_links = vc.github_release_links.map(function (gl) {
        return { version: gl.version, tag: gl.tag, url: gl.url };
      });
    }
    return o;
  }

  function mergeExtensionTimelineIntoUsage(data) {
    var p = __extensionTimelinePayload;
    if (!data?.days || !p?.by_date) return;
    var bd = p.by_date;
    for (var d of data.days) {
      var dt = d.date;
      if (!dt || !bd[dt]) continue;
      d.version_change = cloneVersionChangeForMerge(bd[dt]);
    }
  }

  function scheduleFetchExtensionTimeline(delayMs) {
    var d = typeof delayMs === 'number' ? delayMs : 500;
    clearTimeout(__extensionTimelineCoalesceTimer);
    __extensionTimelineCoalesceTimer = setTimeout(function () {
      __extensionTimelineCoalesceTimer = null;
      fetchExtensionTimelineOnceInternal();
    }, d);
  }

  function fetchExtensionTimelineOnce() {
    scheduleFetchExtensionTimeline(80);
  }

  function fetchExtensionTimelineOnceInternal() {
    if (__extensionTimelineInFlight) {
      scheduleFetchExtensionTimeline(350);
      return;
    }
    __extensionTimelineInFlight = true;
    fetch('/api/extension-timeline', { headers: apiGithubTokenHeader() })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        __extensionTimelinePayload = payload && typeof payload === 'object' ? payload : null;
        var d = window.__dashboardState.getData();
        if (d) {
          mergeExtensionTimelineIntoUsage(d);
          if (typeof window.renderDashboard === 'function') window.renderDashboard(d, true);
        }
      })
      .catch(function (err) { logStreamErr(err); })
      .then(function () {
        __extensionTimelineInFlight = false;
      });
  }

  // ── Fetch + Stream ──────────────────────────────────────────────────────────

  var usageStreamAbort = null;

  function fetchUsageJsonOnce() {
    return fetch('/api/usage', { headers: apiGithubTokenHeader() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        try {
          if (typeof window.renderDashboard === 'function') window.renderDashboard(d, true);
        } catch (e) {
          window.appLogger?.error('ui-core-stream', 'fetchRender', 'fail', e?.message || e);
        }
      })
      .catch(function (err) { logStreamErr(err); });
  }

  function syncGithubSessionThenReconnectStream() {
    fetch('/api/github-session-sync', {
      method: 'GET',
      headers: apiGithubTokenHeader()
    }).finally(function () {
      connectUsageStream();
    });
  }

  function connectUsageStream() {
    var t = window.t || function (k) { return k; };
    if (typeof fetch === 'function' && typeof AbortController !== 'undefined') {
      if (usageStreamAbort) usageStreamAbort.abort();
      usageStreamAbort = new AbortController();
      var sig = usageStreamAbort.signal;
      fetch('/api/stream', {
        signal: sig,
        headers: Object.assign({ Accept: 'text/event-stream' }, apiGithubTokenHeader())
      })
        .then(function (res) {
          if (!res.ok || !res.body || typeof res.body.getReader !== 'function') throw new Error('stream');
          var reader = res.body.getReader();
          var dec = new TextDecoder();
          var buf = '';
          var dot = document.getElementById('live-dot');
          if (dot) dot.style.background = '#22c55e';
          function pump() {
            return reader.read().then(function (part) {
              if (part.done) throw new Error('stream_end');
              buf += dec.decode(part.value, { stream: true });
              for (;;) {
                var ix = buf.indexOf('\n\n');
                if (ix < 0) break;
                var block = buf.slice(0, ix);
                buf = buf.slice(ix + 2);
                var lines = block.split('\n');
                for (var _line of lines) {
                  if (_line.startsWith('data: ')) {
                    try {
                      if (typeof window.renderDashboard === 'function') window.renderDashboard(JSON.parse(_line.slice(6)), false);
                    } catch (err) {
                      window.appLogger?.error('ui-core-stream', 'pumpParse', 'fail', err?.message || err);
                    }
                  }
                }
              }
              return pump();
            });
          }
          return pump();
        })
        .catch(function () {
          if (sig.aborted) return;
          var dot2 = document.getElementById('live-dot');
          var lab2 = document.getElementById('live-label');
          if (dot2) dot2.style.background = '#ef4444';
          if (lab2) lab2.textContent = t('sseDisconnected');
          setTimeout(connectUsageStream, 3000);
        });
      return;
    }
    var evtSource = new EventSource('/api/stream');
    evtSource.onmessage = function (e) {
      try {
        if (typeof window.renderDashboard === 'function') window.renderDashboard(JSON.parse(e.data), false);
      } catch (err) {
        window.appLogger?.error('ui-core-stream', 'sseMessage', 'fail', err?.message || err);
      }
    };
    evtSource.onerror = function () {
      var dot3 = document.getElementById('live-dot');
      var lab3 = document.getElementById('live-label');
      if (dot3) dot3.style.background = '#ef4444';
      if (lab3) lab3.textContent = t('sseDisconnected');
    };
  }

  // ── GitHub Token Panel ──────────────────────────────────────────────────────

  function initGithubTokenPanel() {
    var t = window.t || function (k) { return k; };
    var edit = document.getElementById('github-token-edit-block');
    var saved = document.getElementById('github-token-saved-block');
    var inp = document.getElementById('github-token-input');
    var save = document.getElementById('github-token-save');
    var clear = document.getElementById('github-token-clear');
    var refBtn = document.getElementById('github-releases-refresh');
    if (!inp || !save || !clear || !edit || !saved) return;
    if (!save.dataset.boundGithubSv) {
      save.dataset.boundGithubSv = '1';
      save.addEventListener('click', function () {
        var v = String(inp.value || '').trim();
        if (v) {
          setSessionGithubToken(v);
          inp.value = '';
          updateGithubTokenPanelMode();
          scheduleGithubTokenUiRefresh();
          showGithubTokenStatus(t('githubTokenSaved'), false);
        } else if (getSessionGithubToken()) {
          updateGithubTokenPanelMode();
          scheduleGithubTokenUiRefresh();
          showGithubTokenStatus(t('githubTokenSaved'), false);
        } else {
          showGithubTokenStatus('', false);
        }
        syncGithubSessionThenReconnectStream();
      });
    }
    if (!clear.dataset.boundGithubCl) {
      clear.dataset.boundGithubCl = '1';
      clear.addEventListener('click', function () {
        setSessionGithubToken('');
        inp.value = '';
        updateGithubTokenPanelMode();
        scheduleGithubTokenUiRefresh();
        showGithubTokenStatus(t('githubTokenCleared'), false);
        syncGithubSessionThenReconnectStream();
        try { inp.focus(); } catch (error) { logStreamErr(error); }
      });
    }
    if (refBtn && !refBtn.dataset.boundGithubRf) {
      refBtn.dataset.boundGithubRf = '1';
      refBtn.addEventListener('click', function () {
        fetch('/api/github-releases-refresh', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, apiGithubTokenHeader())
        })
          .then(function (r) {
            if (!r.ok) throw new Error('bad');
            return r.json();
          })
          .then(function () {
            showGithubTokenStatus(t('githubReleasesRefreshOk'), false);
            setTimeout(function () { fetchExtensionTimelineOnce(); }, 2500);
          })
          .catch(function () {
            showGithubTokenStatus(t('githubReleasesRefreshFail'), true);
          });
      });
    }
    updateGithubTokenPanelMode();
    scheduleGithubTokenUiRefresh();
  }

  function initMarketplaceRefreshButton() {
    var t = window.t || function (k) { return k; };
    var btn = document.getElementById('marketplace-extension-refresh');
    if (!btn || btn.dataset.boundMpRf) return;
    btn.dataset.boundMpRf = '1';
    btn.addEventListener('click', function () {
      fetch('/api/marketplace-refresh', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, apiGithubTokenHeader())
      })
        .then(function (r) {
          if (!r.ok) throw new Error('bad');
          return r.json();
        })
        .then(function () {
          showGithubTokenStatus(t('marketplaceRefreshOk'), false);
          setTimeout(function () { fetchExtensionTimelineOnce(); }, 1800);
        })
        .catch(function () {
          showGithubTokenStatus(t('marketplaceRefreshFail'), true);
        });
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────────────
  // Phase 18 review: legacy global exports removed — all consumers use __apiClient

  // UI-specific exports (not routed through __apiClient — direct window access is correct)
  window.syncGithubSessionThenReconnectStream = syncGithubSessionThenReconnectStream;
  window.apiGithubTokenHeader = apiGithubTokenHeader;
  window.getSessionGithubToken = getSessionGithubToken;
  window.setSessionGithubToken = setSessionGithubToken;
  window.updateGithubTokenPanelMode = updateGithubTokenPanelMode;
  window.scheduleGithubTokenUiRefresh = scheduleGithubTokenUiRefresh;
  window.showGithubTokenStatus = showGithubTokenStatus;
  window.initGithubTokenPanel = initGithubTokenPanel;
  window.initMarketplaceRefreshButton = initMarketplaceRefreshButton;

  // Phase 17c: register into api-client facade instead of overwriting
  if (window.__apiClient?.register) {
    window.__apiClient.register({
      fetchUsage: fetchUsageJsonOnce,
      connectStream: connectUsageStream,
      scheduleFetchExtensionTimeline: scheduleFetchExtensionTimeline,
      getSessionGithubToken: getSessionGithubToken,
      apiGithubTokenHeader: apiGithubTokenHeader
    });
  }
})();
