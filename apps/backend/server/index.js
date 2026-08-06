'use strict';
/**
 * @asseris-module       Server Composition Root
 * @asseris-description  HTTP server bootstrap for the standalone dashboard.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-core
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Usage Routes, Layout Routes, Stream Routes, Debug Cache Routes, Debug JSONL Routes, Health Events Routes, Provider Routes, Dashboard HTTP Assets, Dashboard HTML Renderer
 * @asseris-called-by    dashboard.js
 * @asseris-emits        HTTP server instance, dispatched route results
 * @asseris-consumes     HTTP request stream, route module exports
 *
 * server/index.js — HTTP Server Composition Root.
 */
var http = require('node:http');
var securityHeaders = require('./security-headers');
var productProfile = require('../product-profile');
var productSetup = productProfile.dashboardOnly ? require('../app/product-setup') : null;
var rateCards = require('../domain/usage/rate-cards');

var layoutRoutes = require('./routes/layout-routes');
var streamRoutes = require('./routes/stream-routes');
var usageRoutes = require('./routes/usage-routes');
var debugRoutes = require('./routes/debug-routes');
var debugJsonlRoutes = require('./routes/debug-jsonl-routes');
var debugCacheRoutes = require('./routes/debug-cache-routes');
var providerRoutes = require('./routes/provider-routes');
var releaseHistoryRoutes = require('./routes/release-history-routes');
var productReleasesClient = require('../infra/providers/product-releases-client');

/**
 * Creates and returns the HTTP server.
 *
 * @param {Object} ctx — Server context provided by dashboard-server.js:
 *   @param {Object} ctx.deps — Dependencies for route modules
 *   @param {Object} ctx.dashboardHttp — Asset serving + pathname parser
 *   @param {string} ctx.DASHBOARD_SCRIPT_DIR — Static asset root
 *   @param {Function} ctx.syncGithubTokenFromBrowserRequest — Token sync
 *   @param {Object} ctx.serviceLog — Logger
 *   @param {Function} ctx.getDashboardHtml — HTML fallback renderer
 */
function createServer(ctx) {
  var routeHandlers = [];
  routeHandlers.push(layoutRoutes.register(ctx.deps).handle);
  routeHandlers.push(streamRoutes.register(ctx.deps).handle);
  routeHandlers.push(usageRoutes.register(ctx.deps).handle);
  routeHandlers.push(debugRoutes.register(ctx.deps).handle);
  routeHandlers.push(debugJsonlRoutes.register(ctx.deps).handle);
  routeHandlers.push(debugCacheRoutes.register(ctx.deps).handle);
  var releaseClient = productReleasesClient.createClient({
    serviceLog: ctx.serviceLog
  });
  routeHandlers.push(releaseHistoryRoutes.register({
    getReleaseHistory: function (callback) {
      releaseClient.getReleaseHistory(ctx.DASHBOARD_SCRIPT_DIR, callback);
    },
    serviceLog: ctx.serviceLog
  }).handle);
  if (ctx.providerRouteDeps) {
    routeHandlers.push(providerRoutes(ctx.providerRouteDeps).handle);
  }

  var server = http.createServer(function (req, res) {
    var pathname = ctx.dashboardHttp.requestPathname(req.url);
    var cspNonce = securityHeaders.createNonce();
    securityHeaders.applySecurityHeaders(res, cspNonce);

    if (securityHeaders.rejectCrossOriginApiRequest(req, res, pathname)) return;

    if (productProfile.dashboardOnly && pathname === '/api/product-capabilities') {
      var setupStatus = productSetup.status();
      var evidenceSources = ['claude-jsonl'];
      if (setupStatus.sources.cache_fix) evidenceSources.push('claude-code-cache-fix');
      if (setupStatus.sources.meter) evidenceSources.push('claude-code-meter');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        product: 'Claude Usage Dashboard',
        profile: 'dashboard',
        read_only_evidence: true,
        source_mode: 'additive',
        source_selection: setupStatus.sources,
        setup_configured: setupStatus.configured,
        evidence_sources: evidenceSources
      }));
      return;
    }

    // Published token rates as a dated history. Served rather than embedded so
    // the cost charts read one authoritative copy instead of carrying their own.
    if (pathname === '/api/rate-cards' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        history: rateCards.history(),
        changes: rateCards.changePoints()
      }));
      return;
    }

    if (productProfile.dashboardOnly && pathname === '/api/setup' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(productSetup.status()));
      return;
    }

    if (productProfile.dashboardOnly && pathname === '/api/setup' && req.method === 'POST') {
      var setupBody = '';
      req.on('data', function (chunk) {
        setupBody += chunk;
        if (setupBody.length > 65536) req.destroy();
      });
      req.on('end', function () {
        try {
          var updated = productSetup.write(JSON.parse(setupBody || '{}'));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(updated));
          // The proxy/evidence cache may have been initialized before setup
          // existed. Re-read immediately so Cache-Fix mode becomes visible
          // without restarting the dashboard process.
          if (typeof ctx.deps?.refreshProxyCache === 'function') {
            setTimeout(function () {
              ctx.deps.refreshProxyCache();
            }, 0);
          }
          var jsonlAgentPort = Number.parseInt(process.env.CLAUDE_USAGE_JSONL_AGENT_PORT || '3335', 10);
          var triggerReq = http.request({
            hostname: '127.0.0.1',
            port: jsonlAgentPort,
            path: '/trigger',
            method: 'POST',
            timeout: 1200
          });
          triggerReq.on('error', function () { /* next scheduled scan remains a fallback */ });
          triggerReq.end();
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // Read-only bridge to the local JSONL scanner. It exposes counts only:
    // never paths, log contents, or operational controls.
    if (productProfile.dashboardOnly && pathname === '/api/scan-status' && req.method === 'GET') {
      var agentPort = Number.parseInt(process.env.CLAUDE_USAGE_JSONL_AGENT_PORT || '3335', 10);
      var statusReq = http.get({
        hostname: '127.0.0.1',
        port: agentPort,
        path: '/status',
        timeout: 1200
      }, function (agentRes) {
        var body = '';
        agentRes.on('data', function (chunk) { body += chunk; });
        agentRes.on('end', function () {
          res.writeHead(agentRes.statusCode || 200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          });
          res.end(body);
        });
      });
      statusReq.on('timeout', function () { statusReq.destroy(); });
      statusReq.on('error', function () {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, scan_in_progress: false, scan_progress: null }));
      });
      return;
    }

    // Token sync for specific paths
    if (
      pathname === '/api/usage' ||
      pathname === '/api/stream' ||
      pathname === '/api/extension-timeline' ||
      pathname === '/api/github-releases-refresh' ||
      pathname === '/api/marketplace-refresh' ||
      pathname === '/api/github-session-sync'
    ) {
      ctx.syncGithubTokenFromBrowserRequest(req, ctx.serviceLog);
    }

    // Static assets
    if (ctx.dashboardHttp.tryServeDashboardAsset(ctx.DASHBOARD_SCRIPT_DIR, pathname, res)) return;

    // Route modules
    for (var ri = 0; ri < routeHandlers.length; ri++) {
      if (routeHandlers[ri](pathname, req, res)) return;
    }

    // API paths must never fall through to HTML.
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'not_available', product: productProfile.name }));
      return;
    }

    // Only the root document is a dashboard route.
    if (pathname !== '/' || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not Found');
      return;
    }

    // Default fallback: serve dashboard HTML.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD'
      ? ''
      : ctx.getDashboardHtml().replace('__CSP_NONCE__', cspNonce));
  });

  return server;
}

module.exports = {
  createServer: createServer
};
