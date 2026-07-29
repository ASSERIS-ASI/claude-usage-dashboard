/**
 * @asseris-module       Tooltips Ko
 * @asseris-description  Auto-annotated module metadata for public/js/core/tooltips-ko.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/tooltips-ko.js — Korean glossary tooltip system (Phase 18 review fix).
 *
 * Extracted from dashboard.client.js. Scans DOM for glossary terms
 * and wraps them with hover tooltips. Korean locale only.
 */
// ── Korean term tooltip system (ko locale only) ──────────────────────
(function () { try {
  var GLOSSARY = {
    "Thinking Token": "AI 내부 추론에 사용되는 비공개 Token",
    "Health Score": "종합 API 사용 건강 점수 (10점 만점)",
    "Hit Limit": "API 사용 한도 도달",
    "Rate Limit": "시간당 허용 요청 수 제한",
    "Cold Start": "캐시 없이 시작하는 첫 요청",
    "Cache Read": "캐시에서 재사용된 Token",
    "Cache Create": "새로 캐시에 저장된 Token",
    "Cache": "이전 대화를 재사용하여 비용을 줄이는 메커니즘",
    "Token": "API 요청/응답의 기본 단위 (단어 조각)",
    "Output": "AI가 생성한 응답 Token",
    "Overhead": "Output 대비 전체 Token 사용 비율",
    "Forensic": "사용 패턴 심층 분석",
    "NDJSON": "줄 구분 JSON (Proxy 로그 형식)",
    "JSONL": "줄 단위 JSON 로그 형식",
    "SSE": "서버→브라우저 실시간 데이터 전송",
    "Proxy": "API 요청을 중계하는 중간 서버",
    "Subagent": "메인 에이전트가 생성한 하위 작업 에이전트",
    "Quota": "일정 기간 내 허용된 총 사용량",
    "Budget": "세션당 허용된 Token 총량",
    "Latency": "API 요청~응답 사이 지연 시간",
    "Interrupt": "사용자에 의한 세션 중단",
    "Retry": "API 오류 후 자동 재시도",
    "Incident": "Anthropic 서비스 장애 이벤트",
    "Outage": "서비스 중단 기간",
    "Extension": "VS Code 확장 프로그램",
    "Peak": "최대 사용량을 기록한 시점",
    "Context": "AI 대화의 전체 입력 맥락",
    "Compaction": "긴 대화를 압축하여 Context 줄이기",
    "PAT": "GitHub Personal Access Token (개인 인증 토큰)"
  };

  var TERMS = Object.keys(GLOSSARY).sort(function (a, b) { return b.length - a.length; });
  var RE = new RegExp("(" + TERMS.map(function (t) { return t.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`); }).join("|") + ")", "g");
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, CODE: 1 };
  var observer = null;
  var debounceTimer = null;

  var pop = document.createElement("div");
  pop.id = "tt-pop";
  document.body.appendChild(pop);

  function showPop(e) {
    var tip = e.currentTarget.dataset.tip;
    if (!tip) return;
    pop.textContent = tip;
    pop.style.opacity = "1";
    positionPop(e);
  }
  function movePop(e) { positionPop(e); }
  function hidePop() { pop.style.opacity = "0"; }
  function positionPop(e) {
    var x = e.clientX + 12;
    var y = e.clientY - 8;
    pop.style.left = "0px";
    pop.style.top = "0px";
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    if (x + pw > window.innerWidth - 8) x = e.clientX - pw - 12;
    if (y - ph < 4) y = e.clientY + 20;
    else y = y - ph;
    pop.style.left = x + "px";
    pop.style.top = y + "px";
  }

  function wrapTextNode(node) {
    var text = node.nodeValue;
    if (!text || !RE.test(text)) return;
    RE.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var lastIdx = 0;
    var parent = node.parentNode;
    var parentSeen = parent.__ttSeen || (parent.__ttSeen = {});
    var match;
    RE.lastIndex = 0;
    while ((match = RE.exec(text)) !== null) {
      var term = match[1];
      if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      if (parentSeen[term]) {
        frag.appendChild(document.createTextNode(term));
      } else {
        var span = document.createElement("span");
        span.className = "tt";
        span.dataset.tip = GLOSSARY[term];
        span.textContent = term;
        span.addEventListener("mouseenter", showPop);
        span.addEventListener("mousemove", movePop);
        span.addEventListener("mouseleave", hidePop);
        frag.appendChild(span);
        parentSeen[term] = true;
      }
      lastIdx = RE.lastIndex;
    }
    if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    if (frag.childNodes.length) node.replaceWith(frag);
  }

  function scanElement(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.classList?.contains("tt")) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var n of nodes) wrapTextNode(n);
  }

  function removeAllTips() {
    hidePop();
    var tips = document.querySelectorAll(".tt");
    for (var span of tips) {
      span.removeEventListener("mouseenter", showPop);
      span.removeEventListener("mousemove", movePop);
      span.removeEventListener("mouseleave", hidePop);
      var parent = span.parentNode;
      if (parent) {
        span.replaceWith(document.createTextNode(span.textContent));
        parent.normalize();
        if (parent.__ttSeen) parent.__ttSeen = {};
      }
    }
  }

  function debouncedScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      if (getLang() === "ko") scanElement(document.body);
    }, 200);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      for (var mut of mutations) {
        if (mut.addedNodes.length || mut.type === "characterData") {
          debouncedScan();
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  var _origSetLang = globalThis.setLang;
  globalThis.setLang = function (code) {
    stopObserver();
    removeAllTips();
    _origSetLang(code);
    if (code === "ko") {
      scanElement(document.body);
      startObserver();
    }
  };

  if (globalThis.getLang() === "ko") {
    setTimeout(function () {
      scanElement(document.body);
      startObserver();
    }, 500);
  }
} catch (e) { if (window.appLogger) window.appLogger.errorM('ui-core-tooltips', 'init', 'fail', e?.message || e); } })();
