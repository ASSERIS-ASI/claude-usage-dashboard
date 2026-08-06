#!/usr/bin/env node
'use strict';

/**
 * The widget registry is the single source of truth for the designer, the
 * saved skeleton and per-surface visibility. A chart that renders without a
 * registry entry cannot be positioned, hidden or scoped to a surface — it just
 * appears wherever its container happens to sit in the template. That is how
 * proxy charts ended up on the overview surface.
 *
 * This check fails when a section renderer or a chart canvas exists without a
 * matching registry entry. Anything that is deliberately not a widget must be
 * listed below with a reason, so the exception is a decision and not an
 * oversight.
 */

var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var root = path.resolve(__dirname, '..');
var sectionsDir = path.join(root, 'public', 'js', 'sections');

// Renderers that are helpers of a registered renderer rather than widgets of
// their own. Each entry needs a reason.
var NON_WIDGET_RENDERERS = {};

// Canvas containers that are not widgets. Each entry needs a reason.
var NON_WIDGET_CANVASES = {};

function loadRegistry() {
  var sandbox = { console: console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = { getElementById: function () { return null; } };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'public', 'js', 'widget-registry.js'), 'utf8'),
    sandbox,
    { filename: 'widget-registry.js' }
  );
  return sandbox.__widgetRegistry;
}

function collectRegistered(registry) {
  var renderFns = new Set();
  var canvases = new Set();
  for (var section of registry.sections) {
    if (section.sectionRenderFn) renderFns.add(section.sectionRenderFn);
    for (var chart of section.charts || []) {
      if (chart.renderFn) renderFns.add(chart.renderFn);
      if (chart.canvasId) canvases.add(chart.canvasId);
    }
  }
  return { renderFns: renderFns, canvases: canvases };
}

function collectRenderers() {
  var found = [];
  for (var file of fs.readdirSync(sectionsDir)) {
    if (!file.endsWith('.js')) continue;
    var source = fs.readFileSync(path.join(sectionsDir, file), 'utf8');
    for (var match of source.matchAll(/window\.(render[A-Za-z0-9_]+)\s*=/g)) {
      found.push({ name: match[1], file: 'public/js/sections/' + file });
    }
  }
  return found;
}

function collectCanvases() {
  var template = fs.readFileSync(path.join(root, 'tpl', 'dashboard.html'), 'utf8');
  var found = [];
  for (var match of template.matchAll(/id="(c-[a-z0-9-]+)"/g)) {
    found.push(match[1]);
  }
  return Array.from(new Set(found));
}

var registry = loadRegistry();
var registered = collectRegistered(registry);
var failures = [];

for (var renderer of collectRenderers()) {
  if (registered.renderFns.has(renderer.name)) continue;
  if (NON_WIDGET_RENDERERS[renderer.name]) continue;
  failures.push(renderer.file + ': ' + renderer.name + ' has no registry entry');
}

for (var canvasId of collectCanvases()) {
  if (registered.canvases.has(canvasId)) continue;
  if (NON_WIDGET_CANVASES[canvasId]) continue;
  failures.push('tpl/dashboard.html: ' + canvasId + ' is not owned by a widget');
}

if (failures.length) {
  process.stderr.write('Widget registry: ' + failures.length + ' unregistered element(s)\n');
  for (var failure of failures.sort()) process.stderr.write(' - ' + failure + '\n');
  process.stderr.write(
    'Register them in public/js/widget-registry.js, or list them as a documented exception.\n'
  );
  process.exit(1);
}

console.log(
  'Widget registry: OK (' + registered.renderFns.size + ' renderers, ' +
  registered.canvases.size + ' canvases)'
);
