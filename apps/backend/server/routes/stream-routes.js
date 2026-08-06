'use strict';

/**
 * @asseris-module       Stream Routes
 * @asseris-description  /api/stream Server-Sent-Events channel for live dashboard updates,
 *                       plus /api/github-session-sync trigger. Maintains the sseClients
 *                       set for fan-out broadcasts from cache reloads and audit events.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        SSE event stream, github-sync-ack JSON
 * @asseris-consumes     getCachedData snapshot, client connection lifecycle
 *
 * /api/stream (SSE) and /api/github-session-sync route handlers
 * deps: getCachedData, sseClients
 */
function register(deps) {
  var getCachedData = deps.getCachedData;
  var sseClients = deps.sseClients;

  function handle(pathname, req, res) {
    if (pathname === '/api/github-session-sync' && req.method === 'GET') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    if (pathname === '/api/stream') {
      // SSE endpoint
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      // The stream carries the same shape as /api/usage, capabilities included:
      // a payload without them makes the chart classification flip off on every
      // live update and back on at the next reload.
      var streamSetup = require('../../app/product-setup').read();
      res.write('data: ' + JSON.stringify({
        ...getCachedData(),
        capabilities: require('../../domain/addons/addon-adapter').capabilities(
          streamSetup?.sources || {}, { setup: streamSetup }
        )
      }) + '\n\n');
      sseClients.push(res);
      req.on('close', function () {
        var idx = sseClients.indexOf(res);
        if (idx >= 0) sseClients.splice(idx, 1);
      });
      return true;
    }

    return false;
  }

  return { handle: handle };
}

module.exports = { register: register };
