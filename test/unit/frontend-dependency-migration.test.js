'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('browser dependencies use the native DataTables 3 and safe Marked 18 stack', function () {
  var pkg = JSON.parse(read('package.json'));
  var html = read('tpl/dashboard.html');
  var scripts = [
    '/assets/vendor/dataTables.min.js',
    '/assets/vendor/marked.umd.js',
    '/assets/vendor/purify.min.js',
    '/assets/core/safe-markdown.js'
  ];

  assert.equal(pkg.dependencies['datatables.net-dt'], '3.0.0');
  assert.equal(pkg.dependencies.marked, '18.0.7');
  assert.equal(pkg.dependencies.dompurify, '3.4.12');
  assert.equal(pkg.dependencies.jquery, undefined);
  assert.doesNotMatch(html, /jquery/i);

  for (var script of scripts) {
    assert.match(html, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.ok(
    scripts.every(function (script, index) {
      return index === 0 || html.indexOf(scripts[index - 1]) < html.indexOf(script);
    }),
    'dependency scripts must load before the safe Markdown adapter'
  );
});

test('security events table uses the jQuery-free DataTables API', function () {
  var source = read('public/js/sections/security-postures.js');
  assert.match(source, /new DataTable\('#sec-events-dt'/);
  assert.match(source, /layout:\s*\{/);
  assert.doesNotMatch(source, /\bjQuery\b|\$\s*\(/);
});

test('all Markdown HTML sinks use the shared sanitizing adapter', function () {
  var consumers = [
    'public/js/core/dashboard-renderer.js',
    'public/js/core/report-modal.js',
    'public/js/widgets/dispatcher-init.js'
  ];
  for (var consumer of consumers) {
    var source = read(consumer);
    assert.match(source, /renderSafeMarkdown/);
    assert.doesNotMatch(source, /\bmarked\.parse\b/);
  }
  var adapter = read('public/js/core/safe-markdown.js');
  assert.match(adapter, /DOMPurify\.sanitize/);
  assert.match(adapter, /FORBID_TAGS/);
  assert.match(adapter, /FORBID_ATTR/);
});

test('release notes keep a delegated handler across sidebar re-renders', function () {
  var source = read('public/js/widgets/dispatcher-init.js');
  assert.match(source, /__releaseNotesClickBound/);
  assert.match(source, /global\.addEventListener\('click'/);
  assert.match(source, /closest\('#sidebar-release-btn'\)/);
  assert.match(source, /renderSafeMarkdown/);
  assert.doesNotMatch(source, /replace\(\s*\/\^##/);
});

test('safe Markdown adapter sanitizes output and fails closed', function () {
  var source = read('public/js/core/safe-markdown.js');
  var captured = null;
  var windowWithDependencies = {
    marked: {
      parse: function () {
        return '<script>alert(1)</script><p>safe</p>';
      }
    },
    DOMPurify: {
      sanitize: function (html, options) {
        captured = { html: html, options: options };
        return '<p>safe</p>';
      }
    }
  };
  vm.runInNewContext(source, { window: windowWithDependencies });

  assert.equal(windowWithDependencies.renderSafeMarkdown('ignored'), '<p>safe</p>');
  assert.match(captured.html, /<script>/);
  assert.ok(captured.options.FORBID_TAGS.includes('iframe'));
  assert.ok(captured.options.FORBID_ATTR.includes('style'));

  var windowWithoutDependencies = {};
  vm.runInNewContext(source, { window: windowWithoutDependencies });
  assert.equal(
    windowWithoutDependencies.renderSafeMarkdown('<img src=x onerror=alert(1)>'),
    '<pre class="markdown-fallback">&lt;img src=x onerror=alert(1)&gt;</pre>'
  );
});
