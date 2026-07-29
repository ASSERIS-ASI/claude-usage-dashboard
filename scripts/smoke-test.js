#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var net = require('node:net');
var cp = require('node:child_process');

var root = path.resolve(__dirname, '..');
var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-dashboard-smoke-'));
var child;
var output = '';

function freePort() {
  return new Promise(function (resolve, reject) {
    var server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

function stop() {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
}

async function request(url, options) {
  var lastError;
  for (var attempt = 0; attempt < 60; attempt++) {
    try {
      var response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
  }
  throw lastError || new Error('server did not start');
}

(async function () {
  var port = await freePort();
  var agentPort = await freePort();
  var env = Object.assign({}, process.env, {
    CLAUDE_USAGE_HOST: '127.0.0.1',
    CLAUDE_USAGE_STATE_DIR: path.join(temporary, 'state'),
    CLAUDE_CONFIG_DIR: path.join(temporary, 'claude'),
    CLAUDE_USAGE_JSONL_AGENT_PORT: String(agentPort),
    CLAUDE_USAGE_PARSE_START_DELAY_MS: '0',
    CLAUDE_USAGE_LOG_LEVEL: 'error'
  });
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  child = cp.spawn(process.execPath, ['dashboard.js', '--port=' + port], {
    cwd: root,
    env: env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (chunk) { output += chunk; });
  child.stderr.on('data', function (chunk) { output += chunk; });

  var base = 'http://127.0.0.1:' + port;
  var capabilitiesResponse = await request(base + '/api/product-capabilities');
  if (!capabilitiesResponse.ok) throw new Error('capabilities endpoint returned ' + capabilitiesResponse.status);
  var capabilities = await capabilitiesResponse.json();
  if (capabilities.read_only_evidence !== true) throw new Error('read_only_evidence must be true');
  var capabilityKeys = [
    'product', 'profile', 'read_only_evidence', 'source_mode',
    'source_selection', 'setup_configured', 'evidence_sources'
  ];
  var unexpectedCapability = Object.keys(capabilities).find(function (key) {
    return !capabilityKeys.includes(key);
  });
  if (unexpectedCapability) throw new Error('unexpected capability field: ' + unexpectedCapability);
  if (capabilities.source_mode !== 'additive') {
    throw new Error('source_mode must describe additive source selection');
  }
  if (capabilities.source_selection?.claude_jsonl !== true ||
      capabilities.source_selection?.cache_fix !== false ||
      capabilities.source_selection?.meter !== false) {
    throw new Error('default source selection is invalid');
  }
  if (capabilities.evidence_sources.join(',') !== 'claude-jsonl') {
    throw new Error('unexpected default evidence sources');
  }
  if (capabilitiesResponse.headers.has('access-control-allow-origin')) {
    throw new Error('capabilities endpoint exposed a cross-origin policy');
  }

  var crossOrigin = await fetch(base + '/api/debug/cache-files', {
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site'
    }
  });
  if (crossOrigin.status !== 403) throw new Error('cross-origin API request returned ' + crossOrigin.status);

  var status = await (await fetch(base + '/api/debug/status')).json();
  if (status.local !== true || status.read_only_sources !== true) {
    throw new Error('local diagnostic contract failed');
  }

  var htmlResponse = await fetch(base + '/');
  var html = await htmlResponse.text();
  if (!htmlResponse.ok || !/<!DOCTYPE html>/i.test(html) || !/Claude Usage Dashboard/i.test(html)) {
    throw new Error('dashboard HTML was not served');
  }
  if (!htmlResponse.headers.get('content-security-policy')?.includes("script-src 'self' 'nonce-")) {
    throw new Error('nonce-bound Content Security Policy missing');
  }
  if (htmlResponse.headers.get('x-frame-options') !== 'DENY') {
    throw new Error('frame protection missing');
  }
  if (/__[A-Z0-9_]+__/.test(html)) throw new Error('unresolved template placeholder in dashboard HTML');
  if (/https?:\/\/(?:cdn\.|fonts\.googleapis|code\.jquery)/i.test(html)) {
    throw new Error('dashboard HTML contains a remote browser dependency');
  }

  for (var asset of [
    '/assets/vendor/dataTables.min.js',
    '/assets/vendor/dataTables.min.css',
    '/assets/vendor/echarts.min.js',
    '/assets/vendor/marked.umd.js',
    '/assets/vendor/purify.min.js',
    '/assets/core/safe-markdown.js',
    '/assets/vendor/cinzel-latin-400-normal.woff2'
  ]) {
    var assetResponse = await fetch(base + asset);
    if (!assetResponse.ok) throw new Error(asset + ' returned ' + assetResponse.status);
  }

  for (var removed of ['/api/gateway-config', '/api/serializer-stats', '/api/claude-data-sync']) {
    var removedResponse = await fetch(base + removed);
    if (removedResponse.status !== 404) throw new Error(removed + ' returned ' + removedResponse.status);
  }
  var proxyShape = await fetch(base + '/v1/messages', { method: 'POST', body: '{}' });
  if (proxyShape.status !== 404) throw new Error('/v1/messages returned ' + proxyShape.status);

  console.log('Runtime smoke test: OK');
})().catch(function (error) {
  console.error('Runtime smoke test failed: ' + error.message);
  if (output) console.error(output.slice(-4000));
  process.exitCode = 1;
}).finally(function () {
  stop();
  var resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
