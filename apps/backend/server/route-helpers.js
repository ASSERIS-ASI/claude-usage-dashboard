'use strict';
/**
 * @asseris-module       Route Helpers
 * @asseris-description  Shared utilities for route modules — frozen JSON headers,
 *                       common error responders, body parsers. Pure utility, no framework.
 * @asseris-pillar       infra
 * @asseris-domain       helper-utils
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Debug Cache Routes, Debug JSONL Routes, Debug Routes, Provider Notify Route, Sync Routes
 * @asseris-emits        JSON headers constants, error-response helpers
 * @asseris-consumes     —
 *
 * Shared helpers for route modules — eliminates repeated boilerplate.
 * No framework, no middleware stack, just utility functions.
 */

/** Frozen JSON headers (safe as Object.assign source). */
var JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json'
});

var JSON_HEADERS_NOCACHE = Object.freeze({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
});

/**
 * Read request body up to maxBytes, parse as JSON.
 * Callback: (err, parsedObj). Empty body → {}.
 */
function readJsonBody(req, maxBytes, cb) {
  var chunks = [];
  var total = 0;
  req.on('data', function (chunk) {
    total += chunk.length;
    if (total > maxBytes) {
      try { req.destroy(); } catch (_e) { /* noop */ }
      cb(new Error('payload_too_large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', function () {
    try {
      var raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return cb(null, {});
      cb(null, JSON.parse(raw));
    } catch (eParse) {
      cb(eParse);
    }
  });
  req.on('error', function (e) { cb(e); });
}

/**
 * Send a JSON response.
 * @param {object} res - HTTP response
 * @param {number} status - HTTP status code
 * @param {*} data - JSON-serializable payload
 * @param {object} [extraHeaders] - merged into response headers
 */
function sendJson(res, status, data, extraHeaders) {
  var headers = extraHeaders
    ? Object.assign({ 'Content-Type': 'application/json' }, extraHeaders)
    : { 'Content-Type': 'application/json' };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

module.exports = { JSON_HEADERS, JSON_HEADERS_NOCACHE, readJsonBody, sendJson };
