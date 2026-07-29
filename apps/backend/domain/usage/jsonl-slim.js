/**
 * @asseris-module       Jsonl Slim
 * @asseris-description  Module-level annotation placeholder for Jsonl Slim.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 */
/**
 * domain/usage/jsonl-slim.js — JSONL record slimming for sync/export.
 *
 * Reduces JSONL records to the minimum fields needed for dashboard
 * aggregation while preserving error records for hit_limit detection.
 * Runs security posture detection on the raw line BEFORE stripping
 * content blocks, embedding _secHits so remote pods can aggregate
 * security events without needing full record bodies.
 *
 * Extracted from usage-scan-roots.js slimJsonlRecord().
 */

var secClassify = require('./security-classify');
var hitLimitMod = require('./hit-limit');
var sessionSignalsMod = require('./session-signals');

function slimJsonlRecord(line) {
  if (!line) return null;
  var rec;
  try { rec = JSON.parse(line); } catch { return null; }
  var tp = rec.type;
  if (tp !== 'assistant' && tp !== 'user' && tp !== 'system') return null;

  // Pre-compute on raw line BEFORE content is stripped:
  // 1. Security posture detection
  var secHits = secClassify.classifySecurityPosture(line, rec.timestamp || '');
  // 2. Hit-limit detection (scans raw line for rate_limit, 429, overloaded etc.)
  var hitLimit = hitLimitMod.scanLineHitLimit(line);
  // 3. Session signal classification (scans raw line for --continue, --resume, interrupt etc.)
  var sessionTags = sessionSignalsMod.classifyJsonlSessionSignals(line, rec);

  var slim = {
    type: tp,
    sessionId: rec.sessionId || undefined,
    timestamp: rec.timestamp || undefined,
    version: rec.version || undefined,
    entrypoint: rec.entrypoint || undefined,
    isSidechain: rec.isSidechain || undefined,
    userType: rec.userType || undefined,
    agentId: rec.agentId || undefined,
    uuid: rec.uuid || undefined,
    parentUuid: rec.parentUuid || undefined,
    requestId: rec.requestId || undefined
  };

  if (rec.subtype) slim.subtype = rec.subtype;
  if (rec.error) slim.error = rec.error;
  if (secHits.length) slim._secHits = secHits;
  if (hitLimit) slim._hitLimit = true;
  if (sessionTags.length) slim._sessionTags = sessionTags;

  // Embed trigger keywords so remote pods with OLD code can still detect
  // signals via scanLineHitLimit(line) and classifyJsonlSessionSignals(line, rec).
  // These functions scan the raw JSON line text for patterns like "rate_limit",
  // "--continue", "user_cancelled" etc. — embedding them here makes them findable.
  var sigParts = [];
  if (hitLimit) sigParts.push('rate_limit');
  for (var _st of sessionTags) {
    if (_st === 'continue') sigParts.push('--continue');
    else if (_st === 'resume') sigParts.push('--resume');
    else if (_st === 'interrupt') sigParts.push('user_cancelled');
    else if (_st === 'retry') sigParts.push('retrying 429 rate_limit');
    else if (_st === 'truncated') sigParts.push('"is_truncated":true');
    else if (_st === 'api_error') { /* already in rec.subtype */ }
  }
  if (sigParts.length) slim._sig = sigParts.join(' ');

  if (rec.message) {
    slim.message = {
      model: rec.message.model || undefined,
      role: rec.message.role || undefined,
      stop_reason: rec.message.stop_reason || undefined,
      stop_details: rec.message.stop_details || undefined,
      usage: rec.message.usage || undefined
    };
  }

  // Drop assistant records with zero tokens — but keep if error or security hits
  if (tp === 'assistant' && !rec.error && !slim._secHits) {
    var usage = rec.message?.usage;
    if (!usage) return null;
    var input = usage.input_tokens || 0;
    var output = usage.output_tokens || 0;
    var cacheRead = usage.cache_read_input_tokens || 0;
    var cacheCreation = usage.cache_creation_input_tokens || 0;
    if (input + output + cacheRead + cacheCreation === 0) return null;
  }

  return JSON.stringify(slim);
}

module.exports = {
  slimJsonlRecord: slimJsonlRecord
};
