/**
 * @asseris-module       Live Panels
 * @asseris-description  Auto-annotated module metadata for public/js/core/live-panels.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/live-panels.js — Live side-panel: scanned JSONL chart, outage/extension lists,
 *                        meta details, state-paths row, scan-sources row.
 *
 * Extracted from dashboard.client.js (Phase 11a).
 *
 * Exposes on window:
 *   updateStatePathsRow(data)
 *   updateScanSourcesRow(data)
 *   resizeLiveScannedJsonlChartIfAny()
 *   updateLiveFilesPanel(data)
 *   liveExtOneLiner(d)
 *   updateLiveOutageAndExtensionSections(data)
 *   updateLiveSidePanel(data)
 *   updateMetaDetailsSummary(data)
 *   initMetaDetailsPanel()
 */
(function () {
  function logLivePanelErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-core-live-panels', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  function t(k) { return (window.t || function (x) { return x; })(k); }
  function tr(k, m) { return (window.tr || function (x) { return x; })(k, m); }
  function escHtml(s) { return (window.escHtml || function (x) { return String(x == null ? '' : x); })(s); }

  // ── State Paths + Scan Sources ──────────────────────────────────────────────

  function updateStatePathsRow(data) {
    var el = document.getElementById('state-cache-paths');
    if (!el) return;
    var sp = data?.state_paths;
    if (!sp) {
      el.textContent = '';
      return;
    }
    el.textContent =
      t('statePathsTitle') +
      '\n' +
      t('statePathDay') +
      sp.day_cache +
      '\n' +
      t('statePathTodayIndex') +
      (sp.jsonl_today_index || '\u2014') +
      '\n' +
      t('statePathReleases') +
      sp.releases +
      '\n' +
      t('statePathMarketplace') +
      sp.marketplace +
      '\n' +
      t('statePathOutage') +
      sp.outage;
  }

  function updateScanSourcesRow(data) {
    var el = document.getElementById('scan-sources');
    if (!el) return;
    var srcs = data?.scan_sources;
    if (srcs?.length > 1) {
      var parts = [];
      for (var _src of srcs) {
        parts.push(_src.label + ' (' + (_src.jsonl_files || 0) + ' .jsonl)');
      }
      el.textContent = t('scanSourcesPrefix') + parts.join(' \u00b7 ');
      el.title = srcs.map(function (s) { return s.label + ': ' + (s.path_hint || ''); }).join('\n');
      el.style.display = '';
    } else {
      el.textContent = '';
      el.title = '';
      el.style.display = 'none';
    }
  }

  // ── Live JSONL Chart ────────────────────────────────────────────────────────

  var __liveScannedJsonlChart = null;

  function resizeLiveScannedJsonlChartIfAny() {
    if (!__liveScannedJsonlChart) return;
    try {
      __liveScannedJsonlChart.resize();
    } catch (err) { logLivePanelErr(err); }
  }

  function __disposeLiveScannedJsonlChartIfNeeded() {
    if (!__liveScannedJsonlChart) return;
    try {
      __liveScannedJsonlChart.dispose();
    } catch (err) { logLivePanelErr(err); }
    __liveScannedJsonlChart = null;
  }

  function __liveJsonlBarTooltipFormatter(params) {
    if (!params?.length) return '';
    var p0 = params[0];
    return escHtml(p0.name) + '<br/>' + p0.marker + String(p0.value) + ' ' + t('liveFilesChartFilesSuffix');
  }

  function liveScannedJsonlBucket(line) {
    var s = String(line || '').replaceAll('\\', '/');
    var dot = ' \u00b7 ';
    var pathPart = s;
    var di = s.indexOf(dot);
    if (di >= 0) pathPart = s.slice(di + dot.length).trim();
    var marker = '/.claude/projects/';
    var ix = pathPart.indexOf(marker);
    if (ix >= 0) {
      var rest = pathPart.slice(ix + marker.length);
      var seg0 = rest.split('/')[0];
      if (seg0) return seg0;
    }
    var fn = pathPart.split('/').pop() || pathPart;
    if (fn.length > 24) return fn.slice(0, 22) + '\u2026';
    return fn || '(?)';
  }

  function updateLiveFilesPanel(data) {
    var host = document.getElementById('live-files-chart-host');
    var head = document.getElementById('live-files-head');
    var trig = document.getElementById('live-trigger');
    if (!host) return;
    __disposeLiveScannedJsonlChartIfNeeded();
    host.innerHTML = '';
    host.style.display = '';
    var files = data?.scanned_files ? data.scanned_files : [];
    var n = files.length;
    if (head) head.textContent = n ? tr('liveFilesHeadN', { n: n }) : t('liveFilesHead0');
    if (data?.scanning && n === 0) {
      host.innerHTML = '<p class="live-files-chart-empty">' + escHtml(t('scanStill')) + '</p>';
      if (trig) trig.setAttribute('title', t('liveTriggerScanning'));
      return;
    }
    if (n === 0) {
      host.innerHTML = '<p class="live-files-chart-empty">' + escHtml(t('noJsonlList')) + '</p>';
      if (trig) trig.setAttribute('title', t('liveTriggerZero'));
      return;
    }
    if (typeof echarts === 'undefined' || !echarts.init) {
      host.innerHTML = '<p class="live-files-chart-empty">' + escHtml(String(n) + ' JSONL') + '</p>';
      if (trig) trig.setAttribute('title', tr('liveTriggerMany', { n: n }));
      return;
    }
    var counts = Object.create(null);
    for (var bi = 0; bi < n; bi++) {
      var b = liveScannedJsonlBucket(files[bi]);
      counts[b] = (counts[b] || 0) + 1;
    }
    var pairs = [];
    for (var k in counts) {
      if (Object.hasOwn(counts, k)) pairs.push({ name: k, value: counts[k] });
    }
    pairs.sort(function (a, b) { return a.value - b.value; });
    var maxBars = 15;
    if (pairs.length > maxBars) pairs = pairs.slice(pairs.length - maxBars);
    var names = [];
    var vals = [];
    for (var _pair of pairs) {
      names.push(_pair.name);
      vals.push(_pair.value);
    }
    var cw = host.clientWidth || host.offsetWidth;
    var ch = host.clientHeight || host.offsetHeight;
    var initW = cw > 48 ? undefined : Math.min(520, Math.max(280, (window.innerWidth || 800) - 48));
    var initH = ch > 48 ? undefined : 220;
    var initOpts = { renderer: 'canvas' };
    if (initW != null) initOpts.width = initW;
    if (initH != null) initOpts.height = initH;
    __liveScannedJsonlChart = echarts.init(host, null, initOpts);
    __liveScannedJsonlChart.setOption({
      animation: false,
      grid: { left: 6, right: 18, top: 6, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(14,17,22,0.95)',
        borderColor: '#2A2D34',
        textStyle: { color: '#F7F3EC' },
        formatter: __liveJsonlBarTooltipFormatter
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#A0875E' },
        splitLine: { lineStyle: { color: 'rgba(42,45,52,0.45)' } }
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: { color: '#A0875E', width: 110, overflow: 'truncate' }
      },
      series: [
        {
          type: 'bar',
          data: vals,
          itemStyle: { color: 'rgba(184,145,90,0.78)' },
          label: { show: true, position: 'right', color: '#EFE7D6', fontSize: 10 }
        }
      ]
    });
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(resizeLiveScannedJsonlChartIfAny);
      });
    } else {
      setTimeout(resizeLiveScannedJsonlChartIfAny, 0);
    }
    if (trig) trig.setAttribute('title', tr('liveTriggerMany', { n: n }));
  }

  // ── Outage + Extension Lists ────────────────────────────────────────────────

  function liveExtOneLiner(d) {
    var vc = d.version_change;
    if (!vc) return d.date;
    var verStr = vc.added?.length ? vc.added.join(', ') : '';
    if (vc.from) verStr = vc.from + ' \u2192 ' + verStr;
    return d.date + ': ' + verStr;
  }

  function updateLiveOutageAndExtensionSections(data) {
    var oh = document.getElementById('live-outage-head');
    var ol = document.getElementById('live-outage-list');
    var oe = document.getElementById('live-outage-empty');
    var eh = document.getElementById('live-ext-head');
    var el = document.getElementById('live-ext-list');
    var ee = document.getElementById('live-ext-empty');
    if (!oh || !ol || !oe || !eh || !el || !ee) return;
    oh.textContent = t('liveOutageHead');
    eh.textContent = t('liveExtHead');
    var days = data?.days ? data.days : [];
    ol.innerHTML = '';
    var hasOut = false;
    for (var d of days) {
      var incs = d.outage_incidents || [];
      if (!incs.length) continue;
      hasOut = true;
      var seen = {};
      for (var inc of incs) {
        var key = (inc.name || '') + '|' + String(inc.created_at || '') + '|' + String(inc.resolved_at || '');
        if (seen[key]) continue;
        seen[key] = true;
        var li = document.createElement('li');
        var imp = String(inc.impact || 'none').toUpperCase();
        var kind = inc.kind ? ' (' + inc.kind + ')' : '';
        li.textContent = d.date + ' \u00b7 [' + imp + '] ' + (inc.name || '') + kind;
        ol.appendChild(li);
      }
    }
    if (hasOut) {
      oe.style.display = 'none';
      ol.style.display = '';
    } else {
      oe.style.display = '';
      oe.textContent = t('liveOutageEmpty');
      ol.style.display = 'none';
    }
    el.innerHTML = '';
    var hasExt = false;
    for (var ei = 0; ei < days.length; ei++) {
      var dx = days[ei];
      if (!dx.version_change) continue;
      hasExt = true;
      var lix = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'live-ext-open';
      btn.dataset.dayIndex = String(ei);
      btn.textContent = liveExtOneLiner(dx);
      btn.setAttribute('aria-label', t('liveExtOpenAria') + ' ' + dx.date);
      lix.appendChild(btn);
      el.appendChild(lix);
    }
    if (hasExt) {
      ee.style.display = 'none';
      el.style.display = '';
    } else {
      ee.style.display = '';
      ee.textContent = t('liveExtEmpty');
      el.style.display = 'none';
    }
  }

  function updateLiveSidePanel(data) {
    updateLiveFilesPanel(data);
    updateLiveOutageAndExtensionSections(data);
  }

  // ── Meta Details ────────────────────────────────────────────────────────────

  function updateMetaDetailsSummary(data) {
    var sumEl = document.getElementById('meta-details-summary');
    if (!sumEl) return;
    var sp = data?.scan_progress;
    if (sp?.total > 0 && data.scanning && sp.done < sp.total) {
      sumEl.textContent = tr('metaDetailsScanProgress', { done: sp.done, total: sp.total, sec: data.refresh_sec || 180 });
      return;
    }
    var days = data?.days;
    if (!days?.length) {
      if (data?.scanning) sumEl.textContent = t('metaSummaryScanning');
      else if (data?.scan_error) sumEl.textContent = tr('metaScanError', { msg: String(data.scan_error).slice(0, 120) });
      else if (data && (data.parsed_files || 0) === 0) sumEl.textContent = t('metaSummaryNoFiles');
      else sumEl.textContent = tr('metaSummaryNoUsage', { files: data.parsed_files || 0 });
      return;
    }
    sumEl.textContent = tr('metaDetailsSummaryLine', { files: data.parsed_files || 0, sec: data.refresh_sec || 180 });
  }

  function initMetaDetailsPanel() {
    var det = document.getElementById('meta-details');
    if (!det || det.dataset.boundMeta) return;
    det.dataset.boundMeta = '1';
    try {
      if (sessionStorage.getItem('usageMetaDetailsOpen') === '1') det.setAttribute('open', '');
    } catch (err) { logLivePanelErr(err); }
    det.addEventListener('toggle', function () {
      if (typeof window.updateGithubTokenPanelMode === 'function') window.updateGithubTokenPanelMode();
      if (typeof window.scheduleGithubTokenUiRefresh === 'function') window.scheduleGithubTokenUiRefresh();
      try {
        sessionStorage.setItem('usageMetaDetailsOpen', det.open ? '1' : '0');
      } catch (err) { logLivePanelErr(err); }
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────────────

  window.updateStatePathsRow = updateStatePathsRow;
  window.updateScanSourcesRow = updateScanSourcesRow;
  window.resizeLiveScannedJsonlChartIfAny = resizeLiveScannedJsonlChartIfAny;
  window.updateLiveFilesPanel = updateLiveFilesPanel;
  window.liveExtOneLiner = liveExtOneLiner;
  window.updateLiveOutageAndExtensionSections = updateLiveOutageAndExtensionSections;
  window.updateLiveSidePanel = updateLiveSidePanel;
  window.updateMetaDetailsSummary = updateMetaDetailsSummary;
  window.initMetaDetailsPanel = initMetaDetailsPanel;
})();
