'use strict';
/**
 * @asseris-module       Server Helpers
 * @asseris-description  Pure utility functions for the dashboard server — git binary
 *                       resolution + version detection, no state, no side effects.
 * @asseris-pillar       infra
 * @asseris-domain       helper-utils
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server
 * @asseris-emits        formatted strings, resolved binary paths
 * @asseris-consumes     env vars, filesystem
 *
 * Extracted from dashboard-server.js (Phase 19).
 * No state, no side effects — just formatting helpers.
 */
var fs = require('node:fs');
var path = require('node:path');

// ── Git binary resolution + version detection ────────────────────────

/** Optional absolute path to git (CI / non-default install). */
function resolveGitBinary() {
  var override = (process.env.CLAUDE_USAGE_GIT_PATH || process.env.GIT_BIN_PATH || '').trim();
  if (override) return override;
  if (process.platform === 'win32') {
    var w = [
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      String.raw`C:\Program Files\Git\bin\git.exe`,
      String.raw`C:\Program Files (x86)\Git\cmd\git.exe`
    ];
    for (var wp of w) {
      try { if (fs.existsSync(wp)) return wp; } catch (_e) { /* ignore */ }
    }
    return 'git.exe';
  }
  var u = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  for (var up of u) {
    try { if (fs.existsSync(up)) return up; } catch (_e) { /* ignore */ }
  }
  return 'git';
}

/** Run git argv without shell; PATH limited to system dirs (Sonar S4036). */
function gitExecFileTrimmed(gitArgs) {
  var cp = require('node:child_process');
  var isWin = process.platform === 'win32';
  var safePath = isWin ? String.raw`C:\Windows\System32;C:\Windows` : '/usr/bin:/bin';
  var gitBin = resolveGitBinary();
  return cp.execFileSync(gitBin, gitArgs, {
    encoding: 'utf8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: safePath }
  }).trim();
}

/** Resolve app version from git tags or VERSION file. */
function resolveAppVersion(baseDir) {
  try {
    var tagLines = gitExecFileTrimmed(['tag', '--sort=-v:refname']).split('\n');
    var tag = tagLines[0] || '';
    if (tag) return tag;
  } catch (_e) { /* ignore */ }
  try { return fs.readFileSync(path.join(baseDir, 'VERSION'), 'utf8').trim(); } catch (_e) { /* ignore */ }
  return 'dev';
}

// ── Date / path helpers ──────────────────────────────────────────────

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function localCalendarTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * Build an object mapping cache file paths for the dashboard state display.
 * @param {object} paths — { day_cache, jsonl_today_index, extract_cache, releases, marketplace, outage }
 * @param {Function} displayPathForUi — formatting function from build-usage-snapshot
 * @returns {object} formatted path object
 */
function buildDashboardStatePaths(paths, displayPathForUi) {
  return {
    day_cache: displayPathForUi(paths.day_cache),
    jsonl_today_index: displayPathForUi(paths.jsonl_today_index),
    extract_cache: displayPathForUi(paths.extract_cache),
    releases: displayPathForUi(paths.releases),
    marketplace: displayPathForUi(paths.marketplace),
    outage: displayPathForUi(paths.outage)
  };
}

module.exports = {
  resolveGitBinary: resolveGitBinary,
  gitExecFileTrimmed: gitExecFileTrimmed,
  resolveAppVersion: resolveAppVersion,
  pad2: pad2,
  localCalendarTodayStr: localCalendarTodayStr,
  buildDashboardStatePaths: buildDashboardStatePaths
};
