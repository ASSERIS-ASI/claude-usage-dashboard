'use strict';
/**
 * @asseris-module       Build Usage Snapshot
 * @asseris-description  Orchestrates the JSONL aggregation pipeline — calls the per-line
 *                       classifiers (security-classify, session-signals, hit-limit) and
 *                       assembles per-day, per-host buckets into the canonical usage
 *                       snapshot. The classifiers themselves live in apps/backend/domain/usage/.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Scan Roots (Usage), Hit Limit Scanner, Session Signals Classifier, Buckets, Forensics, Security Posture Classifier
 * @asseris-called-by    Usage Scan Orchestrator, Scan Worker
 * @asseris-emits        per-day usage snapshot (days[], hosts{}, signals)
 * @asseris-consumes     tagged JSONL file paths, bundled classification defaults
 *
 * build-usage-snapshot.js — App-Service fuer Usage-Aggregation.
 *
 * Extrahiert aus dashboard-server.js (Phase 3).
 * Enthaelt die JSONL-Parsing-Pipeline, Bucket-Aggregation und Ergebnis-Kompilierung.
 * Server-spezifische Orchestrierung (Worker, SSE, Caching) bleibt im Server.
 */
var path = require('node:path');
var usageScanRoots = require('../domain/usage/scan-roots');
var HOME = usageScanRoots.HOME;
var getScanRoots = usageScanRoots.getScanRoots;
var collectTaggedJsonlFiles = usageScanRoots.collectTaggedJsonlFiles;
var forEachJsonlLineSync = usageScanRoots.forEachJsonlLineSync;

// Domain-Module (Phase 1+2)
var hitLimitMod = require('../domain/usage/hit-limit');
var scanLineHitLimit = hitLimitMod.scanLineHitLimit;
var sessionSignalsMod = require('../domain/usage/session-signals');
var emptySessionSignals = sessionSignalsMod.emptySessionSignals;
var bumpSessionSignals = sessionSignalsMod.bumpSessionSignals;
var bumpHourSessionSignals = sessionSignalsMod.bumpHourSessionSignals;
var classifyJsonlSessionSignals = sessionSignalsMod.classifyJsonlSessionSignals;
var bucketsMod = require('../domain/usage/buckets');
var emptyDailyBucket = bucketsMod.emptyDailyBucket;
var emptyHostSlice = bucketsMod.emptyHostSlice;
var emptySecurityPostures = bucketsMod.emptySecurityPostures;
var emptyVersionStats = bucketsMod.emptyVersionStats;
var forensicsMod = require('../domain/usage/forensics');
var computeForensicForDay = forensicsMod.computeForensicForDay;

// ── Pure Helpers ─────────────────────────────────────────────────────────

function normalizeCliSemver(s) {
  if (s == null || s === '') return '';
  var m = String(s).match(/\d{1,10}\.\d{1,10}\.\d{1,10}/);
  return m ? m[0] : '';
}

