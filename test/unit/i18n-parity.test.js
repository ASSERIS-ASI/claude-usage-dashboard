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

// The setup wizard runs before any UI bundle is loaded, so its copy lives in
// the module itself instead of tpl/<lang>/ui.tpl — and was therefore not
// covered by the check above. A key added to one language only would ship as a
// blank label for the other two.
test('the setup wizard offers identical copy in all three languages', function () {
  var source = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public', 'js', 'core', 'product-setup.js'),
    'utf8'
  );
  var dictionary = /var SETUP_COPY = \{([\s\S]*?)\n {2}\};/.exec(source);
  assert.ok(dictionary, 'SETUP_COPY dictionary not found');

  var keysByLanguage = {};
  for (var match of dictionary[1].matchAll(/\n {4}(de|en|ko): \{([\s\S]*?)\n {4}\}/g)) {
    keysByLanguage[match[1]] = Array.from(
      match[2].matchAll(/\n {6}([A-Za-z0-9_]+):/g),
      function (entry) { return entry[1]; }
    ).sort();
  }

  assert.deepEqual(Object.keys(keysByLanguage).sort(), ['de', 'en', 'ko']);
  assert.ok(keysByLanguage.en.length > 0, 'no English setup keys found');
  assert.deepEqual(keysByLanguage.de, keysByLanguage.en);
  assert.deepEqual(keysByLanguage.ko, keysByLanguage.en);
});
