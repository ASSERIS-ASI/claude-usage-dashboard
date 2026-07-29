'use strict';
/**
 * @asseris-module       Security Classify
 * @asseris-description  Regex-driven security-posture classifier — compiles the bundled
 *                       read-only policy set and scores user commands + tool output
 *                       per session, returns severity buckets. Single ingestion site for
 *                       CLS-01 + SEC-01..12 patterns AND input-side prompt-injection/jailbreak
 *                       detectors (prompt_injection_*, cmdOnly:false). DETECT-only: emits
 *                       structured findings, never stores prompt text and never strips/blocks —
 *                       enforcement (SUBSTITUTE/PREVENT) is delegated to XDR/SIEM per ANC-05.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   CLS-01, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07,
 *                       SEC-08, SEC-09, SEC-10, SEC-11, SEC-12
 * @asseris-anchor       ANC-04, ANC-05, ANC-06
 * @asseris-calls        Service Logger, Policy Config
 * @asseris-called-by    Usage Scan Orchestrator, Forensics
 * @asseris-emits        per-session severity classification + matched pattern hits
 * @asseris-consumes     session JSONL records and bundled security policies
 */

var serviceLog = require('../../infra/service-logger');
var BUILTIN_POLICIES = require('../../infra/config/policy-config').DEFAULT_SECURITY_POLICIES;

var _compiled = null;

function compilePolicies(policies) {
  var result = [];
  for (var p of policies) {
    if (p.enabled === false) continue;
    try {
      // flags default '' keeps the case-sensitive SEC patterns unchanged; prompt-injection
      // patterns opt into 'i' since natural-language attacks vary in casing.
      var rx = new RegExp(p.pattern, p.flags || '');
      result.push({
        id: p.id,
        severity: p.severity || 'medium',
        action: p.action || 'detect',
        clients: p.clients || null,
        rx: rx,
        pre: p.pre || null,
        cmdOnly: p.cmdOnly !== false
      });
    } catch (e) {
      serviceLog.warn('domain-security', 'invalid pattern for ' + p.id + ': ' + e.message);
    }
  }
  return result;
}

function getCompiledPolicies() {
  if (_compiled) return _compiled;
  _compiled = compilePolicies(BUILTIN_POLICIES);
  return _compiled;
}

/** Force re-read from config (e.g. after config update). */
function invalidateCache() {
  _compiled = null;
}

/**
 * @param {string} line — raw JSONL/body line to scan
 * @param {string} ts — timestamp
 * @param {string} [clientType] — client identifier (cursor, vscode, desktop, claude) for per-client filtering
 */
function classifySecurityPosture(line, ts, clientType) {
  var patterns = getCompiledPolicies();
  var hasCmd = line.includes('"command"') || line.includes(String.raw`\"command\"`);
  var hits = [];
  var seen = {};
  for (var p of patterns) {
    // Per-client filter: if policy has clients[], skip if client not in list
    if (p.clients && p.clients.length && clientType) {
      var match = false;
      for (var ci = 0; ci < p.clients.length; ci++) {
        if (clientType.includes(p.clients[ci])) { match = true; break; }
      }
      if (!match) continue;
    }
    if (p.cmdOnly && !hasCmd) continue;
    if (p.pre && !line.includes(p.pre)) continue;
    if (p.rx.test(line)) {
      if (!seen[p.id]) { seen[p.id] = true; hits.push({ ts: ts || '', type: p.id, severity: p.severity, action: p.action }); }
    }
  }
  return hits;
}

module.exports = {
  BUILTIN_POLICIES: BUILTIN_POLICIES,
  classifySecurityPosture: classifySecurityPosture,
  invalidateCache: invalidateCache
};
