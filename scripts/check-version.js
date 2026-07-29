#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var path = require('node:path');

var root = path.resolve(__dirname, '..');
var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
var versionFile = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
var history = JSON.parse(fs.readFileSync(path.join(root, 'public', 'release-history.json'), 'utf8'));
var changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
var version = String(pkg.version || '');
var tag = 'v' + version;
var failures = [];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  failures.push('package.json contains an invalid semantic version: ' + version);
}
if (versionFile !== tag) failures.push('VERSION must equal ' + tag);
if (lock.version !== version) failures.push('package-lock.json root version differs from package.json');
if (!lock.packages || !lock.packages[''] || lock.packages[''].version !== version) {
  failures.push('package-lock.json package version differs from package.json');
}
if (!Array.isArray(history) || !history.length || history[0].tag_name !== tag) {
  failures.push('public/release-history.json must start with ' + tag);
}
if (!changelog.includes('## [' + version + ']')) {
  failures.push('CHANGELOG.md has no section for ' + version);
}
if (!fs.existsSync(path.join(root, 'release-notes', tag + '.md'))) {
  failures.push('release-notes/' + tag + '.md is missing');
}

if (failures.length) {
  console.error('Version consistency failed:');
  for (var failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log('Version consistency: OK (' + tag + ')');
