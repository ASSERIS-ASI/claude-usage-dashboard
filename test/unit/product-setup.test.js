'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var setup = require('../../apps/backend/app/product-setup');

test('persists a validated local setup with configured model colors', function () {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-setup-test-'));
  var previous = process.env.CLAUDE_USAGE_STATE_DIR;
  process.env.CLAUDE_USAGE_STATE_DIR = path.join(temporary, 'state');
  try {
    var status = setup.write({
      mode: 'local',
      subscription: 'pro',
      language: 'en',
      log_roots: [temporary],
      include_subagents: true,
      model_colors: { opus: '#123456', sonnet: 'invalid' }
    });
    assert.equal(status.configured, true);
    assert.equal(status.mode, 'local');
    assert.equal(status.subscription, 'pro');
    assert.equal(status.include_subagents, true);
    assert.equal(status.model_colors.opus, '#123456');
    assert.equal(status.model_colors.sonnet, '#f59e0b');
  } finally {
    if (previous == null) delete process.env.CLAUDE_USAGE_STATE_DIR;
    else process.env.CLAUDE_USAGE_STATE_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects unsupported source modes', function () {
  assert.throws(function () {
    setup.write({ mode: 'gateway', subscription: 'pro', language: 'en' });
  }, /mode must be local, cache-fix or meter/);
});
