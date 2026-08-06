'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var rateCards = require('../../apps/backend/domain/usage/rate-cards');

test('a record is costed with the card that was valid on its own day', function () {
  // Sonnet 5 ran on an introductory rate through 2026-08-31.
  var august = rateCards.priceFor('claude-sonnet-5', 'standard', '2026-08-15T10:00:00Z');
  var september = rateCards.priceFor('claude-sonnet-5', 'standard', '2026-09-15T10:00:00Z');

  assert.equal(august.rates.input, 2);
  assert.equal(august.rates.output, 10);
  assert.equal(september.rates.input, 3);
  assert.equal(september.rates.output, 15);
  assert.notEqual(august.card_id, september.card_id);
});

test('a model with no card for that date yields no price rather than a guess', function () {
  // The seeded history starts at the meter table, which predates Sonnet 5. We
  // know the model existed in July but not at which rate, and inventing one by
  // reaching forward to the August card is exactly what this history prevents.
  assert.equal(rateCards.priceFor('claude-sonnet-5', 'standard', '2026-07-15'), null);
  assert.ok(rateCards.priceFor('claude-opus-4-7', 'standard', '2026-07-15'));
});

test('a later card inherits every rate it does not restate', function () {
  var september = rateCards.priceFor('claude-haiku-4-5', 'standard', '2026-09-15');
  assert.equal(september.card_id, '2026-09-01-sonnet-5-standard');
  assert.equal(september.rates.input, 1);
  assert.equal(september.rates.output, 5);
});

test('every price carries the card it came from', function () {
  var price = rateCards.priceFor('claude-opus-4-7', 'standard', '2026-08-06');
  assert.ok(price.card_id);
  assert.ok(price.valid_from);
  assert.match(price.source_url, /^https:\/\//);
  assert.equal(price.confidence, 'published');
});

test('the fast tier falls back to standard where fast mode does not exist', function () {
  // Fast mode is offered for Opus 5 and 4.8 only; 4.7 rejects it outright.
  var opus5 = rateCards.priceFor('claude-opus-5', 'fast', '2026-08-06');
  assert.equal(opus5.tier, 'fast');
  assert.equal(opus5.rates.input, 10);

  var opus47 = rateCards.priceFor('claude-opus-4-7', 'fast', '2026-08-06');
  assert.equal(opus47.tier, 'standard');
  assert.equal(opus47.rates.input, 5);
});

test('dated and dotted model names resolve to the same card entry', function () {
  assert.equal(rateCards.modelKey('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(rateCards.modelKey('claude-opus-4.7'), 'claude-opus-4-7');
  assert.ok(rateCards.priceFor('claude-haiku-4-5-20251001', 'standard', '2026-08-06'));
});

test('the history exposes one point per card and the change dates', function () {
  var series = rateCards.history();
  assert.ok(series['claude-opus-4-7'].length >= 2);

  var changes = rateCards.changePoints();
  var dates = changes.map(function (change) { return change.valid_from; });
  assert.deepEqual(dates, dates.slice().sort());
  assert.ok(dates.includes('2026-09-01'));
  for (var change of changes) assert.ok(change.card_id && change.source);
});

test('an unknown model yields no price instead of a guessed one', function () {
  assert.equal(rateCards.priceFor('gpt-4o', 'standard', '2026-08-06'), null);
});
