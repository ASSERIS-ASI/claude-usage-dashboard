'use strict';
/**
 * @asseris-module       Outage Client
 * @asseris-description  Fetches incidents from status.claude.com — in-memory + disk cache,
 *                       computes per-day outage hours and time spans for overlay markers
 *                       on usage charts (correlates user issues with provider outages).
 * @asseris-pillar       sensor
 * @asseris-domain       external-source
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       ANC-07
 * @asseris-calls        HTTP Client
 * @asseris-called-by    Dashboard Server, Token Forensics, JSONL Agent, Provider Agent
 * @asseris-emits        outage incidents cache, per-day outage hours + spans
 * @asseris-consumes     status.claude.com incident feed
 *
 * outage-client.js — Anthropic Outage Data Provider.
 *
 * Fetches incidents from status.claude.com, maintains in-memory + disk cache,
 * computes per-day outage hours/spans.
 */
var fs = require('node:fs');
var path = require('node:path');
var httpClient = require('../http-client');
var storagePaths = require('../../domain/usage/storage-paths');

var OUTAGE_API_URL = 'https://status.claude.com/api/v2/incidents.json';
var OUTAGE_REFRESH_MS = 5 * 60 * 1000;
// Obergrenze fuer die als Ausfall gezaehlte Dauer eines noch NICHT aufgeloesten
// Incidents. Schuetzt gegen Status-Advisories, die unbefristet im Status
// 'monitoring' offen geparkt bleiben (z.B. eine Modell-Suspension) und sonst
// jeden Tag bis heute als kritischen Dauerausfall darstellen wuerden.
var OUTAGE_MAX_OPEN_HOURS = 48;
var OUTAGE_DISK_CACHE = storagePaths.stateFile('outages.json');
storagePaths.migrateLegacyFileIfMissing(OUTAGE_DISK_CACHE, 'usage-dashboard-outages.json');

// In-memory cache (module-scoped singleton)
var outageCache = { incidents: [], fetchedAt: 0, error: null };

// Disk-Cache laden (sofort verfuegbar, kein Netzwerk noetig)
try {
  var diskOutage = JSON.parse(fs.readFileSync(OUTAGE_DISK_CACHE, 'utf8'));
  if (Array.isArray(diskOutage.incidents)) {
    outageCache.incidents = diskOutage.incidents;
    outageCache.fetchedAt = diskOutage.fetchedAt || 0;
  }
} catch (error) { /* intentional */ }

/**
 * Fetch fresh incidents from status.claude.com.
 * @param {Function} serviceLog - { debug, info, warn, error }
 * @param {Function} [onFetched] - (outageCache) called after successful fetch, for server-side merge+broadcast
 */
