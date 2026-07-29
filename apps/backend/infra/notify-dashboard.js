'use strict';
/**
 * @asseris-module       Notify Dashboard
 * @asseris-description  Shared helper agents use to POST /api/provider-notify when their
 *                       a local disk cache has been refreshed.
 * @asseris-pillar       infra
 * @asseris-domain       agent-process
 * @asseris-stage        output
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    JSONL Agent, Provider Agent
 * @asseris-emits        POST /api/provider-notify request
 * @asseris-consumes     dashboardUrl, source key
 *
 * infra/notify-dashboard.js — Shared helper for internal agent → dashboard notifies.
 *
 * Local scanner/provider agents use this to POST /api/provider-notify.
 *
 * @param {string} dashboardUrl   — base URL, e.g. http://localhost:3333
 * @param {string} source         — notify source key (usage|jsonl|outage|releases|marketplace)
 * @param {Object} serviceLog     — service-logger instance
 * @param {Function} [cb]         — optional callback(err)
 */

var http = require('node:http');
var https = require('node:https');

function notifyDashboard(dashboardUrl, source, serviceLog, cb) {
  cb = cb || function () {};
  var url = dashboardUrl.replace(/\/+$/, '') + '/api/provider-notify';
  var body = JSON.stringify({ source: source });
  var parsed;
  try { parsed = new URL(url); } catch (e) { return cb(e); }

  var headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };

  var mod = parsed.protocol === 'https:' ? https : http;
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname,
    method: 'POST',
    headers: headers,
    timeout: 10000,
    rejectUnauthorized: false
  };

  var req = mod.request(opts, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      var resp = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode === 200) {
        serviceLog.info('notify', source + ' → dashboard OK');
        cb(null);
      } else {
        serviceLog.warn('notify', source + ' → HTTP ' + res.statusCode + ': ' + resp.slice(0, 200));
        cb(new Error('HTTP ' + res.statusCode));
      }
    });
  });
  req.on('error', function (e) {
    serviceLog.warn('notify', source + ' → ' + (e.message || e));
    cb(e);
  });
  req.on('timeout', function () {
    req.destroy();
    serviceLog.warn('notify', source + ' → timeout');
    cb(new Error('timeout'));
  });
  req.write(body);
  req.end();
}

module.exports = { notifyDashboard: notifyDashboard };
