'use strict';
(function () {
  var SETUP_COPY = {
    de: {
      configuration: 'Grundkonfiguration',
      noScanYet: 'Die Auswahl startet noch keinen Scan.',
      language: 'Sprache',
      plan: 'Anthropic-Abo',
      localDescription: 'Sessions, Modelle, Tokens, Subagents und geschätzte Kosten.',
      cacheFixDescription: 'Zusätzlich Request-Cache, TTL, Quota und beobachtete Fix-Aktivität.',
      meterDescription: 'Validierte MeterRow-v1-Daten mit Request- und Agent-Zuordnung.',
      baseSource: 'Basisquelle',
      additionalService: 'Zusätzlicher Dienst',
      detected: 'erkannt',
      notFound: 'noch nicht gefunden',
      next: 'Weiter',
      logSources: 'Logquellen auswählen',
      sourceLead: 'Wähle lokale und zusätzliche Logs. Erst „Setup abschließen“ startet den Scan.',
      discovering: 'Logquellen werden ermittelt…',
      includeSubagents: 'Subagent-Logs einbeziehen',
      extraPlaceholder: 'Zusätzliches Logverzeichnis',
      add: 'Hinzufügen',
      back: 'Zurück',
      finish: 'Setup abschließen',
      logs: 'Logs',
      subagents: 'Subagents',
      noDefault: 'Keine Standard-Logquelle gefunden.',
      missingSelection: 'Bitte Sprache und Abo auswählen.',
      setupFailed: 'Setup fehlgeschlagen'
    },
    en: {
      configuration: 'Basic configuration',
      noScanYet: 'Selecting sources does not start a scan yet.',
      language: 'Language',
      plan: 'Anthropic plan',
      localDescription: 'Sessions, models, tokens, subagents and estimated cost.',
      cacheFixDescription: 'Adds request cache, TTL, quota and observed fix activity.',
      meterDescription: 'Validated MeterRow v1 data with request and agent attribution.',
      baseSource: 'Base source',
      additionalService: 'Additional service',
      detected: 'detected',
      notFound: 'not found yet',
      next: 'Continue',
      logSources: 'Select log sources',
      sourceLead: 'Choose local and additional logs. Scanning starts only after setup is completed.',
      discovering: 'Discovering log sources…',
      includeSubagents: 'Include subagent logs',
      extraPlaceholder: 'Additional log directory',
      add: 'Add',
      back: 'Back',
      finish: 'Complete setup',
      logs: 'logs',
      subagents: 'subagents',
      noDefault: 'No default log source found.',
      missingSelection: 'Select a language and plan.',
      setupFailed: 'Setup failed'
    },
    ko: {
      configuration: '기본 구성',
      noScanYet: '소스를 선택해도 아직 스캔이 시작되지 않습니다.',
      language: '언어',
      plan: 'Anthropic 요금제',
      localDescription: '세션, 모델, 토큰, 하위 에이전트 및 예상 비용.',
      cacheFixDescription: '요청 캐시, TTL, 할당량 및 관찰된 수정 활동을 추가합니다.',
      meterDescription: '요청 및 에이전트 귀속이 포함된 검증된 MeterRow v1 데이터.',
      baseSource: '기본 소스',
      additionalService: '추가 서비스',
      detected: '감지됨',
      notFound: '아직 찾을 수 없음',
      next: '계속',
      logSources: '로그 소스 선택',
      sourceLead: '로컬 및 추가 로그를 선택하십시오. 설정을 완료한 후에만 스캔이 시작됩니다.',
      discovering: '로그 소스를 검색하는 중…',
      includeSubagents: '하위 에이전트 로그 포함',
      extraPlaceholder: '추가 로그 디렉터리',
      add: '추가',
      back: '뒤로',
      finish: '설정 완료',
      logs: '로그',
      subagents: '하위 에이전트',
      noDefault: '기본 로그 소스를 찾을 수 없습니다.',
      missingSelection: '언어와 요금제를 선택하십시오.',
      setupFailed: '설정 실패'
    }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showSetup(status, requestedLanguage, preserved) {
    preserved = preserved || {};
    var language = requestedLanguage || localStorage.getItem('usageDashboardLang') ||
      String(navigator.language || 'en').slice(0, 2).toLowerCase();
    if (!SETUP_COPY[language]) language = 'en';
    var c = SETUP_COPY[language];
    var configuredSources = preserved.sources || status.sources || {};
    var selectedSources = {
      claude_jsonl: true,
      cache_fix: configuredSources.cache_fix === true,
      meter: configuredSources.meter === true
    };
    var warmup = document.getElementById('warmup-overlay');
    if (warmup) warmup.style.display = 'none';
    var overlay = document.createElement('div');
    overlay.id = 'product-setup-overlay';
    overlay.innerHTML =
      '<div class="product-setup-card">' +
        '<div class="product-setup-kicker">CLAUDE USAGE DASHBOARD</div>' +
        '<div class="product-setup-step" id="product-setup-step-1">' +
          '<h1>' + c.configuration + '</h1>' +
          '<p class="product-setup-lead">' + c.noScanYet + '</p>' +
          '<fieldset class="product-setup-plans"><legend>' + c.language + '</legend>' +
            '<label><input type="radio" name="product-language" value="de"' + (language === 'de' ? ' checked' : '') + '> Deutsch</label>' +
            '<label><input type="radio" name="product-language" value="en"' + (language === 'en' ? ' checked' : '') + '> English</label>' +
            '<label><input type="radio" name="product-language" value="ko"' + (language === 'ko' ? ' checked' : '') + '> 한국어</label>' +
          '</fieldset>' +
          '<fieldset class="product-setup-plans"><legend>' + c.plan + '</legend>' +
            '<label><input type="radio" name="product-plan" value="pro"' + (preserved.plan === 'pro' ? ' checked' : '') + '> Pro</label>' +
            '<label><input type="radio" name="product-plan" value="max5"' + (preserved.plan === 'max5' ? ' checked' : '') + '> Max 5</label>' +
            '<label><input type="radio" name="product-plan" value="max20"' + (preserved.plan === 'max20' ? ' checked' : '') + '> Max 20</label>' +
            '<label><input type="radio" name="product-plan" value="api"' + (preserved.plan === 'api' ? ' checked' : '') + '> API</label>' +
          '</fieldset>' +
          '<div class="product-setup-options">' +
            '<label class="product-setup-option is-selected is-required">' +
              '<span class="product-setup-option-head"><input type="checkbox" checked disabled>' +
                '<strong>Claude JSONL</strong><small>' + c.baseSource + '</small></span>' +
              '<span>' + c.localDescription + '</span>' +
            '</label>' +
            '<label class="product-setup-option" data-source-card="cache_fix">' +
              '<span class="product-setup-option-head"><input type="checkbox" class="product-setup-source-toggle" data-source="cache_fix"' +
                (selectedSources.cache_fix ? ' checked' : '') + '>' +
                '<strong>Claude Cache Fix</strong><small>' + c.additionalService + '</small></span>' +
              '<span>' + c.cacheFixDescription + '</span>' +
              '<em>usage.jsonl ' + (status.cache_fix_detected ? c.detected : c.notFound) + '</em>' +
            '</label>' +
            '<label class="product-setup-option" data-source-card="meter">' +
              '<span class="product-setup-option-head"><input type="checkbox" class="product-setup-source-toggle" data-source="meter"' +
                (selectedSources.meter ? ' checked' : '') + '>' +
                '<strong>Claude Code Meter</strong><small>' + c.additionalService + '</small></span>' +
              '<span>' + c.meterDescription + '</span>' +
              '<em>claude-meter.jsonl ' + (status.meter_detected ? c.detected : c.notFound) + '</em>' +
            '</label>' +
          '</div>' +
          '<div class="product-setup-source-paths" data-source-paths="cache_fix"' + (selectedSources.cache_fix ? '' : ' hidden') + '>' +
            '<label class="product-setup-path">Cache-Fix usage.jsonl' +
              '<input id="product-setup-cache-path" value="' + esc(preserved.cacheFixUsage || status.cache_fix_usage) + '">' +
            '</label>' +
            '<label class="product-setup-path">Cache-Fix debug log' +
              '<input id="product-setup-cache-debug-path" value="' + esc(preserved.cacheFixDebug || status.cache_fix_debug) + '">' +
            '</label>' +
          '</div>' +
          '<div class="product-setup-source-paths" data-source-paths="meter"' + (selectedSources.meter ? '' : ' hidden') + '>' +
            '<label class="product-setup-path">Claude Meter claude-meter.jsonl' +
              '<input id="product-setup-meter-path" value="' + esc(preserved.meterUsage || status.meter_usage) + '">' +
            '</label>' +
          '</div>' +
          '<div class="product-setup-actions"><span></span><button type="button" id="product-setup-next">' + c.next + '</button></div>' +
        '</div>' +
        '<div class="product-setup-step" id="product-setup-step-2" hidden>' +
          '<h1>' + c.logSources + '</h1>' +
          '<p class="product-setup-lead">' + c.sourceLead + '</p>' +
          '<div id="product-setup-inventory" class="product-setup-inventory">' + c.discovering + '</div>' +
          '<label class="product-setup-subagents"><input type="checkbox" id="product-setup-subagents"> ' + c.includeSubagents + '</label>' +
          '<div class="product-setup-extra"><input id="product-setup-extra-root" placeholder="' + c.extraPlaceholder + '"><button type="button" id="product-setup-extra-add">' + c.add + '</button></div>' +
          '<div id="product-setup-extra-list"></div>' +
          '<div class="product-setup-actions"><button type="button" id="product-setup-back">' + c.back + '</button><button type="button" id="product-setup-finish">' + c.finish + '</button></div>' +
        '</div>' +
        '<p class="product-setup-error" id="product-setup-error"></p>' +
      '</div>';
    document.body.appendChild(overlay);

    var inventory = null;
    var extraRoots = [];
    var errorEl = document.getElementById('product-setup-error');
    refreshSourceState();

    overlay.querySelectorAll('input[name="product-language"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var selectedPlan = overlay.querySelector('input[name="product-plan"]:checked');
        var nextState = {
          plan: selectedPlan ? selectedPlan.value : null,
          sources: selectedSources,
          cacheFixUsage: document.getElementById('product-setup-cache-path').value,
          cacheFixDebug: document.getElementById('product-setup-cache-debug-path').value,
          meterUsage: document.getElementById('product-setup-meter-path').value
        };
        localStorage.setItem('usageDashboardLang', radio.value);
        overlay.remove();
        showSetup(status, radio.value, nextState);
      });
    });

    function refreshSourceState() {
      overlay.querySelectorAll('[data-source-card]').forEach(function (card) {
        var source = card.dataset.sourceCard;
        card.classList.toggle('is-selected', selectedSources[source] === true);
      });
      overlay.querySelectorAll('[data-source-paths]').forEach(function (paths) {
        paths.hidden = selectedSources[paths.dataset.sourcePaths] !== true;
      });
    }

    overlay.querySelectorAll('.product-setup-source-toggle').forEach(function (checkbox) {
      checkbox.addEventListener('change', function () {
        selectedSources[checkbox.dataset.source] = checkbox.checked;
        refreshSourceState();
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
          '<strong>' + esc(root.label) + '</strong><span>' + root.fileCount + ' ' + c.logs +
          (subCount ? ' · ' + subCount + ' ' + c.subagents : '') + '</span></label>';
      }).join('') || '<p>' + c.noDefault + '</p>';
    }

    function loadInventory() {
      return fetch('/api/debug/jsonl-inventory?include_subagents=true', { cache: 'no-store' })
        .then(function (response) { return response.json(); })
        .then(function (value) { inventory = value; renderInventory(); });
    }

    document.getElementById('product-setup-next').addEventListener('click', function () {
      var language = overlay.querySelector('input[name="product-language"]:checked');
      var plan = overlay.querySelector('input[name="product-plan"]:checked');
      if (!language || !plan) {
        errorEl.textContent = c.missingSelection;
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
          sources: selectedSources,
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
          if (!response.ok) throw new Error(body.error || c.setupFailed);
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
