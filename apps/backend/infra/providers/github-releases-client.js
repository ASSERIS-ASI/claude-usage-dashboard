'use strict';
/**
 * @asseris-module       GitHub Releases Client
 * @asseris-description  Fetches GitHub release metadata for Claude Code + Cursor (versions,
 *                       publish dates, asset links) — maintains in-memory + disk cache,
 *                       singleton releasesCache shared across callers.
 * @asseris-pillar       sensor
 * @asseris-domain       external-source
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       ANC-04
 * @asseris-calls        HTTP Client
 * @asseris-called-by    Dashboard Server, Marketplace Client, JSONL Agent, Provider Agent
 * @asseris-emits        releasesCache snapshot, releases disk cache file
 * @asseris-consumes     GitHub Releases REST API responses
 *
 * github-releases-client.js — GitHub Releases provider.
 *
 * All GitHub-releases-related logic extracted from dashboard-server.js (Phase 2).
 * Singleton module: releasesCache is shared state across all callers.
 */
var https = require('node:https');
var fs = require('node:fs');
var path = require('node:path');
var httpClient = require('../http-client');
var httpsGetJson = httpClient.httpsGetJson;
var scanRoots = require('../../domain/usage/scan-roots');
var HOME = scanRoots.HOME;
var buildSnapshot = require('../../app/build-usage-snapshot');
var normalizeCliSemver = buildSnapshot.normalizeCliSemver;
var semverCmp = buildSnapshot.semverCmp;

// ── Constants ──────────────────────────────────────────────────────────────
var RELEASES_CACHE = path.join(HOME, '.claude', 'claude-code-releases.json');
var RELEASES_API_URL = 'https://api.github.com/repos/anthropics/claude-code/releases?per_page=100';

/** Pause zwischen GitHub-Release-Backfill-Requests (ms), 0-5000. */
var GITHUB_BACKFILL_TAG_DELAY_MS = 0;
(function () {
  var e = process.env.CLAUDE_USAGE_GITHUB_BACKFILL_DELAY_MS;
  if (!e) return;
  var n = Number.parseInt(e, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 5000) GITHUB_BACKFILL_TAG_DELAY_MS = n;
})();

var REVERT_KEYWORDS = ['revert', 'rollback', 'roll back', 'backed out', 'regression', 'hotfix'];

// ── Module-scoped state ────────────────────────────────────────────────────
/** Zuletzt vom Browser gesetztes PAT (Header X-GitHub-Token auf /api/*); `null` = noch kein Header gesehen. */
var lastClientGithubToken = null;

var releasesRefreshInFlight = false;

// Releases laden (Disk-Cache oder frisch fetchen)
var releasesCache = { releases: [], fetchedAt: 0 };
try {
  var diskRel = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'));
  if (Array.isArray(diskRel)) releasesCache.releases = diskRel;
} catch (error) { /* intentional */ }

// ── Functions ──────────────────────────────────────────────────────────────

function syncGithubTokenFromBrowserRequest(req, serviceLog) {
  if (typeof req.headers?.['x-github-token'] === 'undefined') return;
  var prev = lastClientGithubToken;
  var next = String(req.headers['x-github-token'] || '').trim();
  lastClientGithubToken = next;
  var had = prev !== null && prev.length > 0;
  var has = next.length > 0;
  if (!had && has) {
    serviceLog.info('github', 'Client-Session: GitHub-PAT über X-GitHub-Token aktiv (Wert nicht geloggt)');
  } else if (had && !has) {
    serviceLog.info('github', 'Client-Session: GitHub-PAT entfernt (leerer X-GitHub-Token), Fallback GITHUB_TOKEN/GH_TOKEN');
  } else if (had && has && prev !== next) {
    serviceLog.info('github', 'Client-Session: GitHub-PAT ersetzt (neuer Wert, nicht geloggt)');
  }
}

