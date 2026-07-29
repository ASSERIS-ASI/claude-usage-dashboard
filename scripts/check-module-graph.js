#!/usr/bin/env node
'use strict';

var fs = require('node:fs');
var path = require('node:path');

var root = path.resolve(__dirname, '..');
var backendRoot = path.join(root, 'apps', 'backend');
var files = [path.join(root, 'dashboard.js')];

function walk(dir) {
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    var absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name.endsWith('.js')) files.push(path.resolve(absolute));
  }
}

function resolveRelative(from, request) {
  var base = path.resolve(path.dirname(from), request);
  var candidates = [base, base + '.js', path.join(base, 'index.js')];
  for (var candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}

walk(backendRoot);
var edges = new Map();
var missing = [];
for (var file of files) {
  var source = fs.readFileSync(file, 'utf8');
  var dependencies = [];
  for (var match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    var resolved = resolveRelative(file, match[1]);
    if (!resolved) {
      missing.push(path.relative(root, file) + ' -> ' + match[1]);
    } else {
      dependencies.push(resolved);
    }
  }
  edges.set(path.resolve(file), dependencies);
}

var seeds = [
  'dashboard.js',
  'apps/backend/entrypoints/dashboard.js',
  'apps/backend/entrypoints/jsonl-agent.js',
  'apps/backend/entrypoints/provider-agent.js',
  'apps/backend/app/scan-worker.js',
  'apps/backend/app/proxy-parse-worker.js'
].map(function (file) { return path.resolve(root, file); });
var reachable = new Set();

function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (var dependency of edges.get(file) || []) visit(dependency);
}

for (var seed of seeds) visit(seed);
var unreachable = files
  .map(function (file) { return path.resolve(file); })
  .filter(function (file) { return !reachable.has(file); })
  .map(function (file) { return path.relative(root, file); });

if (missing.length || unreachable.length) {
  if (missing.length) {
    console.error('Missing relative imports:\n - ' + missing.join('\n - '));
  }
  if (unreachable.length) {
    console.error('Unreachable backend modules:\n - ' + unreachable.join('\n - '));
  }
  process.exit(1);
}

console.log('Backend module graph: OK (' + files.length + ' files)');
