'use strict';

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

function usagePath(env, home) {
  env = env || process.env;
  home = home || os.homedir();
  if (env.CACHE_FIX_USAGE_LOG) return path.resolve(env.CACHE_FIX_USAGE_LOG);
  var root = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  return path.join(root, 'usage.jsonl');
}

function meterPath(env, home) {
  env = env || process.env;
  home = home || os.homedir();
  if (env.CLAUDE_METER_LOG) return path.resolve(env.CLAUDE_METER_LOG);
  var root = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  return path.join(root, 'claude-meter.jsonl');
}

function collect(env, home) {
  var setup = null;
  try { setup = require('./product-setup').read(); } catch (error) { setup = null; }
  var mode = setup?.mode || env?.CLAUDE_USAGE_SOURCE_MODE;
  if (mode !== 'cache-fix' && mode !== 'meter') return [];
  var file = mode === 'meter'
    ? (setup?.meter_usage ? path.resolve(setup.meter_usage) : meterPath(env, home))
    : (setup?.cache_fix_usage ? path.resolve(setup.cache_fix_usage) : usagePath(env, home));
  try {
    return fs.statSync(file).isFile() ? [file] : [];
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return [];
  }
}

function quota(entry, current, legacy) {
  if (entry[legacy] != null) return Number(entry[legacy]) / 100;
  if (entry[current] != null) return Number(entry[current]);
  return null;
}

function translate(entry, source) {
  if (!entry || typeof entry !== 'object') return null;
  var ts = entry.ts || entry.timestamp;
  var model = entry.model;
  if (typeof ts !== 'string' || !ts || typeof model !== 'string' || !model) return null;

  var cr = Number(entry.cache_read_input_tokens) || 0;
  var cc = Number(entry.cache_creation_input_tokens) || 0;
  var ratio = cr + cc > 0 ? cr / (cr + cc) : null;
  var headers = {};
  var q5 = quota(entry, 'q5h', 'q5h_pct');
  var q7 = quota(entry, 'q7d', 'q7d_pct');
  if (Number.isFinite(q5)) headers['anthropic-ratelimit-unified-5h-utilization'] = String(q5);
  if (Number.isFinite(q7)) headers['anthropic-ratelimit-unified-7d-utilization'] = String(q7);
  if (entry.q5h_reset != null) headers['anthropic-ratelimit-unified-5h-reset'] = String(entry.q5h_reset);
  if (entry.q7d_reset != null) headers['anthropic-ratelimit-unified-7d-reset'] = String(entry.q7d_reset);
  if (entry.qstatus) headers['anthropic-ratelimit-unified-status'] = String(entry.qstatus);
  if (entry.qoverage) headers['anthropic-ratelimit-unified-overage-status'] = String(entry.qoverage);
  if (entry.qoverage_util != null) headers['anthropic-ratelimit-unified-overage-utilization'] = String(entry.qoverage_util);

  return {
    ts_start: ts,
    ts_end: ts,
    duration_ms: null,
    method: 'POST',
    path: '/v1/messages',
    upstream_status: 200,
    usage: {
      input_tokens: Number(entry.input_tokens) || 0,
      output_tokens: Number(entry.output_tokens) || 0,
      cache_creation_input_tokens: cc,
      cache_read_input_tokens: cr
    },
    cache_read_ratio: ratio,
    cache_health: ratio == null ? 'na' : ratio >= 0.8 ? 'healthy' : ratio < 0.4 ? 'affected' : 'mixed',
    request_hints: { model: model, requested_model: entry.requested_model || null },
    response_anthropic_headers: headers,
    req_id: 'ccf_' + ts.replace(/[^0-9]/g, '') + '_' + model.slice(-6),
    upstream_request_id: entry.request_id || null,
    account_key: entry.org_id ? 'cache-fix:' + entry.org_id : null,
    ephemeral_1h_input_tokens: Number(entry.ephemeral_1h_input_tokens) || 0,
    ephemeral_5m_input_tokens: Number(entry.ephemeral_5m_input_tokens) || 0,
    ttl_tier: entry.ttl_tier || null,
    peak_hour: entry.peak_hour === true,
    source: source === 'claude-code-meter' ? source : 'claude-code-cache-fix',
    meter_session_id: entry.sid || null,
    agent_id: entry.agent_id || null,
    agent_id_source: entry.agent_id_source || null,
    speed: entry.speed || null,
    service_tier: entry.service_tier || null
  };
}

module.exports = {
  usagePath: usagePath,
  meterPath: meterPath,
  collect: collect,
  translate: translate
};
