'use strict';
/**
 * @asseris-module       Dashboard HTTP Assets
 * @asseris-description  Static-asset server for /assets/* paths under ./public —
 *                       whitelist-gated against directory traversal, MIME-mapped,
 *                       Cache-Control headers.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        static asset bytes + Content-Type header
 * @asseris-consumes     ./public/* filesystem, request URL pathname
 *
 * HTTP helpers for the usage dashboard: static assets under /assets/ (served from ./public).
 * Paths are whitelisted; no directory traversal.
 */
var fs = require('node:fs');
var path = require('node:path');

var MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

/** pathname -> path segments relative to script root (must stay under public/) */
var ASSET_ROUTES = {
  '/assets/release-history.json': ['public', 'release-history.json'],
  '/assets/brand-tokens.css': ['public', 'css', 'brand-tokens.css'],
  '/assets/dashboard.css': ['public', 'css', 'dashboard.css'],
  '/assets/img/asseris_favicon.svg': ['public', 'img', 'asseris_favicon.svg'],
  '/assets/img/asseris_logo_horizontal_TM.svg': ['public', 'img', 'asseris_logo_horizontal_TM.svg'],
  '/assets/img/asseris_wordmark_dunkel.svg': ['public', 'img', 'asseris_wordmark_dunkel.svg'],
  '/assets/cache-files-explorer.js': ['public', 'js', 'cache-files-explorer.js'],
  '/assets/infra/app-logger.js': ['public', 'js', 'infra', 'app-logger.js'],
  '/assets/widget-registry.js': ['public', 'js', 'widget-registry.js'],
  '/assets/provider-capabilities.js': ['public', 'js', 'provider-capabilities.js'],
  '/assets/widget-dispatcher.js': ['public', 'js', 'widget-dispatcher.js'],
  // dashboard-sections.js removed (Phase 16c) — split into sections/token-stats.js + forensic.js
  '/assets/metrics-engine.js': ['public', 'js', 'metrics-engine.js'],
  '/assets/dashboard.client.js': ['public', 'js', 'dashboard.client.js'],
  '/assets/split-advisor.js': ['public', 'js', 'split-advisor.js'],
  // Phase 7: navigation modules
  '/assets/navigation/nav-model.js':    ['public', 'js', 'navigation', 'nav-model.js'],
  '/assets/navigation/nav-state.js':    ['public', 'js', 'navigation', 'nav-state.js'],
  '/assets/navigation/nav-renderer.js': ['public', 'js', 'navigation', 'nav-renderer.js'],
  // Phase 7+10: section modules
  '/assets/sections/health.js':        ['public', 'js', 'sections', 'health.js'],
  '/assets/sections/token-stats.js':   ['public', 'js', 'sections', 'token-stats.js'],
  '/assets/sections/forensic.js':      ['public', 'js', 'sections', 'forensic.js'],
  '/assets/sections/proxy.js':         ['public', 'js', 'sections', 'proxy.js'],
  '/assets/sections/cost-intelligence.js': ['public', 'js', 'sections', 'cost-intelligence.js'],
  '/assets/sections/economic.js':      ['public', 'js', 'sections', 'economic.js'],
  '/assets/sections/status.js':        ['public', 'js', 'sections', 'status.js'],
  '/assets/sections/budget.js':        ['public', 'js', 'sections', 'budget.js'],
  '/assets/sections/user-profile.js':  ['public', 'js', 'sections', 'user-profile.js'],
  // Phase 7: page modules
  '/assets/pages/overview-page.js':   ['public', 'js', 'pages', 'overview-page.js'],
  '/assets/pages/usage-page.js':      ['public', 'js', 'pages', 'usage-page.js'],
  '/assets/pages/proxy-page.js':      ['public', 'js', 'pages', 'proxy-page.js'],
  '/assets/pages/security-page.js':   ['public', 'js', 'pages', 'security-page.js'],
  '/assets/pages/cost-intelligence-page.js': ['public', 'js', 'pages', 'cost-intelligence-page.js'],
  '/assets/pages/settings-page.js':   ['public', 'js', 'pages', 'settings-page.js'],
  '/assets/pages/audit-page.js':      ['public', 'js', 'pages', 'audit-page.js'],
  // Phase 11b: dispatcher-core split (prefs, tree, sidebar)
  '/assets/widgets/prefs-store.js':      ['public', 'js', 'widgets', 'prefs-store.js'],
  '/assets/widgets/layout-tree.js':      ['public', 'js', 'widgets', 'layout-tree.js'],
  '/assets/widgets/settings-sidebar.js': ['public', 'js', 'widgets', 'settings-sidebar.js'],
  // Phase 10: widget submodules (extracted from widget-dispatcher.js)
  '/assets/widgets/template-builder.js': ['public', 'js', 'widgets', 'template-builder.js'],
  '/assets/widgets/export-panel.js':     ['public', 'js', 'widgets', 'export-panel.js'],
  // Phase 7: core facade modules
  '/assets/core/api-client.js':        ['public', 'js', 'core', 'api-client.js'],
  '/assets/core/date-range.js':        ['public', 'js', 'core', 'date-range.js'],
  '/assets/core/dashboard-state.js':   ['public', 'js', 'core', 'dashboard-state.js'],
  '/assets/core/section-contexts.js':  ['public', 'js', 'core', 'section-contexts.js'],
  // Phase 11a: core runtime modules
  '/assets/core/i18n.js':              ['public', 'js', 'core', 'i18n.js'],
  '/assets/core/stream-client.js':     ['public', 'js', 'core', 'stream-client.js'],
  '/assets/core/dashboard-shell.js':   ['public', 'js', 'core', 'dashboard-shell.js'],
  '/assets/core/product-setup.js':     ['public', 'js', 'core', 'product-setup.js'],
  '/assets/core/live-panels.js':       ['public', 'js', 'core', 'live-panels.js'],
  '/assets/core/slideouts.js':         ['public', 'js', 'core', 'slideouts.js'],
  '/assets/core/report-modal.js':      ['public', 'js', 'core', 'report-modal.js'],
  // Phase 18a: extracted core modules
  '/assets/core/dashboard-renderer.js': ['public', 'js', 'core', 'dashboard-renderer.js'],
  '/assets/core/dashboard-boot.js':     ['public', 'js', 'core', 'dashboard-boot.js'],
  '/assets/core/ui-utils.js':           ['public', 'js', 'core', 'ui-utils.js'],
  '/assets/core/dashboard-utils.js':   ['public', 'js', 'core', 'dashboard-utils.js'],
  '/assets/core/tooltips-ko.js':       ['public', 'js', 'core', 'tooltips-ko.js'],
  // Phase 18d: intelligence section
  '/assets/sections/intelligence.js':   ['public', 'js', 'sections', 'intelligence.js'],
  '/assets/sections/security-postures.js': ['public', 'js', 'sections', 'security-postures.js'],
  // Phase 18c: dispatcher submodules
  '/assets/widgets/dispatcher-visibility.js': ['public', 'js', 'widgets', 'dispatcher-visibility.js'],
  '/assets/widgets/dispatcher-layout.js':     ['public', 'js', 'widgets', 'dispatcher-layout.js'],
  '/assets/widgets/dispatcher-init.js':       ['public', 'js', 'widgets', 'dispatcher-init.js']
};

