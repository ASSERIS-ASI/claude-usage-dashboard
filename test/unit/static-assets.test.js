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

test('every pinned dependency asset exists inside node_modules/', function () {
  var root = path.resolve(__dirname, '..', '..');
  for (var route of Object.keys(dashboardHttp.VENDOR_ASSET_ROUTES)) {
    var resolved = dashboardHttp.resolveWhitelistedAsset(root, route);
    assert.ok(resolved, 'missing vendor asset for ' + route);
    assert.ok(resolved.includes(path.sep + 'node_modules' + path.sep));
  }
});

test('pinned dependency assets resolve when npm hoists them above the package', function () {
  var root = path.resolve(__dirname, '..', '..');
  var installedPackageRoot = path.join(
    root, 'node_modules', '@asseris', 'claude-usage-dashboard'
  );
  for (var route of Object.keys(dashboardHttp.VENDOR_ASSET_ROUTES)) {
    assert.ok(
      dashboardHttp.resolveWhitelistedAsset(installedPackageRoot, route),
      'hoisted dependency did not resolve for ' + route
    );
  }
});
