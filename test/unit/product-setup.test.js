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
      sources: { claude_jsonl: true, cache_fix: false, meter: false },
      subscription: 'pro',
      language: 'en',
      log_roots: [temporary],
      include_subagents: true,
      model_colors: { opus: '#123456', sonnet: 'invalid' }
    });
    assert.equal(status.configured, true);
    assert.equal(status.mode, 'local');
    assert.deepEqual(status.sources, {
      claude_jsonl: true,
      cache_fix: false,
      meter: false
    });
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

test('persists Cache Fix and Claude Code Meter as additive sources', function () {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-setup-additive-test-'));
  var previous = process.env.CLAUDE_USAGE_STATE_DIR;
  process.env.CLAUDE_USAGE_STATE_DIR = path.join(temporary, 'state');
  try {
    var status = setup.write({
      sources: { claude_jsonl: true, cache_fix: true, meter: true },
      subscription: 'max20',
      language: 'de',
      log_roots: [temporary]
    });
    assert.equal(status.mode, 'combined');
    assert.deepEqual(status.enabled_sources, ['claude_jsonl', 'cache_fix', 'meter']);
    assert.equal(setup.read().version, 2);
  } finally {
    if (previous == null) delete process.env.CLAUDE_USAGE_STATE_DIR;
    else process.env.CLAUDE_USAGE_STATE_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('maps legacy source modes to additive selections', function () {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-setup-legacy-test-'));
  var previous = process.env.CLAUDE_USAGE_STATE_DIR;
  process.env.CLAUDE_USAGE_STATE_DIR = path.join(temporary, 'state');
  try {
    fs.mkdirSync(setup.stateDir(), { recursive: true });
    fs.writeFileSync(setup.setupFile(), JSON.stringify({
      version: 1,
      mode: 'meter',
      subscription: 'pro',
      language: 'en',
      meter_usage: path.join(temporary, 'claude-meter.jsonl')
    }));
    var value = setup.read();
    assert.equal(value.mode, 'meter');
    assert.deepEqual(value.sources, {
      claude_jsonl: true,
      cache_fix: false,
      meter: true
    });
  } finally {
    if (previous == null) delete process.env.CLAUDE_USAGE_STATE_DIR;
    else process.env.CLAUDE_USAGE_STATE_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects a setup without a source selection', function () {
  assert.throws(function () {
    setup.write({ subscription: 'pro', language: 'en' });
  }, /sources must select Claude JSONL/);
});
