'use strict';
/**
 * @asseris-module       Debug Cache Routes
 * @asseris-description  /api/debug/cache-files (list), /api/debug/cache-file-view (read)
 *                       and DEBUG_API-gated /api/debug/cache-reset (full rescan trigger)
 *                       for the local on-disk usage cache.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Route Helpers, Debug Cache Service
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        cache-files list JSON, file-view JSON, reset-ack
 * @asseris-consumes     disk cache files, path query params
 *
 * server/routes/debug-cache-routes.js — Cache file listing, viewing, reset.
 *
 * Split from debug-routes.js (clean-modules Phase 1).
 * cache-files/cache-file-view: always available. cache-reset: DEBUG_API=1 only.
 */

var fs = require('node:fs');
var path = require('node:path');
var rh = require('../route-helpers');
var readJsonBodyMax = rh.readJsonBody;
var CORS_JSON = rh.CORS_JSON;

function register(deps) {
  var serviceLog = deps.serviceLog;
  var collectDebugCacheFilesPayload = deps.collectDebugCacheFilesPayload;
  var debugPathAllowedForRead = deps.debugPathAllowedForRead;
  var displayPathForUi = deps.displayPathForUi;
  var runScanAndBroadcast = deps.runScanAndBroadcast;
  var resetScanFingerprints = deps.resetScanFingerprints;
  var USAGE_DAY_CACHE_FILE = deps.USAGE_DAY_CACHE_FILE;
  var JSONL_TODAY_INDEX_FILE = deps.JSONL_TODAY_INDEX_FILE;
  var DEBUG_CACHE_FILE_VIEW_MAX_BYTES = deps.DEBUG_CACHE_FILE_VIEW_MAX_BYTES || 786432;

  function logOptionalErr(err) {
    if (err) { try { serviceLog.error('debug-cache-routes', err.message || err); } catch (_e) { /* noop */ } }
  }

  function handle(pathname, req, res) {
    // ── /api/debug/cache-files  GET ──
    if (pathname === '/api/debug/cache-files' && req.method === 'GET') {
      var corsCf = CORS_JSON;
      var listCf = collectDebugCacheFilesPayload();
      res.writeHead(200, corsCf);
      res.end(JSON.stringify({ ok: true, files: listCf }));
      return true;
    }

    // ── /api/debug/cache-file-view  POST+OPTIONS ──
    if (pathname === '/api/debug/cache-file-view') {
      var corsView = CORS_JSON;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return true;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, Object.assign({ Allow: 'POST, OPTIONS' }, corsView));
        res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
        return true;
      }
      readJsonBodyMax(req, 65536, function (errV, bodyV) {
        if (errV && String(errV.message || errV) === 'payload_too_large') {
          res.writeHead(413, corsView);
          res.end(JSON.stringify({ ok: false, error: 'payload_too_large' }));
          return;
        }
        if (errV) {
          res.writeHead(400, corsView);
          res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
          return;
        }
        var rawPath = bodyV && (bodyV.path_abs || bodyV.path);
        if (!rawPath || typeof rawPath !== 'string') {
          res.writeHead(400, corsView);
          res.end(JSON.stringify({ ok: false, error: 'missing_path' }));
          return;
        }
        var target = path.resolve(rawPath);

        if (!debugPathAllowedForRead(target)) {
          res.writeHead(403, corsView);
          res.end(JSON.stringify({ ok: false, error: 'path_not_allowed' }));
          return;
        }
        try {
          var stv = fs.statSync(target);
          if (!stv.isFile()) {
            res.writeHead(400, corsView);
            res.end(JSON.stringify({ ok: false, error: 'not_a_file' }));
            return;
          }
          var buf = fs.readFileSync(target);
          var truncated = buf.length > DEBUG_CACHE_FILE_VIEW_MAX_BYTES;
          var slice = truncated ? buf.subarray(0, DEBUG_CACHE_FILE_VIEW_MAX_BYTES) : buf;
          var text = slice.toString('utf8');
          if (truncated) {
            text += '\n... [truncated, file_bytes=' + buf.length + ' show_max=' + DEBUG_CACHE_FILE_VIEW_MAX_BYTES + ']';
          }
          serviceLog.info('dev', 'cache-file-view ' + displayPathForUi(target) + ' bytes=' + buf.length + (truncated ? ' truncated=1' : ''));
          res.writeHead(200, corsView);
          res.end(JSON.stringify({
            ok: true,
            path_ui: displayPathForUi(target),
            size: buf.length,
            truncated: truncated,
            content: text
          }));
        } catch (eV) {
          res.writeHead(500, corsView);
          res.end(JSON.stringify({ ok: false, error: 'read_failed', detail: String(eV && eV.message ? eV.message : eV) }));
        }
      });
      return true;
    }

    // ── /api/debug/cache-reset  POST  (DEBUG_API=1) ──
    if (pathname === '/api/debug/cache-reset' && req.method === 'POST' && process.env.DEBUG_API === '1') {
      if (fs.existsSync(USAGE_DAY_CACHE_FILE)) fs.unlinkSync(USAGE_DAY_CACHE_FILE);
      if (fs.existsSync(JSONL_TODAY_INDEX_FILE)) fs.unlinkSync(JSONL_TODAY_INDEX_FILE);
      // Reset in-memory fingerprints so scan doesn't short-circuit via tier2InMemory
      resetScanFingerprints?.();
      serviceLog.info('cache', 'cache-reset via /api/debug/cache-reset — full rescan triggered (fingerprints reset)');
      runScanAndBroadcast();
      res.writeHead(200, CORS_JSON);
      res.end(JSON.stringify({ ok: true, message: 'Day cache deleted, full rescan started' }));
      return true;
    }

    return false;
  }

  return { handle: handle };
}

module.exports = { register: register };
