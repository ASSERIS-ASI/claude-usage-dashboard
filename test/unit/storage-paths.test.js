'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var storagePaths = require('../../apps/backend/domain/usage/storage-paths');

test('derived files share the configured state directory', function () {
  var configured = path.resolve('test-state');
  var env = { CLAUDE_USAGE_STATE_DIR: configured };
  assert.equal(storagePaths.stateDir(env), configured);
  assert.equal(storagePaths.stateFile('layout.json', env), path.join(configured, 'layout.json'));
});

test('default state is isolated below the user Claude directory', function () {
  var home = path.resolve('test-home');
  assert.equal(
    storagePaths.stateDir({ USERPROFILE: home }),
    path.join(home, '.claude', 'usage-dashboard-product')
  );
});

test('legacy cache migration is opt-in when a custom state directory is used', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-storage-'));
  var home = path.join(root, 'home');
  var target = path.join(root, 'state', 'cache.json');
  var legacy = path.join(home, '.claude', 'legacy.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '{"ok":true}', 'utf8');

  assert.equal(storagePaths.migrateLegacyFileIfMissing(target, 'legacy.json', {
    USERPROFILE: home,
    CLAUDE_USAGE_STATE_DIR: path.dirname(target)
  }), false);
  assert.equal(fs.existsSync(target), false);

  assert.equal(storagePaths.migrateLegacyFileIfMissing(target, 'legacy.json', {
    USERPROFILE: home,
    CLAUDE_USAGE_STATE_DIR: path.dirname(target),
    CLAUDE_USAGE_MIGRATE_LEGACY_STATE: '1'
  }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
});

test('legacy custom templates are imported once and do not return after reset', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-layout-'));
  var home = path.join(root, 'home');
  var state = path.join(root, 'state');
  var legacy = path.join(home, '.claude', 'usage-dashboard-layout.json');
  var current = path.join(state, 'layout.json');
  var modulePath = path.resolve(
    __dirname,
    '../../apps/backend/infra/files/layout-store.js'
  );
  var childEnv = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    CLAUDE_USAGE_STATE_DIR: state,
    CLAUDE_USAGE_MIGRATE_LEGACY_STATE: '1'
  };

  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({
    v: 3,
    templates: [{ name: 'custom', widgets: [] }]
  }), 'utf8');
  fs.writeFileSync(current, JSON.stringify({ v: 3, widgets: [] }), 'utf8');

  var script = [
    'var store = require(' + JSON.stringify(modulePath) + ');',
    'process.stdout.write(JSON.stringify(store.readLayout().data));'
  ].join('');
  var imported = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    env: childEnv,
    encoding: 'utf8'
  }));
  assert.equal(imported.templates.length, 1);
  assert.equal(imported.templates[0].name, 'custom');
  assert.equal(fs.existsSync(path.join(state, 'layout-migration-v1.json')), true);

  fs.unlinkSync(current);
  var afterReset = cp.execFileSync(process.execPath, ['-e', script], {
    env: childEnv,
    encoding: 'utf8'
  });
  assert.equal(JSON.parse(afterReset), null);
});
