'use strict';

/**
 * @asseris-module       Quota Attribution
 * @asseris-description  Splits the account quota meters into what the proxy caused and
 *                       what the rest of the account caused, hour by hour.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-consumes     translated cache-fix usage records (usage.jsonl, claude-meter.jsonl)
 * @asseris-emits        quota_attribution
 */

/**
 * On a subscription account the Q5h and Q7d meters count every surface that
 * uses the account: the proxy in front of Claude Code, the claude.ai web UI,
 * Claude Design and any other client. The proxy only sees its own traffic, so a
 * rising meter has two possible causes and the logs can only account for one.
 *
 * Three lines per meter close that gap:
 *
 *   cumulative    the meter as the response headers report it — all surfaces
 *   attributed    the proxy's own per-turn claims inside the meter's window
 *   unattributed  cumulative minus attributed — what the proxy never saw
 *
 * qclaim is expected as a number on the same scale as the meter (a share of the
 * window, like q5h/q7d). Today cache-fix writes it as an empty string — the
 * raw `anthropic-ratelimit-unified-claim` header, which the API does not send —
 * and populating it is tracked upstream (claude-code-cache-fix#335). Until a
 * record carries a number, nothing can be attributed: attributed is 0 and the
 * whole meter is unattributed, and `attribution_available` says so.
 *
 * Read-only: this module folds records it is handed. It opens no file, writes
 * nothing and raises no alert.
 */

var HOUR_MS = 60 * 60 * 1000;

var METERS = {
  q5h: {
    windowMs: 5 * HOUR_MS,
    utilization: 'anthropic-ratelimit-unified-5h-utilization',
    reset: 'anthropic-ratelimit-unified-5h-reset'
  },
  q7d: {
    windowMs: 7 * 24 * HOUR_MS,
    utilization: 'anthropic-ratelimit-unified-7d-utilization',
    reset: 'anthropic-ratelimit-unified-7d-reset'
  }
};

/**
 * A quota claim as a number, or null.
 *
 * Only a real, non-negative number counts. An empty string — what every record
 * carries today — must not become Number('') === 0, or "no claim" would read as
 * "a claim of zero" and the panel would report attribution it does not have.
 */
function claimOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** A meter reading from the translated headers: a finite, non-negative number or null. */
function readingOf(headers, name) {
  var raw = headers?.[name];
  if (raw == null || raw === '') return null;
  var value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Window reset as epoch milliseconds; the headers carry unix seconds. */
function resetOf(headers, name) {
  var value = Number(headers?.[name]);
  return Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

function createAccumulator() {
  var observations = [];
  var claims = [];

  /** Take one translated record. Records without a timestamp are skipped. */
  function add(record) {
    var ts = Date.parse(record?.ts_end || record?.ts_start || '');
    if (!Number.isFinite(ts)) return;
    var headers = record.response_anthropic_headers || {};
    var observation = { ts: ts };
    var any = false;
    for (var meter of Object.keys(METERS)) {
      var reading = readingOf(headers, METERS[meter].utilization);
      observation[meter] = reading;
      observation[meter + '_reset'] = resetOf(headers, METERS[meter].reset);
      if (reading !== null) any = true;
    }
    if (any) observations.push(observation);
    var claim = claimOf(record.quota_claim);
    if (claim !== null) claims.push({ ts: ts, claim: claim });
  }

  function build() {
    return summarize(observations, claims);
  }

  return { add: add, build: build };
}

/**
 * Sum of claims with lo < ts <= hi, from a list sorted by ts with running
 * totals. Binary search keeps an hourly series over a month of turns linear.
 */
function claimsBetween(sorted, prefix, lo, hi) {
  function upperBound(limit) {
    var left = 0;
    var right = sorted.length;
    while (left < right) {
      var mid = (left + right) >> 1;
      if (sorted[mid].ts <= limit) left = mid + 1;
      else right = mid;
    }
    return left;
  }
  return prefix[upperBound(hi)] - prefix[upperBound(lo)];
}

/**
 * Where the meter's current window began at the moment of an observation.
 *
 * The meter counts from its own window start, not over a sliding interval: a
 * 5-hour meter read at 14:10 whose window resets at 16:00 has been counting
 * since 11:00. The reset header gives that start exactly; without it the
 * nominal window length is the best available approximation.
 */
function windowStart(observation, meter) {
  var reset = observation[meter + '_reset'];
  var length = METERS[meter].windowMs;
  if (reset !== null && reset > observation.ts && reset - observation.ts <= length) return reset - length;
  return observation.ts - length;
}

/**
 * The newest observation of each clock hour becomes one point per meter. An
 * hour is the finest step anyone reads a 5-hour meter at, and it bounds the
 * payload: a month is at most 744 points per meter, however many turns ran.
 */
function summarize(observations, claims) {
  observations.sort(function (a, b) { return a.ts - b.ts; });
  claims.sort(function (a, b) { return a.ts - b.ts; });
  var prefix = [0];
  for (var entry of claims) prefix.push(prefix.at(-1) + entry.claim);

  var meters = {};
  for (var meter of Object.keys(METERS)) {
    var byHour = new Map();
    for (var observation of observations) {
      if (observation[meter] === null) continue;
      byHour.set(Math.floor(observation.ts / HOUR_MS) * HOUR_MS, observation);
    }
    var points = [];
    for (var [hour, latest] of byHour) {
      var cumulative = latest[meter];
      var attributedRaw = claimsBetween(claims, prefix, windowStart(latest, meter), latest.ts);
      // Claims and the reading are not sampled at the same instant, so the sum
      // can drift past the meter by a hair at a window edge. Clamped, so the
      // gap never shows as another surface handing quota back.
      var attributed = Math.min(attributedRaw, cumulative);
      points.push({
        hour: new Date(hour).toISOString(),
        cumulative: round(cumulative),
        attributed: round(attributed),
        unattributed: round(Math.max(cumulative - attributed, 0))
      });
    }
    meters[meter] = { window_ms: METERS[meter].windowMs, points: points };
  }

  return {
    observations: observations.length,
    claims: claims.length,
    attribution_available: claims.length > 0,
    meters: meters
  };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

module.exports = {
  createAccumulator: createAccumulator,
  claimOf: claimOf,
  METERS: METERS
};
