'use strict';
/**
 * @asseris-module       Provider Notify Route
 * @asseris-description  POST /api/provider-notify — receives "cache refreshed" pings from
 *                       provider-agent / jsonl-agent, reloads in-memory
 *                       cache from disk and fans out an SSE broadcast to live dashboards.
 * @asseris-pillar       infra
 * @asseris-domain       agent-process
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Route Helpers, Cache Update Service
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        notify-ack JSON, SSE broadcast trigger
 * @asseris-consumes     notify body {source}
 *
 * provider-routes.js — POST /api/provider-notify
 *
 * Receives notifications from local agents (provider-agent and jsonl-agent)
 * after they have refreshed a disk cache. Reloads the
 * in-memory cache from disk and triggers SSE broadcast.
 */
var CORS_JSON = require('../route-helpers').CORS_JSON;

module.exports = function createProviderRoutes(opts) {
  var serviceLog = opts.serviceLog;
  var outageClient = opts.outageClient;
  var releasesClient = opts.releasesClient;
  var marketplaceClient = opts.marketplaceClient;
  var jsonlClient = opts.jsonlClient;
  var onOutageReloaded = opts.onOutageReloaded;
  var onReleasesReloaded = opts.onReleasesReloaded;
  var onMarketplaceReloaded = opts.onMarketplaceReloaded;
  var onJsonlReloaded = opts.onJsonlReloaded;

  function handle(pathname, req, res) {
    if (pathname !== '/api/provider-notify' || req.method !== 'POST') return false;

    var cors = CORS_JSON;
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      var body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
        res.writeHead(400, cors);
        res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
        return;
      }

      var source = body.source;
      if (!source || !['outage', 'releases', 'marketplace', 'jsonl'].includes(source)) {
        res.writeHead(400, cors);
        res.end(JSON.stringify({ ok: false, error: 'invalid_source', expected: 'outage|releases|marketplace|jsonl' }));
        return;
      }

      var reloaded = false;
      if (source === 'outage') {
        reloaded = outageClient.reloadFromDisk();
        if (reloaded) {
          serviceLog.info('provider-notify', 'outage cache reloaded from disk');
          onOutageReloaded(outageClient.outageCache);
        }
      } else if (source === 'releases') {
        reloaded = releasesClient.reloadFromDisk();
        if (reloaded) {
          serviceLog.info('provider-notify', 'releases cache reloaded from disk (' + releasesClient.releasesCache.releases.length + ' entries)');
          onReleasesReloaded();
        }
      } else if (source === 'marketplace') {
        reloaded = marketplaceClient.reloadFromDisk();
        if (reloaded) {
          serviceLog.info('provider-notify', 'marketplace cache reloaded from disk (' + marketplaceClient.marketplaceVersionsCache.items.length + ' versions)');
          onMarketplaceReloaded();
        }
      } else if (source === 'jsonl' && jsonlClient) {
        reloaded = jsonlClient.reloadFromDisk();
        if (reloaded) {
          var jsonlDaysLen = (jsonlClient.scanCache.data?.days || []).length;
          serviceLog.info('provider-notify', 'jsonl scan reloaded from disk (' + jsonlDaysLen + ' days)');
          if (onJsonlReloaded) onJsonlReloaded(jsonlClient.scanCache);
        }
      }

      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true, source: source, reloaded: reloaded }));
    });

    return true;
  }

  return { handle: handle };
};
