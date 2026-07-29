'use strict';
/**
 * @asseris-module       Marketplace Client
 * @asseris-description  Fetches VS Code Marketplace extension version metadata via the
 *                       JSON-API — used to overlay extension-publish markers on usage
 *                       charts. Singleton marketplaceVersionsCache shared across callers.
 * @asseris-pillar       sensor
 * @asseris-domain       external-source
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       ANC-04
 * @asseris-calls        HTTP Client, GitHub Releases Client
 * @asseris-called-by    Dashboard Server, JSONL Agent, Provider Agent
 * @asseris-emits        marketplaceVersionsCache, marketplace disk cache file
 * @asseris-consumes     VS Code Marketplace JSON-API responses
 *
 * marketplace-client.js — VS Code Marketplace provider.
 *
 * All Marketplace-related logic extracted from dashboard-server.js (Phase 2).
 * Singleton module: marketplaceVersionsCache is shared state across all callers.
 */
var fs = require('node:fs');
var path = require('node:path');
var httpsPostJson = require('../http-client').httpsPostJson;
var HOME = require('../../domain/usage/scan-roots').HOME;
var buildSnapshot = require('../../app/build-usage-snapshot');
var normalizeCliSemver = buildSnapshot.normalizeCliSemver;
var semverCmp = buildSnapshot.semverCmp;
var ghClient = require('./github-releases-client');
var getReleasesMap = ghClient.getReleasesMap;
var buildGitHubVersionTimelineItems = ghClient.buildGitHubVersionTimelineItems;
var enrichVersionChangeNotes = ghClient.enrichVersionChangeNotes;
var buildByDateFromVersionTimelineItems = ghClient.buildByDateFromVersionTimelineItems;
var applyVersionChangeByDateMap = ghClient.applyVersionChangeByDateMap;
var isoToUtcYmd = ghClient.isoToUtcYmd;
var isoToLocalYmd = ghClient.isoToLocalYmd;
var releasesCache = ghClient.releasesCache;

// ── Constants ──────────────────────────────────────────────────────────────
var MARKETPLACE_CACHE = path.join(HOME, '.claude', 'claude-code-marketplace-versions.json');
var MARKETPLACE_QUERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
var MARKETPLACE_EXTENSION_ID = 'anthropic.claude-code';
var MARKETPLACE_QUERY_FLAGS = 0x1;
/** POST extensionquery: Standard 12s; Env 3000-120000. */
var MARKETPLACE_POST_TIMEOUT_MS = 12000;
(function () {
  var e = process.env.CLAUDE_USAGE_MARKETPLACE_TIMEOUT_MS;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 3000 && n <= 120000) MARKETPLACE_POST_TIMEOUT_MS = n;
})();

// ── State (singleton) ─────────────────────────────────────────────────────
var marketplaceQueryInFlight = false;
var marketplaceVersionsCache = { items: [], fetchedAt: 0 };
(function () {
  try {
    var disk = JSON.parse(fs.readFileSync(MARKETPLACE_CACHE, 'utf8'));
    if (disk && Array.isArray(disk.versions) && disk.versions.length) {
      marketplaceVersionsCache.items = disk.versions;
      marketplaceVersionsCache.fetchedAt = disk.fetchedAt || 0;
    }
  } catch (error) { /* intentional */ }
})();

// ── Functions ─────────────────────────────────────────────────────────────

function dedupeMarketplaceVersionsByVersion(rawVers) {
  var by = Object.create(null);
  for (var v of rawVers) {
    var ver = normalizeCliSemver(v.version || '');
    if (!ver || !v.lastUpdated) continue;
    var t = new Date(v.lastUpdated).getTime();
    if (Number.isNaN(t)) continue;
    if (!by[ver] || t > by[ver].t) {
      by[ver] = { ver: ver, lastUpdated: v.lastUpdated, t: t };
    }
  }
  var keys = Object.keys(by).sort(semverCmp);
  var out = [];
  for (var key of keys) {
    out.push({ ver: key, lastUpdated: by[key].lastUpdated });
  }
  return out;
}

