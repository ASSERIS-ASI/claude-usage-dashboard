'use strict';
/**
 * @asseris-module       Layout Store
 * @asseris-description  File-I/O for ~/.claude/usage-dashboard-layout.json — persists the
 *                       user's chart order, visibility toggles and widget preferences.
 *                       Atomic write, JSON validation.
 * @asseris-pillar       infra
 * @asseris-domain       dashboard-ui
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Dashboard Server, Layout Routes
 * @asseris-emits        ~/.claude/usage-dashboard-layout.json write
 * @asseris-consumes     layout JSON payload from caller
 *
 * layout-store.js — Dashboard Layout File-I/O.
 */
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');

var LAYOUT_FILE = path.join(os.homedir(), '.claude', 'usage-dashboard-layout.json');

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
  var dir = path.dirname(LAYOUT_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (error) { /* intentional */ }
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(data, null, 2), 'utf8');
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
  readLayout: readLayout,
  writeLayout: writeLayout,
  deleteLayout: deleteLayout
};
