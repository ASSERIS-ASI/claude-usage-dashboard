/**
 * @asseris-module       Intelligence
 * @asseris-description  Auto-annotated module metadata for public/js/sections/intelligence.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
(function () { try {

// ── Intelligence / Predictive Metrics Section ────────────────────────────

let _intelCharts = { seasonality: null };

// Klassifikations-Helfer (ersetzen verschachtelte Ternaries, S3358).
function _satClass(s) {
  if (s >= 75) return 'danger';
  if (s >= 40) return 'warn';
  return 'ok';
}

function _healthClass(h) {
  if (h < 50) return 'danger';
  if (h < 75) return 'warn';
  return 'ok';
}

function _satSub(cls) {
  if (cls === 'ok') return 'Low stress';
  if (cls === 'warn') return 'Elevated';
  return 'Critical';
}

function _healthSub(cls) {
  if (cls === 'ok') return 'Good';
  if (cls === 'warn') return 'Degraded';
  return 'Poor';
}

function _etaLabel(eta) {
  if (eta.minutesLeft <= 0) return '—';
  if (eta.minutesLeft >= 60) return Math.floor(eta.minutesLeft / 60) + 'h ' + (eta.minutesLeft % 60) + 'm';
  return eta.minutesLeft + 'm';
}

// Positive Bedingung zuerst (S7735): Suffix nur, wenn Confidence bekannt ist.
function _etaConfidenceSuffix(eta) {
  return eta.confidence === 'none' ? '' : ' (' + eta.confidence + ')';
}

function _renderIntelScores(scoresEl, metrics) {
  let satCls = _satClass(metrics.saturation);
  let healthCls = _healthClass(metrics.healthScore);
  let eta = metrics.quotaETA;
  let etaCls = eta.minutesLeft > 0 && eta.minutesLeft < 60 ? 'warn' : '';

  let cards = [
    { wid: 'intel-saturation', label: t('intelSaturation'), value: metrics.saturation + '/100', sub: _satSub(satCls), cls: satCls },
    { wid: 'intel-health', label: t('intelHealth'), value: metrics.healthScore + '/100', sub: _healthSub(healthCls), cls: healthCls },
    { wid: 'intel-quota-eta', label: t('intelQuotaEta'), value: _etaLabel(eta), sub: eta.pct5h + '% used' + _etaConfidenceSuffix(eta), cls: etaCls }
  ];
  let ch = '';
  for (let c of cards) {
    ch += '<div class="chart-box chart-box--kpi" id="' + c.wid + '"><div class="card ' + c.cls + '">' +
      '<div class="label">' + escHtml(c.label) + '</div>' +
      '<div class="value">' + escHtml(c.value) + '</div>' +
      '<div class="sub">' + escHtml(c.sub) + '</div></div></div>';
  }
  scoresEl.innerHTML = ch;
}

function _intelDotClass(line) {
  if (line.includes('critical') || line.includes('poor') || line.includes('high')) return 'intel-dot intel-dot--red';
  if (line.includes('elevated') || line.includes('degraded')) return 'intel-dot intel-dot--yellow';
  return 'intel-dot intel-dot--green';
}

function _renderIntelNarrative(narrativeEl, metrics) {
  if (!narrativeEl || !metrics.narrative.length) return;
  let nh = '<div class="intel-narrative-box" id="intel-narrative">';
  for (let line of metrics.narrative) {
    nh += '<div class="intel-narrative-line"><span class="' + _intelDotClass(line) + '"></span> ' + escHtml(line) + '</div>';
  }
  nh += '</div>';
  narrativeEl.innerHTML = nh;
}

function _renderIntelRootCause(rootCauseEl, metrics) {
  if (!rootCauseEl) return;
  // Root cause nur bei erhöhter Saturation; sonst leeren.
  if (!metrics.rootCause.length || metrics.saturation < 40) { rootCauseEl.innerHTML = ''; return; }
  let rh = '<div class="intel-rootcause-box"><h4>' + t('intelRootCauseTitle') + '</h4>';
  for (let rc of metrics.rootCause) {
    let rcCls = rc.severity === 'high' ? 'intel-rc--high' : 'intel-rc--medium';
    rh += '<div class="intel-rc-item ' + rcCls + '">' + escHtml(rc.factor) + ' <strong>' + escHtml(rc.pct) + '</strong></div>';
  }
  rh += '</div>';
  rootCauseEl.innerHTML = rh;
}

function renderIntelligenceSection(data) {
  let sumEl = document.getElementById('intelligence-summary-line');
  let scoresEl = document.getElementById('intelligence-scores');
  let narrativeEl = document.getElementById('intelligence-narrative');
  let rootCauseEl = document.getElementById('intelligence-rootcause');
  if (!sumEl) return;

  let engine = globalThis.__metricsEngine;
  if (!engine) { sumEl.textContent = t('intelNoData'); return; }

  let proxyDays = data.proxy?.proxy_days || [];
  if (!proxyDays.length) { sumEl.textContent = t('intelNoData'); return; }

  // Compute health indicators (reuse existing function)
  let indicators = typeof computeHealthIndicators === 'function'
    ? computeHealthIndicators(data) : null;

  let metrics = engine.computeAll(data, indicators);

  // Summary line
  sumEl.textContent = tr('intelSummaryLine', {
    sat: String(metrics.saturation),
    health: String(metrics.healthScore),
    q5: String(metrics.quotaETA.pct5h)
  });

  if (scoresEl) _renderIntelScores(scoresEl, metrics);
  _renderIntelNarrative(narrativeEl, metrics);
  _renderIntelRootCause(rootCauseEl, metrics);

  // Seasonality chart
  renderIntelSeasonalityChart(metrics.seasonality);
}

/** Standalone: render seasonality bar chart. */
globalThis.renderIntel_seasonality = function (sCtx) {
  let seasonal = sCtx || globalThis.__metricsEngine?._lastSeasonality;
  if (!seasonal) return;
  renderIntelSeasonalityChart(seasonal);
};

