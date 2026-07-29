'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var adapter = require('../../apps/backend/app/cache-fix-usage-adapter');

test('translates MeterRow v1 usage and quota fields into read-only telemetry', function () {
  var row = adapter.translate({
    ts: '2026-07-29T10:00:00.000Z',
    model: 'claude-sonnet-5',
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_input_tokens: 30,
    cache_read_input_tokens: 70,
    q5h: 0.32,
    q7d_pct: 19,
    sid: 'session-1',
    agent_id: 'agent-1'
  }, 'claude-code-meter');

  assert.equal(row.source, 'claude-code-meter');
  assert.equal(row.cache_read_ratio, 0.7);
  assert.equal(row.response_anthropic_headers['anthropic-ratelimit-unified-5h-utilization'], '0.32');
  assert.equal(row.response_anthropic_headers['anthropic-ratelimit-unified-7d-utilization'], '0.19');
  assert.equal(row.meter_session_id, 'session-1');
  assert.equal(row.agent_id, 'agent-1');
});

test('rejects rows without timestamp or model', function () {
  assert.equal(adapter.translate({ model: 'claude-sonnet-5' }), null);
  assert.equal(adapter.translate({ ts: '2026-07-29T10:00:00.000Z' }), null);
});

test('merges duplicate Cache Fix and Meter rows without summing usage', function () {
  var base = {
    ts: '2026-07-29T10:00:00.000Z',
    model: 'claude-opus-5',
    request_id: 'request-42',
    output_tokens: 100,
    cache_read_input_tokens: 300000,
    cache_creation_input_tokens: 2000,
    ttl_tier: '1h'
  };
  var cacheFix = adapter.translate(base, 'claude-code-cache-fix');
  var meter = adapter.translate(Object.assign({}, base, {
    sid: 'session-42',
    agent_id: 'agent-7',
    agent_id_source: 'explicit'
  }), 'claude-code-meter');
  var merged = adapter.mergeTranslated(cacheFix, meter);

  assert.equal(merged.req_id, 'request-42');
  assert.equal(merged.usage.output_tokens, 100);
  assert.equal(merged.usage.cache_read_input_tokens, 300000);
  assert.equal(merged.ttl_tier, '1h');
  assert.equal(merged.meter_session_id, 'session-42');
  assert.equal(merged.agent_id, 'agent-7');
  assert.deepEqual(merged.evidence_sources, [
    'claude-code-cache-fix',
    'claude-code-meter'
  ]);
});

test('preserves account scope and keeps identical request IDs separate across accounts', function () {
  var base = {
    ts: '2026-07-29T10:00:00.000Z',
    model: 'claude-opus-5',
    request_id: 'shared-request-id'
  };
  var first = adapter.translate(Object.assign({}, base, {
    org_id: '0011223344556677'
  }), 'claude-code-cache-fix');
  var same = adapter.translate(Object.assign({}, base, {
    org_id: '0011223344556677'
  }), 'claude-code-meter');
  var second = adapter.translate(Object.assign({}, base, {
    org_id: '8899aabbccddeeff'
  }), 'claude-code-meter');

  assert.equal(first.account_key, 'acct:0011223344556677');
  assert.equal(second.account_key, 'acct:8899aabbccddeeff');
  assert.equal(adapter.accountsCanMerge(first, same), true);
  assert.equal(adapter.accountsCanMerge(first, second), false);
});

test('marks rows without an organization hash as explicitly unassigned', function () {
  var base = {
    ts: '2026-07-29T10:00:00.000Z',
    model: 'claude-sonnet-5'
  };

  assert.equal(
    adapter.translate(base, 'claude-code-cache-fix').account_key,
    'unassigned:cache-fix'
  );
  assert.equal(
    adapter.translate(base, 'claude-code-meter').account_key,
    'unassigned:meter'
  );
});