function refreshOutageCache(serviceLog, onFetched) {
  serviceLog.debug('outage', 'GET status.claude.com');
  httpClient.httpsGetJson(OUTAGE_API_URL, function (err, data) {
    if (err) {
      outageCache.error = err.message || String(err);
      serviceLog.error('outage', 'fetch failed: ' + outageCache.error);
      return;
    }
    if (data && Array.isArray(data.incidents)) {
      outageCache.incidents = data.incidents;
      outageCache.fetchedAt = Date.now();
      outageCache.error = null;
      // Disk-Cache schreiben
      try {
        var dir = path.dirname(OUTAGE_DISK_CACHE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(OUTAGE_DISK_CACHE, JSON.stringify({ incidents: data.incidents, fetchedAt: outageCache.fetchedAt }), 'utf8');
        serviceLog.info(
          'outage',
          'OK incidents=' + data.incidents.length + ' disk=' + OUTAGE_DISK_CACHE
        );
      } catch (we) {
        serviceLog.error('outage', 'disk write failed: ' + (we.message || we));
      }
      if (onFetched) onFetched(outageCache);
    } else {
      serviceLog.warn('outage', 'response ohne incidents-Array');
    }
  });
}

function classifyIncident(name, impact) {
  if (impact === 'none') return 'client';
  var n = (name || '').toLowerCase();
  if (n.includes('desktop')) return 'client';
  if (n.includes('dispatch')) return 'client';
  if (n.includes('cowork')) return 'client';
  if (n.includes('connector')) return 'client';
  return 'server';
}

var _statusRank = { major_outage: 3, partial_outage: 2, degraded_performance: 1, operational: 0 };
var _impactToStatus = { critical: 'major_outage', major: 'partial_outage', minor: 'degraded_performance', none: 'operational' };

function worstComponentStatus(inc) {
  var worst = 'operational';
  var hasComps = false;
  var updates = inc.incident_updates || [];
  for (var upd of updates) {
    var comps = upd.affected_components || [];
    for (var comp of comps) {
      hasComps = true;
      var s = comp.new_status || comp.old_status || 'operational';
      if ((_statusRank[s] || 0) > (_statusRank[worst] || 0)) worst = s;
    }
  }
  if (!hasComps) worst = _impactToStatus[inc.impact || 'none'] || 'degraded_performance';
  return worst;
}

/**
 * End-Zeitpunkt, bis zu dem ein Incident als Ausfall zaehlt.
 * Bugfix: ein nicht aufgeloester Incident wurde bis 'jetzt' gezaehlt, wodurch eine
 * offen geparkte Advisory (z.B. die Fable/Mythos-Suspension im Status 'monitoring')
 * jeden Tag bis heute als kritischen Dauerausfall malte.
 *   - resolved                 -> exakt bis resolved_at
 *   - monitoring/postmortem    -> nur bis updated_at (Fix steht, kein aktiver Ausfall)
 *   - investigating/identified -> bis jetzt (wirklich laufend)
 *   - jeder offene Fall: harte Obergrenze OUTAGE_MAX_OPEN_HOURS ab created_at.
 * @param {object} inc   Statuspage-Incident
 * @param {Date}   start created_at als Date
 * @returns {Date}
 */
function computeIncidentEnd(inc, start) {
  if (inc.resolved_at) {
    var r = new Date(inc.resolved_at);
    if (!Number.isNaN(r.getTime())) return r;
  }
  var status = (inc.status || '').toLowerCase();
  var endMs;
  if (status === 'monitoring' || status === 'postmortem') {
    endMs = inc.updated_at ? new Date(inc.updated_at).getTime() : (start.getTime() + 3600000);
  } else {
    endMs = Date.now();
  }
  if (Number.isNaN(endMs)) endMs = Date.now();
  var capMs = start.getTime() + (OUTAGE_MAX_OPEN_HOURS * 3600000);
  if (endMs > capMs) endMs = capMs;
  return new Date(endMs);
}

function getOutageDaysMap() {
  var map = {};
  var incs = outageCache.incidents;
  for (var inc of incs) {
    if (!inc.created_at) continue;
    var start = new Date(inc.created_at);
    if (Number.isNaN(start.getTime())) continue;
    var end = computeIncidentEnd(inc, start);
    if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + 3600000);

    var cur = new Date(start);
    while (cur < end) {
      var dayStr = cur.toISOString().slice(0, 10);
      var dayStart = new Date(dayStr + 'T00:00:00Z');
      var dayEnd = new Date(dayStart.getTime() + 86400000);
      var segStart = cur > dayStart ? cur : dayStart;
      var segEnd = end < dayEnd ? end : dayEnd;
      var hours = (segEnd - segStart) / 3600000;
      var startH = (segStart - dayStart) / 3600000;
      var endH = (segEnd - dayStart) / 3600000;

      if (!map[dayStr]) map[dayStr] = { outage_hours: 0, server_hours: 0, client_hours: 0, incidents: [], spans: [] };
      var incImpact = inc.impact || 'none';
      var incKind = classifyIncident(inc.name, incImpact);
      var incCompStatus = worstComponentStatus(inc);
      map[dayStr].outage_hours += hours;
      if (incKind === 'server') map[dayStr].server_hours += hours;
      else map[dayStr].client_hours += hours;
      map[dayStr].spans.push({ from: Math.round(startH * 100) / 100, to: Math.round(endH * 100) / 100, name: inc.name || '', impact: incImpact, kind: incKind, comp_status: incCompStatus });
      var found = false;
      for (var existing of map[dayStr].incidents) {
        if (existing.name === inc.name) { found = true; break; }
      }
      if (!found) map[dayStr].incidents.push({ name: inc.name || '', impact: incImpact, kind: incKind, created_at: inc.created_at, resolved_at: inc.resolved_at || null });
      cur = dayEnd;
    }
  }
  var keys = Object.keys(map);
  for (var key of keys) {
    map[key].outage_hours = Math.round(map[key].outage_hours * 10) / 10;
    map[key].server_hours = Math.round(map[key].server_hours * 10) / 10;
    map[key].client_hours = Math.round(map[key].client_hours * 10) / 10;
  }
  return map;
}

/** Reload memory cache from disk (called by provider-notify route). */
function reloadFromDisk() {
  try {
    var raw = JSON.parse(fs.readFileSync(OUTAGE_DISK_CACHE, 'utf8'));
    if (Array.isArray(raw.incidents)) {
      outageCache.incidents = raw.incidents;
      outageCache.fetchedAt = raw.fetchedAt || Date.now();
      outageCache.error = null;
      return true;
    }
  } catch (error) { /* intentional */ }
  return false;
}

module.exports = {
  OUTAGE_API_URL: OUTAGE_API_URL,
  OUTAGE_REFRESH_MS: OUTAGE_REFRESH_MS,
  OUTAGE_DISK_CACHE: OUTAGE_DISK_CACHE,
  outageCache: outageCache,
  refreshOutageCache: refreshOutageCache,
  reloadFromDisk: reloadFromDisk,
  classifyIncident: classifyIncident,
  worstComponentStatus: worstComponentStatus,
  getOutageDaysMap: getOutageDaysMap
};
