/**
 * @asseris-module       Date Range Picker
 * @asseris-description  Grafana-style date-range control in the filter bar — presets
 *                       (24h/7d/31d-live/90d) plus custom from/to. Ranges inside the live
 *                       snapshot use the existing client-side filter path; ranges beyond
 *                       it fetch compact day aggregates via /api/usage-range and pin them
 *                       as a frozen overlay (live updates pause until resume).
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/date-range.js — Grafana-style range picker for the filter bar.
 *
 * API: window.__dateRange = { init, setPreset, setCustom, resumeLive }
 */
(function () {

  var PRESETS = [
    { key: '24h', i18n: 'filterRange24h', days: 1 },
    { key: '7d', i18n: 'filterRange7d', days: 7 },
    { key: '31d', i18n: 'filterRange31dLive', days: 31 },
    { key: '90d', i18n: 'filterRange90d', days: 90 }
  ];
  var LIVE_PRESET = '31d';

  function st() { return window.__dashboardState; }
  function tt(key) { return typeof window.t === 'function' ? window.t(key) : key; }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function shiftKey(dateKey, days) {
    return new Date(Date.parse(dateKey + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }

  // Earliest date covered by the live snapshot (proxy_days ∪ days).
  function snapshotStartKey() {
    var data = st().getLiveData();
    if (!data) return todayKey();
    var firstProxy = data.proxy?.proxy_days?.[0]?.date || '';
    var firstDay = data.days?.[0]?.date || '';
    if (firstProxy && firstDay) return firstProxy < firstDay ? firstProxy : firstDay;
    return firstProxy || firstDay || todayKey();
  }

  function setInputs(from, to) {
    var startEl = document.getElementById('filter-date-start');
    var endEl = document.getElementById('filter-date-end');
    if (startEl) startEl.value = from || '';
    if (endEl) endEl.value = to || '';
  }

  function setActiveChip(key) {
    var chips = document.getElementById('filter-range-chips');
    if (!chips) return;
    chips.querySelectorAll('.filter-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.range === key);
    });
  }

  function setPinBadge(overlay) {
    var badge = document.getElementById('filter-range-pin-badge');
    if (!badge) return;
    if (!overlay) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    var txt = tt('filterRangePinned');
    var gaps = overlay.days_missing ? overlay.days_missing.length : 0;
    if (gaps > 0) txt += ' · ' + tt('filterRangeGapsHint').replace('{n}', String(gaps));
    badge.textContent = txt;
    badge.hidden = false;
  }

  // Always re-render from the LIVE snapshot: renderDashboard(data) stores its
  // argument via setData() — passing the overlay-composed object would
  // clobber the live data. The chart core re-reads getData() internally and
  // thereby picks up the pinned overlay.
  function resetFingerprintsAndRender() {
    if (window.__resetProxyFingerprint) window.__resetProxyFingerprint();
    if (window.__resetDashboardCoreFingerprint) window.__resetDashboardCoreFingerprint();
    var live = st().getLiveData();
    if (live && typeof window.renderDashboard === 'function') window.renderDashboard(live, true);
  }

  function fetchRangeOverlay(from, to) {
    if (window.showRecomputeOverlay) window.showRecomputeOverlay(true);
    return window.__apiClient.fetch('/api/usage-range?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) {
        st().setRangeOverlay(body);
        setInputs(body.from, body.to);
        setPinBadge(body);
        resetFingerprintsAndRender();
      })
      .catch(function (e) {
        if (window.console?.warn) console.warn('[date-range] range fetch failed:', e.message || e);
      })
      .then(function () {
        if (window.showRecomputeOverlay) window.showRecomputeOverlay(false);
      });
  }

  function resumeLive() {
    st().clearRangeOverlay();
    setPinBadge(null);
    setActiveChip(LIVE_PRESET);
    setInputs('', '');
    resetFingerprintsAndRender();
  }

  // Apply [from, to]: inside the live snapshot → existing client-side filter
  // path (stays live); beyond it → fetch + pin overlay.
  function applyRange(from, to) {
    var today = todayKey();
    if (!from || !to || from > to) return;
    if (to > today) to = today;
    if (from >= snapshotStartKey()) {
      st().clearRangeOverlay();
      setPinBadge(null);
      setInputs(from, to);
      resetFingerprintsAndRender();
      return;
    }
    fetchRangeOverlay(from, to);
  }

  function setPreset(key) {
    setActiveChip(key);
    if (key === LIVE_PRESET) {
      resumeLive();
      return;
    }
    var preset = PRESETS.find(function (p) { return p.key === key; });
    if (!preset) return;
    var to = todayKey();
    applyRange(shiftKey(to, -(preset.days - 1)), to);
  }

  function setCustom(from, to) {
    setActiveChip('');
    applyRange(from, to);
  }

  function init(data) {
    var chips = document.getElementById('filter-range-chips');
    if (!chips || chips.dataset.bound) return;
    chips.dataset.bound = '1';

    var html = '';
    for (var p of PRESETS) {
      html += '<button type="button" class="filter-chip' + (p.key === LIVE_PRESET ? ' active' : '') +
        '" data-range="' + p.key + '">' + tt(p.i18n) + '</button>';
    }
    chips.innerHTML = html;
    chips.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-chip');
      if (!btn?.dataset.range) return;
      setPreset(btn.dataset.range);
    });

    var startEl = document.getElementById('filter-date-start');
    var endEl = document.getElementById('filter-date-end');
    var applyBtn = document.getElementById('filter-range-apply');
    var today = todayKey();
    var firstDay = data?.days?.[0]?.date || '';
    if (startEl) {
      if (firstDay) startEl.placeholder = firstDay;
      startEl.max = today;
    }
    if (endEl) endEl.max = today;
    function onApply() {
      if (startEl?.value && endEl?.value) setCustom(startEl.value, endEl.value);
    }
    if (applyBtn) {
      applyBtn.textContent = tt('filterRangeApply');
      applyBtn.addEventListener('click', onApply);
    }
    // Direct input changes inside the snapshot keep the legacy instant-filter
    // feel; crossing the snapshot boundary requires the explicit Apply.
    function onInputChange() {
      var f = startEl?.value;
      var to = endEl?.value;
      if (f && to && f <= to && f >= snapshotStartKey() && !st().isRangePinned()) {
        resetFingerprintsAndRender();
      }
    }
    if (startEl) startEl.addEventListener('change', onInputChange);
    if (endEl) endEl.addEventListener('change', onInputChange);
  }

  window.__dateRange = {
    init: init,
    setPreset: setPreset,
    setCustom: setCustom,
    resumeLive: resumeLive
  };
})();
