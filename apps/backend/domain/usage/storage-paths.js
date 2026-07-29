'use strict';
/**
 * @asseris-module       Storage Paths
 * @asseris-description  Central resolver for derived dashboard state.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 */
var os = require('node:os');
var fs = require('node:fs');
var path = require('node:path');

function homeDir(env) {
  env = env || process.env;
  return env.USERPROFILE || env.HOME || os.homedir();
}

function stateDir(env) {
  env = env || process.env;
  return env.CLAUDE_USAGE_STATE_DIR ||
    path.join(homeDir(env), '.claude', 'usage-dashboard-product');
}

function stateFile(name, env) {
  return path.join(stateDir(env), name);
}

function legacyStateFile(name, env) {
  return path.join(homeDir(env), '.claude', name);
}

function legacyMigrationEnabled(env) {
  env = env || process.env;
  return env.CLAUDE_USAGE_MIGRATE_LEGACY_STATE === '1' ||
    env.CLAUDE_USAGE_MIGRATE_LEGACY_STATE === 'true';
}

function migrateLegacyFileIfMissing(target, legacyName, env) {
  if (!legacyMigrationEnabled(env)) return false;
  var legacy = legacyStateFile(legacyName, env);
  try {
    if (fs.existsSync(target) || !fs.statSync(legacy).isFile()) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  homeDir: homeDir,
  stateDir: stateDir,
  stateFile: stateFile,
  legacyStateFile: legacyStateFile,
  legacyMigrationEnabled: legacyMigrationEnabled,
  migrateLegacyFileIfMissing: migrateLegacyFileIfMissing
};