/** PAT: 5000 req/h statt ~60/IP. Priorität: Browser-Header X-GitHub-Token, sonst GITHUB_TOKEN/GH_TOKEN. */
function githubApiRequestHeaders() {
  var h = {
    'User-Agent': 'claude-usage-dashboard/1.0 (Claude Code usage dashboard; +https://github.com/anthropics/claude-code)',
    Accept: 'application/vnd.github+json'
  };
  var tok = '';
  if (lastClientGithubToken !== null && lastClientGithubToken.length > 0) {
    tok = lastClientGithubToken;
  } else {
    var envT = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (envT && String(envT).trim()) tok = String(envT).trim();
  }
  if (tok) h.Authorization = 'Bearer ' + tok;
  return h;
}

/** Nur Release-Tags anthropics/claude-code (SSRF-Schutz). */
function isSafeGithubReleaseTagParam(s) {
  if (!s || typeof s !== 'string') return false;
  var t = s.trim();
  if (t.length < 3 || t.length > 48) return false;
  return /^[vV]?[0-9][0-9A-Za-z.\-+]{0,40}$/.test(t);
}

function persistReleasesCacheToDisk() {
  try {
    fs.writeFileSync(RELEASES_CACHE, JSON.stringify(releasesCache.releases), 'utf8');
  } catch (error) { /* intentional */ }
}

/**
 * Einzelrelease per API (wie curl) — für Backfill in claude-code-releases.json.
 */
function httpsFetchGithubReleaseByTag(tag, cb) {
  if (!isSafeGithubReleaseTagParam(tag)) {
    process.nextTick(function () {
      cb(new Error('invalid tag'), null);
    });
    return;
  }
  var done = false;
  function once(err, data) {
    if (done) return;
    done = true;
    cb(err, data);
  }
  var tagEnc = encodeURIComponent(String(tag).trim());
  var opts = {
    hostname: 'api.github.com',
    path: '/repos/anthropics/claude-code/releases/tags/' + tagEnc,
    method: 'GET',
    headers: githubApiRequestHeaders()
  };
  var ghReq = https.request(opts, function (ghRes) {
    var chunks = [];
    ghRes.on('data', function (c) {
      chunks.push(c);
    });
    ghRes.on('end', function () {
      try {
        var data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (ghRes.statusCode !== 200 || !data?.tag_name) {
          once(new Error('not found'), null);
          return;
        }
        once(null, data);
      } catch (e) {
        once(e, null);
      }
    });
  });
  ghReq.on('error', function (e) {
    once(e, null);
  });
  ghReq.setTimeout(15000, function () {
    ghReq.destroy();
    once(new Error('timeout'), null);
  });
  ghReq.end();
}

/**
 * Fehlende Tags aus den Dashboard-Tagen per HTTPS nachladen, JSON-Cache mergen + Highlights neu ziehen.
 */
function backfillReleaseBodiesForDashboardDays(days, cb, serviceLog) {
  if (!days?.length) {
    process.nextTick(cb);
    return;
  }
  var tags = [];
  var seen = Object.create(null);
  for (var day of days) {
    var vc = day.version_change;
    if (!vc?.github_release_links) continue;
    for (var gl of vc.github_release_links) {
      var tg = gl.tag || 'v' + gl.version;
      if (tg && !seen[tg]) {
        seen[tg] = true;
        tags.push(String(tg).trim());
      }
    }
  }
  function hasTagInCache(tag) {
    var rels = releasesCache.releases;
    for (var rel of rels) {
      if (String(rel.tag_name || '') === tag) return true;
    }
    return false;
  }
  var missing = [];
  for (var tag of tags) {
    if (!hasTagInCache(tag)) missing.push(tag);
  }
  if (!missing.length) {
    enrichVersionChangeNotes(days);
    process.nextTick(cb);
    return;
  }
  serviceLog.info('github', 'backfill missing_release_tags=' + missing.length);
  var ix = 0;
  function step() {
    if (ix >= missing.length) {
      persistReleasesCacheToDisk();
      enrichVersionChangeNotes(days);
      serviceLog.info('github', 'backfill done total_releases_cache=' + releasesCache.releases.length);
      cb();
      return;
    }
    var t = missing[ix++];
    if (!isSafeGithubReleaseTagParam(t)) {
      setImmediate(step);
      return;
    }
    serviceLog.debug('github', 'backfill release tag=' + t);
    httpsFetchGithubReleaseByTag(t, function (err, rel) {
      if (!err && rel?.tag_name) {
        var dupe = false;
        for (var cachedRel of releasesCache.releases) {
          if (String(cachedRel.tag_name) === String(rel.tag_name)) {
            dupe = true;
            break;
          }
        }
        if (!dupe) releasesCache.releases.push(rel);
      }
      if (GITHUB_BACKFILL_TAG_DELAY_MS > 0) {
        setTimeout(step, GITHUB_BACKFILL_TAG_DELAY_MS);
      } else {
        setImmediate(step);
      }
    });
  }
  step();
}

