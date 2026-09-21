/**
 * @asseris-module       Parser Dated Cost Test
 * @asseris-description  Guards that the day aggregate is costed from the record's own date
 *                       and that the day total is the sum of its own model rows.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

var parser = require('../../apps/backend/app/proxy-ndjson-parser');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dated-cost-test-'));

/** One inference record, shaped as the proxy writes it. */
function record(day, model, usage, extra) {
  return Object.assign({
    ts_start: day + 'T10:00:00.000Z',
    ts_end: day + 'T10:00:02.000Z',
    path: '/v1/messages',
    upstream_status: 200,
    response_model: model,
    duration_ms: 2000,
    usage: usage
  }, extra || {});
}

function writeDay(day, records) {
  var file = path.join(TMP, 'proxy-' + day + '.ndjson');
  fs.writeFileSync(file, records.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n', 'utf8');
  return file;
}

function dayOf(result, key) {
  return result.proxy_days.find(function (d) { return d.date === key; });
}

test('a day total equals the sum of its own model rows', function () {
  // The day total used to be re-derived from the model token sums with its own price
  // lookup, and that second computation priced every cache write at the 5m rate while the
  // per-record path resolved the TTL tier. The two answers for the same day disagreed by up
  // to 60 % of the write. Summing what was already priced is what makes them one number.
  var file = writeDay('2026-09-15', [
    record('2026-09-15', 'claude-opus-5', {
      input_tokens: 1000, output_tokens: 2000,
      cache_read_input_tokens: 500000, cache_creation_input_tokens: 100000
    }, { ttl_tier: '1h' }),
    record('2026-09-15', 'claude-sonnet-5', {
      input_tokens: 5000, output_tokens: 1000,
      cache_read_input_tokens: 20000, cache_creation_input_tokens: 4000
    }),
    record('2026-09-15', 'claude-haiku-4-5-20251001', {
      input_tokens: 800, output_tokens: 300,
      cache_read_input_tokens: 1000, cache_creation_input_tokens: 0
    })
  ]);

  var day = dayOf(parser.parseProxyNdjsonFiles({ files: [file], latestDayFull: false }), '2026-09-15');
  assert.ok(day, 'the day was not aggregated');

  var summed = Object.keys(day.models).reduce(function (acc, model) {
    return acc + day.models[model].estimated_cost_usd;
  }, 0);
  assert.ok(
    Math.abs(day.estimated_cost.total - summed) < 0.0001,
    'day total ' + day.estimated_cost.total + ' does not match the sum of its models ' + summed
  );
});

test('a 1h cache write is costed at the 1h rate in the day total', function () {
  // The aggregate path had no access to the tier at all, so this was the 5m rate no matter
  // what the record said — and the auto-mode classifier writes exclusively on 1h.
  var tokens = 1000000;
  var at1h = writeDay('2026-09-16', [
    record('2026-09-16', 'claude-opus-5', { cache_creation_input_tokens: tokens }, { ttl_tier: '1h' })
  ]);
  var at5m = writeDay('2026-09-17', [
    record('2026-09-17', 'claude-opus-5', { cache_creation_input_tokens: tokens }, { ttl_tier: '5m' })
  ]);

  var d1h = dayOf(parser.parseProxyNdjsonFiles({ files: [at1h], latestDayFull: false }), '2026-09-16');
  var d5m = dayOf(parser.parseProxyNdjsonFiles({ files: [at5m], latestDayFull: false }), '2026-09-17');

  // Opus 5: 10.00 per MTok on the 1h tier, 6.25 on the 5m tier.
  assert.equal(d1h.estimated_cost.cache_creation, 10);
  assert.equal(d5m.estimated_cost.cache_creation, 6.25);
});

test('the same request costs what its own day charged, not what today charges', function () {
  // Sonnet 5 ran at an introductory 2/10 through 2026-08-31. An undated table bills both
  // days alike; measured here, 18803 real requests fall on the cheaper side of that line.
  var usage = { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  var august = writeDay('2026-08-15', [record('2026-08-15', 'claude-sonnet-5', usage)]);
  var september = writeDay('2026-09-18', [record('2026-09-18', 'claude-sonnet-5', usage)]);

  var dAug = dayOf(parser.parseProxyNdjsonFiles({ files: [august], latestDayFull: false }), '2026-08-15');
  var dSep = dayOf(parser.parseProxyNdjsonFiles({ files: [september], latestDayFull: false }), '2026-09-18');

  assert.equal(dAug.estimated_cost.input, 2, 'a August record must carry the introductory rate');
  assert.equal(dSep.estimated_cost.input, 3, 'a September record must carry the standard rate');
});

test('Opus 4 is not costed as Opus 5', function () {
  // The substring match answered every `opus` with one row, so the retired and dearest
  // generation was billed at a third of its published price.
  var usage = { input_tokens: 1000000 };
  var file = writeDay('2026-09-19', [
    record('2026-09-19', 'claude-opus-4-1-20250805', usage),
    record('2026-09-19', 'claude-opus-5', usage)
  ]);
  var day = dayOf(parser.parseProxyNdjsonFiles({ files: [file], latestDayFull: false }), '2026-09-19');
  assert.equal(day.models['claude-opus-4-1-20250805'].estimated_cost_usd, 15);
  assert.equal(day.models['claude-opus-5'].estimated_cost_usd, 5);
});

test('a day names what its money was computed with', function () {
  var file = writeDay('2026-09-14', [
    record('2026-09-14', 'claude-opus-5', { input_tokens: 100 })
  ]);
  var day = dayOf(parser.parseProxyNdjsonFiles({ files: [file], latestDayFull: false }), '2026-09-14');
  assert.ok(day.pricing, 'a day must state its pricing basis');
  assert.equal(day.pricing.records || 0, 0, 'a fully covered day reports no fallback');
});

test('a model with no card is priced from the family table and reported', function () {
  // The fallback keeps the figure from dropping to zero, but it is the undated family rate —
  // correct to the family, wrong to the model and wrong to the date. Saying so is the point.
  var file = writeDay('2026-09-13', [
    record('2026-09-13', 'claude-nonexistent-9', { input_tokens: 1000 })
  ]);
  var day = dayOf(parser.parseProxyNdjsonFiles({ files: [file], latestDayFull: false }), '2026-09-13');
  assert.ok(day.pricing.records > 0, 'an uncovered model must be counted');
  assert.ok(
    Object.keys(day.pricing.models).includes('claude-nonexistent-9'),
    'the uncovered model must be named so a card can be appended'
  );
});
