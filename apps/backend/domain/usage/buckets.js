'use strict';
/**
 * @asseris-module       Usage Buckets
 * @asseris-description  Empty-bucket factory + merge primitives for per-day usage aggregates
 *                       (tokens, session signals, security postures) — pure data plumbing
 *                       used by scanner.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Session Signals
 * @asseris-called-by    Usage Scan Orchestrator, Day-Cache Schema
 * @asseris-emits        empty/merged bucket objects
 * @asseris-consumes     per-day raw aggregates
 */

var sessionSignalsMod = require('./session-signals');
var emptySessionSignals = sessionSignalsMod.emptySessionSignals;
var mergeHourSignalsInto = sessionSignalsMod.mergeHourSignalsInto;

function emptySecurityPostures() {
  return { total: 0, critical: 0, high: 0, medium: 0, by_type: {}, events: [] };
}

function mergeSecurityPosturesInto(dst, src) {
  if (!src) return;
  if (!dst.security_postures) dst.security_postures = emptySecurityPostures();
  var d = dst.security_postures;
  d.total += src.total || 0;
  d.critical += src.critical || 0;
  d.high += src.high || 0;
  d.medium += src.medium || 0;
  for (var k in (src.by_type || {})) {
    d.by_type[k] = (d.by_type[k] || 0) + src.by_type[k];
  }
  for (var e of (src.events || [])) {
    if (d.events.length < 200) d.events.push(e);
  }
}

function emptyVersionStats() {
  return { calls: 0, output: 0, cache_read: 0, hit_limit: 0, retry: 0, interrupt: 0, continue: 0, resume: 0, truncated: 0, api_error: 0, entrypoints: {} };
}

function emptyHostSlice() {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
    calls: 0,
    sub_calls: 0,
    sub_cache: 0,
    sub_output: 0,
    hours: {},
    hour_signals: {},
    hit_limit: 0,
    session_signals: emptySessionSignals(),
    stop_reasons: {}
  };
}

function emptyDailyBucket() {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
    calls: 0,
    sub_calls: 0,
    sub_cache: 0,
    sub_output: 0,
    hours: {},
    hour_signals: {},
    models: {},
    versions: {},
    entrypoints: {},
    version_stats: {},
    hit_limit: 0,
    hosts: {},
    session_signals: emptySessionSignals(),
    stop_reasons: {},
    security_postures: emptySecurityPostures()
  };
}

function mergeHoursInto(dst, src) {
  if (!src || typeof src !== 'object') return;
  var ks = Object.keys(src);
  for (var k of ks) {
    dst[k] = (dst[k] || 0) + (src[k] || 0);
  }
}

function mergeTopSessionSignalsInto(bucket, srcSs) {
  if (!srcSs || typeof srcSs !== 'object') return;
  if (!bucket.session_signals) bucket.session_signals = emptySessionSignals();
  var d = bucket.session_signals;
  d.continue += srcSs.continue || 0;
  d.resume += srcSs.resume || 0;
  d.retry += srcSs.retry || 0;
  d.interrupt += srcSs.interrupt || 0;
  d.truncated += srcSs.truncated || 0;
  d.api_error += srcSs.api_error || 0;
}

function mergeHostSliceInto(dst, src) {
  if (!src || typeof src !== 'object') return;
  dst.input += src.input || 0;
  dst.output += src.output || 0;
  dst.cache_read += src.cache_read || 0;
  dst.cache_creation += src.cache_creation || 0;
  dst.calls += src.calls || 0;
  dst.sub_calls += src.sub_calls || 0;
  dst.sub_cache += src.sub_cache || 0;
  dst.sub_output += src.sub_output || 0;
  dst.hit_limit += src.hit_limit || 0;
  mergeHoursInto(dst.hours || (dst.hours = {}), src.hours);
  mergeHourSignalsInto(dst, src.hour_signals);
  mergeTopSessionSignalsInto(dst, src.session_signals);
  mergeStopReasons(dst, src);
}

function mergeStopReasons(dst, src) {
  if (!src.stop_reasons) return;
  if (!dst.stop_reasons) dst.stop_reasons = {};
  var sk = Object.keys(src.stop_reasons);
  for (var srk of sk) {
    dst.stop_reasons[srk] = (dst.stop_reasons[srk] || 0) + (src.stop_reasons[srk] || 0);
  }
}

