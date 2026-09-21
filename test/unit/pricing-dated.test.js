/**
 * @asseris-module       Dated Pricing Test
 * @asseris-description  Guards that a cost figure is resolved from the card valid for the
 *                       record's own model and day, and that a missing card is counted
 *                       rather than silently absorbed.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var rateCards = require('../../apps/backend/domain/usage/rate-cards');
var pricing = require('../../apps/backend/domain/usage/pricing');

test('a served id with a date suffix resolves to the model it names', function () {
  // The pattern used to read the date as a minor version, so claude-opus-4-20250514 asked
  // for a card called "claude-opus-4-20250514" and no card has ever been called that. Opus 4
  // and Sonnet 4 were therefore unpriceable under the ids the API actually serves.
  assert.equal(rateCards.modelKey('claude-opus-4-20250514'), 'claude-opus-4');
  assert.equal(rateCards.modelKey('claude-sonnet-4-20250514'), 'claude-sonnet-4');
  // The ids that already worked must keep working — the fix may not narrow the mapping.
  assert.equal(rateCards.modelKey('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(rateCards.modelKey('claude-opus-4-1-20250805'), 'claude-opus-4-1');
  assert.equal(rateCards.modelKey('claude-opus-4.7'), 'claude-opus-4-7');
});

test('the Opus generations are told apart', function () {
  // The family table answers `opus` with one row, so Opus 4 was billed at Opus 5 rates —
  // a third of its real price, while the rate-history chart drew the published $15.
  assert.equal(pricing.ratesFor('claude-opus-4-1', '2026-09-20').rates.input, 15);
  assert.equal(pricing.ratesFor('claude-opus-4-20250514', '2026-09-20').rates.input, 15);
  assert.equal(pricing.ratesFor('claude-opus-4-0', '2026-09-20').rates.input, 15);
  assert.equal(pricing.ratesFor('claude-opus-5', '2026-09-20').rates.input, 5);
  assert.equal(pricing.ratesFor('claude-opus-4-8', '2026-09-20').rates.input, 5);
});

test('a record is priced with the rate in force on its own day', function () {
  // The Sonnet 5 introductory price ran through 2026-08-31. Measured on this installation:
  // 18803 requests fall before that date, and the undated table billed every one of them
  // 50 % over the rate that applied.
  assert.equal(pricing.ratesFor('claude-sonnet-5', '2026-08-15').rates.input, 2);
  assert.equal(pricing.ratesFor('claude-sonnet-5', '2026-08-31').rates.input, 2);
  assert.equal(pricing.ratesFor('claude-sonnet-5', '2026-09-01').rates.input, 3);
  assert.equal(pricing.ratesFor('claude-sonnet-5', '2026-09-15').rates.input, 3);
});

test('a model that reads cache at its own rate is not given the family rate', function () {
  // Fable 5.1 reads cache at 0.025x base input where every other model charges 0.1x.
  // Matched on the substring `fable` it inherited Fable 5's 1.00 and billed four times over.
  assert.equal(pricing.ratesFor('claude-fable-5-1', '2026-09-20').rates.cache_read, 0.25);
  assert.equal(pricing.ratesFor('claude-fable-5', '2026-09-20').rates.cache_read, 1);
  assert.equal(pricing.ratesFor('claude-haiku-3-5', '2026-09-20').rates.input, 0.8);
});

test('an undated record is not quietly billed at today\'s prices', function () {
  // cardAt('') answers with the NEWEST card, which is right for the chart and wrong for
  // money: a record that lost its timestamp would be costed at whatever today charges.
  var undated = pricing.ratesFor('claude-opus-5', '');
  assert.equal(undated.source, 'family', 'an undated record must not resolve to a card');
  assert.equal(rateCards.ratesFor('claude-opus-5', ''), null);
  assert.equal(rateCards.ratesFor('claude-opus-5', '2026-09'), null, 'a partial date is not a date');
});

test('a rate that no card covers falls back, and the fallback is counted', function () {
  pricing.resetMisses();
  assert.equal(pricing.missTotals().records, 0);

  // Before the first card there is no published rate to resolve.
  var old = pricing.ratesFor('claude-opus-5', '2026-01-01');
  assert.equal(old.source, 'family');
  // A model outside the catalogue entirely.
  assert.equal(pricing.ratesFor('gpt-4', '2026-09-20').source, 'last-resort');

  var totals = pricing.missTotals();
  assert.equal(totals.records, 2, 'every fallback is counted, not just the unknown model');
  assert.equal(totals.models['claude-opus-5'], 1);
  assert.equal(totals.models['gpt-4'], 1);
  assert.ok(pricing.missesFor('2026-01-01'), 'the miss is attributed to the day it happened');
  assert.equal(pricing.missesFor('2026-09-19'), null, 'a clean day reports nothing');

  pricing.resetMisses();
  assert.equal(pricing.missTotals().records, 0, 'a pass starts from zero');
});

test('a resolved price names the card it came from', function () {
  var resolved = pricing.ratesFor('claude-opus-5', '2026-09-20');
  assert.equal(resolved.source, 'card');
  assert.ok(resolved.card_id, 'a card-resolved price must say which card');
});

test('a resolved rate row cannot be mutated by a caller', function () {
  // The rows are memoised, so a caller that wrote to one would corrupt every later
  // computation in the process, and silently.
  var rates = pricing.ratesFor('claude-opus-5', '2026-09-20').rates;
  assert.throws(function () { 'use strict'; rates.input = 999; }, TypeError);
  assert.equal(pricing.ratesFor('claude-opus-5', '2026-09-20').rates.input, 5);
});

test('both cache-write spellings price a write identically', function () {
  // The cards write cache_write_5m/_1h, the family table cache_creation/_1h. One resolved
  // row carries both so the cost path did not have to rename its arithmetic.
  var usage = { cache_creation_input_tokens: 100000 };
  var rates = pricing.ratesFor('claude-sonnet-5', '2026-09-20').rates;
  assert.equal(rates.cache_write_5m, rates.cache_creation);
  assert.equal(rates.cache_write_1h, rates.cache_creation_1h);

  var at5m = pricing.usageCostBreakdown(usage, rates, {});
  var at1h = pricing.usageCostBreakdown(usage, rates, { ttl_tier: '1h' });
  assert.equal(at5m.cache_creation, 100000 * rates.cache_write_5m / 1e6);
  assert.equal(at1h.cache_creation, 100000 * rates.cache_write_1h / 1e6);
  assert.ok(at1h.cache_creation > at5m.cache_creation, 'the 1h tier is the dearer one');
});

test('the resolution is memoised well enough for a per-record hot path', function () {
  // Every priced record asks. Without the memo this re-read and re-parsed the NDJSON card
  // file per record, which is minutes of work across a day of proxy traffic.
  var started = Date.now();
  for (var i = 0; i < 50000; i++) pricing.ratesFor('claude-opus-5', '2026-09-20');
  var elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, '50k resolutions took ' + elapsed + 'ms — the memo is not working');
});
