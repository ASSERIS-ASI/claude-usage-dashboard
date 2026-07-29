/**
 * @asseris-module       Export Panel
 * @asseris-description  Auto-annotated module metadata for public/js/widgets/export-panel.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Export/Import Buttons Section
 * Extracted from widget-dispatcher.js
 *
 * Dependencies (via globals):
 *   window.__widgetDispatcher — getPrefs(), applyGridLayout(), renderWidgetTree(), resizeAll()
 *   window.__dashboardState.getData()
 *   Internal prefs helpers accessed via dispatcher forwarding
 */
(function () {
  'use strict';

  function renderExportSection() {
    // Export buttons are already in HTML, just add click handlers
    var jsonlBtn = document.getElementById('sidebar-export-jsonl');
    if (jsonlBtn && !jsonlBtn.dataset.bound) {
      jsonlBtn.dataset.bound = '1';
      jsonlBtn.addEventListener('click', function () {
        // JSONL export -- trigger download of cached data
        var data = window.__dashboardState.getData();
        if (!data) return;
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'claude-usage-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
    var templateExBtn = document.getElementById('sidebar-export-template');
    if (templateExBtn && !templateExBtn.dataset.bound) {
      templateExBtn.dataset.bound = '1';
      templateExBtn.addEventListener('click', function () {
        var d = window.__widgetDispatcher;
        var prefs = d && typeof d.getPrefs === 'function' ? d.getPrefs() : {};
        var blob = new Blob([JSON.stringify(prefs, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'cud-layout-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
    var templateImBtn = document.getElementById('sidebar-import-template');
    if (templateImBtn && !templateImBtn.dataset.bound) {
      templateImBtn.dataset.bound = '1';
      templateImBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', function () {
          if (!this.files?.[0]) return;
          var reader = new FileReader();
          reader.onload = function (ev) {
            try {
              var imported = JSON.parse(ev.target.result);
              // Delegate import to widget-dispatcher which owns prefs internals
              var d = window.__widgetDispatcher;
              if (d && typeof d._importPrefs === 'function') {
                d._importPrefs(imported);
              } else {
                window.appLogger?.warn('ui-widget-export', 'importPrefs', 'not_available');
              }
            } catch (e) { /* invalid JSON */ }
          };
          reader.readAsText(this.files[0]);
        });
        input.click();
      });
    }
  }

  // ── Public API ───────────────────────────────────────────────────

  window.__exportPanel = {
    renderExportSection: renderExportSection
  };
})();
