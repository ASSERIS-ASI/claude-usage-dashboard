/**
 * @asseris-module       Split Advisor
 * @asseris-description  Auto-annotated module metadata for public/js/split-advisor.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * split-advisor.js — Tier-1 Hard Limit Warning for Multi-Tab Pro Plans
 *
 * Monitors quota ETA and displays a sticky banner warning about
 * Phantom Session penalties when multiple Claude Code tabs are warm
 * and Hard Limit is approaching.
 *
 * Auto-refreshes every 10 seconds while quota < 60% of 5h window.
 */

(function () {
  'use strict';

  var __splitAdvisorState = {
    enabled: true,
    tabCount: null, // only populated by explicit user input
    updateIntervalMs: 10000,
    timer: null
  };

  function detectActiveSessions(requests) {
    var now = Date.now();
    var cutoff = now - (10 * 60 * 1000);
    var ids = new Set();
    for (var request of requests || []) {
      var id = request.session_id || request.sessionId;
      var rawTs = request.ts || request.timestamp || request.time;
      var ts = typeof rawTs === 'number' ? rawTs : Date.parse(rawTs || '');
      if (id && Number.isFinite(ts) && ts >= cutoff) ids.add(id);
    }
    return ids.size || null;
  }

  /**
   * Update Split-Advisor banner based on current quota ETA.
   * @param {object} latestProxyDay - proxy day object with rate_limit + q5_samples
   */
  function updateSplitAdvisorBanner(latestProxyDay) {
    if (!__splitAdvisorState.enabled) return;
    if (!latestProxyDay || !__metricsEngine) return;

    // Get quota ETA from metrics engine
    var quotaETA = __metricsEngine.estimateQuotaETA(latestProxyDay);

    // Call Split-Advisor Tier-1 (safe fallback if no ETA)
    var recentReqs = latestProxyDay.gateway_last_requests || [];
    var detectedSessions = detectActiveSessions(recentReqs);
    var effectiveCount = detectedSessions || __splitAdvisorState.tabCount || 1;
    var advisor = quotaETA.minutesLeft >= 0
      ? __metricsEngine.splitAdvisorTier1(quotaETA, effectiveCount)
      : { urgency: 'safe', warningLevel: 'low', recommendation: '' };

    // Phantom cache detection: check avg cache_read from recent requests
    var phantomWarning = '';
    if (recentReqs.length >= 3) {
      var last5 = recentReqs.slice(-5);
      var crSum = 0;
      var crCount = 0;
      for (var ri = 0; ri < last5.length; ri++) {
        if (last5[ri].cache_read > 0) {
          crSum += last5[ri].cache_read;
          crCount++;
        }
      }
      var avgCr = crCount > 0 ? Math.round(crSum / crCount) : 0;
      if (avgCr > 100000) {
        phantomWarning = ' · recent cache read avg ~' + Math.round(avgCr / 1000) + 'K/req';
      }
    }

    // Render banner
    var bannerEl = document.getElementById('split-advisor-banner');
    if (!bannerEl) return;

    // Remove old event listeners by cloning
    var newBanner = bannerEl.cloneNode(false);
    bannerEl.parentNode.replaceChild(newBanner, bannerEl);
    bannerEl = newBanner;

    // HTML content
    var isSafe = advisor.urgency === 'safe';
    var iconMap = {
      CRITICAL: '🔴',
      HIGH: '🟡',
      MEDIUM: '⚠️',
      low: '✓'
    };
    var icon = isSafe ? '✓' : (iconMap[advisor.warningLevel] || '•');

    var html = icon + ' <strong>Split-Advisor</strong>: ';
    if (isSafe) {
      var pct = quotaETA.pct5h || 0;
      html += pct + '% — no action needed';
      if (phantomWarning) html += phantomWarning;
    } else {
      html += advisor.recommendation;
      if (phantomWarning) html += phantomWarning;
    }

    if (!isSafe) {
      // Tab count toggle (clickable to adjust)
      html += ' <button type="button" class="split-advisor-tabs-btn" data-action="toggle-tabs">(' +
        (detectedSessions ? detectedSessions + ' active sessions observed' :
          (__splitAdvisorState.tabCount ? __splitAdvisorState.tabCount + ' tabs (manual)' : 'tab count unknown')) +
        ')</button>';
      // Close button
      html += ' <button type="button" class="split-advisor-close-btn" aria-label="Dismiss" data-action="close">✕</button>';
    }

    bannerEl.innerHTML = html;
    bannerEl.className = 'split-advisor-banner ' + (isSafe ? 'safe' : advisor.urgency);
    bannerEl.style.display = 'block';

    // Event handlers
    bannerEl.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-action');
      if (action === 'close') {
        __splitAdvisorState.enabled = false;
        hideSplitAdvisorBanner();
      } else if (action === 'toggle-tabs') {
        var newCount = prompt('Open Claude Code tabs (manual estimate):', String(__splitAdvisorState.tabCount || 1));
        if (newCount != null) {
          __splitAdvisorState.tabCount = Math.max(1, Math.min(10, Number.parseInt(newCount, 10)));
          updateSplitAdvisorBanner(latestProxyDay); // Re-render
        }
      }
    });
  }

  function hideSplitAdvisorBanner() {
    var bannerEl = document.getElementById('split-advisor-banner');
    if (bannerEl) bannerEl.style.display = 'none';
  }

  /**
   * Start auto-refresh polling. Call this from main dashboard init.
   * @param {function} getLatestProxyDay - callback to fetch latest proxy day
   */
  function startAutoRefresh(getLatestProxyDay) {
    if (__splitAdvisorState.timer) clearInterval(__splitAdvisorState.timer);

    __splitAdvisorState.timer = setInterval(function () {
      if (!__splitAdvisorState.enabled) return;
      try {
        var pd = getLatestProxyDay();
        if (pd) updateSplitAdvisorBanner(pd);
      } catch (e) {
        logClientOptionalErr('Split-Advisor auto-refresh: ' + e.message);
      }
    }, __splitAdvisorState.updateIntervalMs);
  }

  function stopAutoRefresh() {
    if (__splitAdvisorState.timer) {
      clearInterval(__splitAdvisorState.timer);
      __splitAdvisorState.timer = null;
    }
  }

  /**
   * Set tab count. Persisted in sessionStorage for this session.
   */
  function setTabCount(count) {
    __splitAdvisorState.tabCount = Math.max(1, Math.min(10, count || 1));
    try {
      sessionStorage.setItem('split-advisor-tabcount', String(__splitAdvisorState.tabCount));
    } catch (e) {
      logClientOptionalErr('Could not save tab count: ' + e.message);
    }
  }

  function getTabCount() {
    try {
      var stored = sessionStorage.getItem('split-advisor-tabcount');
      if (stored) {
        var parsed = Number.parseInt(stored, 10);
        if (!Number.isNaN(parsed)) return Math.max(1, Math.min(10, parsed));
      }
    } catch (e) {
      logClientOptionalErr('Could not read tab count: ' + e.message);
    }
    return null;
  }

  // Restore tab count from sessionStorage
  __splitAdvisorState.tabCount = getTabCount();

  // Export
  window.__splitAdvisor = {
    updateBanner: updateSplitAdvisorBanner,
    hide: hideSplitAdvisorBanner,
    startAutoRefresh: startAutoRefresh,
    stopAutoRefresh: stopAutoRefresh,
    setTabCount: setTabCount,
    getTabCount: getTabCount,
    getState: function () { return __splitAdvisorState; }
  };

})();
