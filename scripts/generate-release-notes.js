#!/usr/bin/env node
'use strict';

/**
 * Build a Gitea release body from conventional Git commit subjects.
 *
 * This script writes the generated text to stdout. It does not create or
 * maintain a release-notes file in the repository.
 */
var childProcess = require('node:child_process');

var TYPE_RE = /^(feat|fix|docs|perf|refactor|test|build|ci|chore)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i;
var GROUPS = [
  { key: 'feat', title: 'Features' },
  { key: 'fix', title: 'Fixes' },
  { key: 'perf', title: 'Performance' },
  { key: 'docs', title: 'Documentation' },
  { key: 'maintenance', title: 'Maintenance' }
];

function gitOutput(args) {
  return childProcess.execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function normalizeCommit(commit) {
  var subject = String(commit.subject || '').trim();
  var match = TYPE_RE.exec(subject);
  var type = match?.[1]?.toLowerCase() || 'maintenance';
  var scope = match?.[2]?.trim() || '';
  var description = match?.[4]?.trim() || subject;
  if (type === 'refactor' || type === 'test' || type === 'build' ||
      type === 'ci' || type === 'chore') {
    type = 'maintenance';
  }
  return {
    type: type,
    scope: scope,
    description: description || subject,
    shortSha: String(commit.sha || '').slice(0, 7)
  };
}

function generateNotes(tag, commits) {
  var grouped = new Map();
  for (var group of GROUPS) grouped.set(group.key, []);

  for (var commit of commits) {
    var normalized = normalizeCommit(commit);
    var target = grouped.get(normalized.type) || grouped.get('maintenance');
    target.push(normalized);
  }

  var lines = ['## ' + tag, ''];
  var rendered = false;
  for (var definition of GROUPS) {
    var entries = grouped.get(definition.key);
    if (!entries.length) continue;
    rendered = true;
    lines.push('### ' + definition.title, '');
    for (var entry of entries) {
      var prefix = entry.scope ? '**' + entry.scope + ':** ' : '';
      var suffix = entry.shortSha ? ' (`' + entry.shortSha + '`)' : '';
      lines.push('- ' + prefix + entry.description + suffix);
    }
    lines.push('');
  }

  if (!rendered) lines.push('- Release ' + tag, '');
  return lines.join('\n').trimEnd() + '\n';
}

function commitsInRange(baseTag, tag) {
  var range = baseTag ? baseTag + '..' + tag : tag;
  var output = gitOutput([
    'log',
    '--no-merges',
    '--format=%H%x1f%s%x1e',
    range
  ]);
  if (!output) return [];
  return output.split('\x1e').map(function (record) {
    var parts = record.trim().split('\x1f');
    return { sha: parts[0], subject: parts.slice(1).join('\x1f') };
  }).filter(function (commit) {
    return commit.sha && commit.subject && !/^release:/i.test(commit.subject);
  });
}

function main() {
  var tag = String(process.argv[2] || '').trim();
  var baseTag = String(process.argv[3] || '').trim();
  if (!tag) {
    console.error('Usage: node scripts/generate-release-notes.js <tag> [base-tag]');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(generateNotes(tag, commitsInRange(baseTag, tag)));
}

if (require.main === module) main();

module.exports = {
  generateNotes: generateNotes,
  normalizeCommit: normalizeCommit
};