function loadMarketplaceVersionsForBuild() {
  var arr = marketplaceVersionsCache.items;
  if (!arr?.length) {
    try {
      var disk = JSON.parse(fs.readFileSync(MARKETPLACE_CACHE, 'utf8'));
      if (disk && Array.isArray(disk.versions)) {
        marketplaceVersionsCache.items = disk.versions;
        arr = disk.versions;
      }
    } catch (error) { /* intentional */ }
  }
  return Array.isArray(arr) ? arr : [];
}

/** Einmal pro Scan: verhindert Marker-Sprünge (z. B. 3.4. sichtbar, nach Scan weg), wenn parallel refreshMarketplace den Cache ersetzt. */
function snapshotMarketplaceRowsForScan() {
  var cur = marketplaceVersionsCache.items;
  if (cur?.length) return cur.slice();
  try {
    var disk = JSON.parse(fs.readFileSync(MARKETPLACE_CACHE, 'utf8'));
    if (disk && Array.isArray(disk.versions)) return disk.versions.slice();
  } catch (error) { /* intentional */ }
  return undefined;
}

function readMarketplaceVersionsDisk() {
  try {
    var disk = JSON.parse(fs.readFileSync(MARKETPLACE_CACHE, 'utf8'));
    if (disk && Array.isArray(disk.versions) && disk.versions.length) return disk.versions;
  } catch (error) { /* intentional */ }
  return null;
}

function mergeMarketplaceRowsPreferNewer(frozenMpRows) {
  var live = loadMarketplaceVersionsForBuild();
  var diskRows = readMarketplaceVersionsDisk();
  var rowsList = [];
  if (frozenMpRows?.length) rowsList.push(frozenMpRows);
  if (live?.length) rowsList.push(live);
  if (diskRows?.length) rowsList.push(diskRows);
  if (rowsList.length === 0) return [];
  if (rowsList.length === 1) return rowsList[0].slice();
  var byVer = Object.create(null);
  for (var rowSet of rowsList) {
    for (var row of rowSet) {
      var ver = row.ver || normalizeCliSemver(row.version || '');
      if (!ver || !row.lastUpdated) continue;
      var t = new Date(row.lastUpdated).getTime();
      if (Number.isNaN(t)) continue;
      var ex = byVer[ver];
      if (!ex || t > ex.t) byVer[ver] = { row: row, t: t };
    }
  }
  var keys = Object.keys(byVer).sort(semverCmp);
  var out = [];
  for (var key of keys) out.push(byVer[key].row);
  return out;
}

function buildMarketplaceVersionTimelineItems() {
  var rows = loadMarketplaceVersionsForBuild();
  var relMap = getReleasesMap();
  var items = [];
  for (var row of rows) {
    var ver = row.ver || normalizeCliSemver(row.version || '');
    if (!ver || !row.lastUpdated) continue;
    var t = new Date(row.lastUpdated).getTime();
    if (Number.isNaN(t)) continue;
    var hi = [];
    var rm = relMap[ver];
    if (rm?.highlights) hi = hi.concat(rm.highlights);
    items.push({ ver: ver, t: t, when: row.lastUpdated, highlights: hi });
  }
  return items;
}

/**
 * GitHub + Marketplace zusammenführen: Datum bevorzugt Marketplace (offiziell), fehlende Versionen
 * kommen von GitHub — verhindert „Abbruch" nach z. B. 27.3., wenn der Marketplace-Cache alt/kurz war.
 */
