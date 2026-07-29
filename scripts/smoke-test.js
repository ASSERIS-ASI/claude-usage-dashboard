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
  if (process.platform === 'win32') {
    cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } else {
    child.kill('SIGTERM');
  }
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
  for (var key of ['gateway_runtime', 'proxy_control', 'mitm_ca', 'serializer_control', 'request_rewrites']) {
    if (capabilities[key] !== false) throw new Error(key + ' must be false');
  }
  if (capabilities.read_only_evidence !== true) throw new Error('read_only_evidence must be true');

  var status = await (await fetch(base + '/api/debug/status')).json();
  if (status.local !== true || status.read_only_sources !== true) {
    throw new Error('local diagnostic contract failed');
  }

  var htmlResponse = await fetch(base + '/');
  var html = await htmlResponse.text();
  if (!htmlResponse.ok || !/<!DOCTYPE html>/i.test(html) || !/Claude Usage Dashboard/i.test(html)) {
    throw new Error('dashboard HTML was not served');
  }
  if (/__[A-Z0-9_]+__/.test(html)) throw new Error('unresolved template placeholder in dashboard HTML');

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
