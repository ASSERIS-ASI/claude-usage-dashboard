'use strict';
/**
 * @asseris-module       Scan Worker
 * @asseris-description  Worker-thread JSONL scanner — runs the heavy parse loop off the
 *                       main event loop so HTTP/SSE stays responsive. Shares the same
 *                       aggregation modules as the main thread for identical output.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Session Signals Classifier, Buckets, Build Usage Snapshot
 * @asseris-called-by    Usage Scan Orchestrator (spawns via worker_threads)
 * @asseris-emits        progress messages + final result over parentPort
 * @asseris-consumes     tagged file list + config from parentPort
 *`r`n * Runs the heavy JSONL parse loop off the main thread so HTTP/SSE stays responsive.
 * Receives tagged file list + config via parentPort, posts back progress + result.
 *
 * Uses the same shared modules as the main thread (build-usage-snapshot.js)
 * to ensure identical aggregation logic.
 */
var { parentPort } = require('node:worker_threads');

// Shared modules — canonical implementations (no local duplicates)
var sessionSignalsMod = require('../domain/usage/session-signals');
var emptySessionSignals = sessionSignalsMod.emptySessionSignals;
var bucketsMod = require('../domain/usage/buckets');
var emptySecurityPostures = bucketsMod.emptySecurityPostures;
var usageSnapshot = require('./build-usage-snapshot');
var processJsonlFile = usageSnapshot.processJsonlFile;

// ── Main worker loop ─────────────────────────────────────────────────────

parentPort.on('message', function (msg) {
  try {
    var tagged = msg.tagged;
    var onlyDate = msg.onlyDate || null;
    var daily = msg.daily || {};
    var BATCH = 5;

    // Restore daily buckets from cache (they come as plain objects)
    for (var dk in daily) {
      if (!daily[dk].session_signals) daily[dk].session_signals = emptySessionSignals();
      if (!daily[dk].security_postures) daily[dk].security_postures = emptySecurityPostures();
    }

    for (var fi = 0; fi < tagged.length; fi++) {
      processJsonlFile(tagged[fi], daily, onlyDate, null, null, null);
      // Post progress every BATCH files
      if ((fi + 1) % BATCH === 0 || fi === tagged.length - 1) {
        parentPort.postMessage({ type: 'progress', fi: fi + 1, total: tagged.length });
      }
    }

    parentPort.postMessage({ type: 'done', daily: daily });
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: e.message || String(e) });
  }
});