function buildMergedExtensionTimelineItems(frozenMpRows) {
  var relMap = getReleasesMap();
  var byVer = Object.create(null);
  var ghItems = buildGitHubVersionTimelineItems();
  for (var g of ghItems) {
    var ghHi = g.highlights?.length ? g.highlights.slice() : [];
    byVer[g.ver] = { ver: g.ver, t: g.t, when: g.when, highlights: ghHi };
  }
  var frozenArg = arguments.length >= 1 ? frozenMpRows : undefined;
  var rows =
    frozenArg !== undefined
      ? mergeMarketplaceRowsPreferNewer(frozenArg)
      : loadMarketplaceVersionsForBuild();
  for (var row of rows) {
    var ver = row.ver || normalizeCliSemver(row.version || '');
    if (!ver || !row.lastUpdated) continue;
    var t = new Date(row.lastUpdated).getTime();
    if (Number.isNaN(t)) continue;
    var hi = [];
    var rm = relMap[ver];
    if (rm?.highlights) hi = hi.concat(rm.highlights);
    var prev = byVer[ver];
    if (!hi?.length && prev?.highlights?.length) {
      hi = prev.highlights.slice();
    }
    byVer[ver] = { ver: ver, t: t, when: row.lastUpdated, highlights: hi };
  }
  var out = [];
  for (var vk in byVer) {
    if (Object.hasOwn(byVer, vk)) out.push(byVer[vk]);
  }
  return out;
}

/**
 * Extension-Marker: Merge Marketplace + GitHub; JSONL-Fallback im Aufrufer.
 * Marketplace-API: https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code (Version History).
 */
function applyExtensionVersionMarkers(result, frozenMpRows) {
  var items = buildMergedExtensionTimelineItems(frozenMpRows);
  var byDate = buildByDateFromVersionTimelineItems(items);
  return !!(byDate && applyVersionChangeByDateMap(result, byDate));
}

/**
 * Marketplace + GitHub-Zeitleiste für GET /api/extension-timeline (ohne JSONL).
 * by_date enthält pro Kalendertag dasselbe version_change wie nach enrichVersionChangeNotes.
 */
function buildExtensionTimelineApiResponse() {
  var items = buildMergedExtensionTimelineItems();
  var byDateRaw = buildByDateFromVersionTimelineItems(items);
  var byDateOut = Object.create(null);
  if (byDateRaw) {
    var keys = Object.keys(byDateRaw).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
    var synthetic = [];
    for (var dk of keys) {
      var ch = byDateRaw[dk];
      var bw = ch.booking_when || '';
      synthetic.push({
        date: dk,
        version_change: {
          added: ch.added.slice(),
          from: ch.from,
          highlights: (ch.highlights || []).slice(),
          release_when: bw,
          release_utc_ymd: bw ? isoToUtcYmd(bw) : '',
          release_local_ymd: bw ? isoToLocalYmd(bw) : ''
        }
      });
    }
    enrichVersionChangeNotes(synthetic);
    for (var synRow of synthetic) {
      if (synRow.version_change) byDateOut[synRow.date] = synRow.version_change;
    }
  }
  return {
    generated: new Date().toISOString(),
    marketplace_fetched_at: marketplaceVersionsCache.fetchedAt
      ? new Date(marketplaceVersionsCache.fetchedAt).toISOString()
      : null,
    marketplace_rows: marketplaceVersionsCache.items ? marketplaceVersionsCache.items.length : 0,
    releases_cached: releasesCache.releases ? releasesCache.releases.length : 0,
    by_date: byDateOut
  };
}

/**
 * Fetch extension versions from VS Code Marketplace API and update cache.
 * @param {object} serviceLog - Logger with .debug/.info/.warn/.error methods
 * @param {function} [onRefreshed] - Callback invoked after successful refresh (e.g. for broadcast)
 */
