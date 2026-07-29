'use strict';
/**
 * @asseris-module       Layout Store
 * @asseris-description  File-I/O for persisted dashboard layout state — stores the
 *                       user's chart order, visibility toggles and widget preferences.
 *                       Atomic write, JSON validation.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-ui
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server, Layout Routes
 * @asseris-emits        dashboard layout state write
 * @asseris-consumes     layout JSON payload from caller
 *
 * layout-store.js — Dashboard Layout File-I/O.
 */
var fs = require('node:fs');
var path = require('node:path');
var storagePaths = require('../../domain/usage/storage-paths');

var LAYOUT_FILE = storagePaths.stateFile('layout.json');
var LEGACY_LAYOUT_FILE = storagePaths.legacyStateFile('usage-dashboard-layout.json');
var MIGRATION_MARKER = storagePaths.stateFile('layout-migration-v1.json');

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function templateCount(layout) {
  return layout && Array.isArray(layout.templates) ? layout.templates.length : 0;
}

function writeJsonAtomic(file, data) {
  var dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var temporary = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (_error) { /* best-effort temporary-file cleanup */ }
  }
}

/**
 * Import the former standalone layout once. A marker is deliberately kept
 * when the active layout is later reset, otherwise deleted custom templates
 * would silently return on the next process start.
 */
function migrateLegacyLayoutOnce() {
  if (!storagePaths.legacyMigrationEnabled() || fs.existsSync(MIGRATION_MARKER)) return false;

  var outcome = 'no-legacy-layout';
  try {
    if (fs.existsSync(LEGACY_LAYOUT_FILE) && fs.statSync(LEGACY_LAYOUT_FILE).isFile()) {
      var legacy = readJsonFile(LEGACY_LAYOUT_FILE);
      if (!fs.existsSync(LAYOUT_FILE)) {
        writeJsonAtomic(LAYOUT_FILE, legacy);
        outcome = 'imported';
      } else {
        var current = readJsonFile(LAYOUT_FILE);
        if (templateCount(legacy) > 0 && templateCount(current) === 0) {
          writeJsonAtomic(LAYOUT_FILE, legacy);
          outcome = 'replaced-template-less-layout';
        } else {
          outcome = 'kept-current-layout';
        }
      }
    }

    writeJsonAtomic(MIGRATION_MARKER, {
      version: 1,
      outcome: outcome,
      migratedAt: new Date().toISOString()
    });
    return outcome === 'imported' || outcome === 'replaced-template-less-layout';
  } catch (_error) {
    // Do not create a marker after a transient read/write failure; retry on
    // the next start instead of losing the opportunity to import the layout.
    return false;
  }
}

migrateLegacyLayoutOnce();

function readLayout() {
  try {
    var raw = fs.readFileSync(LAYOUT_FILE, 'utf8');
    var mtime = fs.statSync(LAYOUT_FILE).mtimeMs;
    return { data: JSON.parse(raw), mtime: mtime };
  } catch (e) {
    return { data: null, mtime: 0 };
  }
}

function writeLayout(data) {
  writeJsonAtomic(LAYOUT_FILE, data);
  var mtime = fs.statSync(LAYOUT_FILE).mtimeMs;
  return { mtime: mtime };
}

function deleteLayout() {
  try {
    if (fs.existsSync(LAYOUT_FILE)) fs.unlinkSync(LAYOUT_FILE);
  } catch (error) { /* intentional */ }
}

module.exports = {
  LAYOUT_FILE: LAYOUT_FILE,
  LEGACY_LAYOUT_FILE: LEGACY_LAYOUT_FILE,
  MIGRATION_MARKER: MIGRATION_MARKER,
  migrateLegacyLayoutOnce: migrateLegacyLayoutOnce,
  readLayout: readLayout,
  writeLayout: writeLayout,
  deleteLayout: deleteLayout
};
