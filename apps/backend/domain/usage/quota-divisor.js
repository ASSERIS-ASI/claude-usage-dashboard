/**
 * @asseris-module       Quota Divisor
 * @asseris-description  Module-level annotation placeholder for Quota Divisor.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 */
/**
 * domain/usage/quota-divisor.js — Quota-divisor NDJSON line processing, date helpers, carryover calc.
 *
 * Extracted from dashboard-server.js (clean-modules Phase 1).
 * Pure domain logic: no HTTP, no I/O, no state — only calculation.
 */

/**
 * Per-model token pricing ($/1M tokens). cache_read = 0.1x input,
 * cache_creation = 1.25x input (5-minute write tier — matches the historical
 * single-table assumption, now resolved per model). Source: platform.claude.com
 * pricing as of 2026-06. Applied per NDJSON line via response_model so a day's
 * mixed Opus/Sonnet/Haiku/Fable traffic is costed correctly instead of with one
 * blanket Opus table.
 */
const MODEL_PRICING = {
  opus:   { input: 5.0,  output: 25.0, cache_read: 0.50, cache_creation: 6.25 },
  sonnet: { input: 3.0,  output: 15.0, cache_read: 0.30, cache_creation: 3.75 },
  haiku:  { input: 1.0,  output: 5.0,  cache_read: 0.10, cache_creation: 1.25 },
  fable:  { input: 10.0, output: 50.0, cache_read: 1.00, cache_creation: 12.5 }
};

/**
 * Resolve a per-model price table from a response_model string. Matches by
 * family substring (handles dated ids like claude-haiku-4-5-20251001). Returns
 * null for unknown/missing models so the caller can fall back to its default.
 *
 * @param {string} model - response_model value
 * @returns {{cache_read:number,cache_creation:number,input:number,output:number}|null}
 */
function priceForModel(model) {
  const m = model ? String(model).toLowerCase() : '';
  if (m.includes('opus')) return MODEL_PRICING.opus;
  if (m.includes('sonnet')) return MODEL_PRICING.sonnet;
  if (m.includes('haiku')) return MODEL_PRICING.haiku;
  if (m.includes('fable') || m.includes('mythos')) return MODEL_PRICING.fable;
  return null;
}

/**
 * Create a closure that processes proxy NDJSON lines and accumulates
 * quota-divisor request pairs. Tracks prevQ5 across calls.
 *
 * @param {object} PRICE - { cache_read, cache_creation, input, output } per 1M tokens.
 *                         Used as the fallback when a record has no recognizable
 *                         response_model; per-model pricing overrides it per line.
 * @param {string} qfDate - YYYY-MM-DD date label
 * @param {Array} requestPairs - accumulator array (mutated)
 * @returns {Function} line processor: function(line)
 */
function createQuotaDivisorLineProcessor(PRICE, qfDate, requestPairs) {
  var prevQ5 = null;
  return function (line) {
    if (!line.trim()) return;
    var rec;
    try {
      rec = JSON.parse(line);
    } catch (_e) {
      return;
    }
    if (!rec.usage) return;
    var rah = rec.response_anthropic_headers || {};
    var q5Str = rah['anthropic-ratelimit-unified-5h-utilization'];
    if (q5Str == null) return;
    var q5 = Number.parseFloat(q5Str);
    if (Number.isNaN(q5) || q5 < 0) return;

    var u = rec.usage;
    var cr = u.cache_read_input_tokens || 0;
    var cc = u.cache_creation_input_tokens || 0;
    var inp = u.input_tokens || 0;
    var out = u.output_tokens || 0;
    const price = priceForModel(rec.response_model) || PRICE;
    const cost =
      (cr * price.cache_read) / 1e6 +
      (cc * price.cache_creation) / 1e6 +
      (inp * price.input) / 1e6 +
      (out * price.output) / 1e6;

    var delta = prevQ5 !== null ? q5 - prevQ5 : null;
    if (delta !== null && delta > 0 && cost > 0) {
      var impliedDivisor = cost / delta;
      requestPairs.push({
        date: qfDate,
        ts: rec.ts_end || rec.ts_start || '',
        q5_prev: prevQ5,
        q5: q5,
        delta: delta,
        cost: Math.round(cost * 100) / 100,
        implied_divisor: Math.round(impliedDivisor * 100) / 100,
        cache_read: cr,
        cache_creation: cc,
        input: inp,
        output: out,
        cache_pct: cr > 0 ? Math.round(cr / (cr + cc + inp + out) * 100) : 0
      });
    }
    prevQ5 = q5;
  };
}

/** YYYY-MM-DD minus one calendar day (UTC). */
function calendarPrevDateYmd(ymd) {
  var parts = String(ymd).split('-');
  if (parts.length !== 3) return null;
  var y = Number.parseInt(parts[0], 10);
  var m = Number.parseInt(parts[1], 10) - 1;
  var d = Number.parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  var dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** Same cumulative rules as Budget Drain lower chart (client). */
function q5CarryoverTotalsFromPairs(pairs) {
  var csum = 0;
  var cisum = 0;
  for (var pair of pairs) {
    var dltPct = pair.delta * 100;
    csum += dltPct;
    if (pair.delta < 0.03) cisum += dltPct;
  }
  return { actual: Math.round(csum * 10) / 10, ideal: Math.round(cisum * 10) / 10 };
}

module.exports = {
  createQuotaDivisorLineProcessor: createQuotaDivisorLineProcessor,
  calendarPrevDateYmd: calendarPrevDateYmd,
  q5CarryoverTotalsFromPairs: q5CarryoverTotalsFromPairs,
  priceForModel: priceForModel,
  MODEL_PRICING: MODEL_PRICING
};
