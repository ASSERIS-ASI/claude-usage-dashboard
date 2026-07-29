'use strict';
/**
 * @asseris-module       Cache Update Service
 * @asseris-description  Owns the cachedData mutations + SSE fan-out — broadcastSse,
 *                       applyJsonlScanCache, outage-fetched hook, and the reapply-extension-
 *                       markers refresh path on marketplace updates.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server, Provider Notify Route, Stream Routes
 * @asseris-emits        SSE event broadcasts, cachedData mutations
 * @asseris-consumes     usage snapshot, outage cache, marketplace cache
 *
 * app/cache-update-service.js — Cache mutation + SSE broadcast service.
 *
 * Extracted from dashboard-server.js (Phase 19).
 * Consolidates all functions that mutate cachedData and broadcast SSE updates.
 *
 * Owns the local scanner/provider cache only. Remote cache ingestion is not a
 * capability of the standalone dashboard.
 */

module.exports = function createCacheUpdateService(opts) {
  var serviceLog = opts.serviceLog;
  var getOutageDaysMap = opts.getOutageDaysMap;
  var buildReleaseStabilityData = opts.buildReleaseStabilityData;
  var getCachedData = opts.getCachedData;
  var setCachedData = opts.setCachedData;
  var getSseClients = opts.getSseClients;
  var refreshProxyCache = opts.refreshProxyCache;
  var getProxyCache = opts.getProxyCache;
  var scanOrchestrator = opts.scanOrchestrator;
  var applyExtensionVersionMarkers = opts.applyExtensionVersionMarkers;
  var applyJsonlGapVersionChanges = opts.applyJsonlGapVersionChanges;
  var enrichVersionChangeNotes = opts.enrichVersionChangeNotes;

  // ── Core: SSE Broadcast ──────────────────────────────────────────────

  function broadcastSse() {
    var cachedData = getCachedData();
    if (!cachedData) return;
    var json = JSON.stringify(cachedData);
    var clients = getSseClients();
    for (var i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i].write('data: ' + json + '\n\n');
      } catch (e) {
        clients.splice(i, 1);
        // Connection closed — safe to ignore
      }
    }
  }

  // ── Core: Outage merge ───────────────────────────────────────────────

  function onOutageFetched(oc) {
    var cachedData = getCachedData();
    if (!cachedData?.days?.length) return;
    var freshOutage = getOutageDaysMap();
    for (var rd of cachedData.days) {
      var lo = freshOutage[rd.date];
      if (!lo) continue;
      rd.outage_spans = lo.spans;
      rd.outage_hours = lo.outage_hours;
      rd.outage_server_hours = lo.server_hours;
      rd.outage_client_hours = lo.client_hours;
      rd.outage_incidents = lo.incidents;
    }
    cachedData.generated = new Date().toISOString();
    cachedData.outage_status = 'ok';
    cachedData.outage_fetched = new Date(oc.fetchedAt).toISOString();
    broadcastSse();
  }

  // ── Core: JSONL scan result from disk ────────────────────────────────

  function applyJsonlScanCache(cache) {
    var scan = cache.data;
    if (!scan) return;
    var cachedData = getCachedData();
    scan.generated = new Date().toISOString();
    scan.scanning = false;
    var hadAgentPending = !!cachedData?.agent_pending;
    setCachedData(scan);
    cachedData = getCachedData();
    delete cachedData.agent_pending;
    cachedData.release_stability = buildReleaseStabilityData();
    refreshProxyCache();
    var pc = getProxyCache();
    if (pc.data) cachedData.proxy = pc.data;
    var daysLen2 = (scan.days || []).length;
    serviceLog.info('jsonl-reload', 'applied: ' + daysLen2 + ' days, files=' + (scan.parsed_files || 0) + ' agent_pending_cleared=' + hadAgentPending);
    serviceLog.debug('jsonl-reload', 'cachedData.scanning=' + cachedData.scanning + ' days=' + daysLen2 + ' agent_pending=' + !!cachedData.agent_pending);
    broadcastSse();
  }

  // ── Core: Extension marketplace markers ──────────────────────────────

  function reapplyExtensionMarkers(reason) {
    var cachedData = getCachedData();
    if (!cachedData?.days?.length) return;
    if (scanOrchestrator?.isScanInProgress()) {
      serviceLog.debug('markers', 'skip reapply: scan in progress (' + reason + ')');
      return;
    }
    try {
      applyExtensionVersionMarkers(cachedData.days, null);
      applyJsonlGapVersionChanges(cachedData.days);
      enrichVersionChangeNotes(cachedData.days);
      cachedData.generated = new Date().toISOString();
      broadcastSse();
      serviceLog.info('markers', 'extension markers refreshed (' + reason + ')');
    } catch (e) {
      serviceLog.error('markers', 'reapply failed: ' + (e?.message ? e.message : String(e)));
    }
  }

  return {
    broadcastSse: broadcastSse,
    onOutageFetched: onOutageFetched,
    applyJsonlScanCache: applyJsonlScanCache,
    reapplyExtensionMarkers: reapplyExtensionMarkers,
    /** Late-bind scanOrchestrator (avoids circular init dependency). */
    _setScanOrchestrator: function (so) { scanOrchestrator = so; }
  };
};
