'use strict';
/**
 * @asseris-module       HTTP Client
 * @asseris-description  Shared HTTP/HTTPS utilities used by provider clients — JSON GET/POST
 *                       with timeout + redirect handling, retry logic, error normalization.
 *                       Pure node:http(s), no npm dep.
 * @asseris-pillar       infra
 * @asseris-domain       helper-utils
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server, GitHub Releases Client, Marketplace Client, Outage Client
 * @asseris-emits        HTTP/HTTPS request bodies + parsed JSON responses
 * @asseris-consumes     URL, headers, request body, timeout options
 *
 * http-client.js — Shared HTTP utilities for provider clients.
 *
 * Extracted from dashboard-server.js (Phase 4).
 */
var https = require('node:https');
var http = require('node:http');

/**
 * GET + JSON parse. Follows redirects. Optional extra headers.
 * @param {string} urlStr
 * @param {Object} [extraHeaders] - additional headers to send
 * @param {Function} cb - (err, data)
 */
function httpsGetJson(urlStr, extraHeaders, cb) {
  if (typeof extraHeaders === 'function') {
    cb = extraHeaders;
    extraHeaders = null;
  }
  var parsed;
  try {
    parsed = new URL(urlStr);
  } catch (eU) {
    cb(eU, null);
    return;
  }
  var headers = Object.create(null);
  if (extraHeaders) {
    var ek = Object.keys(extraHeaders);
    for (var eKey of ek) headers[eKey] = extraHeaders[eKey];
  }
  var mod = parsed.protocol === 'https:' ? https : http;
  var opts = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: headers
  };
  if (parsed.port) opts.port = parsed.port;
  var req = mod.request(opts, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      var nextUrl;
      try {
        nextUrl = new URL(res.headers.location, urlStr).href;
      } catch (eL) {
        cb(new Error('bad redirect'), null);
        return;
      }
      return httpsGetJson(nextUrl, extraHeaders, cb);
    }
    var chunks = [];
    res.on('data', function (c) {
      chunks.push(c);
    });
    res.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      try {
        var data = JSON.parse(raw);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          var msg =
            data && typeof data.message === 'string' ? data.message : 'HTTP ' + res.statusCode;
          cb(new Error(msg), null);
          return;
        }
        cb(null, data);
      } catch (eJ) {
        cb(eJ, null);
      }
    });
  });
  req.on('error', function (e) {
    cb(e, null);
  });
  req.setTimeout(20000, function () {
    req.destroy();
    cb(new Error('timeout'), null);
  });
  req.end();
}

/**
 * POST JSON + parse response. Custom timeout support.
 * @param {string} postUrl
 * @param {Object} jsonBody
 * @param {Function} cb - (err, data)
 * @param {number} [timeoutMs=15000]
 */
function httpsPostJson(postUrl, jsonBody, cb, timeoutMs) {
  var parsed;
  try {
    parsed = new URL(postUrl);
  } catch (e) {
    cb(e, null);
    return;
  }
  var tMs = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000;
  var finished = false;
  function done(err, data) {
    if (finished) return;
    finished = true;
    cb(err, data);
  }
  var body = JSON.stringify(jsonBody);
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 443,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json;api-version=7.2-preview.1',
      'Content-Length': Buffer.byteLength(body, 'utf8')
    }
  };
  var req = https.request(opts, function (res) {
    var chunks = [];
    res.on('data', function (c) {
      chunks.push(c);
    });
    res.on('end', function () {
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done(new Error('HTTP ' + res.statusCode), null);
          return;
        }
        done(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        done(e, null);
      }
    });
  });
  req.on('error', function (e) {
    done(e, null);
  });
  req.setTimeout(tMs, function () {
    req.destroy();
    done(new Error('timeout'), null);
  });
  req.write(body);
  req.end();
}

module.exports = {
  httpsGetJson: httpsGetJson,
  httpsPostJson: httpsPostJson
};
