#!/usr/bin/env node
'use strict';

var path = require('node:path');
var cp = require('node:child_process');
var os = require('node:os');

process.env.ASSERIS_PRODUCT = 'dashboard';

// Derived state belongs to the standalone product, not to a co-located
// gateway. Raw Claude JSONL remains shared/read-only; caches do not.
var productStateDir = process.env.CLAUDE_USAGE_STATE_DIR ||
  path.join(os.homedir(), '.claude', 'usage-dashboard-product');
process.env.CLAUDE_USAGE_STATE_DIR = productStateDir;
if (!process.env.CLAUDE_USAGE_SESSION_TURNS_CACHE_DIR) {
  process.env.CLAUDE_USAGE_SESSION_TURNS_CACHE_DIR = path.join(productStateDir, 'session-turns');
}

// Keep the independently spawned agents attached to the selected dashboard
// port. dashboard-server accepts --port=N; without this propagation agents
// would notify the default :3333 instance instead.
var portArg = process.argv.find(function (arg) { return /^--port=\d+$/.test(arg); });
if (portArg && !process.env.CLAUDE_USAGE_DASHBOARD_URL) {
  process.env.CLAUDE_USAGE_DASHBOARD_URL = 'http://127.0.0.1:' + portArg.split('=')[1];
}

var entrypoints = path.join(__dirname, 'apps', 'backend', 'entrypoints');
var children = [];
var shuttingDown = false;
require(path.join(entrypoints, 'dashboard'));

function spawnAgent(name) {
  var child = cp.spawn(process.execPath, [path.join(entrypoints, name + '.js')], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: 'inherit'
  });
  children.push(child);
}

spawnAgent('provider-agent');
spawnAgent('jsonl-agent');

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (var child of children) {
    try { child.kill('SIGTERM'); } catch (error) { /* already stopped */ }
  }
  setTimeout(function () { process.exit(0); }, 100).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