function refreshReleasesCache(serviceLog) {
  if (releasesRefreshInFlight) {
    serviceLog.debug('releases', 'fetch skip: in flight');
    return;
  }
  releasesRefreshInFlight = true;
  serviceLog.debug('releases', 'fetch start');
  var all = [];
  var page = 1;
  var maxPages = 5;
  function fetchNext() {
    var sep = RELEASES_API_URL.includes('?') ? '&' : '?';
    var url = RELEASES_API_URL + sep + 'page=' + page;
    httpsGetJson(url, githubApiRequestHeaders(), function (err, data) {
      if (err || !Array.isArray(data) || data.length === 0) {
        if (page === 1 && err) {
          var hasTok =
            (lastClientGithubToken && lastClientGithubToken.length > 0) ||
            process.env.GITHUB_TOKEN ||
            process.env.GH_TOKEN;
          var relHint = hasTok
            ? ''
            : ' — bei Rate-Limit: PAT im Dashboard (Meta) oder GITHUB_TOKEN/GH_TOKEN (klassisch: repo:public nur nötig).';
          serviceLog.warn('releases', 'GitHub API: ' + err.message + relHint);
        } else if (page === 1 && !err && !data?.length) {
          serviceLog.warn('releases', 'GitHub API: leeres Array — kein Update');
        }
        finish();
        return;
      }
      for (var datum of data) all.push(datum);
      if (data.length < 100 || page >= maxPages) {
        finish();
        return;
      }
      page++;
      fetchNext();
    });
  }
  function finish() {
    if (!all.length) {
      releasesRefreshInFlight = false;
      serviceLog.debug('releases', 'fetch end no_new_rows (GitHub)');
      return;
    }
    var seen = Object.create(null);
    var merged = [];
    for (var item of all) {
      var ta = item?.tag_name;
      if (ta) seen[String(ta)] = true;
      merged.push(item);
    }
    var prev = releasesCache.releases;
    for (var pb of prev) {
      var tb = pb?.tag_name;
      if (tb && !seen[String(tb)]) {
        seen[String(tb)] = true;
        merged.push(pb);
      }
    }
    releasesCache.releases = merged;
    releasesCache.fetchedAt = Date.now();
    persistReleasesCacheToDisk();
    serviceLog.info(
      'releases',
      'GitHub merge OK unique_tags≈' +
        Object.keys(seen).length +
        ' pages_read≤' +
        page +
        ' disk=' +
        RELEASES_CACHE.replace(/^.*[\\/].claude[\\/]/i, '~/.claude/')
    );
    releasesRefreshInFlight = false;
  }
  fetchNext();
}

/** GitHub-Releases: nur Netzwerk, wenn kein Disk-Cache — sonst manuell POST /api/github-releases-refresh oder CLAUDE_USAGE_GITHUB_RELEASES_FETCH=1. */
function shouldFetchGithubReleasesFromNetwork() {
  var force =
    process.env.CLAUDE_USAGE_GITHUB_RELEASES_FETCH === '1' ||
    process.env.CLAUDE_USAGE_GITHUB_RELEASES_FETCH === 'true' ||
    process.env.CLAUDE_USAGE_GITHUB_RELEASES_FETCH === 'force';
  if (force) return true;
  return !releasesCache.releases || releasesCache.releases.length === 0;
}

function maybeRefreshReleasesCacheOnStartup(serviceLog) {
  if (shouldFetchGithubReleasesFromNetwork()) {
    refreshReleasesCache(serviceLog);
  } else {
    serviceLog.info(
      'releases',
      'GitHub fetch übersprungen (' +
        releasesCache.releases.length +
        ' Releases aus ~/.claude/claude-code-releases.json); manuell: POST /api/github-releases-refresh oder start mit CLAUDE_USAGE_GITHUB_RELEASES_FETCH=1'
    );
  }
}

