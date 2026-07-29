'use strict';
/**
 * @asseris-module       Proxy Parse Worker
 * @asseris-description  Worker-thread proxy-NDJSON parser — runs the heavy full-window parse
 *                       (proxy-*.ndjson, ~200-400 files) off the main event loop so the
 *                       dashboard responsive while compatible request logs are parsed.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Proxy NDJSON Parser
 * @asseris-called-by    Proxy Cache Service (spawns via worker_threads)
 * @asseris-emits        final result over parentPort
 * @asseris-consumes     parse opts from parentPort
 *
 * Runs parseProxyNdjsonFiles() in a worker thread. The function is pure + stateless
 * (see build-proxy-snapshot.js), so it ports cleanly; it reads the proxy-logs dirs from
 * process.env (HOME) which the worker inherits.
 */
var { parentPort } = require('node:worker_threads');
var proxyNdjsonParser = require('./proxy-ndjson-parser');

parentPort.on('message', function (msg) {
  try {
    var opts = (msg && msg.opts) ? msg.opts : {};
    var result = proxyNdjsonParser.parseProxyNdjsonFiles(opts);
    parentPort.postMessage({ type: 'done', result: result });
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: (e && e.message) ? e.message : String(e) });
  }
});
