'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var adapter = require('../../apps/backend/app/cache-fix-usage-adapter');
var quotaAttribution = require('../../apps/backend/app/quota-attribution');

var HOUR = 60 * 60 * 1000;

function row(ts, fields) {
  return adapter.translate(Object.assign({
    ts: ts,
    model: 'claude-sonnet-5',
    input_tokens: 1,
    output_tokens: 1
  }, fields), 'claude-code-cache-fix');
}

function build(rows) {
  var accumulator = quotaAttribution.createAccumulator();
  for (var record of rows) accumulator.add(record);
  return accumulator.build();
}

test('an empty qclaim attributes nothing and reports the whole meter as unattributed', function () {
  var result = build([
    row('2026-09-20T10:05:00.000Z', { q5h: 0.2, q7d: 0.1, qclaim: '' }),
    row('2026-09-20T10:40:00.000Z', { q5h: 0.3, q7d: 0.12, qclaim: '' })
  ]);

  assert.equal(result.attribution_available, false);
  assert.equal(result.claims, 0);
  assert.deepEqual(result.meters.q5h.points, [
    { hour: '2026-09-20T10:00:00.000Z', cumulative: 0.3, attributed: 0, unattributed: 0.3 }
  ]);
  assert.equal(result.meters.q7d.points[0].unattributed, 0.12);
});

test('numeric claims inside the meter window are attributed, the rest is unattributed', function () {
  var result = build([
    row('2026-09-20T10:00:00.000Z', { q5h: 0.1, qclaim: 0.05 }),
    row('2026-09-20T11:00:00.000Z', { q5h: 0.4, qclaim: '0.1' })
  ]);

  assert.equal(result.attribution_available, true);
  var last = result.meters.q5h.points.at(-1);
  assert.equal(last.cumulative, 0.4);
  assert.equal(last.attributed, 0.15);
  assert.equal(last.unattributed, 0.25);
});

test('claims before the window start reported by the reset header are not attributed', function () {
  // Reset at 16:00 means the 5h window began at 11:00; the 10:30 claim belongs
  // to the previous window.
  var reset = Date.parse('2026-09-20T16:00:00.000Z') / 1000;
  var result = build([
    row('2026-09-20T10:30:00.000Z', { q5h: 0.9, qclaim: 0.3, q5h_reset: reset - 5 * 3600 }),
    row('2026-09-20T12:00:00.000Z', { q5h: 0.2, qclaim: 0.05, q5h_reset: reset })
  ]);

  var last = result.meters.q5h.points.at(-1);
  assert.equal(last.attributed, 0.05);
  assert.equal(last.unattributed, 0.15);
});

test('attributed is clamped to the meter and never turns unattributed negative', function () {
  var result = build([
    row('2026-09-20T10:00:00.000Z', { q5h: 0.1, qclaim: 0.08 }),
    row('2026-09-20T10:30:00.000Z', { q5h: 0.1, qclaim: 0.08 })
  ]);

  var point = result.meters.q5h.points[0];
  assert.equal(point.attributed, 0.1);
  assert.equal(point.unattributed, 0);
});

test('one point per clock hour, taken from the newest observation', function () {
  var start = Date.parse('2026-09-20T00:00:00.000Z');
  var rows = [];
  for (var minute = 0; minute < 180; minute += 15) {
    rows.push(row(new Date(start + minute * 60000).toISOString(), { q5h: minute / 1000 }));
  }
  var points = build(rows).meters.q5h.points;

  assert.equal(points.length, 3);
  assert.equal(points[0].cumulative, 0.045);
  assert.equal(Date.parse(points[2].hour) - Date.parse(points[0].hour), 2 * HOUR);
});

test('qclaim is read only as a real number', function () {
  assert.equal(quotaAttribution.claimOf(''), null);
  assert.equal(quotaAttribution.claimOf('five_hour'), null);
  assert.equal(quotaAttribution.claimOf(-0.1), null);
  assert.equal(quotaAttribution.claimOf(Number.NaN), null);
  assert.equal(quotaAttribution.claimOf('0.25'), 0.25);
  assert.equal(quotaAttribution.claimOf(0), 0);
});

test('records without a meter reading or timestamp are ignored', function () {
  var accumulator = quotaAttribution.createAccumulator();
  accumulator.add(null);
  accumulator.add({ ts_start: 'not a date' });
  accumulator.add(row('2026-09-20T09:00:00.000Z', {}));          // no meter reading
  accumulator.add(row('2026-09-20T10:00:00.000Z', { q5h: 0 }));
  var result = accumulator.build();

  assert.equal(result.observations, 1);
  assert.deepEqual(result.meters.q5h.points.map(function (p) { return p.cumulative; }), [0]);
});

test('the adapter carries qclaim through translation and merge', function () {
  var base = { ts: '2026-09-20T10:00:00.000Z', model: 'claude-sonnet-5', request_id: 'r1' };
  var cacheFix = adapter.translate(Object.assign({ qclaim: '' }, base), 'claude-code-cache-fix');
  var meter = adapter.translate(Object.assign({ qclaim: 0.02 }, base), 'claude-code-meter');

  assert.equal(cacheFix.quota_claim, null);
  assert.equal(adapter.mergeTranslated(cacheFix, meter).quota_claim, 0.02);
});
