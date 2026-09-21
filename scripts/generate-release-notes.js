#!/usr/bin/env node
'use strict';

/**
 * Build a Gitea release body from conventional Git commit subjects.
 *
 * This script writes the generated text to stdout. It does not create or
 * maintain a release-notes file in the repository.
 *
 * The body has two parts. Everything above the <!--INTERNAL--> marker is the
 * public release text; the GitHub mirror cuts the body at that marker
 * (.gitea/workflows/mirror-github.yml). Below it, and only in the Gitea
 * release, are the commits that touch nothing but internal infrastructure —
 * deployment manifests, forge workflows, the scrub itself. A commit that
 * changes any product file stays public.
 */
var childProcess = require('node:child_process');

var TYPE_RE = /^(feat|fix|docs|perf|refactor|test|build|ci|chore)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i;
var INTERNAL_MARKER = '<!--INTERNAL-->';

// Paths whose changes never concern a public reader. Kubernetes manifests are
// shipped as examples, but a change to this installation's sizing or ingress
// is not a product change.
var INTERNAL_ONLY_RE = /^(?:\.gitea\/|Jenkinsfile$|k8s\/.+\.ya?ml$|sonar-project\.properties$|scripts\/scrub-for-public\.sh$)/;

/** True when a commit changed files and every one of them is internal. */
function isInternalOnly(commit) {
  var files = Array.isArray(commit.files) ? commit.files : [];
  return files.length > 0 && files.every(function (file) { return INTERNAL_ONLY_RE.test(file); });
}

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
  var publicCommits = commits.filter(function (commit) { return !isInternalOnly(commit); });
  var internalCommits = commits.filter(isInternalOnly);
  var body = groupedNotes(tag, publicCommits);
  if (!internalCommits.length) return body;
  var lines = [body.trimEnd(), '', INTERNAL_MARKER, '', '### Internal', ''];
  for (var commit of internalCommits) {
    var entry = normalizeCommit(commit);
    var prefix = entry.scope ? '**' + entry.scope + ':** ' : '';
    var suffix = entry.shortSha ? ' (`' + entry.shortSha + '`)' : '';
    lines.push('- ' + prefix + entry.description + suffix);
  }
  return lines.join('\n') + '\n';
}

function groupedNotes(tag, commits) {
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
  // Record separator first, so the file list that --name-only prints after
  // each header stays with its own commit.
  var output = gitOutput([
    'log',
    '--no-merges',
    '--name-only',
    '--format=%x1e%H%x1f%s',
    range
  ]);
  if (!output) return [];
  return output.split('\x1e').filter(Boolean).map(function (record) {
    var lines = record.split('\n');
    var parts = lines[0].trim().split('\x1f');
    var files = lines.slice(1).map(function (line) { return line.trim(); }).filter(Boolean);
    return { sha: parts[0], subject: parts.slice(1).join('\x1f'), files: files };
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
  normalizeCommit: normalizeCommit,
  isInternalOnly: isInternalOnly,
  commitsInRange: commitsInRange,
  INTERNAL_MARKER: INTERNAL_MARKER
};
