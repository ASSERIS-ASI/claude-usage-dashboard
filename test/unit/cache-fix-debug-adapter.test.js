'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var adapter = require('../../apps/backend/app/cache-fix-debug-adapter');

test('classifies dynamic cache-fix applications', function () {
  var event = adapter.parseLine('[2026-07-29T10:00:00Z] APPLIED: cache_control_sticky');
  assert.equal(event.kind, 'applied');
  assert.equal(event.fix, 'cache_control_sticky');
  assert.equal(event.hour, 10);
});

test('parses cache TTL telemetry', function () {
  var event = adapter.parseLine(
    '[2026-07-29T10:00:00Z] CACHE TTL: tier=1h create=250 read=9750 hit=97.5%'
  );
  assert.deepEqual(event.cache_ttl, {
    tier: '1h',
    creation_tokens: 250,
    read_tokens: 9750,
    hit_rate: 0.975
  });
});
