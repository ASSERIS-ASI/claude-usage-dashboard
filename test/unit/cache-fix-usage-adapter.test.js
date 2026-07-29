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