function renderIntelSeasonalityChart(seasonal) {
  if (!seasonal?.byHour) return;
  let el = document.getElementById('c-intel-seasonality');
  if (!el) return;

  if (typeof echarts === 'undefined') return;
  if (_intelCharts.seasonality) { _intelCharts.seasonality.dispose(); _intelCharts.seasonality = null; }

  _intelCharts.seasonality = echarts.init(el, null, { renderer: 'canvas' });

  let labels = [];
  let values = [];
  let latValues = [];
  for (let bh of seasonal.byHour) {
    labels.push(String(bh.hour).padStart(2, '0') + ':00');
    values.push(bh.avgRequests);
    latValues.push(bh.avgLatencyMs);
  }

  _intelCharts.seasonality.setOption({
    animation: false,
    grid: { left: 40, right: 50, top: 30, bottom: 30 },
    legend: { data: ['Requests', 'Latency (ms)'], textStyle: { color: '#EFE7D6', fontSize: 10 }, top: 2 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' } },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#A0875E', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
    yAxis: [
      { type: 'value', min: 0, axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.5)' } } },
      { type: 'value', min: 0, axisLabel: { color: '#f59e0b', fontSize: 10, formatter: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 's' : v + 'ms'; } }, splitLine: { show: false } }
    ],
    series: [
      { name: 'Requests', type: 'bar', data: values, itemStyle: { color: function (p) { return p.dataIndex === seasonal.peakHour ? 'rgba(239,68,68,0.7)' : 'rgba(184,145,90,0.6)'; }, borderRadius: [3, 3, 0, 0] } },
      { name: 'Latency (ms)', type: 'line', yAxisIndex: 1, data: latValues, smooth: 0.3, symbol: 'circle', symbolSize: 4,
        lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' } }
    ]
  }, true);
  if (typeof globalThis.__safeChartResize === 'function') { globalThis.__safeChartResize(_intelCharts.seasonality); }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () {
      if (typeof globalThis.__safeChartResize === 'function') { globalThis.__safeChartResize(_intelCharts.seasonality); }
    });
  }
}

globalThis.renderIntelligenceSection = renderIntelligenceSection;
globalThis._intelCharts = _intelCharts;

} catch (e) { if (globalThis.appLogger) globalThis.appLogger.errorM('ui-section-intelligence', 'init', 'fail', e?.message || e); } })();