function semverCmp(a, b) {
  var pa = a.split('.').map(Number);
  var pb = b.split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function extractCliVersion(rec) {
  if (!rec || typeof rec !== 'object') return '';
  var msg = rec.message;
  var cand =
    rec.version ||
    rec.cli_version ||
    rec.claude_code_version ||
    rec.extension_version ||
    (msg &&
      (msg.cli_version ||
        msg.extension_version ||
        msg.client_version ||
        msg.claude_code_version ||
        msg.version)) ||
    '';
  return normalizeCliSemver(cand);
}

function extractEntrypoint(rec) {
  if (!rec || typeof rec !== 'object') return '';
  return rec.entrypoint || '';
}

function isClaudeModel(model) {
  return typeof model === 'string' && /^claude-/i.test(model);
}

function unionHourKeyCount(hoursObj, hourSignalsObj) {
  var m = {};
  var k;
  for (k in hoursObj || {}) if (Object.hasOwn(hoursObj, k)) m[k] = true;
  for (k in hourSignalsObj || {})
    if (Object.hasOwn(hourSignalsObj, k)) m[k] = true;
  return Object.keys(m).length;
}

function displayPathForUi(absPath) {
  if (typeof absPath !== 'string') return '';
  if (absPath.startsWith(HOME)) {
    var rest = absPath.slice(HOME.length).replaceAll('\\', '/');
    return '~/' + rest.replace(/^\/+/, '');
  }
  return absPath.replaceAll('\\', '/');
}

function displayScannedFileLine(entry) {
  if (typeof entry === 'string') return displayPathForUi(entry);
  var p = entry.path;
  var label = entry.label || 'local';
  var rel;
  if (p.startsWith(HOME)) {
    rel = displayPathForUi(p);
  } else if (entry.rootPath) {
    try {
      rel = path.relative(entry.rootPath, p).replaceAll('\\', '/');
      if (!rel || rel.startsWith('..')) rel = p.replaceAll('\\', '/');
    } catch (e) {
      rel = p.replaceAll('\\', '/');
    }
  } else {
    rel = p.replaceAll('\\', '/');
  }
  return label + ' \u00b7 ' + rel;
}

function buildLimitSourceNote() {
  var roots = getScanRoots();
  var s = 'Datenquelle: ~/.claude/projects';
  if (roots.length > 1) s += ' + weitere Wurzeln (CLAUDE_USAGE_EXTRA_BASES)';
  return s;
}

function buildLimitSourceNoteEn() {
  var roots = getScanRoots();
  var s = 'Data source: ~/.claude/projects';
  if (roots.length > 1) s += ' + additional roots (CLAUDE_USAGE_EXTRA_BASES)';
  return s;
}

// ── Security Posture Detection ───────────────────────────────────────────
// Bundled read-only patterns are implemented in domain/usage/security-classify.js.
// Canonical implementation in domain/usage/security-classify.js.

var secClassify = require('../domain/usage/security-classify');
var classifySecurityPosture = secClassify.classifySecurityPosture;

function bumpSecurityPostures(bucket, hits) {
  if (!bucket.security_postures) bucket.security_postures = emptySecurityPostures();
  var sp = bucket.security_postures;
  for (var h of hits) {
    sp.total++;
    if (h.severity === 'critical') sp.critical++;
    else if (h.severity === 'high') sp.high++;
    else sp.medium++;
    sp.by_type[h.type] = (sp.by_type[h.type] || 0) + 1;
    if (sp.events.length < 200) {
      sp.events.push(h);
    }
  }
}

// ── JSONL Parsing Pipeline ───────────────────────────────────────────────

function targetDayBucket(daily, dayKey, onlyDate, isolateTodayFrag) {
  if (isolateTodayFrag && onlyDate && dayKey === onlyDate) return isolateTodayFrag;
  if (!daily[dayKey]) daily[dayKey] = emptyDailyBucket();
  return daily[dayKey];
}

function processJsonlFile(fileRef, daily, onlyDate, isolateTodayFrag, fileTodayFrag, todayYmdForFrag, logWarn) {
  var f = typeof fileRef === 'string' ? fileRef : fileRef.path;
  var hostLabel = typeof fileRef === 'string' ? 'local' : fileRef.label || 'local';
  var isSub = f.includes('subagent');
  try {
    forEachJsonlLineSync(f, function(line) {
      if (!line.trim()) return;
      var rec;
      try {
        rec = JSON.parse(line);
      } catch (e) {
        return;
      }
      var ts = rec.timestamp || '';
      if (ts.length >= 10) {
        var daySig = ts.slice(0, 10);
        if (!onlyDate || daySig === onlyDate) {
          var sigTags = rec._sessionTags || classifyJsonlSessionSignals(line, rec);
          if (sigTags.length) {
            var dSig = targetDayBucket(daily, daySig, onlyDate, isolateTodayFrag);
            bumpSessionSignals(dSig, sigTags);
            var sigVer = extractCliVersion(rec);
            if (sigVer) {
              if (!dSig.version_stats) dSig.version_stats = {};
              if (!dSig.version_stats[sigVer]) dSig.version_stats[sigVer] = emptyVersionStats();
              var svs = dSig.version_stats[sigVer];
              for (var st of sigTags) {
                if (svs[st] != null) svs[st]++;
              }
            }
            if (!dSig.hosts) dSig.hosts = {};
            if (!dSig.hosts[hostLabel]) dSig.hosts[hostLabel] = emptyHostSlice();
            bumpSessionSignals(dSig.hosts[hostLabel], sigTags);
            var hourKeyStr = null;
            if (ts.length >= 13) {
              var hiSig = Number.parseInt(ts.slice(11, 13), 10);
              if (!Number.isNaN(hiSig) && hiSig >= 0 && hiSig <= 23) hourKeyStr = String(hiSig);
            }
            if (hourKeyStr) {
              bumpHourSessionSignals(dSig, hourKeyStr, sigTags);
              bumpHourSessionSignals(dSig.hosts[hostLabel], hourKeyStr, sigTags);
            }
            if (fileTodayFrag && todayYmdForFrag && daySig === todayYmdForFrag) {
              bumpSessionSignals(fileTodayFrag, sigTags);
              if (!fileTodayFrag.hosts) fileTodayFrag.hosts = {};
              if (!fileTodayFrag.hosts[hostLabel]) fileTodayFrag.hosts[hostLabel] = emptyHostSlice();
              bumpSessionSignals(fileTodayFrag.hosts[hostLabel], sigTags);
              if (hourKeyStr) {
                bumpHourSessionSignals(fileTodayFrag, hourKeyStr, sigTags);
                bumpHourSessionSignals(fileTodayFrag.hosts[hostLabel], hourKeyStr, sigTags);
              }
            }
          }
        }
      }
      if (ts.length >= 10 && (rec._hitLimit || scanLineHitLimit(line))) {
        var dayLimit = ts.slice(0, 10);
        if (onlyDate && dayLimit !== onlyDate) {
          /* skip */
        } else {
          var dLim = targetDayBucket(daily, dayLimit, onlyDate, isolateTodayFrag);
          dLim.hit_limit = (dLim.hit_limit || 0) + 1;
          var limVer = extractCliVersion(rec);
          if (limVer) {
            if (!dLim.version_stats) dLim.version_stats = {};
            if (!dLim.version_stats[limVer]) dLim.version_stats[limVer] = emptyVersionStats();
            dLim.version_stats[limVer].hit_limit++;
          }
          if (!dLim.hosts) dLim.hosts = {};
          if (!dLim.hosts[hostLabel]) dLim.hosts[hostLabel] = emptyHostSlice();
          var hl = dLim.hosts[hostLabel];
          hl.hit_limit = (hl.hit_limit || 0) + 1;
          if (fileTodayFrag && todayYmdForFrag && dayLimit === todayYmdForFrag) {
            fileTodayFrag.hit_limit = (fileTodayFrag.hit_limit || 0) + 1;
            if (!fileTodayFrag.hosts) fileTodayFrag.hosts = {};
            if (!fileTodayFrag.hosts[hostLabel]) fileTodayFrag.hosts[hostLabel] = emptyHostSlice();
            var hlf = fileTodayFrag.hosts[hostLabel];
            hlf.hit_limit = (hlf.hit_limit || 0) + 1;
          }
        }
      }

      // Security posture scanning — use pre-computed _secHits from slimmed records, fallback to raw-line scan
      var secHits = rec._secHits || classifySecurityPosture(line, ts);
      if (secHits.length) {
        var dSec = ts.length >= 10 ? targetDayBucket(daily, ts.slice(0, 10), onlyDate, isolateTodayFrag) : null;
        if (dSec) {
          bumpSecurityPostures(dSec, secHits);
          if (fileTodayFrag && todayYmdForFrag && ts.slice(0, 10) === todayYmdForFrag) {
            bumpSecurityPostures(fileTodayFrag, secHits);
          }
        }
      }

      var u = rec.message?.usage;
      if (!u) return;
      // Some subagent/event schemas carry usage but omit message.model.
      // Keep counting these records instead of dropping whole days to zero.
      var modelRaw = rec.message?.model || rec.model || rec.provider_model || '';
      if (modelRaw && !isClaudeModel(modelRaw)) return;
      if (!modelRaw) modelRaw = 'claude-unknown';
      if (ts.length < 19) return;
      var day = ts.slice(0, 10);
      if (onlyDate && day !== onlyDate) return;
      var hour = Number.parseInt(ts.slice(11, 13));
      var dd = targetDayBucket(daily, day, onlyDate, isolateTodayFrag);
      if (!dd.hosts) dd.hosts = {};
      if (!dd.hosts[hostLabel]) dd.hosts[hostLabel] = emptyHostSlice();
      var hh = dd.hosts[hostLabel];
      var inTok = u.input_tokens || 0;
      var outTok = u.output_tokens || 0;
      var crTok = u.cache_read_input_tokens || 0;
      var ccTok = u.cache_creation_input_tokens || 0;
      dd.input += inTok;
      dd.output += outTok;
      dd.cache_read += crTok;
      dd.cache_creation += ccTok;
      dd.calls++;
      dd.hours[hour] = (dd.hours[hour] || 0) + 1;
      hh.input += inTok;
      hh.output += outTok;
      hh.cache_read += crTok;
      hh.cache_creation += ccTok;
      hh.calls++;
      hh.hours[hour] = (hh.hours[hour] || 0) + 1;
      if (isSub) {
        dd.sub_calls++;
        dd.sub_cache += crTok;
        dd.sub_output += outTok;
        hh.sub_calls++;
        hh.sub_cache += crTok;
        hh.sub_output += outTok;
      }
      var model = modelRaw;
      if (!dd.models[model]) dd.models[model] = { calls: 0, output: 0, cache_read: 0 };
      dd.models[model].calls++;
      dd.models[model].output += outTok;
      dd.models[model].cache_read += crTok;
      var stopR = rec.message?.stop_reason || 'unknown';
      dd.stop_reasons[stopR] = (dd.stop_reasons[stopR] || 0) + 1;
      var cliVer = extractCliVersion(rec);
      if (cliVer) {
        dd.versions[cliVer] = (dd.versions[cliVer] || 0) + 1;
        if (!dd.version_stats[cliVer]) dd.version_stats[cliVer] = emptyVersionStats();
        var vs = dd.version_stats[cliVer];
        vs.calls++;
        vs.output += outTok;
        vs.cache_read += crTok;
        var vsEp = extractEntrypoint(rec);
        if (vsEp) vs.entrypoints[vsEp] = (vs.entrypoints[vsEp] || 0) + 1;
      }
      var ep = extractEntrypoint(rec);
      if (ep) dd.entrypoints[ep] = (dd.entrypoints[ep] || 0) + 1;
      if (fileTodayFrag && todayYmdForFrag && day === todayYmdForFrag) {
        if (!fileTodayFrag.hosts) fileTodayFrag.hosts = {};
        if (!fileTodayFrag.hosts[hostLabel]) fileTodayFrag.hosts[hostLabel] = emptyHostSlice();
        var fhh = fileTodayFrag.hosts[hostLabel];
        fileTodayFrag.input += inTok;
        fileTodayFrag.output += outTok;
        fileTodayFrag.cache_read += crTok;
        fileTodayFrag.cache_creation += ccTok;
        fileTodayFrag.calls++;
        fileTodayFrag.hours[hour] = (fileTodayFrag.hours[hour] || 0) + 1;
        fhh.input += inTok;
        fhh.output += outTok;
        fhh.cache_read += crTok;
        fhh.cache_creation += ccTok;
        fhh.calls++;
        fhh.hours[hour] = (fhh.hours[hour] || 0) + 1;
        if (isSub) {
          fileTodayFrag.sub_calls++;
          fileTodayFrag.sub_cache += crTok;
          fileTodayFrag.sub_output += outTok;
          fhh.sub_calls++;
          fhh.sub_cache += crTok;
          fhh.sub_output += outTok;
        }
        if (!fileTodayFrag.models[model]) fileTodayFrag.models[model] = { calls: 0, output: 0, cache_read: 0 };
        fileTodayFrag.models[model].calls++;
        fileTodayFrag.models[model].output += outTok;
        fileTodayFrag.models[model].cache_read += crTok;
        if (cliVer) fileTodayFrag.versions[cliVer] = (fileTodayFrag.versions[cliVer] || 0) + 1;
        if (ep) fileTodayFrag.entrypoints[ep] = (fileTodayFrag.entrypoints[ep] || 0) + 1;
      }
    });
  } catch (e) {
    if (logWarn) logWarn('jsonl read failed ' + displayPathForUi(f) + ': ' + (e.message || e));
  }
}

// ── Cache Row Reconstruction ─────────────────────────────────────────────

function hostSliceFromRow(h) {
  if (!h || typeof h !== 'object') return emptyHostSlice();
  var ss = h.session_signals && typeof h.session_signals === 'object' ? h.session_signals : null;
  var base = emptyHostSlice();
  if (ss) {
    base.session_signals.continue = ss.continue || 0;
    base.session_signals.resume = ss.resume || 0;
    base.session_signals.retry = ss.retry || 0;
    base.session_signals.interrupt = ss.interrupt || 0;
    base.session_signals.truncated = ss.truncated || 0;
    base.session_signals.api_error = ss.api_error || 0;
  }
  var hsRow = h.hour_signals && typeof h.hour_signals === 'object' ? h.hour_signals : {};
  return {
    input: h.input || 0,
    output: h.output || 0,
    cache_read: h.cache_read || 0,
    cache_creation: h.cache_creation || 0,
    calls: h.calls || 0,
    sub_calls: h.sub_calls || 0,
    sub_cache: h.sub_cache || 0,
    sub_output: h.sub_output || 0,
    hours: h.hours && typeof h.hours === 'object' ? h.hours : {},
    hour_signals: hsRow,
    hit_limit: h.hit_limit || 0,
    session_signals: base.session_signals
  };
}

function rowToDailyEntry(row) {
  var hosts = {};
  if (row.hosts && typeof row.hosts === 'object') {
    var hk = Object.keys(row.hosts);
    for (var hKey of hk) {
      hosts[hKey] = hostSliceFromRow(row.hosts[hKey]);
    }
  }
  var versNorm = {};
  var versIn = row.versions && typeof row.versions === 'object' ? row.versions : {};
  var vkeys = Object.keys(versIn);
  for (var vkey of vkeys) {
    var nk = normalizeCliSemver(vkey);
    if (!nk) continue;
    versNorm[nk] = (versNorm[nk] || 0) + (versIn[vkey] || 0);
  }
  var ss0 = row.session_signals && typeof row.session_signals === 'object' ? row.session_signals : null;
  var sigRow = emptySessionSignals();
  if (ss0) {
    sigRow.continue = ss0.continue || 0;
    sigRow.resume = ss0.resume || 0;
    sigRow.retry = ss0.retry || 0;
    sigRow.interrupt = ss0.interrupt || 0;
    sigRow.truncated = ss0.truncated || 0;
    sigRow.api_error = ss0.api_error || 0;
  }
  var hourSigRow = row.hour_signals && typeof row.hour_signals === 'object' ? row.hour_signals : {};
  var stopR = row.stop_reasons && typeof row.stop_reasons === 'object' ? row.stop_reasons : {};
  return {
    input: row.input || 0,
    output: row.output || 0,
    cache_read: row.cache_read || 0,
    cache_creation: row.cache_creation || 0,
    calls: row.calls || 0,
    sub_calls: row.sub_calls || 0,
    sub_cache: row.sub_cache || 0,
    sub_output: row.sub_output || 0,
    hours: row.hours && typeof row.hours === 'object' ? row.hours : {},
    hour_signals: hourSigRow,
    models: row.models && typeof row.models === 'object' ? row.models : {},
    versions: versNorm,
    entrypoints: row.entrypoints && typeof row.entrypoints === 'object' ? row.entrypoints : {},
    version_stats: row.version_stats && typeof row.version_stats === 'object' ? row.version_stats : {},
    hit_limit: row.hit_limit || 0,
    hosts: hosts,
    session_signals: sigRow,
    stop_reasons: stopR,
    security_postures: row.security_postures && row.security_postures.total > 0 ? row.security_postures : emptySecurityPostures()
  };
}

// ── API Result Compilation ───────────────────────────────────────────────

function hostSliceToApi(h) {
  var total = h.input + h.output + h.cache_read + h.cache_creation;
  var activeH = unionHourKeyCount(h.hours, h.hour_signals);
  var ss = h.session_signals && typeof h.session_signals === 'object' ? h.session_signals : emptySessionSignals();
  return {
    input: h.input,
    output: h.output,
    cache_read: h.cache_read,
    cache_creation: h.cache_creation,
    total: total,
    calls: h.calls || 0,
    active_hours: activeH,
    hit_limit: h.hit_limit || 0,
    cache_output_ratio: h.output > 0 ? Math.round(h.cache_read / h.output) : 0,
    overhead: h.output > 0 ? Math.round(total / h.output) : 0,
    sub_calls: h.sub_calls || 0,
    sub_pct: h.calls > 0 ? Math.round(((h.sub_calls || 0) / h.calls) * 100) : 0,
    sub_cache: h.sub_cache || 0,
    sub_cache_pct: h.cache_read > 0 ? Math.round(((h.sub_cache || 0) / h.cache_read) * 100) : 0,
    output_per_hour: activeH > 0 ? Math.round(h.output / activeH) : 0,
    hours: h.hours || {},
    hour_signals: h.hour_signals || {},
    session_signals: {
      continue: ss.continue || 0,
      resume: ss.resume || 0,
      retry: ss.retry || 0,
      interrupt: ss.interrupt || 0,
      truncated: ss.truncated || 0,
      api_error: ss.api_error || 0
    }
  };
}

/**
 * Kompiliert daily-Buckets in die /api/usage Antwortstruktur.
 *
 * @param {Object} daily - { [dayKey]: DailyBucket }
 * @param {number} fileCount - Anzahl gescannter Dateien
 * @param {Array} filePaths - Tagged file references
 * @param {Array} roots - Scan root directories
 * @param {Object} enrichment - Server-seitige Anreicherungsdaten:
 *   @param {Object} enrichment.outageDaysMap - getOutageDaysMap() Ergebnis
 *   @param {Object} enrichment.releaseStability - buildReleaseStabilityData() Ergebnis
 *   @param {Function} enrichment.applyExtensionVersionMarkers - (result, mpRows) => void
 *   @param {Function} enrichment.enrichVersionChangeNotes - (result) => void
 *   @param {Function} enrichment.getReleasesMap - () => releasesMap (fuer applyJsonlGapVersionChanges)
 *   @param {Object} enrichment.outageCache - { fetchedAt, error } fuer Status
 *   @param {Function} enrichment.buildStatePaths - () => state_paths Objekt
 *   @param {Array} [enrichment.marketplaceRows] - frozen marketplace rows
 */
function buildUsageResult(daily, fileCount, filePaths, roots, enrichment) {
  enrichment = enrichment || {};
  var days = Object.keys(daily).sort(function (a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  });
  var result = [];
  for (var key of days) {
    var r = daily[key];
    var total = r.input + r.output + r.cache_read + r.cache_creation;
    var activeH = unionHourKeyCount(r.hours, r.hour_signals);
    var hostsRaw = r.hosts || {};
    var hostsApi = {};
    var hKeys = Object.keys(hostsRaw).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
    for (var hk of hKeys) {
      hostsApi[hk] = hostSliceToApi(hostsRaw[hk]);
    }
    var rsig = r.session_signals && typeof r.session_signals === 'object' ? r.session_signals : emptySessionSignals();
    result.push({
      date: key,
      input: r.input,
      output: r.output,
      cache_read: r.cache_read,
      cache_creation: r.cache_creation,
      total: total,
      calls: r.calls,
      active_hours: activeH,
      cache_output_ratio: r.output > 0 ? Math.round(r.cache_read / r.output) : 0,
      overhead: r.output > 0 ? Math.round(total / r.output) : 0,
      sub_calls: r.sub_calls,
      sub_pct: r.calls > 0 ? Math.round(r.sub_calls / r.calls * 100) : 0,
      sub_cache: r.sub_cache,
      sub_cache_pct: r.cache_read > 0 ? Math.round(r.sub_cache / r.cache_read * 100) : 0,
      output_per_hour: activeH > 0 ? Math.round(r.output / activeH) : 0,
      total_per_hour: activeH > 0 ? Math.round(total / activeH) : 0,
      hit_limit: r.hit_limit || 0,
      models: r.models,
      versions: r.versions || {},
      entrypoints: r.entrypoints || {},
      version_stats: r.version_stats || {},
      hours: r.hours,
      hour_signals: r.hour_signals || {},
      hosts: hostsApi,
      session_signals: {
        continue: rsig.continue || 0,
        resume: rsig.resume || 0,
        retry: rsig.retry || 0,
        interrupt: rsig.interrupt || 0,
        truncated: rsig.truncated || 0,
        api_error: rsig.api_error || 0
      },
      forensic_code: '\u2014',
      forensic_hint: '',
      forensic_implied_cap_90: 0,
      forensic_vs_peak: 0,
      outage_hours: 0,
      outage_incidents: [],
      outage_spans: [],
      outage_likely: false,
      model_change: null,
      version_change: null,
      security_postures: r.security_postures && r.security_postures.total > 0 ? r.security_postures : null
    });
  }

  // Model-Change-Detection
  for (var mci = 0; mci < result.length; mci++) {
    var curModels = Object.keys(result[mci].models || {}).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
    if (mci === 0) { result[mci].model_set = curModels; continue; }
    var prevModels = Object.keys(result[mci - 1].models || {}).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
    result[mci].model_set = curModels;
    var added = [];
    var removed = [];
    for (var cm of curModels) {
      if (!prevModels.includes(cm)) added.push(cm);
    }
    for (var pm of prevModels) {
      if (!curModels.includes(pm)) removed.push(pm);
    }
    if (added.length > 0 || removed.length > 0) {
      result[mci].model_change = { added: added, removed: removed };
    }
  }

  // Extension version markers (injected from server)
  if (enrichment.applyExtensionVersionMarkers) {
    enrichment.applyExtensionVersionMarkers(result, enrichment.marketplaceRows);
  }
  applyJsonlGapVersionChanges(result, enrichment.getReleasesMap);
  if (enrichment.enrichVersionChangeNotes) {
    enrichment.enrichVersionChangeNotes(result);
  }

  // Peak detection
  var peakDate = '';
  var peakTotal = 0;
  for (var pr of result) {
    if (pr.total > peakTotal) {
      peakTotal = pr.total;
      peakDate = pr.date;
    }
  }

  // Forensic + Outage pro Tag
  var outageDays = enrichment.outageDaysMap || {};
  for (var row of result) {
    var rr = daily[row.date];
    if (!rr) continue;
    var f = computeForensicForDay(row.date, rr, peakDate, peakTotal);
    row.forensic_code = f.forensic_code;
    row.forensic_hint = f.forensic_hint;
    row.forensic_implied_cap_90 = f.forensic_implied_cap_90;
    row.forensic_vs_peak = f.forensic_vs_peak;
    var od = outageDays[row.date];
    if (od) {
      row.outage_hours = od.outage_hours;
      row.outage_server_hours = od.server_hours;
      row.outage_client_hours = od.client_hours;
      row.outage_incidents = od.incidents;
      row.outage_spans = od.spans;
      row.outage_likely = (row.hit_limit || 0) > 0;
    }
  }

  var scanned = [];
  var tagged = filePaths;
  if (tagged?.length) {
    for (var tf of tagged) {
      scanned.push(displayScannedFileLine(tf));
    }
  }

  var byLabel = Object.create(null);
  for (var tg of (tagged || [])) {
    var lb = tg.label || 'local';
    byLabel[lb] = (byLabel[lb] || 0) + 1;
  }
  var scan_sources = [];
  if (roots?.length) {
    for (var root of roots) {
      var rl = root.label;
      scan_sources.push({
        label: rl,
        jsonl_files: byLabel[rl] || 0,
        path_hint: displayPathForUi(root.path)
      });
    }
  }

  var host_labels = [];
  if (roots?.length) {
    for (var rt of roots) {
      host_labels.push(rt.label);
    }
  }

  var oc = enrichment.outageCache || {};
  return {
    days: result,
    release_stability: enrichment.releaseStability || null,
    parsed_files: fileCount,
    scanned_files: scanned,
    scan_sources: scan_sources,
    host_labels: host_labels,
    generated: new Date().toISOString(),
    limit_source_note: buildLimitSourceNote(),
    limit_source_note_en: buildLimitSourceNoteEn(),
    scope: 'claude-models-only',
    forensic_peak_date: peakDate,
    forensic_peak_total: peakTotal,
    forensic_note:
      'Forensic: ? = Cache\u2265500M; HIT = Limit-Zeilen in JSONL; <<P = stark unter Peak bei hohem Output (nicht \u201e90%\u201c/100% der UI). Impl@90% = total/0.9 nur Rechenbeispiel. Alles heuristisch.',
    forensic_note_en:
      'Forensic: ? = cache \u2265500M; HIT = limit-like lines in JSONL; <<P = far below peak with high output (not Claude UI \u201c90%\u201d/100%). Impl@90% = total/0.9 is illustrative only. All heuristic.',
    outage_status: oc.fetchedAt > 0 ? 'ok' : (oc.error ? 'error' : 'pending'),
    outage_fetched: oc.fetchedAt ? new Date(oc.fetchedAt).toISOString() : null,
    state_paths: enrichment.buildStatePaths ? enrichment.buildStatePaths() : {}
  };
}

function applyJsonlGapVersionChanges(result, getReleasesMapFn) {
  if (!getReleasesMapFn) return;
  var relMapJsonl = getReleasesMapFn();
  for (var vci = 0; vci < result.length; vci++) {
    if (result[vci].version_change) continue;
    var curVers = Object.keys(result[vci].versions || {}).sort(semverCmp);
    if (vci === 0) continue;
    var prevVers = Object.keys(result[vci - 1].versions || {}).sort(semverCmp);
    var vAdded = [];
    for (var cv of curVers) {
      if (!prevVers.includes(cv)) vAdded.push(cv);
    }
    if (vAdded.length === 0) continue;
    vAdded.sort(semverCmp);
    var relHighlights = [];
    for (var va of vAdded) {
      var vk = normalizeCliSemver(va);
      var ri = vk ? relMapJsonl[vk] : null;
      if (ri?.highlights) relHighlights = relHighlights.concat(ri.highlights);
    }
    var fromVer = prevVers.length > 0 ? prevVers[prevVers.length - 1] : null;
    result[vci].version_change = { added: vAdded, from: fromVer, highlights: relHighlights };
  }
}

/**
 * Synchroner Vollscan (Utility / CLI).
 */
function parseAllUsageSync(enrichment) {
  var coll = collectTaggedJsonlFiles();
  var tagged = coll.tagged;
  var daily = {};
  for (var tf of tagged) {
    processJsonlFile(tf, daily, null, null, null, null);
  }
  return buildUsageResult(daily, tagged.length, tagged, coll.roots, enrichment);
}

module.exports = {
  // Pure helpers
  normalizeCliSemver: normalizeCliSemver,
  semverCmp: semverCmp,
  extractCliVersion: extractCliVersion,
  extractEntrypoint: extractEntrypoint,
  isClaudeModel: isClaudeModel,
  unionHourKeyCount: unionHourKeyCount,
  displayPathForUi: displayPathForUi,
  displayScannedFileLine: displayScannedFileLine,
  buildLimitSourceNote: buildLimitSourceNote,
  buildLimitSourceNoteEn: buildLimitSourceNoteEn,
  // Security posture (canonical: domain/usage/security-classify.js)
  classifySecurityPosture: classifySecurityPosture,
  bumpSecurityPostures: bumpSecurityPostures,
  // JSONL parsing
  targetDayBucket: targetDayBucket,
  processJsonlFile: processJsonlFile,
  // Cache row reconstruction
  hostSliceFromRow: hostSliceFromRow,
  rowToDailyEntry: rowToDailyEntry,
  // API compilation
  hostSliceToApi: hostSliceToApi,
  buildUsageResult: buildUsageResult,
  applyJsonlGapVersionChanges: applyJsonlGapVersionChanges,
  parseAllUsageSync: parseAllUsageSync
};
