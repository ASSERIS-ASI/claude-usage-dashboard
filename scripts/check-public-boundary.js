#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var path = require('node:path');

var root = path.resolve(__dirname, '..');
var ignored = new Set(['.git', 'node_modules', 'coverage', 'state', 'tmp']);
var forbiddenFiles = [
  /^server\.js$/i,
  /^start\.js$/i,
  /^anthropic-proxy\.js$/i,
  /^apps\/backend\/proxy\//i,
  /^apps\/backend\/runtime\/proxy/i,
  /^apps\/backend\/entrypoints\/proxy/i,
  /^apps\/backend\/infra\/auth\//i,
  /^apps\/backend\/server\/routes\/auth/i,
  /^apps\/backend\/server\/routes\/sync/i
];
var forbiddenText = [
  { re: /\/api\/gateway-config\b/i, label: 'gateway control API' },
  { re: /\/api\/serializer-stats\b/i, label: 'serializer control API' },
  { re: /\bCLAUDE_GATEWAY_ENABLED\b/i, label: 'gateway runtime flag' },
  { re: /\bclaude-data-sync\b/i, label: 'remote log sync' },
  { re: /\/auth\/login-page\b/i, label: 'removed auth UI' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: 'private key material' }
];
var textExtensions = new Set([
  '.js', '.json', '.md', '.html', '.tpl', '.css', '.svg',
  '.yml', '.yaml', '.txt', '.xml', '.dockerignore', '.gitignore'
]);
var textNames = new Set([
  'Dockerfile', 'Jenkinsfile', 'LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES'
]);
var failures = [];

function walk(dir) {
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    var absolute = path.join(dir, entry.name);
    var relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (forbiddenFiles.some(function (pattern) { return pattern.test(relative); })) {
      failures.push(relative + ': forbidden operational path');
    }
    // The checker and the negative runtime smoke test necessarily contain the
    // forbidden signatures they enforce.
    if (relative === 'scripts/check-public-boundary.js' || relative === 'scripts/smoke-test.js') continue;
    var extension = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(extension) &&
        !textNames.has(entry.name) &&
        !entry.name.startsWith('.')) continue;
    var text;
    try { text = fs.readFileSync(absolute, 'utf8'); } catch (error) { continue; }
    for (var rule of forbiddenText) {
      if (rule.re.test(text)) failures.push(relative + ': ' + rule.label);
    }
  }
}

walk(root);

if (failures.length) {
  console.error('Public product boundary failed:');
  for (var failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log('Public product boundary: OK');
