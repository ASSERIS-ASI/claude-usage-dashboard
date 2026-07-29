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
