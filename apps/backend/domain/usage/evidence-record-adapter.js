/**
 * @asseris-module       Ndjson Adapter
 * @asseris-description  Module-level annotation placeholder for Ndjson Adapter.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 */

/**
 * Read-only adapter that normalizes NDJSON evidence from different sources
 * (including claude-code-cache-fix and compatible request logs) into a canonical format
 * before the accumulator functions process them.
 *
 * Source detection is automatic via the `source` field.
 * Missing fields are filled with safe defaults so accumulators
 * never need to branch on source type.
 */

/**
 * Normalize a raw NDJSON record into canonical form.
 * Mutates and returns the same object (no copy).
 * @param {object} rec - parsed NDJSON record
 * @returns {object} the same record with guaranteed field presence
 */
function normalizeRecord(rec) {
  var source = rec.source || 'proxy';
  rec.source = source;

  // --- Timing ---
  if (rec.duration_ms == null) rec.duration_ms = 0;
  if (!rec.ts_end) rec.ts_end = rec.ts_start || '';
  if (!rec.ts_start) rec.ts_start = rec.ts_end || '';

  // --- Usage ---
  if (!rec.usage) {
    rec.usage = {
      input_tokens: rec.input_tokens || 0,
      output_tokens: rec.output_tokens || 0,
      cache_read_input_tokens: rec.cache_read_input_tokens || 0,
      cache_creation_input_tokens: rec.cache_creation_input_tokens || 0
    };
  }

  // --- Request hints ---
  if (!rec.request_hints) {
    rec.request_hints = { model: rec.model || 'unknown' };
  }

  // --- Response hints ---
  if (!rec.response_hints) rec.response_hints = {};

  // --- Response headers ---
  if (!rec.response_anthropic_headers) rec.response_anthropic_headers = {};

  // --- Cache health (compute if missing) ---
  if (!rec.cache_health) {
    var u = rec.usage;
    var cr = u.cache_read_input_tokens || 0;
    var cc = u.cache_creation_input_tokens || 0;
    if (cr + cc === 0) {
      rec.cache_health = 'na';
    } else {
      var ratio = cr / (cr + cc);
      rec.cache_health = ratio >= 0.8 ? 'healthy' : ratio < 0.4 ? 'affected' : 'mixed';
    }
  }

  // --- Cache read ratio (compute if missing) ---
  if (rec.cache_read_ratio == null) {
    var uu = rec.usage;
    var crr = uu.cache_read_input_tokens || 0;
    var ccc = uu.cache_creation_input_tokens || 0;
    rec.cache_read_ratio = (crr + ccc) > 0 ? crr / (crr + ccc) : null;
  }

  // --- Peak hour (compute if missing) ---
  if (rec.peak_hour == null && rec.ts_end && rec.ts_end.length >= 13) {
    var d = new Date(rec.ts_end);
    var utcH = d.getUTCHours();
    var utcD = d.getUTCDay();
    rec.peak_hour = utcD >= 1 && utcD <= 5 && utcH >= 13 && utcH < 19;
  }

  // --- TTL tier ---
  if (!rec.ttl_tier) rec.ttl_tier = 'unknown';

  // --- Upstream status ---
  if (!rec.upstream_status) rec.upstream_status = 200;

  // --- Gateway arrays ---
  if (!rec.gateway_fixes_applied) rec.gateway_fixes_applied = null;

  // --- Cursor proto fields ---
  if (!rec.rpc_method) rec.rpc_method = null;
  if (!rec.rpc_service) rec.rpc_service = null;
  if (!rec.cursor_model) rec.cursor_model = null;

  // --- Forensic classification ---
  // Derive from existing fields for records written before forensic_class existed.
  if (!rec.forensic_class) {
    var hasTokens = rec.usage && (
      (rec.usage.input_tokens || 0) + (rec.usage.output_tokens || 0) > 0
    );
    rec.forensic_class = hasTokens ? 'llm_api' : 'chat_session';
  }
  if (!rec.observable) {
    switch (rec.forensic_class) {
      case 'llm_api':      rec.observable = ['tokens', 'cache', 'model', 'timing', 'path']; break;
      case 'auth':         rec.observable = ['path', 'timing', 'status']; break;
      case 'cdn':          rec.observable = ['path', 'timing', 'bytes']; break;
      default:             rec.observable = ['path', 'timing', 'bytes']; break;
    }
  }

  return rec;
}

module.exports = { normalizeRecord: normalizeRecord };
