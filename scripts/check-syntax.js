#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var path = require('node:path');
var cp = require('node:child_process');

var root = path.resolve(__dirname, '..');
var ignored = new Set(['.git', 'node_modules', 'coverage', 'state', 'tmp']);
var files = [];

function walk(dir) {
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    var absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name.endsWith('.js')) files.push(absolute);
  }
}

walk(root);
for (var file of files) {
  var check = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.stdout || ('Syntax check failed: ' + file + '\n'));
    process.exit(check.status || 1);
  }
}

console.log('JavaScript syntax: OK (' + files.length + ' files)');
