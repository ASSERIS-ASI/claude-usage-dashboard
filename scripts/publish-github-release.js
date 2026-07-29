#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var https = require('node:https');
var path = require('node:path');

var tag = String(process.argv[2] || '').trim();
var token = String(process.env.GITHUB_MIRROR_TOKEN || '').trim();
var repository = 'ASSERIS-ASI/claude-usage-dashboard';

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error('Expected a semantic release tag, received: ' + tag);
  process.exit(1);
}
if (!token) {
  console.error('GITHUB_MIRROR_TOKEN is required');
  process.exit(1);
}

var notesPath = path.resolve(__dirname, '..', 'release-notes', tag + '.md');
if (!fs.existsSync(notesPath)) {
  console.error('Missing release notes: release-notes/' + tag + '.md');
  process.exit(1);
}

var payload = JSON.stringify({
  tag_name: tag,
  name: tag + ' — Standalone public dashboard',
  body: fs.readFileSync(notesPath, 'utf8'),
  draft: false,
  prerelease: tag.includes('-')
});

var request = https.request({
  hostname: 'api.github.com',
  path: '/repos/' + repository + '/releases',
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'User-Agent': 'asseris-gitea-release-mirror',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}, function (response) {
  var chunks = [];
  response.on('data', function (chunk) { chunks.push(chunk); });
  response.on('end', function () {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('Published GitHub release ' + tag);
      return;
    }
    var body = Buffer.concat(chunks).toString('utf8');
    if (response.statusCode === 422 && /already_exists|already exists/i.test(body)) {
      console.log('GitHub release ' + tag + ' already exists');
      return;
    }
    console.error('GitHub release API returned HTTP ' + response.statusCode);
    process.exitCode = 1;
  });
});

request.on('error', function (error) {
  console.error('GitHub release request failed: ' + error.message);
  process.exitCode = 1;
});
request.end(payload);
