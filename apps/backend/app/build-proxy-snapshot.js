'use strict';
/**
 * @asseris-module       Build Proxy Snapshot
 * @asseris-description  Thin app-layer wrapper that triggers proxy-ndjson-parser and returns
 *                       a proxy snapshot ready for the /api/proxy-usage and /api/usage
 *                       endpoints. Does no aggregation itself.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Proxy NDJSON Parser
 * @asseris-called-by    Proxy Cache Service, Dashboard Server
 * @asseris-emits        proxy snapshot object
 * @asseris-consumes     —
 *
 * build-proxy-snapshot.js — App-Service fuer Proxy-Daten-Aggregation.
 *
 * Duenner Wrapper um proxy-ndjson-parser (bereits pure und stateless).
 */
var proxyNdjsonParser = require('./proxy-ndjson-parser');

function buildProxySnapshot() {
  return proxyNdjsonParser.parseProxyNdjsonFiles();
}

module.exports = {
  buildProxySnapshot: buildProxySnapshot
};
