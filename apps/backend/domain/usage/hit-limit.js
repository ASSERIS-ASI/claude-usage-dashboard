'use strict';
/**
 * @asseris-module       Hit-Limit Detector
 * @asseris-description  Detects rate-limit / 429 / overloaded / session-limit signals in
 *                       JSONL lines + provides the 500M cache_read forensic threshold for
 *                       day-summary annotation.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   CLS-03
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Usage Scan Orchestrator, Token Forensics
 * @asseris-emits        boolean hit-limit verdict per line
 * @asseris-consumes     JSONL line strings
 */

// Wie apps/backend/runtime/token-forensics.js (Tagesuebersicht): sehr hoher Cache-Read -> "?"
var CACHE_READ_FORENSIC_THRESH = 500000000; // 500M

function scanLineHitLimit(line) {
  if (line.includes('rate_limit')) return true;
  if (line.includes('RateLimit')) return true;
  if (line.includes('rate limit')) return true;
  if (line.includes('"status":429')) return true;
  if (line.includes('"status_code":429')) return true;
  if (line.includes('429') && line.includes('error')) return true;
  if (line.includes('overloaded')) return true;
  if (line.includes('Too Many Requests')) return true;
  if (line.includes('session') && line.includes('limit')) return true;
  return false;
}

module.exports = {
  CACHE_READ_FORENSIC_THRESH: CACHE_READ_FORENSIC_THRESH,
  scanLineHitLimit: scanLineHitLimit
};
