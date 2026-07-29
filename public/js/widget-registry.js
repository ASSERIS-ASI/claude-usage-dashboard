/**
 * @asseris-module       Widget Registry
 * @asseris-description  Auto-annotated module metadata for public/js/widget-registry.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Widget Registry — Central manifest of all dashboard sections and charts.
 *
 * Every chart in the dashboard has an entry here. The registry serves as:
 *   1. Migration tracker (Chart.js → ECharts)
 *   2. Foundation for the widget builder (drag & drop layout)
 *   3. Data-source dependency map (which API feeds which chart)
 *
 * engine: "chartjs" = legacy, "echarts" = migrated, "google" = Google Charts
 *
 * Layer 1 (registry v2): every section and chart gets
 *   visible (boolean), order (number), tags (string[])
 * via normalizeWidgetRegistryLayer1() — defaults can be overridden on literals later.
 *
 * Layer 2 (registry v3): every section gets dispatcher fields:
 *   domId (string|null)      — <details> element ID for visibility/reorder
 *   sectionRenderFn (string) — global function name called by dispatcher
 *   companionIds (string[])  — sibling DOM elements that move with the section
 *   reorderable (boolean)    — false for popup/nested sections
 *
 * Layer 4 (modular widgets): optional per-chart/chip:
 *   kind (string)            — "chart" | "chip" (default chart for ECharts)
 *   widgetGroup (string)     — sidebar: cluster under one expandable group (e.g. "kernbefunde")
 *
 * Usage:
 *   window.__widgetRegistry.sections  — all section definitions
 *   window.__widgetRegistry.findChart("ts-c1")  — lookup by chart ID (token stats main chart)
 *   window.__widgetRegistry.findSection("proxy")  — lookup by section ID
 *   window.__widgetRegistry.getSectionsSorted()  — sections by order
 *   window.__widgetRegistry.getChartsSorted("proxy")  — charts in section by order
 */
'use strict';

