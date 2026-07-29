'use strict';
(function () {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showSetup(status) {
    var warmup = document.getElementById('warmup-overlay');
    if (warmup) warmup.style.display = 'none';
    var overlay = document.createElement('div');
    overlay.id = 'product-setup-overlay';
    overlay.innerHTML =
      '<div class="product-setup-card">' +
        '<div class="product-setup-kicker">CLAUDE USAGE DASHBOARD</div>' +
        '<div class="product-setup-step" id="product-setup-step-1">' +
          '<h1>Grundkonfiguration</h1>' +
          '<p class="product-setup-lead">Die Auswahl startet noch keinen Scan.</p>' +
          '<fieldset class="product-setup-plans"><legend>Sprache</legend>' +
            '<label><input type="radio" name="product-language" value="de"> Deutsch</label>' +
            '<label><input type="radio" name="product-language" value="en"> English</label>' +
            '<label><input type="radio" name="product-language" value="ko"> 한국어</label>' +
          '</fieldset>' +
          '<fieldset class="product-setup-plans"><legend>Anthropic-Abo</legend>' +
            '<label><input type="radio" name="product-plan" value="pro"> Pro</label>' +
            '<label><input type="radio" name="product-plan" value="max5"> Max 5</label>' +
            '<label><input type="radio" name="product-plan" value="max20"> Max 20</label>' +
            '<label><input type="radio" name="product-plan" value="api"> API</label>' +
          '</fieldset>' +
          '<div class="product-setup-options">' +
            '<button type="button" class="product-setup-option" data-mode="local">' +
              '<strong>Claude JSONL</strong><span>Sessions, Modelle, Tokens, Subagents und geschätzte Kosten.</span>' +
            '</button>' +
            '<button type="button" class="product-setup-option" data-mode="cache-fix">' +
              '<strong>Claude Cache Fix</strong><span>Zusätzlich Request-Cache und Quota-Telemetrie.</span>' +
              '<em>' + (status.cache_fix_detected ? 'usage.jsonl erkannt' : 'usage.jsonl noch nicht gefunden') + '</em>' +
            '</button>' +
            '<button type="button" class="product-setup-option" data-mode="meter">' +
              '<strong>Claude Code Meter</strong><span>Validierte MeterRow-v1-Daten mit Request- und Agent-Zuordnung.</span>' +
              '<em>' + (status.meter_detected ? 'claude-meter.jsonl erkannt' : 'claude-meter.jsonl noch nicht gefunden') + '</em>' +
            '</button>' +
          '</div>' +
          '<label class="product-setup-path">Cache-Fix usage.jsonl' +
            '<input id="product-setup-cache-path" value="' + esc(status.cache_fix_usage) + '">' +
          '</label>' +
          '<label class="product-setup-path">Cache-Fix debug log' +
            '<input id="product-setup-cache-debug-path" value="' + esc(status.cache_fix_debug) + '">' +
          '</label>' +
          '<label class="product-setup-path">Claude Meter claude-meter.jsonl' +
            '<input id="product-setup-meter-path" value="' + esc(status.meter_usage) + '">' +
          '</label>' +
          '<div class="product-setup-actions"><span></span><button type="button" id="product-setup-next">Weiter</button></div>' +
        '</div>' +
        '<div class="product-setup-step" id="product-setup-step-2" hidden>' +
          '<h1>Logquellen auswählen</h1>' +
          '<p class="product-setup-lead">Wähle lokale und zusätzliche Logs. Erst „Setup abschließen“ startet den Scan.</p>' +
          '<div id="product-setup-inventory" class="product-setup-inventory">Logquellen werden ermittelt…</div>' +
          '<label class="product-setup-subagents"><input type="checkbox" id="product-setup-subagents"> Subagent-Logs einbeziehen</label>' +
          '<div class="product-setup-extra"><input id="product-setup-extra-root" placeholder="Zusätzliches Logverzeichnis"><button type="button" id="product-setup-extra-add">Hinzufügen</button></div>' +
          '<div id="product-setup-extra-list"></div>' +
          '<div class="product-setup-actions"><button type="button" id="product-setup-back">Zurück</button><button type="button" id="product-setup-finish">Setup abschließen</button></div>' +
        '</div>' +
        '<p class="product-setup-error" id="product-setup-error"></p>' +
      '</div>';
    document.body.appendChild(overlay);

    var selectedMode = null;
    var inventory = null;
    var extraRoots = [];
    var errorEl = document.getElementById('product-setup-error');

    overlay.querySelectorAll('[data-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectedMode = button.dataset.mode;
        overlay.querySelectorAll('[data-mode]').forEach(function (item) {
          item.classList.toggle('is-selected', item === button);
        });
      });
    });

    function renderInventory() {
      var host = document.getElementById('product-setup-inventory');
      if (!inventory) return;
      var subCountByRoot = {};
      for (var file of inventory.files || []) {
        if (file.isSubagent) subCountByRoot[file.root] = (subCountByRoot[file.root] || 0) + 1;
      }
      host.innerHTML = (inventory.roots || []).map(function (root, index) {
        var subCount = subCountByRoot[root.label] || 0;
        return '<label class="product-setup-root">' +
          '<input type="checkbox" class="product-setup-root-cb" value="' + esc(root.path) + '" checked> ' +
          '<strong>' + esc(root.label) + '</strong><span>' + root.fileCount + ' Logs' +
          (subCount ? ' · ' + subCount + ' Subagents' : '') + '</span></label>';
      }).join('') || '<p>Keine Standard-Logquelle gefunden.</p>';
    }

    function loadInventory() {
      return fetch('/api/debug/jsonl-inventory?include_subagents=true', { cache: 'no-store' })
        .then(function (response) { return response.json(); })
        .then(function (value) { inventory = value; renderInventory(); });
    }

    document.getElementById('product-setup-next').addEventListener('click', function () {
      var language = overlay.querySelector('input[name="product-language"]:checked');
      var plan = overlay.querySelector('input[name="product-plan"]:checked');
      if (!language || !plan || !selectedMode) {
        errorEl.textContent = 'Bitte Sprache, Abo und Datenquelle auswählen.';
        return;
      }
      errorEl.textContent = '';
      document.getElementById('product-setup-step-1').hidden = true;
      document.getElementById('product-setup-step-2').hidden = false;
      if (!inventory) loadInventory().catch(function (error) { errorEl.textContent = error.message; });
    });

    document.getElementById('product-setup-back').addEventListener('click', function () {
      document.getElementById('product-setup-step-2').hidden = true;
      document.getElementById('product-setup-step-1').hidden = false;
      errorEl.textContent = '';
    });

    document.getElementById('product-setup-extra-add').addEventListener('click', function () {
      var input = document.getElementById('product-setup-extra-root');
      var value = input.value.trim();
      if (!value || extraRoots.includes(value)) return;
      extraRoots.push(value);
      input.value = '';
      document.getElementById('product-setup-extra-list').innerHTML = extraRoots.map(function (root) {
        return '<div class="product-setup-extra-row">' + esc(root) + '</div>';
      }).join('');
    });

    document.getElementById('product-setup-finish').addEventListener('click', function () {
      var language = overlay.querySelector('input[name="product-language"]:checked');
      var plan = overlay.querySelector('input[name="product-plan"]:checked');
      var roots = Array.from(overlay.querySelectorAll('.product-setup-root-cb:checked'))
        .map(function (checkbox) { return checkbox.value; }).concat(extraRoots);
      var finish = document.getElementById('product-setup-finish');
      finish.disabled = true;
      errorEl.textContent = '';
      fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: selectedMode,
          subscription: plan.value,
          language: language.value,
          cache_fix_usage: document.getElementById('product-setup-cache-path').value.trim(),
          cache_fix_debug: document.getElementById('product-setup-cache-debug-path').value.trim(),
          meter_usage: document.getElementById('product-setup-meter-path').value.trim(),
          log_roots: roots,
          include_subagents: document.getElementById('product-setup-subagents').checked
        })
      }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || 'Setup fehlgeschlagen');
          localStorage.setItem('cud_plan', plan.value);
          localStorage.setItem('usageDashboardLang', language.value);
          window.location.reload();
        });
      }).catch(function (error) {
        errorEl.textContent = error.message;
        finish.disabled = false;
      });
    });
  }

  fetch('/api/setup', { cache: 'no-store' })
    .then(function (response) { return response.json(); })
    .then(function (status) {
      window.__productSetup = status;
      if (!status.configured) showSetup(status);
      else {
        if (status.subscription) localStorage.setItem('cud_plan', status.subscription);
        if (status.language) localStorage.setItem('usageDashboardLang', status.language);
      }
    })
    .catch(function () { /* dashboard remains usable if setup endpoint is unavailable */ });
})();
