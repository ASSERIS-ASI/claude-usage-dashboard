'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var test = require('node:test');
var productReleases = require('../../apps/backend/infra/providers/product-releases-client');
var releaseHistoryRoutes = require('../../apps/backend/server/routes/release-history-routes');

function makeFixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-release-history-'));
  fs.mkdirSync(path.join(root, 'public'));
  fs.mkdirSync(path.join(root, 'state'));
  fs.writeFileSync(
    path.join(root, 'public', 'release-history-fallback.json'),
    JSON.stringify([
      {
        tag_name: 'v1.9.0',
        published_at: '2026-07-29T00:00:00Z',
        name: 'Bundled first release',
        body: 'Bundled body'
      },
      {
        tag_name: 'v1.8.3',
        published_at: '2026-04-15T00:00:00Z',
        name: 'Predecessor',
        body: 'Fallback body'
      }
    ])
  );
  return root;
}

function readHistory(client, root) {
  return new Promise(function (resolve, reject) {
    client.getReleaseHistory(root, function (error, history) {
      if (error) reject(error);
      else resolve(history);
    });
  });
}

test('published GitHub releases override immutable fallback entries and persist', async function (t) {
  var root = makeFixture();
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cacheFile = path.join(root, 'state', 'product-release-history.json');
  var client = productReleases.createClient({
    cacheFile: cacheFile,
    cacheTtlMs: 60000,
    fetchReleases: function (callback) {
      callback(null, [
        {
          tag_name: 'v2.0.0',
          published_at: '2026-08-01T12:00:00Z',
          name: 'Published release',
          body: '## Features\n\n- Mirrored from Gitea.'
        },
        {
          tag_name: 'v1.9.0',
          published_at: '2026-07-29T10:00:00Z',
          name: 'Published first release',
          body: 'Published body'
        },
        {
          tag_name: 'v2.1.0-rc.1',
          published_at: '2026-08-02T10:00:00Z',
          name: 'Unpublished candidate',
          body: 'Must stay hidden',
          prerelease: true
        }
      ]);
    }
  });

  var history = await readHistory(client, root);
  var disk = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

  assert.deepEqual(history.map(function (entry) { return entry.tag_name; }), [
    'v2.0.0',
    'v1.9.0',
    'v1.8.3'
  ]);
  assert.equal(history[1].name, 'Published first release');
  assert.equal(history[1].body, 'Published body');
  assert.equal(disk.releases[0].tag_name, 'v2.0.0');
  assert.ok(disk.fetched_at > 0);
});

test('fresh disk cache avoids a network request', async function (t) {
  var root = makeFixture();
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cacheFile = path.join(root, 'state', 'product-release-history.json');
  fs.writeFileSync(cacheFile, JSON.stringify({
    fetched_at: Date.now(),
    releases: [{
      tag_name: 'v2.0.0',
      published_at: '2026-08-01T12:00:00Z',
      name: 'Cached',
      body: 'Cached release'
    }]
  }));
  var fetchCalls = 0;
  var client = productReleases.createClient({
    cacheFile: cacheFile,
    cacheTtlMs: 60000,
    fetchReleases: function () {
      fetchCalls++;
    }
  });

  var history = await readHistory(client, root);

  assert.equal(fetchCalls, 0);
  assert.equal(history[0].tag_name, 'v2.0.0');
  assert.equal(history[2].tag_name, 'v1.8.3');
});

test('offline refresh serves the immutable bundled fallback', async function (t) {
  var root = makeFixture();
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var client = productReleases.createClient({
    cacheFile: path.join(root, 'state', 'missing-cache.json'),
    cacheTtlMs: 60000,
    fetchReleases: function (callback) {
      callback(new Error('offline'), null);
    }
  });

  var history = await readHistory(client, root);

  assert.deepEqual(history.map(function (entry) { return entry.tag_name; }), [
    'v1.9.0',
    'v1.8.3'
  ]);
});

test('bundled package version is visible before its mirrored release is available', async function (t) {
  var root = makeFixture();
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.10.0' })
  );
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    [
      '# Changelog',
      '',
      '## [1.10.0] - 2026-07-30',
      '',
      '### Added',
      '',
      '- Release-gated public distribution.',
      '',
      '## [1.9.0] - 2026-07-29',
      '',
      '- Previous release.'
    ].join('\n')
  );
  var client = productReleases.createClient({
    cacheFile: path.join(root, 'state', 'missing-cache.json'),
    cacheTtlMs: 60000,
    fetchReleases: function (callback) {
      callback(new Error('mirror pending'), null);
    }
  });

  var history = await readHistory(client, root);

  assert.equal(history[0].tag_name, 'v1.10.0');
  assert.equal(history[0].published_at, '2026-07-30T00:00:00Z');
  assert.match(history[0].body, /Release-gated public distribution/);
  assert.doesNotMatch(history[0].body, /Previous release/);
});

test('release-history route serves provider results without browser caching', async function () {
  var response = { status: 0, headers: {}, body: '' };
  var route = releaseHistoryRoutes.register({
    getReleaseHistory: function (callback) {
      process.nextTick(function () {
        callback(null, [{ tag_name: 'v2.0.0', name: 'Published', body: '## Notes' }]);
      });
    },
    serviceLog: { error: function () {} }
  });

  await new Promise(function (resolve) {
    var handled = route.handle('/api/release-history', { method: 'GET' }, {
      writeHead: function (status, headers) {
        response.status = status;
        response.headers = headers;
      },
      end: function (body) {
        response.body = body;
        resolve();
      }
    });
    assert.equal(handled, true);
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(response.body)[0].tag_name, 'v2.0.0');
});
