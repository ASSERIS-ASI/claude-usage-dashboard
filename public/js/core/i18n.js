/**
 * @asseris-module       I18n
 * @asseris-description  Auto-annotated module metadata for public/js/core/i18n.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/i18n.js — Internationalization: language detection, t(), tr(), setLang().
 *
 * Extracted from dashboard.client.js (Phase 11a).
 * Exposes functions directly on window so all existing callers work unchanged.
 *
 * API (global):
 *   t(key)               → translated string
 *   tr(key, map)         → translated string with {placeholder} substitution
 *   getLang()            → current language code ('de' | 'en' | 'ko')
 *   setLang(code)        → change language and trigger re-render
 *   updateLangButtons()  → sync active state on all .lang-btn elements
 */
(function () {
  var I18N = (typeof globalThis.__I18N_BUNDLES === 'object' && globalThis.__I18N_BUNDLES?.de && globalThis.__I18N_BUNDLES?.en)
    ? globalThis.__I18N_BUNDLES
    : { de: {}, en: {}, ko: {} };

  function logI18nErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-core-i18n', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  function detectLang() {
    try {
      var sv = localStorage.getItem('usageDashboardLang');
      if (sv === 'de' || sv === 'en' || sv === 'ko') return sv;
    } catch (error) { logI18nErr(error); }
    var langs = navigator.languages;
    if (langs?.length) {
      for (var _lng of langs) {
        var x = String(_lng || '').toLowerCase();
        if (x.startsWith('ko')) return 'ko';
        if (x.startsWith('de')) return 'de';
      }
    }
    var nav = String(navigator.language || '').toLowerCase();
    if (nav.startsWith('ko')) return 'ko';
    if (nav.startsWith('de')) return 'de';
    return 'en';
  }

  var __lang = detectLang();

  function getLang() { return __lang; }

  function setLang(code) {
    if (code !== 'de' && code !== 'en' && code !== 'ko') return;
    __lang = code;
    try { localStorage.setItem('usageDashboardLang', code); } catch (error) { logI18nErr(error); }
    document.documentElement.lang = code;
    updateLangButtons();
    if (typeof window.applyStaticChrome === 'function') window.applyStaticChrome();
    if (typeof window.invalidateHealthAndFindingsRender === 'function') window.invalidateHealthAndFindingsRender();
    if (typeof window.__dashboardState.getData() !== 'undefined' && window.__dashboardState.getData()) {
      if (typeof window.renderDashboard === 'function') window.renderDashboard(window.__dashboardState.getData(), true);
    }
  }

  function t(k) {
    var o = I18N[__lang] || I18N.en;
    if (o[k] !== undefined && o[k] !== '') return o[k];
    return I18N.en[k] !== undefined ? I18N.en[k] : k;
  }

  function tr(k, m) {
    var s = t(k);
    if (!m) return s;
    for (var x in m) {
      if (Object.hasOwn(m, x)) s = s.split('{' + x + '}').join(String(m[x]));
    }
    return s;
  }

  function updateLangButtons() {
    var picks = document.querySelectorAll('.lang-switch .lang-btn[data-lang], #us-lang-body .lang-btn[data-lang]');
    for (var b of picks) {
      var code = b.dataset.lang || '';
      var on = code === __lang;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // Expose on window — same names as before so all callers in dashboard.client.js work unchanged
  window.t = t;
  window.tr = tr;
  window.getLang = getLang;
  window.setLang = setLang;
  window.updateLangButtons = updateLangButtons;

  window.__i18n = { t: t, tr: tr, getLang: getLang, setLang: setLang, updateLangButtons: updateLangButtons };
})();
