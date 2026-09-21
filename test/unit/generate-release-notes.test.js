'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
var releaseNotes = require('../../scripts/generate-release-notes');

test('release body groups conventional commits without a repository note file', function () {
  var output = releaseNotes.generateNotes('v2.0.0', [
    { sha: '1234567890', subject: 'feat(proxy): import compatible telemetry' },
    { sha: 'abcdef1234', subject: 'fix: keep empty charts hidden' },
    { sha: 'fedcba9876', subject: 'ci: mirror published releases' }
  ]);

  assert.match(output, /^## v2\.0\.0/m);
  assert.match(output, /### Features/);
  assert.match(output, /\*\*proxy:\*\* import compatible telemetry/);
  assert.match(output, /### Fixes/);
  assert.match(output, /### Maintenance/);
  assert.match(output, /`1234567`/);
});

test('release body preserves non-conventional product commits as maintenance', function () {
  var output = releaseNotes.generateNotes('v1.9.1', [
    { sha: '0123456789', subject: 'Improve release presentation' }
  ]);

  assert.match(output, /### Maintenance/);
  assert.match(output, /Improve release presentation/);
});

test('infrastructure-only commits go below the internal marker', function () {
  var output = releaseNotes.generateNotes('v1.2.3', [
    { sha: '1111111111', subject: 'fix(proxy): keep hidden charts hidden', files: ['public/js/sections/proxy.js'] },
    { sha: '2222222222', subject: 'ops(k8s): raise the memory limit', files: ['k8s/base/deployment.yml'] },
    { sha: '3333333333', subject: 'ci: retry the mirror', files: ['.gitea/workflows/mirror-github.yml', 'Jenkinsfile'] }
  ]);
  var parts = output.split(releaseNotes.INTERNAL_MARKER);

  assert.equal(parts.length, 2);
  assert.match(parts[0], /keep hidden charts hidden/);
  assert.doesNotMatch(parts[0], /memory limit|retry the mirror/);
  assert.match(parts[1], /### Internal/);
  assert.match(parts[1], /raise the memory limit/);
  assert.match(parts[1], /retry the mirror/);
});

test('a commit touching any product file stays public', function () {
  var mixed = { sha: '4444444444', subject: 'fix: tune the deployment and the parser', files: ['k8s/base/deployment.yml', 'apps/backend/app/proxy-ndjson-parser.js'] };
  assert.equal(releaseNotes.isInternalOnly(mixed), false);
  assert.equal(releaseNotes.isInternalOnly({ subject: 'no file list' }), false);
  assert.equal(releaseNotes.isInternalOnly({ files: ['k8s/README.md'] }), false);

  var output = releaseNotes.generateNotes('v1.2.4', [mixed]);
  assert.doesNotMatch(output, /INTERNAL/);
});
