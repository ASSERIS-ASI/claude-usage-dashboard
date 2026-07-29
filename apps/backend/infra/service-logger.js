'use strict';
/**
 * @asseris-module       Service Logger
 * @asseris-description  Structured server-side logging facility — canonical line format
 *                       [TIME][LEVEL][MODULE][...] ACTION key=value, stderr + optional
 *                       file sink, per-module debug filter via env var.
 * @asseris-pillar       infra
 * @asseris-domain       logging-infra
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Compact Correlator Agent, Drift Detector Agent, Proxy Log Dirs, Proxy NDJSON Parser, TLS Lifecycle, many others
 * @asseris-emits        log lines to stderr + optional file sink
 * @asseris-consumes     CLAUDE_USAGE_LOG_LEVEL, CLAUDE_USAGE_LOG_FILE, CLAUDE_USAGE_DEBUG_MODULES env
 *
 * Strukturiertes Server-Logging (stderr + optional Datei).
 *
 * Canonical log line format:
 *   [TIME] [LEVEL] [MODULE] [CLASS] [FUNCTION] ACTION key=value ...
 *
 * Environment:
 *   CLAUDE_USAGE_LOG_LEVEL=error|warn|info|debug|none (Standard: info)
 *   CLAUDE_USAGE_LOG_FILE=Pfad — Append, eine Zeile pro Eintrag (UTF-8)
 *   CLAUDE_USAGE_DEBUG_MODULES=mod1,mod2 — per-module debug filter (comma-separated).
 *     When set, debug() only emits for listed modules. Empty/unset = all modules.
 */
var fs = require('node:fs');
var path = require('node:path');

var RANK = { error: 0, warn: 1, info: 2, debug: 3 };
var maxRank = RANK.info;
var logFilePath = '';
var debugModuleFilter = null; // null = all, Set = only listed

function refreshFromEnv() {
  var l = String(process.env.CLAUDE_USAGE_LOG_LEVEL || 'info')
    .trim()
    .toLowerCase();
  if (l === 'none' || l === 'off' || l === 'silent' || l === '0' || l === 'false') {
    maxRank = -1;
  } else if (l === 'error') {
    maxRank = RANK.error;
  } else if (l === 'warn') {
    maxRank = RANK.warn;
  } else if (l === 'debug' || l === 'verbose') {
    maxRank = RANK.debug;
  } else {
    maxRank = RANK.info;
  }
  logFilePath = String(process.env.CLAUDE_USAGE_LOG_FILE || '').trim();
  var dm = String(process.env.CLAUDE_USAGE_DEBUG_MODULES || '').trim();
  debugModuleFilter = dm ? new Set(dm.split(',').map(function (s) { return s.trim(); }).filter(Boolean)) : null;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function isoLocal() {
  var d = new Date();
  return (
    d.getFullYear() +
    '-' +
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    'T' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes()) +
    ':' +
    pad2(d.getSeconds()) +
    '.' +
    (function (x) {
      x = String(x);
      while (x.length < 3) x = '0' + x;
      return x;
    })(d.getMilliseconds())
  );
}

function emit(level, topic, message) {
  var r = RANK[level];
  if (r === undefined) r = RANK.info;
  if (maxRank < 0 || r > maxRank) return;
  var line =
    '[' +
    isoLocal() +
    '] [' +
    String(level).toUpperCase() +
    '] [' +
    String(topic || '-') +
    '] ' +
    String(message || '') +
    '\n';
  try {
    process.stderr.write(line);
  } catch (error) { /* intentional */ }
  if (logFilePath) {
    try {
      var dir = path.dirname(logFilePath);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logFilePath, line, 'utf8');
    } catch (error) { /* intentional */ }
  }
}

function logError(topic, message) {
  emit('error', topic, message);
}
function logWarn(topic, message) {
  emit('warn', topic, message);
}
function logInfo(topic, message) {
  emit('info', topic, message);
}
function logDebug(topic, message) {
  if (debugModuleFilter && !debugModuleFilter.has(topic)) return;
  emit('debug', topic, message);
}

// ── Structured API (canonical format) ──────────────────────────────────
// [TIME] [LEVEL] [module] [cls] [fn] action detail

function structured(level, mod, cls, fn, action, detail) {
  var topic = mod || '-';
  var msg = '[' + (cls || '-') + '] [' + (fn || '-') + '] ' + (action || '-');
  if (detail != null) {
    if (typeof detail === 'object') {
      var parts = [];
      for (var k of Object.keys(detail)) {
        var v = detail[k];
        parts.push(k + '=' + (v != null ? v : ''));
      }
      msg += ' ' + parts.join(' ');
    } else {
      msg += ' ' + String(detail);
    }
  }
  if (level === 'debug' && debugModuleFilter && !debugModuleFilter.has(topic)) return;
  emit(level, topic, msg);
}

function infoM(mod, fn, action, detail) {
  structured('info', mod, '-', fn, action, detail);
}
function errorM(mod, fn, action, detail) {
  structured('error', mod, '-', fn, action, detail);
}
function warnM(mod, fn, action, detail) {
  structured('warn', mod, '-', fn, action, detail);
}
function debugM(mod, fn, action, detail) {
  structured('debug', mod, '-', fn, action, detail);
}

refreshFromEnv();

module.exports = {
  refreshFromEnv: refreshFromEnv,
  error: logError,
  warn: logWarn,
  info: logInfo,
  debug: logDebug,
  emit: emit,
  structured: structured,
  infoM: infoM,
  errorM: errorM,
  warnM: warnM,
  debugM: debugM
};
