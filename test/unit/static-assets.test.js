'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var dashboardHttp = require('../../apps/backend/server/dashboard-http');

test('every whitelisted browser asset exists inside public/', function () {
  var root = path.resolve(__dirname, '..', '..');
  for (var route of Object.keys(dashboardHttp.ASSET_ROUTES)) {
    var resolved = dashboardHttp.resolveWhitelistedAsset(root, route);
    assert.ok(resolved, 'missing asset for ' + route);
    assert.ok(resolved.startsWith(path.join(root, 'public') + path.sep));
  }
});