function pad2Cal(n) {
  var x = typeof n === 'number' ? n : Number.parseInt(n, 10);
  return x < 10 ? '0' + x : String(x);
}

/** Kalendertag in lokaler Zeitzone (u. a. Anzeige). */
function isoToLocalYmd(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2Cal(d.getMonth() + 1) + '-' + pad2Cal(d.getDate());
}

/**
 * UTC-Datum YYYY-MM-DD — gleiche Semantik wie JSONL `timestamp.slice(0, 10)` bei ISO mit Z.
 * Extension-Marker müssen damit gebucht werden, sonst fehlen sie in US-Zeitzonen (Local vs. UTC).
 */
function isoToUtcYmd(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function extractReleaseHighlights(body) {
  var raw = String(body || '');
  var slice = raw;
  var sec = raw.match(/^##\s*what[\u2019\x27]?s changed\b/im);
  if (sec?.index != null) {
    var after = raw.indexOf('\n', sec.index + sec[0].length);
    slice = after >= 0 ? raw.slice(after + 1) : raw.slice(sec.index + sec[0].length);
  }
  var highlights = [];
  var lines = slice.split('\n');
  for (var li = 0; li < lines.length && li < 140 && highlights.length < 12; li++) {
    var ln = lines[li].replace(/^[ \t>*\-\u2022]+/, '').trim();
    if (!ln || ln.length < 6) continue;
    if (/^#{1,6}\s/.test(ln)) break;
    if (/^---+(\s|$)|^\*{3,}(\s|$)/.test(ln)) continue;
    if (/^(full changelog|see also)\b/i.test(ln)) continue;
    if (/^assets[\s\d]*$/i.test(ln)) continue;
    highlights.push(ln.slice(0, 220));
  }
  return highlights;
}

/** Liefert Map: normalisierte Version "2.1.87" -> { tag, date, highlights } */
function getReleasesMap() {
  if (!releasesCache.releases || releasesCache.releases.length === 0) {
    try {
      var diskR = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'));
      if (Array.isArray(diskR)) releasesCache.releases = diskR;
    } catch (error) { /* intentional */ }
  }
  var map = {};
  var rels = releasesCache.releases;
  for (var r of rels) {
    var nk = normalizeCliSemver(r.tag_name || r.name || '');
    var date = isoToUtcYmd(r.published_at || '');
    if (nk) map[nk] = { tag: r.tag_name, date: date, highlights: extractReleaseHighlights(r.body) };
  }
  return map;
}

/** Semver-Keys aus relMap mit fromNorm < v <= toNorm (für Release-Texte übersprungener Patch-Versionen). */
function versionsInRelMapBetween(relMap, fromNorm, toNorm) {
  if (!relMap || !toNorm) return [];
  var keys = Object.keys(relMap);
  keys.sort(semverCmp);
  var out = [];
  for (var k of keys) {
    if (!k) continue;
    if (fromNorm && semverCmp(k, fromNorm) <= 0) continue;
    if (semverCmp(k, toNorm) > 0) continue;
    out.push(k);
  }
  return out;
}

function uniqSortedSemvers(vers) {
  var o = Object.create(null);
  for (var v of vers) {
    var n = normalizeCliSemver(v);
    if (n) o[n] = true;
  }
  var ks = Object.keys(o);
  ks.sort(semverCmp);
  return ks;
}

function githubReleaseLinkForVersion(relMap, ver) {
  var nk = normalizeCliSemver(ver);
  if (!nk) return { version: '', url: '', tag: '' };
  var ent = relMap[nk];
  var tag = ent?.tag ? String(ent.tag).trim() : 'v' + nk;
  return {
    version: nk,
    tag: tag,
    url: 'https://github.com/anthropics/claude-code/releases/tag/' + encodeURIComponent(tag)
  };
}

/** Füllt Highlights aus allen Releases zwischen from und höchstem added; setzt github_release_links als Fallback. */
function mergeHighlightsFromReleases(relMap, inter, existing) {
  var mergedHi = (existing || []).slice();
  var seenH = Object.create(null);
  for (var hi of mergedHi) seenH[String(hi)] = true;
  var prefixMulti = inter.length > 1;
  for (var iv of inter) {
    var ri = relMap[iv];
    if (ri?.highlights?.length) {
      for (var hl of ri.highlights) {
        var line = (prefixMulti ? '[' + iv + '] ' : '') + hl;
        if (seenH[line]) continue;
        mergedHi.push(line);
        seenH[line] = true;
      }
    }
  }
  if (mergedHi.length > 24) mergedHi.length = 24;
  return mergedHi;
}

function enrichVersionChangeNotes(result) {
  var relMap = getReleasesMap();
  for (var entry of result) {
    var vc = entry.version_change;
    if (!vc?.added?.length) continue;
    var fromN = vc.from ? normalizeCliSemver(vc.from) : '';
    var addedSorted = vc.added.slice().sort(semverCmp);
    var topN = addedSorted[addedSorted.length - 1];
    var inter = versionsInRelMapBetween(relMap, fromN, topN);
    vc.highlights = mergeHighlightsFromReleases(relMap, inter, vc.highlights);
    var linkVers = uniqSortedSemvers(inter.concat(addedSorted));
    var links = [];
    var seenV = Object.create(null);
    for (var vj of linkVers) {
      if (seenV[vj]) continue;
      seenV[vj] = true;
      var gl = githubReleaseLinkForVersion(relMap, vj);
      if (gl.url) links.push(gl);
    }
    vc.github_release_links = links;
  }
}

function loadReleasesArrayForBuild() {
  var rels = releasesCache.releases;
  if (!rels?.length) {
    try {
      var diskR = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'));
      if (Array.isArray(diskR)) rels = diskR;
    } catch (error) { /* intentional */ }
  }
  return Array.isArray(rels) ? rels : [];
}

function buildByDateFromVersionTimelineItems(items) {
  if (!items?.length) return null;
  items = items.slice().sort(function (a, b) {
    if (a.t !== b.t) return a.t - b.t;
    return semverCmp(a.ver, b.ver);
  });
  var groups = [];
  for (var item of items) {
    var itemDk = isoToUtcYmd(item.when);
    if (!itemDk) continue;
    if (groups.length) {
      var lastGrp = groups[groups.length - 1];
      var lastDk = isoToUtcYmd(lastGrp[0].when);
      if (lastDk === itemDk) lastGrp.push(item);
      else groups.push([item]);
    } else {
      groups.push([item]);
    }
  }
  if (!groups.length) return null;
  var byDate = Object.create(null);
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var dk = isoToUtcYmd(grp[0].when);
    var prevVer = g > 0 ? groups[g - 1][groups[g - 1].length - 1].ver : null;
    var added = [];
    var hi = [];
    for (var gu of grp) {
      added.push(gu.ver);
      hi = hi.concat(gu.highlights || []);
    }
    added.sort(semverCmp);
    byDate[dk] = {
      added: added,
      from: prevVer,
      highlights: hi,
      booking_when: grp[0].when
    };
  }
  expandVersionByDateLocalAliases(byDate);
  return byDate;
}

/** Wenn UTC-Tag und lokaler Tag (Server) auseinanderfallen: gleichen Marker auch unter lokalem YMD buchen, falls frei — sonst wirkt ein 3.4.-Release „hinter" 1.4. nur auf 4.4.-Balken oder fehlt. */
function expandVersionByDateLocalAliases(byDate) {
  var initial = Object.keys(byDate);
  for (var dk of initial) {
    var ch = byDate[dk];
    var w = ch?.booking_when;
    if (!w) continue;
    var utcDk = isoToUtcYmd(w);
    var locDk = isoToLocalYmd(w);
    if (!locDk || locDk === utcDk) continue;
    if (!byDate[locDk] || byDate[locDk] === ch) {
      byDate[locDk] = ch;
    }
  }
}

function applyVersionChangeByDateMap(result, byDate) {
  if (!byDate) return false;
  var kc = 0;
  for (var kk in byDate) {
    if (Object.hasOwn(byDate, kk)) kc++;
  }
  if (!kc) return false;
  for (var row of result) {
    row.version_change = null;
  }
  for (var row2 of result) {
    var ch = byDate[row2.date];
    if (ch) {
      var bw = ch.booking_when || '';
      row2.version_change = {
        added: ch.added,
        from: ch.from,
        highlights: ch.highlights,
        release_when: bw,
        release_utc_ymd: bw ? isoToUtcYmd(bw) : '',
        release_local_ymd: bw ? isoToLocalYmd(bw) : ''
      };
    }
  }
  return true;
}

function buildGitHubVersionTimelineItems() {
  var rels = loadReleasesArrayForBuild();
  var items = [];
  for (var r of rels) {
    var ver = normalizeCliSemver(r.tag_name || r.name || '');
    if (!ver || !r.published_at) continue;
    var t = new Date(r.published_at).getTime();
    if (Number.isNaN(t)) continue;
    items.push({
      ver: ver,
      t: t,
      when: r.published_at,
      highlights: extractReleaseHighlights(r.body)
    });
  }
  return items;
}

// ── Release Stability Analysis ──────────────────────────────────────────

function __releaseParseTagEntry(r) {
  var tag = (r.tag_name || '').replace(/^v/, '');
  var parts = tag.split('.');
  if (parts.length < 3) return null;
  var major = Number.parseInt(parts[0], 10) || 0;
  var minor = Number.parseInt(parts[1], 10) || 0;
  var patch = Number.parseInt(parts[2], 10) || 0;
  var body = (r.body || '').toLowerCase();
  var matchedKeywords = [];
  for (var kw of REVERT_KEYWORDS) {
    if (body.includes(kw)) matchedKeywords.push(kw);
  }
  return {
    tag: r.tag_name || '',
    date: (r.published_at || '').substring(0, 10),
    major: major,
    minor: minor,
    patch: patch,
    hasRegression: matchedKeywords.length > 0,
    matchedKeywords: matchedKeywords,
    prerelease: !!r.prerelease
  };
}

function __releaseBuildEntries(sorted) {
  var entries = [];
  for (var sr of sorted) {
    var ent = __releaseParseTagEntry(sr);
    if (ent) entries.push(ent);
  }
  return entries;
}

function __releaseDaysActive(cur, nextEntry, ri, entriesLen, nowMs) {
  if (ri < entriesLen - 1) {
    var d1 = new Date(cur.date);
    var d2 = new Date(nextEntry.date);
    return Math.max(0, Math.round((d2 - d1) / 86400000));
  }
  return Math.max(0, Math.round((nowMs - new Date(cur.date)) / 86400000));
}

function __releaseSkippedPatches(prev, cur) {
  if (prev && cur.minor === prev.minor) {
    return Math.max(0, cur.patch - prev.patch - 1);
  }
  return 0;
}

function __releaseStabilityOf(cur, isHotfix) {
  if (isHotfix) return 'hotfix';
  if (cur.hasRegression) return 'regression';
  return 'stable';
}

function __releaseBuildOne(cur, prev, nextEntry, ri, nEnt, nowMs) {
  var isHotfix = prev ? (cur.date === prev.date) : false;
  return {
    tag: cur.tag,
    date: cur.date,
    daysActive: __releaseDaysActive(cur, nextEntry, ri, nEnt, nowMs),
    stability: __releaseStabilityOf(cur, isHotfix),
    isHotfix: isHotfix,
    hasRegression: cur.hasRegression,
    matchedKeywords: cur.matchedKeywords,
    skippedPatches: __releaseSkippedPatches(prev, cur)
  };
}

function buildReleaseStabilityData() {
  var rels = releasesCache.releases;
  if (!rels?.length) return null;

  var sorted = rels.slice().sort(function(a, b) {
    return (a.published_at || '').localeCompare(b.published_at || '');
  });

  var entries = __releaseBuildEntries(sorted);
  if (!entries.length) return null;

  var releases = [];
  var totalSkipped = 0;
  var hotfixCount = 0;
  var regressionCount = 0;
  var nowMs = Date.now();
  var nEnt = entries.length;
  for (var ri = 0; ri < nEnt; ri++) {
    var cur = entries[ri];
    var prev = ri > 0 ? entries[ri - 1] : null;
    var r = __releaseBuildOne(cur, prev, entries[ri + 1], ri, nEnt, nowMs);
    releases.push(r);
    if (r.isHotfix) hotfixCount++;
    totalSkipped += r.skippedPatches;
    if (cur.hasRegression) regressionCount++;
  }

  var firstEnt = entries[0];
  var lastEnt = entries.at(-1);
  return {
    releases: releases,
    summary: {
      total: releases.length,
      totalSkipped: totalSkipped,
      hotfixCount: hotfixCount,
      regressionCount: regressionCount,
      stableCount: releases.length - hotfixCount - regressionCount + (hotfixCount > 0 ? releases.filter(function(r) { return r.isHotfix && r.hasRegression; }).length : 0),
      firstDate: firstEnt.date,
      lastDate: lastEnt.date,
      daysSpan: Math.round((new Date(lastEnt.date) - new Date(firstEnt.date)) / 86400000),
      cadenceDays: entries.length > 1
        ? Math.round((new Date(lastEnt.date) - new Date(firstEnt.date)) / 86400000 / (entries.length - 1) * 10) / 10
        : 0
    }
  };
}

/** Reload memory cache from disk (called by provider-notify route). */
function reloadFromDisk() {
  try {
    var diskRel = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'));
    if (Array.isArray(diskRel)) {
      releasesCache.releases = diskRel;
      releasesCache.fetchedAt = Date.now();
      return true;
    }
  } catch (error) { /* intentional */ }
  return false;
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  // Constants
  RELEASES_CACHE: RELEASES_CACHE,
  RELEASES_API_URL: RELEASES_API_URL,
  GITHUB_BACKFILL_TAG_DELAY_MS: GITHUB_BACKFILL_TAG_DELAY_MS,
  REVERT_KEYWORDS: REVERT_KEYWORDS,

  // State
  releasesCache: releasesCache,

  // Token / headers
  syncGithubTokenFromBrowserRequest: syncGithubTokenFromBrowserRequest,
  githubApiRequestHeaders: githubApiRequestHeaders,

  // Validation
  isSafeGithubReleaseTagParam: isSafeGithubReleaseTagParam,

  // Disk persistence
  persistReleasesCacheToDisk: persistReleasesCacheToDisk,
  reloadFromDisk: reloadFromDisk,

  // Network fetching
  httpsFetchGithubReleaseByTag: httpsFetchGithubReleaseByTag,
  backfillReleaseBodiesForDashboardDays: backfillReleaseBodiesForDashboardDays,
  refreshReleasesCache: refreshReleasesCache,
  shouldFetchGithubReleasesFromNetwork: shouldFetchGithubReleasesFromNetwork,
  maybeRefreshReleasesCacheOnStartup: maybeRefreshReleasesCacheOnStartup,

  // Date helpers
  pad2Cal: pad2Cal,
  isoToLocalYmd: isoToLocalYmd,
  isoToUtcYmd: isoToUtcYmd,

  // Release content
  extractReleaseHighlights: extractReleaseHighlights,
  getReleasesMap: getReleasesMap,
  versionsInRelMapBetween: versionsInRelMapBetween,
  uniqSortedSemvers: uniqSortedSemvers,
  githubReleaseLinkForVersion: githubReleaseLinkForVersion,
  mergeHighlightsFromReleases: mergeHighlightsFromReleases,
  enrichVersionChangeNotes: enrichVersionChangeNotes,
  loadReleasesArrayForBuild: loadReleasesArrayForBuild,

  // Version timeline
  buildByDateFromVersionTimelineItems: buildByDateFromVersionTimelineItems,
  expandVersionByDateLocalAliases: expandVersionByDateLocalAliases,
  applyVersionChangeByDateMap: applyVersionChangeByDateMap,
  buildGitHubVersionTimelineItems: buildGitHubVersionTimelineItems,

  // Release stability analysis
  __releaseParseTagEntry: __releaseParseTagEntry,
  __releaseBuildEntries: __releaseBuildEntries,
  __releaseDaysActive: __releaseDaysActive,
  __releaseSkippedPatches: __releaseSkippedPatches,
  __releaseStabilityOf: __releaseStabilityOf,
  __releaseBuildOne: __releaseBuildOne,
  buildReleaseStabilityData: buildReleaseStabilityData
};
