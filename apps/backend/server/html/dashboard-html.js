'use strict';
/**
 * @asseris-module       Dashboard HTML Renderer
 * @asseris-description  Builds the dashboard HTML shell — i18n bundle assembly per language,
 *                       template caching and version resolution.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        dashboard HTML shell, i18n bundle JSON
 * @asseris-consumes     tpl/{de,en,ko}/ui.tpl, package.json version
 *
 * Dashboard HTML — i18n bundle building, HTML template caching, version resolution.
 *
 * Extracted from dashboard-server.js as part of Phase 12a modularization.
 *
 * Usage:
 *   var htmlService = require('./dashboard-html')(opts);
 *   htmlService.getDashboardHtml();
 */
var fs = require('fs');
var path = require('path');

module.exports = function createDashboardHtml(opts) {
  var DASHBOARD_SCRIPT_DIR = opts.DASHBOARD_SCRIPT_DIR;
  var serviceLog           = opts.serviceLog;
  var logOptionalErr       = opts.logOptionalErr;
  var gitExecFileTrimmed   = opts.gitExecFileTrimmed;
  var buildLimitSourceNote   = opts.buildLimitSourceNote;
  var buildLimitSourceNoteEn = opts.buildLimitSourceNoteEn;
  var localCalendarTodayStr  = opts.localCalendarTodayStr;
  var buildDashboardStatePaths = opts.buildDashboardStatePaths;
  var REFRESH_SEC          = opts.REFRESH_SEC;

  // ── File paths ──────────────────────────────────────────────────
  var DASHBOARD_TPL_FILE        = path.join(DASHBOARD_SCRIPT_DIR, 'tpl', 'dashboard.html');
  var DASHBOARD_CSS_FILE        = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'css', 'dashboard.css');
  var DASHBOARD_CLIENT_JS_FILE  = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'dashboard.client.js');
  var DASHBOARD_EXPLORER_JS_FILE = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'cache-files-explorer.js');
  var DASHBOARD_REGISTRY_JS_FILE = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'widget-registry.js');
  var DASHBOARD_DISPATCHER_JS_FILE = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'widget-dispatcher.js');
  // Phase 17d: dashboard-sections.js removed — token-stats + forensic are standalone
  var DASHBOARD_METRICS_JS_FILE  = path.join(DASHBOARD_SCRIPT_DIR, 'public', 'js', 'metrics-engine.js');

  // Optional analytics section templates
  var SECURITY_SECTION_FILE          = path.join(DASHBOARD_SCRIPT_DIR, 'tpl', 'sections', 'security-section.html');
  var COST_INTELLIGENCE_SECTION_FILE = path.join(DASHBOARD_SCRIPT_DIR, 'tpl', 'sections', 'cost-intelligence-section.html');

  function readFileSafe(fp) {
    try { return fs.readFileSync(fp, 'utf8'); } catch { return ''; }
  }

  var ANALYTICS_SCRIPTS_PAGES = '<script defer src="/assets/pages/security-page.js"></script>\n<script defer src="/assets/pages/cost-intelligence-page.js"></script>';
  var COST_INTELLIGENCE_SCRIPTS = '<script defer src="/assets/sections/cost-intelligence.js"></script>';

  // ── i18n page cache ─────────────────────────────────────────────
  var __i18nPageCache = {
    mde: null,
    men: null,
    mdashboard: null,
    mcss: null,
    mjs: null,
    bundles: null,
    inlineJson: '',
    fullHtml: null
  };

  function getPathMtimeMs(p) {
    try {
      return fs.statSync(p).mtimeMs;
    } catch (e) {
      return NaN;
    }
  }

  function getUiTplMtimeMs(lang) {
    try {
      return fs.statSync(path.join(DASHBOARD_SCRIPT_DIR, 'tpl', lang, 'ui.tpl')).mtimeMs;
    } catch (e) {
      return NaN;
    }
  }

  function loadUiTpl(lang) {
    var p = path.join(DASHBOARD_SCRIPT_DIR, 'tpl', lang, 'ui.tpl');
    try {
      var raw = fs.readFileSync(p, 'utf8');
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      return JSON.parse(raw);
    } catch (e) {
      serviceLog.error('i18n', 'tpl/' + lang + '/ui.tpl: ' + e.message);
      return {};
    }
  }

  function buildI18nBundles() {
    var mde = getUiTplMtimeMs('de');
    var men = getUiTplMtimeMs('en');
    var mko = getUiTplMtimeMs('ko');
    var c = __i18nPageCache;
    if (c.bundles && c.mde === mde && c.men === men && c.mko === mko) {
      return c.bundles;
    }
    c.bundles = { de: loadUiTpl('de'), en: loadUiTpl('en'), ko: loadUiTpl('ko') };
    c.mde = mde;
    c.men = men;
    c.mko = mko;
    c.inlineJson = '';
    c.fullHtml = null;
    return c.bundles;
  }

  function jsonForInlineI18nScript() {
    var c = __i18nPageCache;
    if (c.inlineJson) return c.inlineJson;
    c.inlineJson = JSON.stringify(c.bundles)
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029')
      .replaceAll('<', '\\u003c');
    return c.inlineJson;
  }

  // ── Version resolution ──────────────────────────────────────────
  var __appVersionHtmlCache = '';
  function getAppVersion() {
    if (__appVersionHtmlCache) return __appVersionHtmlCache;
    try {
      var envHtml = (process.env.APP_VERSION || '').trim();
      if (envHtml) {
        __appVersionHtmlCache = envHtml;
        return __appVersionHtmlCache;
      }
    } catch (error) {
      logOptionalErr(error);
    }
    try {
      var fromVerFile = fs
        .readFileSync(path.join(DASHBOARD_SCRIPT_DIR, 'VERSION'), 'utf8')
        .trim();
      if (fromVerFile) {
        __appVersionHtmlCache = fromVerFile;
        return __appVersionHtmlCache;
      }
    } catch (error) {
      logOptionalErr(error);
    }
    try {
      __appVersionHtmlCache = gitExecFileTrimmed(['describe', '--tags', '--abbrev=7']);
    } catch (e) {
      try {
        __appVersionHtmlCache = 'dev-' + gitExecFileTrimmed(['rev-parse', '--short=7', 'HEAD']);
      } catch (e2) {
        __appVersionHtmlCache = 'dev';
      }
    }
    return __appVersionHtmlCache;
  }

  // ── HTML template ───────────────────────────────────────────────
  function getDashboardHtml() {
    var c = __i18nPageCache;
    var mde = getUiTplMtimeMs('de');
    var men = getUiTplMtimeMs('en');
    var mko = getUiTplMtimeMs('ko');
    var md = getPathMtimeMs(DASHBOARD_TPL_FILE);
    var mc = getPathMtimeMs(DASHBOARD_CSS_FILE);
    var mj = getPathMtimeMs(DASHBOARD_CLIENT_JS_FILE);
    var mex = getPathMtimeMs(DASHBOARD_EXPLORER_JS_FILE);
    var mreg = getPathMtimeMs(DASHBOARD_REGISTRY_JS_FILE);
    var mdisp = getPathMtimeMs(DASHBOARD_DISPATCHER_JS_FILE);
    var msec = 0; // Phase 17d: dashboard-sections.js removed
    var mmet = getPathMtimeMs(DASHBOARD_METRICS_JS_FILE);
    if (
      c.fullHtml &&
      c.mde === mde &&
      c.men === men &&
      c.mko === mko &&
      c.mdashboard === md &&
      c.mcss === mc &&
      c.mjs === mj &&
      c.mexplorer === mex &&
      c.mregistry === mreg &&
      c.mdispatcher === mdisp &&
      c.msections === msec &&
      c.mmetrics === mmet
    ) {
      return c.fullHtml;
    }
    buildI18nBundles();
    var shell = fs.readFileSync(DASHBOARD_TPL_FILE, 'utf8');
    c.fullHtml = shell
      .replace('__I18N_PLACEHOLDER__', jsonForInlineI18nScript())
      .replace('__APP_VERSION__', getAppVersion())
      .replace('__SECTION_COST_INTELLIGENCE__', readFileSafe(COST_INTELLIGENCE_SECTION_FILE))
      .replace('__SECTION_SECURITY__', readFileSafe(SECURITY_SECTION_FILE))
      .replace('__SCRIPTS_ANALYTICS_PAGES__', ANALYTICS_SCRIPTS_PAGES)
      .replace('__SCRIPTS_COST_INTELLIGENCE__', COST_INTELLIGENCE_SCRIPTS);
    c.mdashboard = md;
    c.mcss = mc;
    c.mjs = mj;
    c.mexplorer = mex;
    c.mregistry = mreg;
    c.mdispatcher = mdisp;
    c.msections = msec;
    c.mmetrics = mmet;
    return c.fullHtml;
  }

  // ── Stub for initial SSE broadcast ──────────────────────────────
  function makeStubCachedData() {
    return {
      days: [],
      parsed_files: 0,
      generated: new Date().toISOString(),
      refresh_sec: REFRESH_SEC,
      limit_source_note: buildLimitSourceNote(),
      limit_source_note_en: buildLimitSourceNoteEn(),
      scope: 'claude-models-only',
      forensic_peak_date: '',
      forensic_peak_total: 0,
      forensic_note: '',
      forensic_note_en: '',
      scanning: true,
      calendar_today: localCalendarTodayStr(),
      day_cache_mode: '',
      day_cache_mode_en: '',
      scanned_files: [],
      scan_sources: [],
      host_labels: ['local'],
      state_paths: buildDashboardStatePaths()
    };
  }

  return {
    getDashboardHtml: getDashboardHtml,
    buildI18nBundles: buildI18nBundles,
    jsonForInlineI18nScript: jsonForInlineI18nScript,
    getAppVersion: getAppVersion,
    makeStubCachedData: makeStubCachedData
  };
};
