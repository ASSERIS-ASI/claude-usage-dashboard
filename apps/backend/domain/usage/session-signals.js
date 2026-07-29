'use strict';
/**
 * @asseris-module       Session Signals
 * @asseris-description  Per-day + per-hour counters for behavioral session signals (continue,
 *                       resume, retry, interrupt, truncated, api_error) — pure aggregator
 *                       used to detect repair patterns and quota-stress trajectories.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   CLS-02
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Usage Scan Orchestrator
 * @asseris-emits        bucket.session_signals + bucket.hour_signals
 * @asseris-consumes     tag arrays from JSONL records
 */

function emptySessionSignals() {
  return { continue: 0, resume: 0, retry: 0, interrupt: 0, truncated: 0, api_error: 0 };
}

function bumpSessionSignals(bucket, tagList) {
  if (!bucket.session_signals) bucket.session_signals = emptySessionSignals();
  var sig = bucket.session_signals;
  for (var tg of tagList) {
    if (sig[tg] != null) sig[tg]++;
  }
}

/** Session-Signale nach JSONL-Stunde (0-23) -- gleiche Zeitleiste wie usage hours. */
function bumpHourSessionSignals(bucket, hourKeyStr, tagList) {
  if (!hourKeyStr || !tagList?.length) return;
  if (!bucket.hour_signals) bucket.hour_signals = {};
  if (!bucket.hour_signals[hourKeyStr]) bucket.hour_signals[hourKeyStr] = emptySessionSignals();
  var sig = bucket.hour_signals[hourKeyStr];
  for (var tg of tagList) {
    if (sig[tg] != null) sig[tg]++;
  }
}

function mergeHourSignalsInto(dst, src) {
  if (!src || typeof src !== 'object') return;
  if (!dst.hour_signals) dst.hour_signals = {};
  var ks = Object.keys(src);
  for (var k of ks) {
    var sk = src[k];
    if (!sk || typeof sk !== 'object') continue;
    if (!dst.hour_signals[k]) dst.hour_signals[k] = emptySessionSignals();
    var dk = dst.hour_signals[k];
    dk.continue += sk.continue || 0;
    dk.resume += sk.resume || 0;
    dk.retry += sk.retry || 0;
    dk.interrupt += sk.interrupt || 0;
    dk.truncated += sk.truncated || 0;
    dk.api_error += sk.api_error || 0;
  }
}

/** Heuristik auf Rohzeile + Objekt: --continue/--resume, Retry/429, Interrupt (siehe Community-JSONL-Analysen). */
function classifyJsonlSessionSignals(line, rec) {
  var tags = [];
  var seen = Object.create(null);
  function add(tag) {
    if (!seen[tag]) {
      seen[tag] = true;
      tags.push(tag);
    }
  }
  var lower = String(line).toLowerCase();
  if (/(?:^|[^\w-])--continue(?:[^\w-]|$)/.test(lower) || /["']--continue["']/.test(line)) {
    add('continue');
  }
  if (/(?:^|[^\w-])--resume(?:[^\w-]|$)/.test(lower) || /["']--resume["']/.test(line)) {
    add('resume');
  }
  if (
    /user_cancel|user_cancelled|user\s*interrupt|interrupted|unterbrochen|stream\s*abort|cancellation|cancelled\s*request/.test(
      lower
    )
  ) {
    add('interrupt');
  }
  if (rec?.message?.stop_reason) {
    var sr = String(rec.message.stop_reason).toLowerCase();
    if (sr.includes('cancel') || sr === 'user_abort') add('interrupt');
  }
  if (/retrying|will\s*retry|retries\s+exhausted|exponential\s*backoff|auto-?retry|retry\s+attempt/.test(lower)) {
    add('retry');
  }
  if (/\b429\b/.test(lower) && /retry|rate|limit|overloaded|throttl|too\s+many/.test(lower)) {
    add('retry');
  }
  if (rec?.error) {
    try {
      var ej = JSON.stringify(rec.error).toLowerCase();
      if (/retry|429|rate|throttl|overloaded/.test(ej)) add('retry');
      if (/interrupt|cancel|abort/.test(ej)) add('interrupt');
    } catch (error) { /* intentional */ }
  }
  // B5: Tool result truncation
  if (/["']is_truncated["']\s*:\s*true|["']truncated["']\s*:\s*true/.test(line)) {
    add('truncated');
  }
  // API error (system records with subtype api_error or error field)
  if (rec?.type === 'system' && rec?.subtype === 'api_error') {
    add('api_error');
  }
  return tags;
}

module.exports = {
  emptySessionSignals: emptySessionSignals,
  bumpSessionSignals: bumpSessionSignals,
  bumpHourSessionSignals: bumpHourSessionSignals,
  mergeHourSignalsInto: mergeHourSignalsInto,
  classifyJsonlSessionSignals: classifyJsonlSessionSignals
};