(function () {
  /**
   * Assigns visible, order, tags to each section/chart if missing.
   * Section order follows SECTION_ORDER; chart order is a global sequence (gaps of 10).
   */
  function normalizeWidgetRegistryLayer1(reg) {
    var sectionOrderIds = [
      'health',
      'token-stats',
      'forensic',
      'user-profile',
      'budget',
      'proxy',
      'anthropic-status',
      'economic',
      'cost-intelligence',
      'efficiency-range'
    ];
    var sectionTagsById = {
      health: ['overview'],
      'token-stats': ['usage', 'tokens', 'performance'],
      forensic: ['usage', 'forensics'],
      'user-profile': ['usage', 'profile'],
      budget: ['cost', 'budget'],
      proxy: ['proxy', 'performance'],
      'cost-intelligence': ['cost', 'forensic', 'reconciliation'],
      'anthropic-status': ['status', 'reliability'],
      economic: ['cost', 'sessions'],
      'efficiency-range': ['performance', 'range']
    };
    var chartTagOverrides = {
      'proxy-hourly-latency': ['proxy', 'latency'],
      'proxy-latency': ['proxy', 'latency'],
      'econ-budget-drain': ['cost', 'budget', 'sessions'],
      'eff-heatmap': ['performance', 'proxy']
    };
    var orderPos = {};
    for (var oi = 0; oi < sectionOrderIds.length; oi++) {
      orderPos[sectionOrderIds[oi]] = (oi + 1) * 10;
    }
    var globalChartOrder = 0;
    for (var si = 0; si < reg.sections.length; si++) {
      var sec = reg.sections[si];
      if (sec.visible === undefined) sec.visible = true;
      if (sec.order === undefined) {
        sec.order = orderPos[sec.id] != null ? orderPos[sec.id] : (si + 1) * 100;
      }
      if (sec.tags === undefined) {
        sec.tags = (sectionTagsById[sec.id] || []).slice();
      }
      var charts = sec.charts || [];
      for (var ch of charts) {
        if (ch.visible === undefined) ch.visible = true;
        if (ch.order === undefined) {
          globalChartOrder += 10;
          ch.order = globalChartOrder;
        }
        if (ch.tags === undefined) {
          ch.tags = chartTagOverrides[ch.id]
            ? chartTagOverrides[ch.id].slice()
            : sec.tags.slice();
        }
      }
    }
  }

  var registry = {
    version: 3,
    sections: [
      // ── Health Score ────────────────────────────────────────────
      {
        id: 'health',
        titleKey: 'healthScoreTitle',
        domId: 'health-collapse',
        sectionRenderFn: 'renderHealthScore',
        reorderable: true,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'health-finding-jsonlProxyGap', titleKey: 'findingThinkingGap', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-jsonlProxyGap', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-overhead', titleKey: 'findingOverhead', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-overhead', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-hitLimits', titleKey: 'findingHitLimits', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-hitLimits', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-interrupts', titleKey: 'findingInterrupts', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-interrupts', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-quota', titleKey: 'findingQuota', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-quota', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-fallback', titleKey: 'findingFallback', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-fallback', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-overage', titleKey: 'findingOveragePolicy', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-overage', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-claim', titleKey: 'findingClaim', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-claim', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-peakDay', titleKey: 'findingPeakDay', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-peakDay', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-retries', titleKey: 'findingRetries', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-retries', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-finding-cacheParadox', titleKey: 'findingCacheParadox', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-finding-cacheParadox', widgetGroup: 'kernbefunde', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-quota5h', titleKey: 'healthQuota5h', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-quota5h', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-thinkingGap', titleKey: 'healthThinkingGap', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-thinkingGap', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-cacheHealth', titleKey: 'healthCacheHealth', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-cacheHealth', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-errorRate', titleKey: 'healthErrorRate', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-errorRate', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-hitLimits', titleKey: 'healthHitLimits', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-hitLimits', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-latency', titleKey: 'healthLatency', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-latency', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-interrupts', titleKey: 'healthInterrupts', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-interrupts', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-coldStarts', titleKey: 'healthColdStarts', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-coldStarts', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-retries', titleKey: 'healthRetries', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-retries', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-false429', titleKey: 'healthFalse429', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-false429', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-truncations', titleKey: 'healthTruncations', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-truncations', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-contextResets', titleKey: 'healthContextResets', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-contextResets', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-quotaBench', titleKey: 'healthQuotaBench', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-quotaBench', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' },
          { id: 'health-kpi-anomalStops', titleKey: 'healthAnomalStops', kind: 'chip', engine: 'html', type: 'cards', canvasId: 'health-kpi-anomalStops', widgetGroup: 'health-kpis', renderFn: 'renderHealthScore' }
        ]
      },

      // ── Token Stats ────────────────────────────────────────────
      {
        id: 'token-stats',
        titleKey: 'sectionTokenStats',
        domId: 'token-stats-collapse',
        sectionRenderFn: 'renderTokenStatsSection',
        companionIds: ['day-picker-row', 'main-charts-scope-wrap'],
        reorderable: true,
        defaultOpen: true,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'token-stats-kpi-day-output', titleKey: 'cardDayOutput', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-day-output', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-day-cache-read', titleKey: 'cardDayCacheRead', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-day-cache-read', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-day-total', titleKey: 'cardDayTotal', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-day-total', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-hit-day', titleKey: 'cardHitDay', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-hit-day', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-hit-all', titleKey: 'cardHitAll', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-hit-all', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-overhead', titleKey: 'cardOverhead', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-overhead', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-peak', titleKey: 'cardPeak', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-peak', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-all-out', titleKey: 'cardAllOut', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-all-out', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-all-cache', titleKey: 'cardAllCache', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-all-cache', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-session-signals', titleKey: 'cardSessionSignals', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-session-signals', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          { id: 'token-stats-kpi-hosts', titleKey: 'tokenStatsHostKpiGroup', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'token-stats-kpi-hosts', widgetGroup: 'token-stats-kpis', renderFn: 'renderTokenStatsSection' },
          {
            id: 'ts-c1',
            titleKey: 'tokenStatsChartC1',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c1',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderTokenStats_c1_daily'
          },
          {
            id: 'ts-c2',
            titleKey: 'tokenStatsChartC2',
            type: 'line',
            engine: 'echarts',
            canvasId: 'c2',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderTokenStats_c2_daily'
          },
          {
            id: 'ts-c3',
            titleKey: 'tokenStatsChartC3',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'c3',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderTokenStats_c3_daily'
          },
          {
            id: 'ts-c4',
            titleKey: 'tokenStatsChartC4',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c4',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderTokenStats_c4_hourly'
          },
          {
            id: 'ts-hosts',
            titleKey: 'chartTokenHosts',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c1-hosts',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderTokenStats_c1hosts'
          },
          {
            id: 'token-stats-daily-detail',
            titleKey: 'tokenStatsDailyDetailTable',
            kind: 'chip',
            type: 'table',
            engine: 'html',
            canvasId: 'token-stats-daily-detail',
            size: { cols: 1, minHeight: 0 },
            renderFn: 'renderTokenStatsSection'
          }
        ]
      },

      // ── Forensic Analysis ──────────────────────────────────────
      {
        id: 'forensic',
        titleKey: 'sectionForensic',
        domId: 'forensic-collapse',
        sectionRenderFn: 'renderForensicSection',
        reorderable: true,
        defaultOpen: true,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'forensic-card-code', titleKey: 'fcForensicDay', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'forensic-card-code', widgetGroup: 'forensic-cards', renderFn: 'renderForensicSection' },
          { id: 'forensic-card-impl', titleKey: 'fcImpl', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'forensic-card-impl', widgetGroup: 'forensic-cards', renderFn: 'renderForensicSection' },
          { id: 'forensic-card-budget', titleKey: 'fcBudget', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'forensic-card-budget', widgetGroup: 'forensic-cards', renderFn: 'renderForensicSection' },
          {
            id: 'forensic-hitlimit',
            titleKey: 'chartForensicHitLimit',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-forensic',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderForensic_main'
          },
          {
            id: 'forensic-signals',
            titleKey: 'chartForensicSignals',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-forensic-signals',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderForensic_signals'
          },
          {
            id: 'forensic-service',
            titleKey: 'chartForensicService',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-service',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderForensic_service'
          }
        ]
      },

      // ── User Profile ───────────────────────────────────────────
      {
        id: 'user-profile',
        titleKey: 'sectionUserProfile',
        domId: 'user-profile-collapse',
        sectionRenderFn: 'renderUserProfileCharts',
        reorderable: true,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          {
            id: 'user-versions',
            titleKey: 'chartUserVersions',
            type: 'bar-horizontal',
            engine: 'echarts',
            canvasId: 'c-user-versions',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderUserProfile_versions'
          },
          {
            id: 'user-entrypoints',
            titleKey: 'chartUserEntrypoints',
            type: 'bar-horizontal',
            engine: 'echarts',
            canvasId: 'c-user-entrypoints',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderUserProfile_entrypoints'
          },
          {
            id: 'user-release-stability',
            titleKey: 'chartUserReleaseStability',
            type: 'bar-horizontal',
            engine: 'echarts',
            canvasId: 'c-user-release-stability',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderUserProfile_releaseStability'
          }
        ]
      },

      // ── Budget Efficiency ──────────────────────────────────────
      {
        id: 'budget',
        titleKey: 'sectionBudget',
        domId: 'budget-collapse',
        sectionRenderFn: 'renderBudgetEfficiency',
        reorderable: true,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'budget-kpi-output', titleKey: 'budgetCardOutput', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-output', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          { id: 'budget-kpi-overhead', titleKey: 'budgetCardOverhead', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-overhead', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          { id: 'budget-kpi-cache-miss', titleKey: 'budgetCardCacheMiss', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-cache-miss', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          { id: 'budget-kpi-lost', titleKey: 'budgetCardLost', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-lost', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          { id: 'budget-kpi-outage', titleKey: 'budgetCardOutage', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-outage', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          { id: 'budget-kpi-truncated', titleKey: 'budgetCardTruncated', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'budget-kpi-truncated', widgetGroup: 'budget-kpis', renderFn: 'renderBudgetEfficiency' },
          {
            id: 'budget-sankey',
            titleKey: 'chartBudgetSankey',
            type: 'sankey',
            engine: 'echarts',
            canvasId: 'c-budget-sankey',
            size: { cols: 2, minHeight: 350 },
            renderFn: 'renderBudget_sankey'
          },
          {
            id: 'budget-trend',
            titleKey: 'chartBudgetTrend',
            type: 'line',
            engine: 'echarts',
            canvasId: 'c-budget-trend',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderBudget_trend'
          },
          {
            id: 'budget-quota',
            titleKey: 'chartBudgetQuota',
            type: 'line',
            engine: 'echarts',
            canvasId: 'c-budget-quota',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderBudget_quota'
          }
        ]
      },

      // ── Proxy Analytics ────────────────────────────────────────
      {
        id: 'proxy',
        titleKey: 'sectionProxy',
        domId: 'proxy-collapse',
        sectionRenderFn: 'renderProxyAnalysis',
        reorderable: true,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'proxy-kpi-requests', titleKey: 'proxyCardRequests', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-requests', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-latency', titleKey: 'proxyCardLatency', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-latency', widgetGroup: 'proxy-kpis', fullProxyOnly: true, renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-cache-ratio', titleKey: 'proxyCardCacheRatio', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-cache-ratio', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-models', titleKey: 'proxyCardModels', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-models', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-quota-5h', titleKey: 'proxyCardQuota5h', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-quota-5h', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-quota-7d', titleKey: 'proxyCardQuota7d', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-quota-7d', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-ttl-tier', titleKey: 'proxyTtlTier', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-ttl-tier', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-peak-hours', titleKey: 'proxyDataSource', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-peak-hours', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-saturation', titleKey: 'proxySaturation', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-saturation', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          { id: 'proxy-kpi-health', titleKey: 'proxyHealth', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'proxy-kpi-health', widgetGroup: 'proxy-kpis', renderFn: 'renderProxyAnalysis' },
          {
            id: 'proxy-tokens',
            titleKey: 'proxyTokenChartTitle',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-proxy-tokens',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderProxy_tokens'
          },
          {
            id: 'proxy-latency',
            titleKey: 'proxyLatencyChartTitle',
            type: 'line',
            engine: 'echarts',
            canvasId: 'c-proxy-latency',
            size: { cols: 1, minHeight: 260 },
            fullProxyOnly: true,
            renderFn: 'renderProxy_latency'
          },
          {
            id: 'proxy-hourly',
            titleKey: 'proxyHourlyTitle',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'c-proxy-hourly',
            size: { cols: 1, minHeight: 200 },
            renderFn: 'renderProxy_hourly'
          },
          {
            id: 'proxy-models',
            titleKey: 'proxyModelTitle',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-proxy-models',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderProxy_models'
          },
          {
            id: 'proxy-hourly-latency',
            titleKey: 'proxyHourlyLatencyTitle',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'c-proxy-hourly-latency',
            size: { cols: 1, minHeight: 200 },
            fullProxyOnly: true,
            renderFn: 'renderProxy_hourlyLatency'
          },
          {
            id: 'proxy-error-trend',
            titleKey: 'proxyErrorTrendTitle',
            type: 'line',
            engine: 'echarts',
            canvasId: 'c-proxy-error-trend',
            size: { cols: 1, minHeight: 200 },
            fullProxyOnly: true,
            renderFn: 'renderProxy_errorTrend'
          },
          {
            id: 'proxy-cache-trend',
            titleKey: 'proxyCacheTrendTitle',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-proxy-cache-trend',
            size: { cols: 1, minHeight: 200 },
            renderFn: 'renderProxy_cacheTrend'
          },
          {
            id: 'proxy-ttl-history',
            titleKey: 'proxyTtlHistoryTitle',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-proxy-ttl-history',
            size: { cols: 1, minHeight: 200 },
            renderFn: 'renderProxy_ttlHistory'
          },
          {
            id: 'proxy-cache-fix-activity',
            titleKey: 'proxyCacheFixActivityTitle',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-proxy-cache-fix-activity',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderProxy_cacheFixActivity'
          },
        ]
      },

      // ── Security Postures ─────────────────────────────────────
      {
        id: 'security-postures',
        titleKey: 'secPosturesTitle',
        domId: 'security-postures-collapse',
        sectionRenderFn: 'renderSecurityPostures',
        reorderable: true,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'sec-kpi-total', titleKey: 'secKpiTotal', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'sec-kpi-total', widgetGroup: 'sec-kpis', renderFn: 'renderSecurityPostures' },
          { id: 'sec-kpi-critical', titleKey: 'secKpiCritical', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'sec-kpi-critical', widgetGroup: 'sec-kpis', renderFn: 'renderSecurityPostures' },
          { id: 'sec-kpi-high', titleKey: 'secKpiHigh', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'sec-kpi-high', widgetGroup: 'sec-kpis', renderFn: 'renderSecurityPostures' },
          // Keep the legacy DOM/widget id so saved layouts remain compatible.
          { id: 'sec-kpi-scrubbed', titleKey: 'secKpiMedium', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'sec-kpi-scrubbed', widgetGroup: 'sec-kpis', renderFn: 'renderSecurityPostures' },
          {
            id: 'sec-timeline',
            titleKey: 'secTimelineTitle',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-sec-timeline',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderSecurityPostures'
          },
          {
            id: 'sec-categories',
            titleKey: 'secCategoriesTitle',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'c-sec-categories',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderSecurityPostures'
          },
          {
            id: 'sec-heatmap',
            titleKey: 'secHeatmapTitle',
            type: 'heatmap',
            engine: 'echarts',
            canvasId: 'c-sec-heatmap',
            size: { cols: 2, minHeight: 280 },
            renderFn: 'renderSecurityPostures'
          }
        ]
      },

      // ── Cost Forensic ───────────────────────────────────────────
      {
        id: 'cost-intelligence',
        titleKey: 'cfSectionTitle',
        domId: 'cost-intelligence-collapse',
        sectionRenderFn: 'renderCostIntelligence',
        reorderable: true,
        defaultOpen: true,
        dataSource: '/api/usage',
        requires: ['usage'],
        charts: [
          { id: 'cf-hero-strip', titleKey: 'cfHeroSpentToday', kind: 'chip', type: 'cards', engine: 'html', canvasId: 'cf-hero-strip', widgetGroup: 'cf-hero', renderFn: 'renderCostIntelligence' },
          { id: 'cf-reconciliation', titleKey: 'cfReconTitle', type: 'html', engine: 'html', canvasId: 'cf-reconciliation', renderFn: 'renderCostIntelligence' },
          { id: 'cf-counterfactual', titleKey: 'cfCounterTitle', type: 'html', engine: 'html', canvasId: 'cf-counterfactual', renderFn: 'renderCostIntelligence' },
          { id: 'cf-cost-fever', titleKey: 'cfCostFeverTitle', type: 'line', engine: 'echarts', canvasId: 'c-cf-cost-fever', size: { cols: 2, minHeight: 420 }, renderFn: 'renderCostIntelligence' },
          { id: 'cf-top5-sessions', titleKey: 'cfTop5Title', type: 'table', engine: 'html', canvasId: 'cf-top5-sessions', renderFn: 'renderCostIntelligence' },
          { id: 'cf-token-decomposition', titleKey: 'cfDecompTitle', type: 'bar', engine: 'html', canvasId: 'cf-token-decomposition', renderFn: 'renderCostIntelligence' }
        ]
      },

      // ── Anthropic Status ───────────────────────────────────────
      {
        id: 'anthropic-status',
        titleKey: 'sectionAnthropicStatus',
        domId: null,
        reorderable: false,
        defaultOpen: false,
        dataSource: '/api/usage',
        requires: ['usage', 'status'],
        charts: [
          {
            id: 'status-uptime',
            titleKey: 'chartStatusUptime',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-uptime-chart',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderStatus_uptime'
          },
          {
            id: 'status-incidents',
            titleKey: 'chartStatusIncidents',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-incident-history',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderStatus_incidents'
          },
          {
            id: 'status-outage-scatter',
            titleKey: 'chartStatusOutageScatter',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'c-anthropic-incidents',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderStatus_outageScatter'
          },
          {
            id: 'status-outage-timeline',
            titleKey: 'chartStatusOutageTimeline',
            type: 'bar-stacked',
            engine: 'echarts',
            canvasId: 'c-outage-timeline',
            size: { cols: 1, minHeight: 260 },
            renderFn: 'renderStatus_outageTimeline'
          }
        ]
      },

      // ── Economic Usage (already ECharts) ───────────────────────
      {
        id: 'economic',
        titleKey: 'sectionEconomic',
        domId: 'economic-collapse',
        sectionRenderFn: 'renderEconomicSection',
        reorderable: true,
        defaultOpen: false,
        lazy: true,
        dataSource: '/api/session-turns',
        requires: ['sessions'],
        charts: [
          {
            id: 'econ-explosion',
            titleKey: 'econExplosionTitle',
            type: 'scatter',
            engine: 'echarts',
            canvasId: 'chart-shell-econ-explosion',
            size: { cols: 2, minHeight: 350 },
            renderFn: 'renderCacheExplosion'
          },
          {
            id: 'econ-budget-drain',
            titleKey: 'econBudgetDrainTitle',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'chart-shell-econ-drain',
            size: { cols: 3, minHeight: 400 },
            renderFn: 'renderBudgetDrain'
          },
        ]
      },

      // ── Efficiency Range (nested in Economic, already ECharts) ─
      {
        id: 'efficiency-range',
        titleKey: 'sectionEfficiencyRange',
        domId: 'econ-range-collapse',
        reorderable: false,
        defaultOpen: false,
        parentSection: 'economic',
        dataSource: '/api/session-turns',
        requires: ['sessions'],
        charts: [
          {
            id: 'eff-efficiency-timeline',
            titleKey: 'econEfficiencyTitle',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'chart-shell-econ-efficiency',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderEfficiencyTimeline'
          },
          {
            id: 'eff-monthly-butterfly',
            titleKey: 'econWasteMonthTitle',
            type: 'bar',
            engine: 'echarts',
            canvasId: 'chart-shell-econ-waste-month',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderMonthlyButterfly'
          },
          {
            id: 'eff-day-comparison',
            titleKey: 'econDayCompareTitle',
            type: 'mixed',
            engine: 'echarts',
            canvasId: 'chart-shell-econ-daycompare',
            size: { cols: 1, minHeight: 300 },
            renderFn: 'renderDayComparison'
          }
        ]
      }
    ],

    // ── Lookup helpers ──────────────────────────────────────────
    findChart: function (chartId) {
      for (var sec of this.sections) {
        for (var ch of sec.charts) {
          if (ch.id === chartId) return ch;
        }
      }
      return null;
    },

    findSection: function (sectionId) {
      for (var sec of this.sections) {
        if (sec.id === sectionId) return sec;
      }
      return null;
    },

    getSectionsSorted: function () {
      var out = this.sections.slice();
      out.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      return out;
    },

    /**
     * @param {string|object} sectionOrId  section id or section object from findSection
     * @returns {object[]} chart defs sorted by order (mutates nothing)
     */
    getChartsSorted: function (sectionOrId) {
      var sec = typeof sectionOrId === 'string' ? this.findSection(sectionOrId) : sectionOrId;
      if (!sec || !sec.charts) return [];
      var arr = sec.charts.slice();
      arr.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      return arr;
    },

    allCharts: function () {
      var result = [];
      for (var sec of this.sections) {
        for (var c of sec.charts) {
          c.section = sec.id;
          result.push(c);
        }
      }
      return result;
    },

    stats: function () {
      var all = this.allCharts();
      var engines = { chartjs: 0, echarts: 0, google: 0 };
      for (var ch of all) {
        engines[ch.engine] = (engines[ch.engine] || 0) + 1;
      }
      var visibleSections = 0;
      var visibleCharts = 0;
      for (var sec of this.sections) {
        if (sec.visible !== false) visibleSections++;
        var chs = sec.charts || [];
        for (var c of chs) {
          if (c.visible !== false) visibleCharts++;
        }
      }
      return {
        version: this.version,
        sections: this.sections.length,
        charts: all.length,
        visibleSections: visibleSections,
        visibleCharts: visibleCharts,
        engines: engines
      };
    }
  };

  normalizeWidgetRegistryLayer1(registry);
  window.__widgetRegistry = registry;
})();