function isPathInsideDir(filePath, dir) {
  var d = path.resolve(dir);
  var f = path.resolve(filePath);
  if (f === d) return false;
  return f.startsWith(d + path.sep);
}

function resolveWhitelistedAsset(scriptDir, pathname) {
  var segs = ASSET_ROUTES[pathname];
  if (!segs) return null;
  var full = path.normalize(path.join.apply(path, [scriptDir].concat(segs)));
  var pubRoot = path.join(scriptDir, 'public');
  if (!isPathInsideDir(full, pubRoot)) return null;
  try {
    if (!fs.statSync(full).isFile()) return null;
  } catch (e) {
    return null;
  }
  return full;
}

/**
 * If pathname matches a dashboard asset, sends the file and returns true (caller must not handle further).
 * Otherwise returns false.
 */
function tryServeDashboardAsset(scriptDir, pathname, res) {
  var filePath = resolveWhitelistedAsset(scriptDir, pathname);
  if (!filePath) return false;
  fs.readFile(filePath, function (err, buf) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
  return true;
}

/** Path only (wie req.url); Basis nur für WHATWG-URL, wird nicht an Clients ausgegeben. */
function requestPathname(reqUrl) {
  var raw = typeof reqUrl === 'string' && reqUrl.length ? reqUrl : '/';
  if (raw[0] !== '/') raw = '/' + raw;
  var p = '/';
  try {
    p = new URL(raw, 'https://dashboard.local').pathname || '/';
  } catch (e) {
    p = '/';
  }
  p = (p || '/').replace(/\/+/g, '/');
  if (!p || p[0] !== '/') p = '/';
  return p;
}

module.exports = {
  ASSET_ROUTES: ASSET_ROUTES,
  tryServeDashboardAsset: tryServeDashboardAsset,
  requestPathname: requestPathname,
  resolveWhitelistedAsset: resolveWhitelistedAsset
};
