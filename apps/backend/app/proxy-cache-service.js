'use strict';

var crypto = require('node:crypto');
var fs = require('node:fs');
var path = require('node:path');
var storagePaths = require('../domain/usage/storage-paths');

/**
 * Local, read-only request-telemetry cache.
 *
 * Source NDJSON is never changed. Parsing can run in a worker thread; the only
 * writes are derived dashboard state such as overage-history snapshots.
 */
module.exports = function createProxyCacheService(opts) {
  var serviceLog = opts.serviceLog;
  var parseProxyNdjsonFiles = opts.parseProxyNdjsonFiles;
  var proxyParseWorkerPath = opts.proxyParseWorkerPath || null;

  var cache = { data: null, generated: null };
  var refreshInFlight = false;
  var rerunRequested = false;
  var onRefreshed = null;

  var overageHistoryLoaded = false;
  var overageHistoryFingerprint = null;
  var overageHistoryPath = process.env.CLAUDE_USAGE_OVERAGE_HISTORY_PATH ||
    storagePaths.stateFile('overage-history.ndjson');

  function loadOverageHistoryFingerprint() {
    if (overageHistoryLoaded) return;
    overageHistoryLoaded = true;
    try {
      if (!fs.existsSync(overageHistoryPath)) return;
      var lines = fs.readFileSync(overageHistoryPath, 'utf8').trim().split(/\r?\n/);
      if (!lines.length) return;
      overageHistoryFingerprint = JSON.parse(lines[lines.length - 1]).fingerprint || null;
    } catch (error) {
      serviceLog.warn('overage-history', 'could not read last snapshot: ' + (error.message || error));
    }
  }

  function appendOverageHistory(proxyData) {
    var days = proxyData?.proxy_days;
    if (!days?.length) return;
    var day = days[days.length - 1];
    var accounts = day?.overage_usage?.accounts || {};
    if (!Object.keys(accounts).length) return;

    var rateLimit = day.rate_limit || {};
    var fingerprintSource = JSON.stringify({
      date: day.date,
      header_ts: rateLimit._ts || null,
      accounts: accounts
    });
    var fingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');
    loadOverageHistoryFingerprint();
    if (fingerprint === overageHistoryFingerprint) return;

    var record = {
      ts: new Date().toISOString(),
      date: day.date,
      header_ts: rateLimit._ts || null,
      active_organization_id: rateLimit._organization_id || null,
      q5: rateLimit['anthropic-ratelimit-unified-5h-utilization'] ?? null,
      q7: rateLimit['anthropic-ratelimit-unified-7d-utilization'] ?? null,
      overage_status: rateLimit['anthropic-ratelimit-unified-overage-status'] || null,
      overage_in_use: rateLimit['anthropic-ratelimit-unified-overage-in-use'] || null,
      overage_header_utilization: rateLimit['anthropic-ratelimit-unified-overage-utilization'] ?? null,
      accounts: accounts,
      fingerprint: fingerprint
    };

    try {
      fs.mkdirSync(path.dirname(overageHistoryPath), { recursive: true });
      fs.appendFileSync(overageHistoryPath, JSON.stringify(record) + '\n', 'utf8');
      overageHistoryFingerprint = fingerprint;
    } catch (error) {
      serviceLog.warn('overage-history', 'append failed: ' + (error.message || error));
    }
  }

  function applyParsed(data, tag) {
    cache.data = data;
    cache.generated = new Date().toISOString();
    appendOverageHistory(data);
    serviceLog.info(
      'request-telemetry',
      'parsed days=' + (data?.proxy_days?.length || 0) +
        ' files=' + (data?.proxy_files || 0) +
        (tag ? ' (' + tag + ')' : '')
    );
  }

  function fireOnRefreshed() {
    if (typeof onRefreshed !== 'function') return;
    try {
      onRefreshed();
    } catch (error) {
      serviceLog.error('request-telemetry', 'refresh hook failed: ' + (error.message || error));
    }
  }

  function finishRefresh() {
    refreshInFlight = false;
    fireOnRefreshed();
    if (rerunRequested) {
      rerunRequested = false;
      refreshProxyCache();
    }
  }

  function syncParse(tag) {
    refreshInFlight = true;
    try {
      applyParsed(parseProxyNdjsonFiles(), tag || 'sync');
    } catch (error) {
      serviceLog.error('request-telemetry', 'parse failed: ' + (error.message || error));
    } finally {
      finishRefresh();
    }
  }

  function spawnParseWorker() {
    refreshInFlight = true;
    var Worker;
    try {
      Worker = require('node:worker_threads').Worker;
    } catch (error) {
      syncParse('worker-unavailable');
      return;
    }

    var worker;
    var startedAt = Date.now();
    try {
      worker = new Worker(proxyParseWorkerPath);
    } catch (error) {
      serviceLog.warn('request-telemetry', 'worker spawn failed; using main thread');
      syncParse('worker-spawn-fallback');
      return;
    }

    var settled = false;
    function settle(error, result) {
      if (settled) return;
      settled = true;
      try { worker.terminate(); } catch (_error) { /* already stopped */ }
      if (error) {
        serviceLog.error('request-telemetry', 'worker failed: ' + (error.message || error));
      } else {
        try {
          applyParsed(result, 'worker ' + (Date.now() - startedAt) + 'ms');
        } catch (applyError) {
          serviceLog.error('request-telemetry', 'worker result failed: ' + (applyError.message || applyError));
        }
      }
      finishRefresh();
    }

    worker.on('message', function (message) {
      if (message?.type === 'done') settle(null, message.result);
      else if (message?.type === 'error') settle(new Error(message.message), null);
    });
    worker.on('error', function (error) { settle(error, null); });
    worker.on('exit', function (code) {
      if (!settled) settle(new Error('worker exited with code ' + code), null);
    });
    worker.postMessage({ opts: {} });
  }

  function refreshProxyCache() {
    if (refreshInFlight) {
      rerunRequested = true;
      return;
    }
    if (proxyParseWorkerPath) spawnParseWorker();
    else syncParse('sync');
  }

  return {
    refreshProxyCache: refreshProxyCache,
    getProxyCache: function () { return cache; },
    _setOnRefreshed: function (callback) { onRefreshed = callback; },
    get data() { return cache.data; },
    get generated() { return cache.generated; }
  };
};
