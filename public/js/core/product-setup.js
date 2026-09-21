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
      requestNdjsonDescription: 'Kompatible Request-NDJSON aus einem Proxy oder Gateway, das dieses Format schreibt — Latenz, Fehlerraten, Traffic-Quellen.',
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
      missingLanguage: 'Bitte eine Sprache auswählen.',
      missingPlan: 'Bitte ein Abo auswählen.',
      setupFailed: 'Setup fehlgeschlagen',
      details: 'Details',
      footerLicense: 'Apache-Lizenz 2.0 · quelloffen',
      footerTrademark: 'ASSERIS, das ASSERIS-Wortzeichen und das Drei-Knoten-Logo sind eingetragene Marken der ASSERIS AISBL.'
    },
    en: {
      configuration: 'Basic configuration',
      noScanYet: 'Selecting sources does not start a scan yet.',
      language: 'Language',
      plan: 'Anthropic plan',
      localDescription: 'Sessions, models, tokens, subagents and estimated cost.',
      cacheFixDescription: 'Adds request cache, TTL, quota and observed fix activity.',
      meterDescription: 'Validated MeterRow v1 data with request and agent attribution.',
      requestNdjsonDescription: 'Compatible request NDJSON from a proxy or gateway writing this format — latency, error rates, traffic sources.',
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
      missingLanguage: 'Select a language.',
      missingPlan: 'Select a plan.',
      setupFailed: 'Setup failed',
      details: 'Details',
      footerLicense: 'Apache License 2.0 · open source',
      footerTrademark: 'ASSERIS, the ASSERIS wordmark and the three-node logo are registered trademarks of ASSERIS AISBL.'
    },
    ko: {
      configuration: '기본 구성',
      noScanYet: '소스를 선택해도 아직 스캔이 시작되지 않습니다.',
      language: '언어',
      plan: 'Anthropic 요금제',
      localDescription: '세션, 모델, 토큰, 하위 에이전트 및 예상 비용.',
      cacheFixDescription: '요청 캐시, TTL, 할당량 및 관찰된 수정 활동을 추가합니다.',
      meterDescription: '요청 및 에이전트 귀속이 포함된 검증된 MeterRow v1 데이터.',
      requestNdjsonDescription: '이 형식을 기록하는 프록시 또는 게이트웨이의 호환 요청 NDJSON — 지연 시간, 오류율, 트래픽 소스.',
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
      missingLanguage: '언어를 선택하십시오.',
      missingPlan: '요금제를 선택하십시오.',
      setupFailed: '설정 실패',
      details: '세부 정보',
      footerLicense: 'Apache License 2.0 · 오픈 소스',
      footerTrademark: 'ASSERIS, ASSERIS 워드마크 및 3노드 로고는 ASSERIS AISBL의 등록 상표입니다.'
    }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pathField(caption, id, value) {
    return '<label class="product-setup-path">' + caption +
      '<input id="' + id + '" value="' + esc(value) + '">' +
    '</label>';
  }

  // A source is a single line: checkbox, name, badge, detection status and a chevron.
  // Description and path fields live in a box below the line that opens on click.
  // The base source cannot be switched off, so its checkbox stays ticked and disabled.
  function sourceRow(source, name, badge, description, detection, paths, c) {
    var base = source === 'claude_jsonl';
    var pathBlock = paths
      ? '<div class="product-setup-source-paths" data-source-paths="' + source + '">' + paths + '</div>'
      : '';
    var body = base ? '' : '<div class="product-setup-source-body"><p>' + description + '</p>' + pathBlock + '</div>';
    return '<div class="product-setup-source' + (base ? ' is-selected is-required' : '') + '"' +
        (base ? '' : ' data-source-card="' + source + '"') + '>' +
      '<div class="product-setup-row">' +
        '<label class="product-setup-row-name"><input type="checkbox"' +
          (base ? ' checked disabled' : ' class="product-setup-source-toggle" data-source="' + source + '"') + '>' +
          '<strong>' + name + '</strong></label>' +
        '<small>' + badge + '</small>' +
        (detection ? '<em>' + detection + '</em>' : '<em></em>') +
        (base ? '' : '<button type="button" class="product-setup-expand" aria-expanded="false" aria-label="' + c.details + ': ' + name + '"></button>') +
      '</div>' +
      body +
    '</div>';
  }

  // Clicking a row opens its box downwards; the checkboxes in it only (de)select.
  function bindExpandableRow(row) {
    var toggle = row.querySelector('.product-setup-expand');
    if (!toggle) return;
    row.querySelector('.product-setup-row').addEventListener('click', function (event) {
      if (event.target.closest('label')) return;
      var open = !row.classList.contains('is-open');
      row.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function bindExpandableRows(scope) {
    scope.querySelectorAll('.product-setup-source').forEach(bindExpandableRow);
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function fileListItem(file) {
    return '<li' + (file.isSubagent ? ' class="is-sub"' : '') + ' title="' + esc(file.absPath || file.path) + '">' +
      '<span><bdi>' + esc(file.path) + '</bdi></span><small>' + formatSize(file.size) + '</small></li>';
  }

  // The open box lists exactly the logs the scan will read for that source.
  function renderFileLists(inventory, includeSubagents) {
    for (var row of document.querySelectorAll('#product-setup-inventory [data-root]')) {
      var root = row.dataset.root;
      var files = (inventory.files || []).filter(function (file) {
        return file.root === root && (includeSubagents || !file.isSubagent);
      });
      row.querySelector('.product-setup-files').innerHTML = files.map(fileListItem).join('');
    }
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
      meter: configuredSources.meter === true,
      request_ndjson: configuredSources.request_ndjson === true
    };
    var warmup = document.getElementById('warmup-overlay');
    if (warmup) warmup.style.display = 'none';
    var overlay = document.createElement('div');
    overlay.id = 'product-setup-overlay';
    overlay.innerHTML =
      '<div class="product-setup-card">' +
        '<div class="product-setup-brand">' +
          '<img class="product-setup-logo" src="/assets/img/asseris_logo_horizontal_TM.svg" alt="ASSERIS">' +
          '<span class="product-setup-kicker">CLAUDE USAGE DASHBOARD</span>' +
        '</div>' +
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
            sourceRow('claude_jsonl', 'Claude JSONL', c.baseSource, c.localDescription, '', '', c) +
            sourceRow('cache_fix', 'Claude Cache Fix', c.additionalService, c.cacheFixDescription,
              'usage.jsonl ' + (status.cache_fix_detected ? c.detected : c.notFound),
              pathField('Cache-Fix usage.jsonl', 'product-setup-cache-path', preserved.cacheFixUsage || status.cache_fix_usage) +
              pathField('Cache-Fix debug log', 'product-setup-cache-debug-path', preserved.cacheFixDebug || status.cache_fix_debug), c) +
            sourceRow('meter', 'Claude Code Meter', c.additionalService, c.meterDescription,
              'claude-meter.jsonl ' + (status.meter_detected ? c.detected : c.notFound),
              pathField('Claude Meter claude-meter.jsonl', 'product-setup-meter-path', preserved.meterUsage || status.meter_usage), c) +
            sourceRow('request_ndjson', 'Request NDJSON', c.additionalService, c.requestNdjsonDescription,
              'NDJSON ' + (status.request_ndjson_detected ? c.detected : c.notFound),
              pathField('Request NDJSON directory', 'product-setup-request-path', preserved.requestLogDir || status.request_log_dir), c) +
          '</div>' +
          '<div class="product-setup-actions"><span></span><button type="button" id="product-setup-next">' + c.next + '</button></div>' +
        '</div>' +
        '<div class="product-setup-step" id="product-setup-step-2" hidden>' +
          '<h1>' + c.logSources + '</h1>' +
          '<p class="product-setup-lead">' + c.sourceLead + '</p>' +
          '<div id="product-setup-inventory" class="product-setup-inventory">' + c.discovering + '</div>' +
          '<div class="product-setup-extra"><input id="product-setup-extra-root" placeholder="' + c.extraPlaceholder + '"><button type="button" id="product-setup-extra-add">' + c.add + '</button></div>' +
          '<div id="product-setup-extra-list"></div>' +
          '<div class="product-setup-actions"><button type="button" id="product-setup-back">' + c.back + '</button><button type="button" id="product-setup-finish">' + c.finish + '</button></div>' +
        '</div>' +
        '<p class="product-setup-error" id="product-setup-error"></p>' +
        '<footer class="product-setup-legal">' +
          '<span>Claude Usage Dashboard · ' + c.footerLicense + '</span>' +
          '<span>\u00A9 2026 ASSERIS AISBL and contributors</span>' +
          '<span>' + c.footerTrademark + '</span>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(overlay);

    var inventory = null;
    var includeSubagents = false;
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
          meterUsage: document.getElementById('product-setup-meter-path').value,
          requestLogDir: document.getElementById('product-setup-request-path').value
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

    bindExpandableRows(overlay.querySelector('.product-setup-options'));

    function renderInventory() {
      var host = document.getElementById('product-setup-inventory');
      if (!inventory) return;
      var subCountByRoot = {};
      for (var file of inventory.files || []) {
        if (file.isSubagent) subCountByRoot[file.root] = (subCountByRoot[file.root] || 0) + 1;
      }
      host.innerHTML = (inventory.roots || []).map(function (root) {
        var subCount = subCountByRoot[root.label] || 0;
        return '<div class="product-setup-source is-selected" data-root="' + esc(root.label) + '">' +
          '<div class="product-setup-row">' +
            '<label class="product-setup-row-name"><input type="checkbox" class="product-setup-root-cb" value="' +
              esc(root.path) + '" checked><strong>' + esc(root.label) + '</strong></label>' +
            '<label class="product-setup-row-sub"><input type="checkbox" class="product-setup-subagents-cb"' +
              (includeSubagents ? ' checked' : '') + '>' + c.subagents + '</label>' +
            '<em>' + root.fileCount + ' ' + c.logs + (subCount ? ' · ' + subCount + ' ' + c.subagents : '') + '</em>' +
            '<button type="button" class="product-setup-expand" aria-expanded="false" aria-label="' +
              c.details + ': ' + esc(root.label) + '"></button>' +
          '</div>' +
          '<div class="product-setup-source-body"><ul class="product-setup-files"></ul></div>' +
        '</div>';
      }).join('') || '<p>' + c.noDefault + '</p>';
      // One delegated listener for every checkbox in the list.
      host.addEventListener('change', function (event) {
        var checkbox = event.target;
        if (checkbox.classList.contains('product-setup-root-cb')) {
          checkbox.closest('.product-setup-source').classList.toggle('is-selected', checkbox.checked);
          return;
        }
        if (!checkbox.classList.contains('product-setup-subagents-cb')) return;
        // One setting for the whole scan: every row shows and changes the same value.
        includeSubagents = checkbox.checked;
        for (var other of host.querySelectorAll('.product-setup-subagents-cb')) other.checked = includeSubagents;
        renderFileLists(inventory, includeSubagents);
      });
      bindExpandableRows(host);
      renderFileLists(inventory, includeSubagents);
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
        // Name what is actually missing — reporting both when only one is
        // unset sends people looking at a field they already filled in.
        if (!language && !plan) errorEl.textContent = c.missingSelection;
        else errorEl.textContent = language ? c.missingPlan : c.missingLanguage;
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
          request_log_dir: document.getElementById('product-setup-request-path').value.trim(),
          log_roots: roots,
          include_subagents: includeSubagents
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
