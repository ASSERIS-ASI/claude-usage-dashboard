/**
 * @asseris-module       App Logger
 * @asseris-description  Auto-annotated module metadata for public/js/infra/app-logger.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * infra/app-logger.js — Structured frontend logging.
 *
 * Canonical log line format (mirrors backend service-logger):
 *   [TIME] [LEVEL] [MODULE] [CLASS] [FUNCTION] ACTION detail
 *
 * Debug output only when globalThis.__ASSERIS_DEBUG is truthy
 * (server-injected or local dev flag).
 *
 * Usage (short, cls='-'):
 *   window.appLogger.infoM('ui-section-forensic', 'render', 'done', { days: 42 });
 *   window.appLogger.errorM('ui-core-stream', 'connectUsageStream', 'fail', err.message);
 *
 * Usage (full, with class):
 *   window.appLogger.info('ui-section-forensic', 'ForensicChart', 'render', 'done', { days: 42 });
 */
(function () {
  function ts() {
    var d = new Date();
    var p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    var ms = String(d.getMilliseconds());
    while (ms.length < 3) ms = '0' + ms;
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '.' + ms;
  }

  function fmt(level, mod, cls, fn, action, detail) {
    var msg = '[' + ts() + '] [' + level + '] [' + (mod || '-') + '] [' + (cls || '-') + '] [' + (fn || '-') + '] ' + (action || '-');
    if (detail != null) {
      if (typeof detail === 'object') {
        try {
          var parts = [];
          for (var k of Object.keys(detail)) parts.push(k + '=' + detail[k]);
          msg += ' ' + parts.join(' ');
        } catch (_e) {
          msg += ' ' + String(detail);
        }
      } else {
        msg += ' ' + String(detail);
      }
    }
    return msg;
  }

  /** Full 5-field: info(module, class, function, action, detail) */
  function info(mod, cls, fn, action, detail) {
    console.log(fmt('INFO', mod, cls, fn, action, detail));
  }
  function error(mod, cls, fn, action, detail) {
    console.error(fmt('ERROR', mod, cls, fn, action, detail));
  }
  function warn(mod, cls, fn, action, detail) {
    console.warn(fmt('WARN', mod, cls, fn, action, detail));
  }
  function debug(mod, cls, fn, action, detail) {
    if (!globalThis.__ASSERIS_DEBUG) return;
    console.debug(fmt('DEBUG', mod, cls, fn, action, detail));
  }

  /** Short 4-field (cls='-'): infoM(module, function, action, detail) */
  function infoM(mod, fn, action, detail) { info(mod, '-', fn, action, detail); }
  function errorM(mod, fn, action, detail) { error(mod, '-', fn, action, detail); }
  function warnM(mod, fn, action, detail) { warn(mod, '-', fn, action, detail); }
  function debugM(mod, fn, action, detail) { debug(mod, '-', fn, action, detail); }

  window.appLogger = {
    info: info, error: error, warn: warn, debug: debug,
    infoM: infoM, errorM: errorM, warnM: warnM, debugM: debugM
  };
})();