function refreshMarketplaceExtensionCache(serviceLog, onRefreshed) {
  if (marketplaceQueryInFlight) {
    serviceLog.debug('marketplace', 'extensionquery skip: in flight');
    return;
  }
  marketplaceQueryInFlight = true;
  serviceLog.debug('marketplace', 'extensionquery start');
  var payload = {
    filters: [{ criteria: [{ filterType: 7, value: MARKETPLACE_EXTENSION_ID }], pageNumber: 1, pageSize: 1 }],
    flags: MARKETPLACE_QUERY_FLAGS
  };
  httpsPostJson(
    MARKETPLACE_QUERY_URL,
    payload,
    function (err, data) {
      try {
        if (err || !data?.results?.[0]?.extensions?.[0]) {
          if (err) {
            var mpLogFn = marketplaceVersionsCache.items.length > 0 ? 'debug' : 'warn';
            serviceLog[mpLogFn]('marketplace', 'extensionquery failed: ' + (err.message || err));
          } else {
            serviceLog.warn('marketplace', 'extensionquery empty response');
          }
          return;
        }
        var ext = data.results[0].extensions[0];
        var vers = ext.versions;
        if (!Array.isArray(vers)) return;
        var deduped = dedupeMarketplaceVersionsByVersion(vers);
        marketplaceVersionsCache.items = deduped;
        marketplaceVersionsCache.fetchedAt = Date.now();
        try {
          var dir = path.dirname(MARKETPLACE_CACHE);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            MARKETPLACE_CACHE,
            JSON.stringify({ versions: deduped, fetchedAt: marketplaceVersionsCache.fetchedAt }),
            'utf8'
          );
          serviceLog.info(
            'marketplace',
            'OK versions=' +
              deduped.length +
              ' extension=' +
              MARKETPLACE_EXTENSION_ID +
              ' disk=' +
              MARKETPLACE_CACHE.replace(/^.*[\/].claude[\/]/i, '~/.claude/')
          );
        } catch (we) {
          serviceLog.error('marketplace', 'write cache failed: ' + (we.message || we));
        }
        if (deduped.length && typeof onRefreshed === 'function') onRefreshed();
      } finally {
        marketplaceQueryInFlight = false;
      }
    },
    MARKETPLACE_POST_TIMEOUT_MS
  );
}

/** Reload memory cache from disk (called by provider-notify route). */
function reloadFromDisk() {
  try {
    var disk = JSON.parse(fs.readFileSync(MARKETPLACE_CACHE, 'utf8'));
    if (disk && Array.isArray(disk.versions) && disk.versions.length) {
      marketplaceVersionsCache.items = disk.versions;
      marketplaceVersionsCache.fetchedAt = disk.fetchedAt || Date.now();
      return true;
    }
  } catch (error) { /* intentional */ }
  return false;
}

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
  // Constants
  MARKETPLACE_CACHE: MARKETPLACE_CACHE,
  MARKETPLACE_QUERY_URL: MARKETPLACE_QUERY_URL,
  MARKETPLACE_EXTENSION_ID: MARKETPLACE_EXTENSION_ID,
  MARKETPLACE_QUERY_FLAGS: MARKETPLACE_QUERY_FLAGS,
  MARKETPLACE_POST_TIMEOUT_MS: MARKETPLACE_POST_TIMEOUT_MS,

  // State
  marketplaceVersionsCache: marketplaceVersionsCache,

  // Functions
  dedupeMarketplaceVersionsByVersion: dedupeMarketplaceVersionsByVersion,
  loadMarketplaceVersionsForBuild: loadMarketplaceVersionsForBuild,
  snapshotMarketplaceRowsForScan: snapshotMarketplaceRowsForScan,
  readMarketplaceVersionsDisk: readMarketplaceVersionsDisk,
  mergeMarketplaceRowsPreferNewer: mergeMarketplaceRowsPreferNewer,
  buildMarketplaceVersionTimelineItems: buildMarketplaceVersionTimelineItems,
  buildMergedExtensionTimelineItems: buildMergedExtensionTimelineItems,
  applyExtensionVersionMarkers: applyExtensionVersionMarkers,
  buildExtensionTimelineApiResponse: buildExtensionTimelineApiResponse,
  refreshMarketplaceExtensionCache: refreshMarketplaceExtensionCache,
  reloadFromDisk: reloadFromDisk
};
