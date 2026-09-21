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
 * FALLBACK token pricing ($/1M tokens), resolved per family.
 *
 * The primary source is the dated card history in rate-cards.json, resolved per model
 * id and record date through domain/usage/pricing.js. This table is what a record is
 * priced with when no card covers its model on its day — it resolves `opus` by
 * substring and knows no dates, so it cannot tell Opus 4 ($15) from Opus 5 ($5) or a
 * Sonnet 5 record before the introductory price ended from one after. Every use of it
 * is counted and reported [pricing.missTotals()].
 *
 * cache_read = 0.1x input,
 * cache_creation = 1.25x input (5-minute write tier — matches the historical
 * single-table assumption, now resolved per model). Source: platform.claude.com
 * pricing as of 2026-06. Applied per NDJSON line via response_model so a day's
 * mixed Opus/Sonnet/Haiku/Fable traffic is costed correctly instead of with one
 * blanket Opus table.
 */
const MODEL_PRICING = {
  opus:   { input: 5,  output: 25, cache_read: 0.5, cache_creation: 6.25, cache_creation_1h: 10 },
  sonnet: { input: 3,  output: 15, cache_read: 0.3, cache_creation: 3.75, cache_creation_1h: 6 },
  haiku:  { input: 1,  output: 5,  cache_read: 0.1, cache_creation: 1.25, cache_creation_1h: 2 },
  fable:  { input: 10, output: 50, cache_read: 1,   cache_creation: 12.5, cache_creation_1h: 20 }
};

/**
 * A cache write has TWO prices, and the table above only ever carried one.
 *
 * Anthropic charges a 5-minute write at 1.25× base input and a 1-hour write at 2×. Every
 * `cache_creation` rate in the table is exactly 1.25× its input rate — i.e. the 5m tier —
 * so a 1h write was billed 60 % too cheap wherever this table was used. Measured on live
 * traffic: the auto-mode classifier writes exclusively on the 1h tier (`ephemeral_1h` equals
 * `cache_creation`, `ephemeral_5m` is zero), which put its real cost at ~42 $ against the
 * ~27 $ the dashboard reported [DET-11].
 *
 * The raw split was in the log all along; only its use was missing.
 *
 * @param {object} usage  record usage block
 * @param {object} price  resolved per-model price row
 * @param {object} [rec]  the record, for the `ttl_tier` fallback
 * @returns {number} USD for the cache-creation part
 */
/**
 * A token count is a non-negative SAFE integer.
 *
 * Three conditions, each closing a different hole:
 *   - integer      rejects NaN, Infinity and fractions in one predicate
 *   - `>= 0`       a negative value SURVIVES a sum check (-100 + 100,100 adds up to
 *                  100,000) and would then subtract from the bill
 *   - safe         `Number.isInteger(1e30)` is true, and 1e30 tokens price at 6e24 USD.
 *                  Beyond 2^53 the arithmetic stops being exact anyway, so a value up
 *                  there is a corrupt record, not a very large request [CWE-20] [CWE-345].
 *
 * @param {*} n
 * @returns {boolean}
 */
function isTokenCount(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * Records whose cost inputs did not hold up, so a parse run can report them once.
 * `split` = tier split that did not partition the write. `total` = a written-token count
 * that is not a token count at all.
 */
var _anomalies = { split: 0, total: 0 };

function cacheCreationCost(usage, price, rec) {
  // `|| 0` would fold NaN into a legitimate zero, so the raw value is inspected first.
  const raw = usage?.cache_creation_input_tokens;
  if (raw === undefined || raw === null) return 0;   // no cache write — not an anomaly
  // A corrupt total cannot be priced. Returning 0 states that, and guessing would put a
  // number into a forensic artifact that no record supports — but returning it SILENTLY
  // would make a broken record indistinguishable from a request that simply wrote no
  // cache, and the difference is exactly what a cost audit needs [CWE-345]
  // [NIST SP 800-53 SI-7].
  if (!isTokenCount(raw)) { _anomalies.total++; return 0; }
  const total = raw;
  if (total === 0) return 0;
  // Two spellings reach this function: the family table writes cache_creation /
  // cache_creation_1h, a rate card writes cache_write_5m / cache_write_1h. Reading both
  // here is what let the cost path move onto dated cards without rewriting the ladder
  // below, which is the part that must not be touched twice.
  const rate5m = price.cache_write_5m ?? price.cache_creation;
  const rate1h = price.cache_write_1h ?? price.cache_creation_1h ?? rate5m;

  // Best evidence first: the per-tier token split — but only when it actually PARTITIONS
  // the write. A sum that disagrees with cache_creation_input_tokens is not a mix that can
  // be priced: too small and the remainder would be billed at zero, too large and we would
  // invent tokens that were never written. Either way the shape is wrong, so it is not used
  // as evidence at all and the ladder falls through to the tier marker [CWE-345]
  // [NIST SP 800-53 SI-7].
  const t1h = rec?.ephemeral_1h_input_tokens;
  const t5m = rec?.ephemeral_5m_input_tokens;
  const hasSplit = t1h !== undefined || t5m !== undefined;
  if (isTokenCount(t1h) && isTokenCount(t5m) && (t1h + t5m) === total) {
    return (t1h * rate1h + t5m * rate5m) / 1e6;
  }
  // Present but unusable. Counted rather than silently dropped: a split that stops
  // reconciling is a data-integrity signal about the log, not a routine fallback
  // [NIST SP 800-53 SI-7] [OWASP API10:2023].
  if (hasSplit) _anomalies.split++;
  // Next best: the record's own tier marker.
  if (rec?.ttl_tier === '1h') return (total * rate1h) / 1e6;
  // Neither present — an older record. The 5m rate is the LOWER of the two, so an
  // unattributable write is under-, not over-charged: a cost view may not invent spend.
  return (total * rate5m) / 1e6;
}

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
 * @param {object} [opts] - { priceOf(model, day) } injects the dated rate-card resolver.
 *                          Omitted, the processor behaves exactly as it did before.
 * @returns {Function} line processor: function(line)
 */
/** The day a record belongs to, from its own timestamp. Empty when it carries none. */
function recDay(rec) {
  return String(rec?.ts_end || rec?.ts_start || '').slice(0, 10);
}

function createQuotaDivisorLineProcessor(PRICE, qfDate, requestPairs, opts) {
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
    // The dated resolver when the caller injected one, the family table otherwise —
    // so this module keeps its promise of pure domain logic with no file I/O, and the
    // route that does read files is the one that supplies the resolver.
    const dated = opts?.priceOf ? opts.priceOf(rec.response_model, recDay(rec)) : null;
    const price = dated || priceForModel(rec.response_model) || PRICE;
    const cost =
      (cr * price.cache_read) / 1e6 +
      cacheCreationCost(u, price, rec) +
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
  recDay: recDay,
  cacheCreationCost: cacheCreationCost,
  /** Cost-input anomalies seen since the last reset: { split, total }. */
  getCacheSplitAnomalies: function () { return { split: _anomalies.split, total: _anomalies.total }; },
  resetCacheSplitAnomalies: function () { _anomalies = { split: 0, total: 0 }; },
  MODEL_PRICING: MODEL_PRICING
};

