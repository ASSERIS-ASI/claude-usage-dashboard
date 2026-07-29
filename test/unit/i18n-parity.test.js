'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

test('German, English and Korean UI bundles expose identical keys', function () {
  var root = path.resolve(__dirname, '..', '..', 'tpl');
  var bundles = {};
  for (var language of ['de', 'en', 'ko']) {
    bundles[language] = JSON.parse(
      fs.readFileSync(path.join(root, language, 'ui.tpl'), 'utf8')
    );
  }

  var expected = Object.keys(bundles.en).sort();
  assert.deepEqual(Object.keys(bundles.de).sort(), expected);
  assert.deepEqual(Object.keys(bundles.ko).sort(), expected);
});
