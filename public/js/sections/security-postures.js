'use strict';
(function () {
  var charts = { timeline: null, categories: null, heatmap: null, table: null };
  var lastFingerprint = '';
  var TYPE_SEVERITY = {
    sudo_escalation: 'high', no_verify: 'medium', credential_in_command: 'critical',
    token_in_command: 'critical', private_key: 'critical', inline_credential_url: 'critical',
    git_reset_hard: 'high', git_force_push: 'high', rm_rf: 'high', kubectl_delete: 'high',
    chmod_dangerous: 'medium', env_file_read: 'medium'
  };
  var TYPE_LABELS = {
    sudo_escalation: 'sudo', no_verify: '--no-verify',
    credential_in_command: 'Credentials', token_in_command: 'Tokens',
    private_key: 'Private Keys', inline_credential_url: 'Inline URL Creds',
    git_reset_hard: 'git reset --hard', git_force_push: 'git push --force',
    rm_rf: 'rm -rf', kubectl_delete: 'kubectl delete',
    chmod_dangerous: 'chmod 777', env_file_read: '.env read'
  };
  function t(key) { return window.t ? window.t(key) : key; }
  function tr(key, values) { return window.tr ? window.tr(key, values) : key; }
  function esc(value) { return window.escHtml ? window.escHtml(value) : String(value); }

  function renderSecurityPostures(data) {
    var summary = document.getElementById('security-postures-summary');
    var kpis = document.getElementById('security-postures-kpis');
    if (!summary) return;
    var totals = { critical: 0, high: 0, medium: 0, total: 0 };
    var byType = {};
    var timeline = [];
    var events = [];
    for (var day of data.days || []) {
      var security = day.security_postures || {};
      totals.critical += security.critical || 0;
      totals.high += security.high || 0;
      totals.medium += security.medium || 0;
      totals.total += security.total || 0;
      timeline.push({
        date: day.date,
        critical: security.critical || 0,
        high: security.high || 0,
        medium: security.medium || 0
      });
      for (var type in security.by_type || {}) {
        byType[type] = (byType[type] || 0) + security.by_type[type];
      }
      for (var event of security.events || []) {
        events.push({
          date: day.date, ts: event.ts, type: event.type,
          severity: event.severity, action: event.action, source: 'jsonl'
        });
      }
    }
    var fingerprint = [
      totals.total, totals.critical, Object.keys(byType).length,
      (data.days || []).map(function (d) { return d.date; }).join(','),
      window.__dashboardState?.getFilterHost?.() || ''
    ].join('|');
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    if (!totals.total) {
      summary.textContent = 'Security — no JSONL findings';
      if (kpis) kpis.innerHTML = '';
      return;
    }
    summary.textContent = tr('secPosturesSummary', {
      total: totals.total,
      critical: totals.critical,
      high: totals.high,
      medium: totals.medium
    });
    if (kpis) {
      var cards = [
        ['secKpiTotal', totals.total, timeline.length + ' ' + t('secEvDate'), totals.total > 50 ? 'warn' : '', ''],
        ['secKpiCritical', totals.critical, countTypes(byType, 'critical') + ' types', totals.critical ? 'danger' : '', totals.critical ? '#ef4444' : ''],
        ['secKpiHigh', totals.high, countTypes(byType, 'high') + ' types', totals.high > 10 ? 'warn' : '', totals.high ? '#f59e0b' : ''],
        ['secKpiMedium', totals.medium, countTypes(byType, 'medium') + ' types', '', totals.medium ? '#D4AF7F' : '']
      ];
      kpis.innerHTML = cards.map(function (card) {
        var valueStyle = card[4] ? ' style="color:' + card[4] + '"' : '';
        return '<div class="chart-box chart-box--kpi"><div class="card ' + card[3] + '">' +
          '<div class="label">' + esc(t(card[0])) + '</div><div class="value"' + valueStyle + '>' +
          card[1] + '</div><div class="sub">' + esc(card[2]) + '</div></div></div>';
      }).join('');
    }
    setTitles();
    renderTimeline(timeline);
    renderCategories(byType);
    renderHeatmap(data.days || [], timeline, byType);
    renderEvents(events);
  }

  function countTypes(byType, severity) {
    return Object.keys(byType).filter(function (key) { return TYPE_SEVERITY[key] === severity; }).length;
  }

  function setTitles() {
    var titles = {
      'sec-timeline-h3': 'secTimelineTitle',
      'sec-categories-h3': 'secCategoriesTitle',
      'sec-heatmap-h3': 'secHeatmapTitle',
      'sec-events-h3': 'secEventsTitle'
    };
    for (var id in titles) {
      var el = document.getElementById(id);
      if (el) el.textContent = t(titles[id]);
    }
  }

  function renderTimeline(timeline) {
    var host = document.getElementById('c-sec-timeline');
    if (!host || typeof echarts === 'undefined') return;
    if (charts.timeline) charts.timeline.dispose();
    charts.timeline = echarts.init(host, null, { renderer: 'canvas' });
    charts.timeline.setOption({
      animation: false,
      tooltip: { trigger: 'axis' },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' } },
      legend: { data: ['Critical', 'High', 'Medium'], textStyle: { color: '#A0875E' }, bottom: 0 },
      grid: { left: 40, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: timeline.map(function (row) { return row.date.slice(5); }), axisLabel: { color: '#A0875E', rotate: 45, fontSize: 9 } },
      yAxis: { type: 'value', axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
      series: [
        { name: 'Critical', type: 'bar', stack: 'security', data: timeline.map(function (row) { return row.critical; }), itemStyle: { color: '#ef4444' } },
        { name: 'High', type: 'bar', stack: 'security', data: timeline.map(function (row) { return row.high; }), itemStyle: { color: '#f59e0b' } },
        { name: 'Medium', type: 'bar', stack: 'security', data: timeline.map(function (row) { return row.medium; }), itemStyle: { color: '#D4AF7F' } }
      ]
    });
  }

  function renderCategories(byType) {
    var host = document.getElementById('c-sec-categories');
    if (!host || typeof echarts === 'undefined') return;
    if (charts.categories) charts.categories.dispose();
    var rows = Object.keys(byType).map(function (key) { return [key, byType[key]]; })
      .sort(function (left, right) { return left[1] - right[1]; });
    charts.categories = echarts.init(host, null, { renderer: 'canvas' });
    charts.categories.setOption({
      animation: false,
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' } },
      grid: { left: 120, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', axisLabel: { color: '#A0875E' }, splitLine: { lineStyle: { color: 'rgba(42,45,52,0.3)' } } },
      yAxis: { type: 'category', data: rows.map(function (row) { return TYPE_LABELS[row[0]] || row[0]; }), axisLabel: { color: '#A0875E', fontSize: 11 } },
      series: [{
        type: 'bar',
        data: rows.map(function (row) {
          var severity = TYPE_SEVERITY[row[0]];
          return { value: row[1], itemStyle: { color: severity === 'critical' ? '#ef4444' : severity === 'high' ? '#f59e0b' : '#D4AF7F' } };
        }),
        label: { show: true, position: 'right', color: '#EFE7D6', fontSize: 11 }
      }]
    });
  }

  function renderHeatmap(days, timeline, byType) {
    var host = document.getElementById('c-sec-heatmap');
    if (!host || typeof echarts === 'undefined') return;
    if (charts.heatmap) charts.heatmap.dispose();
    var types = Object.keys(byType).sort();
    var activeDays = timeline.filter(function (row) { return row.critical + row.high + row.medium > 0; });
    var values = [];
    var max = 1;
    for (var dayIndex = 0; dayIndex < activeDays.length; dayIndex++) {
      var sourceDay = days.find(function (day) { return day.date === activeDays[dayIndex].date; });
      var dayTypes = sourceDay?.security_postures?.by_type || {};
      for (var typeIndex = 0; typeIndex < types.length; typeIndex++) {
        var value = dayTypes[types[typeIndex]] || 0;
        max = Math.max(max, value);
        values.push([dayIndex, typeIndex, value]);
      }
    }
    charts.heatmap = echarts.init(host, null, { renderer: 'canvas' });
    charts.heatmap.setOption({
      animation: false,
      tooltip: {
        backgroundColor: 'rgba(14,17,22,0.95)', borderColor: '#2A2D34', textStyle: { color: '#F7F3EC' },
        formatter: function (point) {
          return activeDays[point.value[0]].date.slice(5) + ' / ' +
            (TYPE_LABELS[types[point.value[1]]] || types[point.value[1]]) +
            '<br><strong>' + point.value[2] + '</strong>';
        }
      },
      grid: { left: 120, right: 60, top: 10, bottom: 60 },
      xAxis: { type: 'category', data: activeDays.map(function (row) { return row.date.slice(5); }), axisLabel: { color: '#A0875E', rotate: 45, fontSize: 9 } },
      yAxis: { type: 'category', data: types.map(function (key) { return TYPE_LABELS[key] || key; }), axisLabel: { color: '#A0875E', fontSize: 10 } },
      visualMap: { min: 0, max: max, calculable: true, orient: 'vertical', right: 0, top: 'center', inRange: { color: ['#1A1D24', '#164e63', '#0e7490', '#f59e0b', '#ef4444'] }, textStyle: { color: '#A0875E' } },
      series: [{ type: 'heatmap', data: values, label: { show: true, color: '#F7F3EC', fontSize: 9, formatter: function (point) { return point.value[2] || ''; } } }]
    });
  }

  function renderEvents(events) {
    var host = document.getElementById('sec-events-table-host');
    if (!host) return;
    events.sort(function (left, right) { return String(right.ts).localeCompare(String(left.ts)); });
    if (typeof jQuery !== 'undefined' && jQuery.fn.DataTable) {
      if (charts.table) charts.table.destroy();
      host.innerHTML = '<style>#sec-events-dt_wrapper .dt-paging{margin-top:15px}</style><table id="sec-events-dt" class="display compact nowrap" style="width:100%;font-size:.65rem"></table>';
      var parentHeight = host.parentElement?.offsetHeight || 600;
      charts.table = jQuery('#sec-events-dt').DataTable({
        data: events.map(function (event) {
          var color = event.severity === 'critical' ? '#ef4444' : event.severity === 'high' ? '#f59e0b' : '#D4AF7F';
          var type = String(event.type || '').replace(/_/g, ' ');
          if (event.action === 'block') type += ' <span style="color:#ef4444;font-size:.5rem">⛔ BLOCK</span>';
          return [
            event.ts ? event.ts.slice(0, 19).replace('T', ' ') : event.date,
            '<span style="color:' + color + ';font-weight:700">' + esc(String(event.severity || 'medium').toUpperCase()) + '</span>',
            type,
            '<span style="color:#8C6A3F">JSONL</span>'
          ];
        }),
        columns: [
          { title: t('secEvDate'), width: '140px', className: 'dt-nowrap' },
          { title: t('secEvSeverity'), width: '70px', className: 'dt-nowrap' },
          { title: t('secEvType') },
          { title: 'Source', width: '50px', className: 'dt-center dt-nowrap' }
        ],
        autoWidth: false, pageLength: Math.max(5, Math.floor((parentHeight - 88) / 24) - 2),
        lengthChange: false, ordering: true, order: [[0, 'desc']],
        searching: false, info: false, dom: 'tp', scrollCollapse: true, paging: true
      });
      return;
    }
    host.innerHTML = '<table class="display compact" style="width:100%"><thead><tr><th>Date</th><th>Severity</th><th>Type</th><th>Source</th></tr></thead><tbody>' +
      events.slice(0, 250).map(function (event) {
        return '<tr><td>' + esc(event.ts || event.date) + '</td><td>' + esc(event.severity || 'medium') +
          '</td><td>' + esc(String(event.type || '').replace(/_/g, ' ')) + '</td><td>JSONL</td></tr>';
      }).join('') + '</tbody></table>';
  }

  window.renderSecurityPostures = renderSecurityPostures;
  window.__resetSecFingerprint = function () { lastFingerprint = ''; };
})();
