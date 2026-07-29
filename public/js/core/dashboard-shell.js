/**
 * Dashboard shell: scan progress, recompute overlay and chart loading states.
 */
'use strict';

(function () {
  var warmupDismissed = false;

  function t(key) {
    return (window.t || function (value) { return value; })(key);
  }

  function logOptional(error) {
    if (window.appLogger) {
      window.appLogger.debugM('ui-core-shell', 'catch', 'optional_err', error?.message || error);
    }
  }

  function updateWarmupOverlay(data) {
    if (warmupDismissed || !data) return;
    var overlay = document.getElementById('warmup-overlay');
    if (!overlay) return;
    var status = document.getElementById('warmup-status');
    var sub = document.getElementById('warmup-sub');
    var progressFill = document.getElementById('warmup-progress-fill');
    var progress = data.scan_progress;

    if (data.scanning && progress?.total > 0) {
      var percent = Math.round(progress.done / progress.total * 100);
      if (status) {
        status.textContent = t('warmupScanning')
          .replace('{done}', progress.done)
          .replace('{total}', progress.total);
      }
      if (sub) sub.textContent = percent + '%';
      if (progressFill) progressFill.style.width = percent + '%';
    } else if (data.scanning) {
      if (status) status.textContent = t('warmupInit');
      if (progressFill) progressFill.style.width = '0%';
    } else if (data.agent_pending) {
      if (status) status.textContent = t('warmupAgentPending');
      if (sub) sub.textContent = '';
      if (progressFill) progressFill.style.width = '0%';
    }
  }

  function pollScannerProgress() {
    if (warmupDismissed || !document.getElementById('warmup-overlay')) return;
    fetch('/api/scan-status', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (scanner) {
        if (scanner?.scan_in_progress) {
          updateWarmupOverlay({ scanning: true, scan_progress: scanner.scan_progress });
        }
      })
      .catch(logOptional);
  }

  function dismissWarmupOverlay() {
    if (warmupDismissed) return;
    warmupDismissed = true;
    var overlay = document.getElementById('warmup-overlay');
    if (!overlay) return;
    var status = document.getElementById('warmup-status');
    if (status) status.textContent = t('warmupReady');
    setTimeout(function () {
      overlay.classList.add('is-done');
      setTimeout(function () { overlay.remove(); }, 500);
    }, 300);
  }

  function showRecomputeOverlay(show) {
    var element = document.getElementById('recompute-overlay');
    if (!element && show) {
      element = document.createElement('div');
      element.id = 'recompute-overlay';
      element.className = 'recompute-overlay';
      element.innerHTML = '<div class="recompute-indicator"><div class="recompute-spinner"></div><span>' +
        t('recomputeLabel') + '</span></div>';
      document.body.appendChild(element);
    }
    if (!element) return;
    element.classList.toggle('is-active', Boolean(show));
    if (!show) {
      setTimeout(function () {
        if (element.parentNode && !element.classList.contains('is-active')) element.remove();
      }, 300);
    }
  }

  function showMainChartsSkeleton(show) {
    var skeleton = document.getElementById('main-charts-skeleton');
    var wrapper = document.getElementById('main-charts-wrap');
    if (skeleton) {
      skeleton.classList.toggle('main-charts-skeleton--off', !show);
      skeleton.setAttribute('aria-busy', show ? 'true' : 'false');
    }
    if (wrapper) wrapper.classList.toggle('main-charts-loading', Boolean(show));
  }

  function chartShellSetLoading(canvasId, loading) {
    var canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    var shell = canvas?.closest('.chart-shell');
    if (!shell) return;
    shell.classList.toggle('is-loading', Boolean(loading));
    shell.classList.toggle('is-ready', !loading);
  }

  function fillInitialShellText() {
    var coldStart = !window.__dashboardState.getData();
    var meta = document.getElementById('meta');
    if (meta && (coldStart || !String(meta.textContent || '').trim())) meta.textContent = t('metaShellReady');
    var summary = document.getElementById('meta-details-summary');
    if (summary && (coldStart || !String(summary.textContent || '').trim())) {
      summary.textContent = t('metaDetailsSummaryDefault');
    }
  }

  function noRemoteSync() {
    return false;
  }

  window.updateWarmupOverlay = updateWarmupOverlay;
  window.dismissWarmupOverlay = dismissWarmupOverlay;
  window.showInitialSyncDialog = noRemoteSync;
  window.showRecomputeOverlay = showRecomputeOverlay;
  window.showMainChartsSkeleton = showMainChartsSkeleton;
  window.chartShellSetLoading = chartShellSetLoading;
  window.fillInitialShellText = fillInitialShellText;
  window.__dashboardShell = {
    updateWarmupOverlay: updateWarmupOverlay,
    dismissWarmupOverlay: dismissWarmupOverlay,
    showInitialSyncDialog: noRemoteSync,
    showRecomputeOverlay: showRecomputeOverlay,
    showMainChartsSkeleton: showMainChartsSkeleton,
    chartShellSetLoading: chartShellSetLoading,
    fillInitialShellText: fillInitialShellText,
    isWarmupDismissed: function () { return warmupDismissed; },
    getDevMode: function () { return false; },
    setDevMode: noRemoteSync,
    getDevProxySource: function () { return ''; },
    setDevProxySource: noRemoteSync,
    getSyncToken: function () { return ''; },
    setSyncToken: noRemoteSync
  };

  pollScannerProgress();
  setInterval(pollScannerProgress, 750);
})();
