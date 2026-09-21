'use strict';

/**
 * @asseris-module       Pricing Resolver
 * @asseris-description  Picks the rate a record is costed with: the dated card for its
 *                       model and day, or the undated family table when no card covers
 *                       it — and counts every time it has to fall back.
 * @asseris-pillar       decision
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-calls        Rate Cards, Quota Divisor
 * @asseris-emits        pricing_fallback_records, pricing_fallback_models
 * @asseris-consumes     response_model, record timestamp
 */

/**
 * Two price sources existed side by side, and the wrong one was doing the work.
 *
 * The dated cards in rate-cards.json name a rate per model id with the day it took
 * effect. The family table in quota-divisor.js resolves `opus` by substring and knows
 * no dates at all — so every Opus billed at Opus 5 rates, including Opus 4 at three
 * times that price, and Sonnet 5 billed at its post-introductory rate for records that
 * predate the change. The chart drew the cards while the cost path used the table, which
 * is how a published $15 and a computed $5 could sit on the same screen.
 *
 * This module is the single place that decides. The card wins; the family table is the
 * fallback, and a fallback is COUNTED — a missing card is a gap someone has to close,
 * and a silent fallback is how it stays open [NIST SP 800-53 SI-7].
 */

var rateCards = require('./rate-cards');
var quotaDivisor = require('./quota-divisor');

/**
 * The family row in the cards' spelling.
 *
 * The table writes cache writes as cache_creation/cache_creation_1h, the cards as
 * cache_write_5m/cache_write_1h. Translating once, here, is what lets everything
 * downstream read one shape without renaming arithmetic that works.
 */
function familyRates(model) {
  var row = quotaDivisor.priceForModel(model);
  if (!row) return null;
  return {
    input: row.input,
    output: row.output,
    cache_read: row.cache_read,
    cache_write_5m: row.cache_creation,
    cache_write_1h: row.cache_creation_1h,
    cache_creation: row.cache_creation,
    cache_creation_1h: row.cache_creation_1h
  };
}

/** The row every unrecognised model has always been priced with. Kept, so nothing drops to zero. */
var LAST_RESORT = familyRates('claude-opus-4-8');

/**
 * Fallbacks since the last reset, per day and in total. Deliberately NOT merged into the
 * cache-split anomaly counter in quota-divisor: that one measures whether the log is
 * internally consistent, this one measures whether the card history covers what we serve.
 * A single number would answer neither question.
 */
var _misses = { records: 0, models: Object.create(null), days: Object.create(null) };

function countMiss(day, model) {
  var name = String(model || 'unknown');
  _misses.records++;
  _misses.models[name] = (_misses.models[name] || 0) + 1;
  var bucket = _misses.days[day];
  if (!bucket) bucket = _misses.days[day] = { records: 0, models: Object.create(null) };
  bucket.records++;
  bucket.models[name] = (bucket.models[name] || 0) + 1;
}

/**
 * The rate row for one record, and where it came from.
 *
 * @param {string} model response_model as served
 * @param {string} day   the record's own day — an undated record cannot be priced from a
 *                       dated history, so it counts as a miss rather than borrowing today
 * @param {object} [opts] { billable } — false suppresses the miss count for a record that
 *                       carries no tokens and therefore needs no rate
 * @returns {{rates:object, source:'card'|'family'|'last-resort', card_id:string|null}}
 */
function ratesFor(model, day, opts) {
  var card = rateCards.ratesFor(model, day);
  if (card) return { rates: card.rates, source: 'card', card_id: card.card_id };

  // Only a record that actually costs something can be evidence of a missing card.
  // Counting every unpriced record flooded the signal: a single day reported 41189
  // fallbacks, of which the overwhelming majority were session and heartbeat events —
  // no tokens, no model, no price needed. A counter that fires on those cannot be read.
  if (!opts || opts.billable !== false) {
    countMiss(String(day || '').slice(0, 10) || 'undated', model);
  }
  var family = familyRates(model);
  if (family) return { rates: family, source: 'family', card_id: null };
  return { rates: LAST_RESORT, source: 'last-resort', card_id: null };
}

/**
 * What one record's usage costs, in USD, split by token class.
 *
 * The cache-write part is delegated to quota-divisor's cacheCreationCost, which carries
 * the whole evidence ladder — the per-tier token split when it partitions the write, then
 * the record's ttl_tier marker, then the 5m rate as the lower of the two. Reimplementing
 * that here is exactly how the two paths drifted apart the first time.
 *
 * @param {object} usage record usage block
 * @param {object} rates a row from ratesFor()
 * @param {object} [rec] the record — carries the cache-write TTL tier
 */
function usageCostBreakdown(usage, rates, rec) {
  if (!usage || !rates) return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  return {
    input: (usage.input_tokens || 0) * rates.input / 1e6,
    output: (usage.output_tokens || 0) * rates.output / 1e6,
    cache_read: (usage.cache_read_input_tokens || 0) * rates.cache_read / 1e6,
    cache_creation: quotaDivisor.cacheCreationCost(usage, rates, rec)
  };
}

/** Resolve and cost in one call — what the parser wants at each of its cost points. */
function costFor(usage, model, day, rec) {
  // A record with no tokens has no cost, whatever rate would apply — so a missing card
  // is not a finding about it.
  var billable = !!usage && (
    (usage.input_tokens || 0) > 0 || (usage.output_tokens || 0) > 0 ||
    (usage.cache_read_input_tokens || 0) > 0 || (usage.cache_creation_input_tokens || 0) > 0
  );
  var resolved = ratesFor(model, day, { billable: billable });
  var parts = usageCostBreakdown(usage, resolved.rates, rec);
  parts.price_source = resolved.source;
  parts.card_id = resolved.card_id;
  return parts;
}

/** Fallbacks recorded for one day, or null when that day needed none. */
function missesFor(day) {
  var bucket = _misses.days[String(day || '').slice(0, 10)];
  if (!bucket) return null;
  return { records: bucket.records, models: { ...bucket.models } };
}

/** Fallbacks across the whole pass, for the one-line warning a parse run emits. */
function missTotals() {
  return { records: _misses.records, models: { ..._misses.models } };
}

/** Called once per parse pass, so a count belongs to exactly one run. */
function resetMisses() {
  _misses = { records: 0, models: Object.create(null), days: Object.create(null) };
}

module.exports = {
  ratesFor: ratesFor,
  usageCostBreakdown: usageCostBreakdown,
  costFor: costFor,
  missesFor: missesFor,
  missTotals: missTotals,
  resetMisses: resetMisses
};
