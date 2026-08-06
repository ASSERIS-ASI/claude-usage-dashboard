'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var setup = require('../../apps/backend/app/product-setup');
var scanRoots = require('../../apps/backend/domain/usage/scan-roots');

function withProductState(run) {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-request-source-test-'));
  var previousState = process.env.CLAUDE_USAGE_STATE_DIR;
  var previousProduct = process.env.ASSERIS_PRODUCT;
  process.env.CLAUDE_USAGE_STATE_DIR = path.join(temporary, 'state');
  process.env.ASSERIS_PRODUCT = 'dashboard';
  try {
    run(temporary);
  } finally {
    if (previousState == null) delete process.env.CLAUDE_USAGE_STATE_DIR;
    else process.env.CLAUDE_USAGE_STATE_DIR = previousState;
    if (previousProduct == null) delete process.env.ASSERIS_PRODUCT;
    else process.env.ASSERIS_PRODUCT = previousProduct;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('the dashboard does not probe request logs while the source is off', function () {
  withProductState(function (temporary) {
    setup.write({
      sources: { claude_jsonl: true },
      subscription: 'pro',
      language: 'en',
      log_roots: [temporary]
    });
    assert.equal(scanRoots.getProxyLogDir(), '');
    assert.deepEqual(scanRoots.collectProxyNdjsonFiles(), []);
  });
});

test('the dashboard reads the configured directory once the source is on', function () {
  withProductState(function (temporary) {
    var logs = path.join(temporary, 'request-logs');
    fs.mkdirSync(logs);
    fs.writeFileSync(path.join(logs, 'requests-2026-08-05.ndjson'), '{"ts":"2026-08-05T00:00:00Z"}\n', 'utf8');
    setup.write({
      sources: { claude_jsonl: true, request_ndjson: true },
      subscription: 'pro',
      language: 'en',
      log_roots: [temporary],
      request_log_dir: logs
    });
    assert.equal(scanRoots.getProxyLogDir(), logs);
    assert.equal(scanRoots.collectProxyNdjsonFiles()[0], path.join(logs, 'requests-2026-08-05.ndjson'));
    assert.equal(scanRoots.collectProxyNdjsonFiles().length, 1);
  });
});

test('other products keep the environment-driven discovery', function () {
  var previousProduct = process.env.ASSERIS_PRODUCT;
  delete process.env.ASSERIS_PRODUCT;
  try {
    assert.notEqual(scanRoots.getProxyLogDir(), '');
    assert.ok(scanRoots.getProxyLogDir().endsWith('anthropic-proxy-logs'));
  } finally {
    if (previousProduct != null) process.env.ASSERIS_PRODUCT = previousProduct;
  }
});
