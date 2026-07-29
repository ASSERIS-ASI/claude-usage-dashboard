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

function enabledSources(setup, env) {
  if (setup) {
    var normalized = require('./product-setup').normalizeSources(setup);
    if (normalized) return normalized;
  }
  env = env || process.env;
  var mode = env.CLAUDE_USAGE_SOURCE_MODE;
  return {
    claude_jsonl: true,
    cache_fix: env.CLAUDE_USAGE_CACHE_FIX_ENABLED === '1' ||
      mode === 'cache-fix' || mode === 'combined',
    meter: env.CLAUDE_USAGE_METER_ENABLED === '1' ||
      mode === 'meter' || mode === 'combined'
  };
}

function existingFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return false;
  }
}

function collectSources(env, home) {
  var setup = null;
  try { setup = require('./product-setup').read(); } catch (error) { setup = null; }
  var sources = enabledSources(setup, env);
  var selected = [];
  if (sources.cache_fix) {
    var cacheFixFile = setup?.cache_fix_usage
      ? path.resolve(setup.cache_fix_usage)
      : usagePath(env, home);
    if (existingFile(cacheFixFile)) {
      selected.push({ file: cacheFixFile, source: 'claude-code-cache-fix' });
    }
  }
  if (sources.meter) {
    var meterFile = setup?.meter_usage
      ? path.resolve(setup.meter_usage)
      : meterPath(env, home);
    if (existingFile(meterFile)) {
      selected.push({ file: meterFile, source: 'claude-code-meter' });
    }
  }
  return selected;
}

function collect(env, home) {
  return collectSources(env, home).map(function (source) {
    return source.file;
  });
}

function quota(entry, current, legacy) {
  if (entry[legacy] != null) return Number(entry[legacy]) / 100;
  if (entry[current] != null) return Number(entry[current]);
  return null;
}

function normalizeAccountKey(entry, source) {
  var raw = String(
    entry.org_id || entry.organization_id || entry.account_key || ''
  ).trim();
  if (raw.startsWith('cache-fix:')) raw = raw.slice('cache-fix:'.length);
  if (raw) return raw.startsWith('acct:') ? raw : 'acct:' + raw;
  if (source === 'claude-code-meter') return 'unassigned:meter';
  return 'unassigned:cache-fix';
}

function accountScope(record) {
  var value = record?.account_key ||
    record?.response_anthropic_headers?.['anthropic-organization-id'] ||
    null;
  if (String(value || '').startsWith('unassigned:')) return null;
  return value ? String(value) : null;
}

function accountsCanMerge(left, right) {
  var leftAccount = accountScope(left);
  var rightAccount = accountScope(right);
  return !leftAccount || !rightAccount || leftAccount === rightAccount;
}

function cacheHealth(ratio) {
  if (ratio == null) return 'na';
  if (ratio >= 0.8) return 'healthy';
  if (ratio < 0.4) return 'affected';
  return 'mixed';
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
  var requestId = String(entry.request_id || '').trim();
  var fallbackId = [
    'evidence',
    ts.replaceAll(/\D/g, ''),
    model.replaceAll(/[^a-z\d]/gi, '').slice(-16),
    Number(entry.input_tokens) || 0,
    Number(entry.output_tokens) || 0,
    cr,
    cc
  ].join('_');
  var evidenceSource = source === 'claude-code-meter'
    ? source
    : 'claude-code-cache-fix';

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
    cache_health: cacheHealth(ratio),
    request_hints: { model: model, requested_model: entry.requested_model || null },
    response_anthropic_headers: headers,
    req_id: requestId || fallbackId,
    upstream_request_id: requestId || null,
    account_key: normalizeAccountKey(entry, evidenceSource),
    ephemeral_1h_input_tokens: Number(entry.ephemeral_1h_input_tokens) || 0,
    ephemeral_5m_input_tokens: Number(entry.ephemeral_5m_input_tokens) || 0,
    ttl_tier: entry.ttl_tier || null,
    peak_hour: entry.peak_hour === true,
    source: evidenceSource,
    evidence_sources: [evidenceSource],
    meter_session_id: entry.sid || null,
    agent_id: entry.agent_id || null,
    agent_id_source: entry.agent_id_source || null,
    speed: entry.speed || null,
    service_tier: entry.service_tier || null
  };
}

function mergeTranslated(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  var merged = { ...existing };
  var sources = [];
  for (var source of (existing.evidence_sources || [existing.source])) {
    if (source && !sources.includes(source)) sources.push(source);
  }
  for (var incomingSource of (incoming.evidence_sources || [incoming.source])) {
    if (incomingSource && !sources.includes(incomingSource)) sources.push(incomingSource);
  }
  merged.evidence_sources = sources;
  merged.source = sources.includes('claude-code-meter')
    ? 'claude-code-meter'
    : sources[0] || existing.source || incoming.source;
  merged.usage = {};
  var tokenFields = [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens'
  ];
  for (var tokenField of tokenFields) {
    merged.usage[tokenField] = Math.max(
      Number(existing.usage?.[tokenField]) || 0,
      Number(incoming.usage?.[tokenField]) || 0
    );
  }
  var read = merged.usage.cache_read_input_tokens;
  var create = merged.usage.cache_creation_input_tokens;
  merged.cache_read_ratio = read + create > 0 ? read / (read + create) : null;
  merged.cache_health = cacheHealth(merged.cache_read_ratio);
  merged.request_hints = {
    ...existing.request_hints,
    ...incoming.request_hints
  };
  merged.response_anthropic_headers = {
    ...existing.response_anthropic_headers,
    ...incoming.response_anthropic_headers
  };
  var fillFields = [
    'upstream_request_id',
    'account_key',
    'ttl_tier',
    'meter_session_id',
    'agent_id',
    'agent_id_source',
    'speed',
    'service_tier'
  ];
  for (var field of fillFields) {
    var existingUnassigned = field === 'account_key' &&
      String(merged[field] || '').startsWith('unassigned:');
    var incomingAssigned = field === 'account_key' &&
      incoming[field] != null &&
      !String(incoming[field]).startsWith('unassigned:');
    if ((merged[field] == null || (existingUnassigned && incomingAssigned)) &&
        incoming[field] != null) {
      merged[field] = incoming[field];
    }
  }
  merged.ephemeral_1h_input_tokens = Math.max(
    Number(existing.ephemeral_1h_input_tokens) || 0,
    Number(incoming.ephemeral_1h_input_tokens) || 0
  );
  merged.ephemeral_5m_input_tokens = Math.max(
    Number(existing.ephemeral_5m_input_tokens) || 0,
    Number(incoming.ephemeral_5m_input_tokens) || 0
  );
  if (incoming.peak_hour != null) merged.peak_hour = incoming.peak_hour;
  return merged;
}

module.exports = {
  usagePath: usagePath,
  meterPath: meterPath,
  normalizeAccountKey: normalizeAccountKey,
  accountScope: accountScope,
  accountsCanMerge: accountsCanMerge,
  enabledSources: enabledSources,
  collectSources: collectSources,
  collect: collect,
  translate: translate,
  mergeTranslated: mergeTranslated
};