function mergeEntrypointsInto(tgt, srcEntrypoints) {
  if (!tgt.entrypoints) tgt.entrypoints = {};
  var ekKeys = Object.keys(srcEntrypoints || {});
  for (var ek of ekKeys) {
    tgt.entrypoints[ek] = (tgt.entrypoints[ek] || 0) + (srcEntrypoints[ek] || 0);
  }
}

function mergeVersionStatsInto(target, srcVersionStats) {
  if (!srcVersionStats) return;
  if (!target.version_stats) target.version_stats = {};
  var vsKeys = Object.keys(srcVersionStats);
  for (var vsKey of vsKeys) {
    if (!target.version_stats[vsKey]) target.version_stats[vsKey] = emptyVersionStats();
    var tgt = target.version_stats[vsKey];
    var srcVs = srcVersionStats[vsKey];
    var fKeys = Object.keys(srcVs);
    for (var f of fKeys) {
      if (f === 'entrypoints') {
        mergeEntrypointsInto(tgt, srcVs.entrypoints);
      } else {
        tgt[f] = (tgt[f] || 0) + (srcVs[f] || 0);
      }
    }
  }
}

/** Additiver Merge: ''heute''-Fragmente aus mehreren JSONL in einen Tages-Bucket (today_nly + Index). */
function mergeDayBucketInto(target, src) {
  if (!src || typeof src !== 'object') return;
  target.input += src.input || 0;
  target.output += src.output || 0;
  target.cache_read += src.cache_read || 0;
  target.cache_creation += src.cache_creation || 0;
  target.calls += src.calls || 0;
  target.sub_calls += src.sub_calls || 0;
  target.sub_cache += src.sub_cache || 0;
  target.sub_output += src.sub_output || 0;
  target.hit_limit += src.hit_limit || 0;
  mergeHoursInto(target.hours || (target.hours = {}), src.hours);
  mergeHourSignalsInto(target, src.hour_signals);
  mergeTopSessionSignalsInto(target, src.session_signals);
  mergeSecurityPosturesInto(target, src.security_postures);
  mergeStopReasons(target, src);
  var hk = Object.keys(src.hosts || {});
  for (var lab of hk) {
    if (!target.hosts[lab]) target.hosts[lab] = emptyHostSlice();
    mergeHostSliceInto(target.hosts[lab], src.hosts[lab]);
  }
  var mk = Object.keys(src.models || {});
  for (var m of mk) {
    var sm = src.models[m];
    if (!sm || typeof sm !== 'object') continue;
    if (!target.models[m]) target.models[m] = { calls: 0, output: 0, cache_read: 0 };
    target.models[m].calls += sm.calls || 0;
    target.models[m].output += sm.output || 0;
    target.models[m].cache_read += sm.cache_read || 0;
  }
  var vk = Object.keys(src.versions || {});
  for (var v of vk) {
    target.versions[v] = (target.versions[v] || 0) + (src.versions[v] || 0);
  }
  var epKeys = Object.keys(src.entrypoints || {});
  for (var epk of epKeys) {
    target.entrypoints[epk] = (target.entrypoints[epk] || 0) + (src.entrypoints[epk] || 0);
  }
  mergeVersionStatsInto(target, src.version_stats);
}

module.exports = {
  emptySecurityPostures: emptySecurityPostures,
  mergeSecurityPosturesInto: mergeSecurityPosturesInto,
  emptyVersionStats: emptyVersionStats,
  emptyHostSlice: emptyHostSlice,
  emptyDailyBucket: emptyDailyBucket,
  mergeHoursInto: mergeHoursInto,
  mergeTopSessionSignalsInto: mergeTopSessionSignalsInto,
  mergeHostSliceInto: mergeHostSliceInto,
  mergeStopReasons: mergeStopReasons,
  mergeEntrypointsInto: mergeEntrypointsInto,
  mergeVersionStatsInto: mergeVersionStatsInto,
  mergeDayBucketInto: mergeDayBucketInto
};
