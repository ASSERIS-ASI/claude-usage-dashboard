'use strict';

/**
 * @asseris-module       Proxy NDJSON Parser
 * @asseris-description  Heart of proxy-data aggregation — reads proxy-YYYY-MM-DD.ndjson,
 *                       normalizes records via the adapter, accumulates per-day stats,
 *                       computes burn-rate projections, gateway_cc_versions, cut-impacts,
 *                       M(t) per session and quota timelines.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Scan Roots (Usage), Service Logger, NDJSON Adapter, Client Detection
 * @asseris-called-by    Build Proxy Snapshot, Proxy Cache Service
 * @asseris-emits        per-day proxy snapshot with sessions, burn-rate, cut-impacts, M(t), cc-versions
 * @asseris-consumes     proxy-YYYY-MM-DD.ndjson files
 *
 * NDJSON proxy-log parser module.
 * Extracted from dashboard-server.js to enable reuse and testing.
 *
 * Reads proxy-YYYY-MM-DD.ndjson files, normalizes records via the adapter,
 * and accumulates per-day statistics for the dashboard API.
 *
 * Concept lineage:
 *   Thinking-token overhead detection (thinking_tokens_est, gateway_thinking_tokens):
 *   blind spot identified by @ArkNill; live Q5h capture and quantification via
 *   fgrosswig gateway proxy (2026-04-16). Burn-rate differential confirmed
 *   in gateway Issue #1 (2026-04-20).
 *   Q5h quota divisor measurement (5.2→8.0 range): fgrosswig, 2026-04-20.
 */

let usageScanRoots = require('../domain/usage/scan-roots');
let forEachJsonlLineSync = usageScanRoots.forEachJsonlLineSync;
const quotaDivisor = require('../domain/usage/quota-divisor');
const priceForModel = quotaDivisor.priceForModel;
const FALLBACK_ANTHROPIC_PRICE = quotaDivisor.MODEL_PRICING.opus;
let collectProxyNdjsonFiles = usageScanRoots.collectProxyNdjsonFiles;
let getProxyLogDir = usageScanRoots.getProxyLogDir;
let serviceLog = require('../infra/service-logger');
let adapter = require('../domain/usage/evidence-record-adapter');
let cacheFixUsage = require('./cache-fix-usage-adapter');

function _osFromIp(ip) {
  if (!ip) return null;
  let clean = String(ip).replace(/^::ffff:/, '');
  if (/windows|w11|win/i.test(clean)) return 'Windows';
  if (/darwin|macos|mac/i.test(clean)) return 'macOS';
  if (/linux|ubuntu|debian|rhel/i.test(clean)) return 'Linux';
  return null;
}

function _isPeakHour(isoTimestamp) {
  let d = new Date(isoTimestamp);
  let h = d.getUTCHours();
  let wd = d.getUTCDay();
  return wd >= 1 && wd <= 5 && h >= 13 && h < 19;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Chronologische Sortierung nach .ts (String). Ersetzt verschachtelte Ternaries (S3358).
function _byTsAsc(a, b) {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  return 0;
}

// Sortierung nach .ts mit numerischem/Date-Parse-Fallback (Quota-Timeline).
function _byTsNum(a, b) {
  let ta = typeof a.ts === 'number' ? a.ts : Date.parse(a.ts);
  let tb = typeof b.ts === 'number' ? b.ts : Date.parse(b.ts);
  return ta - tb;
}

// Dominanter (haeufigster) Schluessel eines count-Maps. Geteilt von model_counts/transport_counts.
function _dominantKey(counts, fallback) {
  let best = fallback;
  let bestN = 0;
  for (let k in counts) {
    if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  }
  return best;
}

// Gerundeter Mittelwert eines Feldes ueber ein Sample-Array. Frueher lokal in computeCutImpacts (S7721).
function _avgField(arr, k) {
  return arr.length ? Math.round(arr.reduce(function (a, s) { return a + (s[k] || 0); }, 0) / arr.length) : 0;
}

// ---------------------------------------------------------------------------
// Provider detection from file path or record
// ---------------------------------------------------------------------------

function _providerFromPath(filePath) {
  let fp = filePath.replaceAll('\\', '/');
  if (fp.includes('.cursor/proxy-logs') || fp.includes('cursor-proxy-logs')) return 'cursor';
  if (fp.includes('.openai/proxy-logs') || fp.includes('openai-proxy-logs')) return 'openai';
  if (fp.includes('anthropic-proxy-logs') || fp.includes('.claude/proxy-logs')) return 'anthropic';
  return null;
}

function _providerFromMitm(mh) {
  if (mh.includes('cursor')) return 'cursor';
  if (mh.includes('openai.com') || mh.includes('chatgpt.com')) return 'openai';
  if (mh.includes('anthropic')) return 'anthropic';
  return null;
}

function detectProvider(filePath, rec) {
  let result = null;
  let source = null;
  // Explicit provider field — but '_system' is the gateway SELF-tag, not a vendor.
  // A _system forward still targets a real upstream (Claude Code via the TLS
  // listener writes provider:'_system' with upstream https://api.anthropic.com),
  // so resolve it by that host below instead of burying real user traffic in the
  // _system bucket — which the dashboard hides, making the feed look empty.
  if (rec?.provider && rec.provider !== '_system') { result = rec.provider; source = 'field'; }
  // Real upstream host — covers _system forwards + records with no provider field.
  if (!result) {
    let host = String(rec?.mitm_host || rec?.upstream || '').replace(/^https?:\/\//, '');
    result = _providerFromMitm(host); if (result) source = 'upstream';
  }
  // Fallback heuristics for older records without provider field:
  if (!result && filePath) { result = _providerFromPath(filePath); if (result) source = 'path'; }
  if (!result) { result = _providerFromMitm(rec?.mitm_host || ''); if (result) source = 'mitm_host'; }
  if (!result && (rec?.cursor_summary || rec?.response_hints?.cursor_model_family)) { result = 'cursor'; source = 'cursor_data'; }
  if (!result && (rec?.rpc_method || rec?.rpc_service)) { result = 'cursor'; source = 'rpc'; }
  // Genuine gateway-internal traffic with no resolvable upstream stays _system (hidden).
  if (!result && rec?.provider === '_system') { result = '_system'; source = 'system'; }
  if (!result) { result = 'anthropic'; source = 'default'; }
  if (source !== 'field') {
    serviceLog.debug('proxy-parse', 'detectProvider provider=' + result + ' source=' + source + ' mitm=' + (rec?.mitm_host || '?') + ' path=' + (rec?.path || '?'));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Day bucket
// ---------------------------------------------------------------------------

function emptyProxyDayBucket() {
  return {
    requests: 0,
    errors: 0,
    total_duration_ms: 0,
    min_duration_ms: Infinity,
    max_duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cache_health: { healthy: 0, mixed: 0, affected: 0, na: 0 },
    models: {},
    status_codes: {},
    hours: {},
    rate_limit_snapshots: [],
    q5_samples: [],
    overage_usage: { requests: 0, estimated_cost_usd: 0, models: {}, accounts: {} },
    cold_starts: 0,
    cache_ratios: [],
    per_hour_latency: {},
    false_429s: 0,
    context_resets: 0,
    _prev_cache_read_high: false,
    // claude-code-cache-fix interop fields
    ttl_tiers: { '1h': 0, '5m': 0, unknown: 0 },
    peak_hour_requests: 0,
    off_peak_requests: 0,
    ephemeral_1h_tokens: 0,
    ephemeral_5m_tokens: 0,
    data_sources: {},
    connection_types: {},
    client_types: {},
    cc_plans: {},
    // gateway dashboard fields
    gateway_thinking_tokens: 0,
    gateway_thinking_chars: 0,
    gateway_fix_counts: {},
    gateway_fix_hourly: {},
    gateway_tokens_hourly: {},
    gateway_sessions: {},
    gateway_reset: { ts_5h: 0, ts_7d: 0 },
    gateway_last_requests: [],
    // Per-day CC-version aggregate { "<version>": { first_seen_ts, count } }.
    // Bounded by uniqueness of user-agent versions seen in a single day
    // (typically 1–3, rarely >5). Persists across days so the trajectory
    // widget can detect multi-day version transitions without relying on
    // gateway_last_requests (which is only populated for the latest day).
    gateway_cc_versions: {},
    gateway_requests_by_provider: {},
    connect_monitor: {},
    connect_monitor_count: 0,
    // Error/hit-limit classification
    hit_limit_count: 0,
    error_classes: {},
    // Per-provider aggregation (cursor, anthropic, ...)
    providers: {}
  };
}

function emptyProviderBucket() {
  return {
    requests: 0,
    errors: 0,
    total_duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    thinking_tokens: 0,
    response_bytes: 0,
    models: {},
    status_codes: {},
    // Cursor-specific
    cursor_frames: 0,
    cursor_reasoning_blocks: 0,
    cursor_text_blocks: 0,
    cursor_tool_calls: 0,
    cursor_gzip_frames: 0,
    anthropic_proxied: 0  // Cursor requests with anthropic_msg_id (provider spoofing)
  };
}

// ---------------------------------------------------------------------------
// Pure analytics functions
// ---------------------------------------------------------------------------

/**
 * Compute cumulative 5h-window consumption from chronological q5 samples.
 * Sums only positive deltas between consecutive requests (active consumption),
 * ignoring natural rollback of the rolling 5h window. Tokens of the consuming
 * request are attributed to the delta they caused. Returns:
 *   { consumed: fraction_0_to_many, tokens: sum_input_output, count: num_samples }
 */
function computeQ5Consumption(samples) {
  if (!samples || samples.length < 2) {
    return { consumed: 0, tokens: 0, count: samples?.length || 0 };
  }
  let sorted = samples.slice().sort(_byTsAsc);
  let consumed = 0;
  let tokens = 0;
  for (let i = 1; i < sorted.length; i++) {
    let delta = sorted[i].q5 - sorted[i - 1].q5;
    if (delta > 0) {
      consumed += delta;
      tokens += sorted[i].tokens;
    }
  }
  return { consumed: consumed, tokens: tokens, count: sorted.length };
}

/**
 * Compact session summary for older days — strips points[], keeps hour buckets.
 * Output per session: { hours: {0..23→count}, client_type, totalReqs, totalDur }
 * ~200 bytes/session vs ~50KB with full points[].
 */
function compactSessionSummary(sessions) {
  if (!sessions) return {};
  let out = {};
  for (let sid in sessions) {
    let s = sessions[sid];
    let pts = s.points || [];
    let hours = {};
    let totalDur = 0;
    for (let pt of pts) {
      let h = new Date(pt.ts).getHours();
      hours[h] = (hours[h] || 0) + 1;
      totalDur += (pt.duration_ms || 0);
    }
    out[sid] = {
      hours: hours,
      client_type: s.client_type || 'unknown',
      totalReqs: pts.length,
      totalDur: totalDur,
      model: s.model || 'unknown',
      model_counts: s.model_counts || {},
      cost_usd: _roundUsd(s.cost_usd || 0),
      usage: s.usage || _emptyUsage(),
      started_at: pts.length ? pts[0].ts : null,
      ended_at: pts.length ? pts.at(-1).ts : null
    };
  }
  return out;
}

function _emptyUsage() {
  return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
}

function _roundUsd(value) {
  return Math.round((value || 0) * 1000000) / 1000000;
}

function _usageCostUsd(usage, model) {
  let breakdown = _usageCostBreakdown(usage, model);
  return breakdown.input + breakdown.output + breakdown.cache_read + breakdown.cache_creation;
}

function _usageCostBreakdown(usage, model) {
  if (!usage) return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  let price = priceForModel(model) || FALLBACK_ANTHROPIC_PRICE;
  return {
    input: (usage.input_tokens || 0) * price.input / 1e6,
    output: (usage.output_tokens || 0) * price.output / 1e6,
    cache_read: (usage.cache_read_input_tokens || 0) * price.cache_read / 1e6,
    cache_creation: (usage.cache_creation_input_tokens || 0) * price.cache_creation / 1e6
  };
}

/**
 * Detect quota cuts (q5 drops >5%) and compute pre/post output impact.
 * Returns array of { ts, pre_q5, post_q5, pre_avg_output, post_avg_output,
 *   pre_avg_cache_read, post_avg_cache_read, post_samples }.
 */
function _detectCuts(sorted) {
  let cuts = [];
  for (let i = 1; i < sorted.length; i++) {
    let drop = (sorted[i - 1].q5 - sorted[i].q5) * 100;
    if (drop > 5) {
      cuts.push({ idx: i, ts: sorted[i].ts, pre_q5: sorted[i - 1].q5, post_q5: sorted[i].q5 });
    }
  }
  return cuts;
}

// Sample-Fenster [startIdx, endIdx) mit tokens/cache_read > 0. cap=0 → unbegrenzt.
function _cutWindow(sorted, startIdx, endIdx, cap) {
  let out = [];
  for (let i = startIdx; i < endIdx; i++) {
    if (sorted[i].tokens > 0 || sorted[i].cache_read > 0) out.push(sorted[i]);
    if (cap && out.length >= cap) break;
  }
  return out;
}

function _buildCutImpact(sorted, cuts, ci) {
  let cut = cuts[ci];
  let preStart = Math.max(0, cut.idx - 40);
  let pre = _cutWindow(sorted, preStart, cut.idx, 0);
  if (pre.length > 20) pre = pre.slice(-20);
  let postEnd = ci + 1 < cuts.length ? cuts[ci + 1].idx : Math.min(sorted.length, cut.idx + 40);
  let post = _cutWindow(sorted, cut.idx, postEnd, 20);
  if (pre.length < 3) return null;
  return {
    ts: cut.ts,
    pre_q5: Math.round(cut.pre_q5 * 1000) / 10,
    post_q5: Math.round(cut.post_q5 * 1000) / 10,
    pre_avg_output: _avgField(pre, 'tokens'),
    post_avg_output: _avgField(post, 'tokens'),
    pre_avg_cache_read: _avgField(pre, 'cache_read'),
    post_avg_cache_read: _avgField(post, 'cache_read'),
    pre_samples: pre.length,
    post_samples: post.length,
    output_change_pct: pre.length && post.length
      ? Math.round((_avgField(post, 'tokens') / Math.max(1, _avgField(pre, 'tokens')) - 1) * 100)
      : null
  };
}

function computeCutImpacts(samples) {
  if (!samples || samples.length < 10) return [];
  let sorted = samples.slice().sort(_byTsAsc);
  let cuts = _detectCuts(sorted);
  if (!cuts.length) return [];
  let results = [];
  for (let ci = 0; ci < cuts.length; ci++) {
    let impact = _buildCutImpact(sorted, cuts, ci);
    if (impact) results.push(impact);
  }
  return results;
}

// ---------------------------------------------------------------------------
// M(t) and burn-rate analytics — called once per parse on today's data
// ---------------------------------------------------------------------------

/**
 * Fit quadratic f(t) = a·t² + b·t + c via normal equations (closed-form least squares).
 * Returns [a, b, c] or null if degenerate.
 * @param {number[]} xs - independent variable values
 * @param {number[]} ys - dependent variable values
 */
function fitQuadratic(xs, ys) {
  let n = xs.length;
  if (n < 3) return null;
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    let x = xs[i], y = ys[i];
    let x2 = x * x, x3 = x2 * x, x4 = x3 * x;
    s1 += x; s2 += x2; s3 += x3; s4 += x4;
    t0 += y; t1 += x * y; t2 += x2 * y;
  }
  // Solve 3×3 system [s0 s1 s2; s1 s2 s3; s2 s3 s4] * [c b a]' = [t0 t1 t2]'
  let m = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2]
  ];
  // Gaussian elimination
  for (let col = 0; col < 3; col++) {
    let maxRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[maxRow][col])) maxRow = row;
    }
    let tmp = m[col]; m[col] = m[maxRow]; m[maxRow] = tmp;
    if (Math.abs(m[col][col]) < 1e-12) return null;
    for (let rr = col + 1; rr < 3; rr++) {
      let f = m[rr][col] / m[col][col];
      for (let cc = col; cc <= 3; cc++) m[rr][cc] -= f * m[col][cc];
    }
  }
  let a3 = m[2][3] / m[2][2];
  let a2 = (m[1][3] - m[1][2] * a3) / m[1][1];
  let a1 = (m[0][3] - m[0][2] * a3 - m[0][1] * a2) / m[0][0];
  return [a3, a2, a1]; // [a, b, c] for a·t² + b·t + c
}

// Zeitachse (Stunden ab erstem Punkt) + bytes-Reihe einer Session.
function _sessionTimeAxis(sorted) {
  let t0ms = new Date(sorted[0].ts).getTime();
  let xs = [];
  let ys = [];
  for (let pt of sorted) {
    let tms = new Date(pt.ts).getTime();
    if (Number.isNaN(tms)) continue;
    xs.push((tms - t0ms) / 3600000);
    ys.push(pt.bytes);
  }
  return { xs: xs, ys: ys };
}

// Phantom-Rebuild: Kontext faellt mittendrin stark und waechst danach wieder.
function _isPhantomRebuild(sorted) {
  let midIdx = Math.floor(sorted.length / 3);
  return sorted.length >= 10 &&
    sorted[midIdx] &&
    sorted[midIdx].bytes < sorted[0].bytes * 0.5 &&
    sorted.at(-1).bytes > sorted[midIdx].bytes * 1.5;
}

function _sessionMt(sid, sess) {
  let pts = sess?.points;
  if (!pts || pts.length < 5) return null;
  let sorted = pts.slice().sort(_byTsAsc);
  let axis = _sessionTimeAxis(sorted);
  if (axis.xs.length < 5) return null;
  let coeffs = fitQuadratic(axis.xs, axis.ys);
  if (!coeffs) return null;
  let a = coeffs[0], b = coeffs[1], c = coeffs[2];
  let tNow = axis.xs.at(-1);
  let fNow = a * tNow * tNow + b * tNow + c;
  // Mean of fitted values
  let fSum = 0;
  for (let xk of axis.xs) {
    fSum += a * xk * xk + b * xk + c;
  }
  let fAvg = fSum / axis.xs.length;
  let mt = fAvg > 0 ? Math.max(1, fNow / fAvg) : 1;
  mt = Math.round(mt * 100) / 100;
  let actualCost = _roundUsd(sess.cost_usd || 0);
  return {
    sid: sid,
    model: sess.model || 'unknown',
    source: sess.source || '',
    points_count: sorted.length,
    t_now_h: Math.round(tNow * 10) / 10,
    mt: mt,
    // M(t) is a context-growth diagnostic, not a dollar multiplier. Cost is
    // independently derived from the logged usage classes and served model.
    actual_cost_usd: actualCost,
    real_cost_daily: actualCost,
    overpayment_daily: null,
    split_recommended: mt > 1.8,
    is_phantom_rebuild: _isPhantomRebuild(sorted)
  };
}

/**
 * Compute per-session M(t) from gateway_sessions context growth data.
 * Uses quadratic fit to session context_bytes timeline.
 * Returns array sorted by M(t) descending, max 20 entries.
 *
 * @param {Object} sessions - gateway_sessions map: sid → {points, model, source}
 * @param {number} [dropDailyUsd=3.33] - plan daily price (MAX5 default)
 */
function computeSessionMt(sessions) {
  let results = [];
  if (!sessions || typeof sessions !== 'object') return results;
  for (let sid of Object.keys(sessions)) {
    let entry = _sessionMt(sid, sessions[sid]);
    if (entry) results.push(entry);
  }
  results.sort(function (a, b) { return b.mt - a.mt; });
  return results.slice(0, 20);
}

/**
 * Small, history-safe payload for the Cost Fever report. It retains the
 * roll-up required for a cost-rate curve and the most expensive session lanes
 * without shipping every request point for every historical day.
 */
function buildCostFever(sessions) {
  let buckets = {};
  let liveBuckets = {};
  let rows = [];
  if (!sessions || typeof sessions !== 'object') {
    return { timeline: [], sessions: [], total_cost_usd: 0 };
  }
  function addBucket(map, key, pt) {
    if (!map[key]) map[key] = { cost: 0, cache_read_cost: 0, cache_creation_cost: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    map[key].cost += pt.cost_usd || 0;
    map[key].cache_read_cost += pt.cache_read_cost_usd || 0;
    map[key].cache_creation_cost += pt.cache_creation_cost_usd || 0;
    map[key].cache_read_tokens += pt.cache_read_tokens || 0;
    map[key].cache_creation_tokens += pt.cache_creation_tokens || 0;
  }
  function timelineFromBuckets(map, hourlyFactor) {
    let running = 0;
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (ms) {
      let b = map[String(ms)];
      running += b.cost;
      let cacheTotal = b.cache_read_tokens + b.cache_creation_tokens;
      return {
        ts: new Date(ms).toISOString(),
        cost_usd: _roundUsd(b.cost),
        burn_usd_h: _roundUsd(b.cost * hourlyFactor),
        cumulative_usd: _roundUsd(running),
        cache_read_usd_h: _roundUsd(b.cache_read_cost * hourlyFactor),
        cache_creation_usd_h: _roundUsd(b.cache_creation_cost * hourlyFactor),
        cache_read_ratio: cacheTotal > 0 ? Math.round(b.cache_read_tokens / cacheTotal * 1000) / 10 : null
      };
    });
  }

  for (let sid of Object.keys(sessions)) {
    let sess = sessions[sid] || {};
    let pts = (sess.points || []).slice().sort(_byTsAsc);
    if (!pts.length) continue;
    let mtRow = _sessionMt(sid, sess);
    let modelCounts = sess.model_counts || {};
    let totalModelReqs = Object.values(modelCounts).reduce(function (sum, n) { return sum + (n || 0); }, 0);
    let opusReqs = Object.keys(modelCounts).reduce(function (sum, model) {
      return sum + (String(model).toLowerCase().includes('opus') ? (modelCounts[model] || 0) : 0);
    }, 0);
    let modelBreakdown = Object.keys(modelCounts).map(function (model) {
      return {
        model: model,
        requests: modelCounts[model] || 0,
        cost_usd: _roundUsd(sess.model_costs?.[model] || 0),
        started_at: sess.model_first_ts?.[model] || pts[0].ts,
        ended_at: sess.model_last_ts?.[model] || pts.at(-1).ts
      };
    }).sort(function (a, b) { return b.cost_usd - a.cost_usd; });
    rows.push({
      sid: sid,
      model: sess.model || 'unknown',
      started_at: pts[0].ts,
      ended_at: pts.at(-1).ts,
      duration_ms: Math.max(0, new Date(pts.at(-1).ts).getTime() - new Date(pts[0].ts).getTime()),
      requests: pts.length,
      mt: mtRow ? mtRow.mt : null,
      cost_usd: _roundUsd(sess.cost_usd || 0),
      output_tokens: sess.usage?.output || 0,
      cache_read_tokens: sess.usage?.cache_read || 0,
      model_counts: modelCounts,
      model_breakdown: modelBreakdown,
      opus_share: totalModelReqs > 0 ? Math.round(opusReqs / totalModelReqs * 1000) / 10 : 0
    });

    for (let pt of pts) {
      let ms = new Date(pt.ts).getTime();
      if (Number.isNaN(ms)) continue;
      let bucketMs = Math.floor(ms / 900000) * 900000;
      let key = String(bucketMs);
      addBucket(buckets, key, pt);
      let liveBucketMs = Math.floor(ms / 60000) * 60000;
      let liveKey = String(liveBucketMs);
      addBucket(liveBuckets, liveKey, pt);
    }
  }

  rows.sort(function (a, b) { return b.cost_usd - a.cost_usd; });
  let timeline = timelineFromBuckets(buckets, 4);
  let liveTimeline = timelineFromBuckets(liveBuckets, 60);

  return {
    timeline: timeline,
    live_timeline: liveTimeline,
    sessions: rows.slice(0, 60),
    total_sessions: rows.length,
    total_cost_usd: _roundUsd(rows.reduce(function (sum, row) { return sum + row.cost_usd; }, 0))
  };
}

// Lineare q7-Steigung (q7 pro ms) ueber die juengsten Samples.
function _q7LinearSlope(recent, t0ms) {
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  let nn = recent.length;
  for (let s of recent) {
    let xi = new Date(s.ts).getTime() - t0ms;
    let yi = s.q7;
    sumX += xi; sumY += yi; sumXY += xi * yi; sumX2 += xi * xi;
  }
  let denom = nn * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (nn * sumXY - sumX * sumY) / denom;
}

// Projektion, wann q7 0.99 erreicht (Erschoepfung). 0 = keine Projektion.
function _projectExhaustion(lastSample, currentQ7, slope) {
  if (slope <= 0) return 0;
  let base = new Date(lastSample.ts).getTime();
  let remainingQ7 = 0.99 - currentQ7;
  if (remainingQ7 > 0) return base + remainingQ7 / slope;
  return base; // already exhausted
}

function _burnRiskLevel(projectedMs, reset7d, currentQ7) {
  if (projectedMs > 0 && reset7d > 0) {
    if (projectedMs < reset7d) return 'critical';
    if (projectedMs < reset7d + 86400000) return 'warning';
    return 'ok';
  }
  if (currentQ7 > 0.85) return 'warning';
  return 'ok';
}

/**
 * Compute burn-rate projection from q5 samples and gateway reset timestamps.
 * Fits linear trend to recent q7 samples and projects exhaustion timestamp.
 *
 * @param {Array} q5Samples - array of {ts, q5, q7} objects
 * @param {{ts_5h: number, ts_7d: number}} gatewayReset - reset epoch ms
 */
function computeBurnRate(q5Samples, gatewayReset) {
  let empty = { current_q5: 0, current_q7: 0, projected_exhaustion_ts: 0, days_until_reset: 0, risk_level: 'ok', trend_slope: 0, samples_used: 0 };
  if (!q5Samples || q5Samples.length < 3) return empty;

  let sorted = q5Samples.slice().sort(_byTsAsc);

  // Filter to samples with valid q7
  let withQ7 = sorted.filter(function (s) { return typeof s.q7 === 'number' && s.q7 >= 0 && s.q7 <= 1.1; });
  if (withQ7.length < 3) {
    // Fall back to q5 if no q7 available
    let last5 = sorted.at(-1);
    return { ...empty, current_q5: last5.q5 || 0 };
  }

  let recent = withQ7.slice(-20);
  let lastSample = recent.at(-1);
  let currentQ7 = lastSample.q7;
  let currentQ5 = lastSample.q5 || 0;
  let t0ms = new Date(recent[0].ts).getTime();

  let slope = _q7LinearSlope(recent, t0ms); // q7 per ms
  let projectedMs = _projectExhaustion(lastSample, currentQ7, slope);

  let reset7d = gatewayReset?.ts_7d ? gatewayReset.ts_7d * 1000 : 0;
  let daysUntilReset = reset7d > 0 ? (reset7d - Date.now()) / 86400000 : 0;
  let riskLevel = _burnRiskLevel(projectedMs, reset7d, currentQ7);

  return {
    current_q5: Math.round(currentQ5 * 10000) / 10000,
    current_q7: Math.round(currentQ7 * 10000) / 10000,
    projected_exhaustion_ts: projectedMs > 0 ? Math.round(projectedMs) : 0,
    days_until_reset: Math.round(daysUntilReset * 10) / 10,
    risk_level: riskLevel,
    trend_slope: Math.round(slope * 1e9) / 1e9, // q7 per ms, tiny number
    samples_used: recent.length
  };
}

// ---------------------------------------------------------------------------
// Accumulator functions — one NDJSON record at a time
// ---------------------------------------------------------------------------

/** Request counts, duration, status, false-429, hourly volume — one NDJSON line. */
function proxyNdjsonAccumulateRequestDuration(dd, rec, tsEnd) {
  dd.requests++;
  let dur = rec.duration_ms || 0;
  dd.total_duration_ms += dur;
  if (dur < dd.min_duration_ms) dd.min_duration_ms = dur;
  if (dur > dd.max_duration_ms) dd.max_duration_ms = dur;

  let status = rec.upstream_status || 0;
  dd.status_codes[status] = (dd.status_codes[status] || 0) + 1;
  if (status >= 400) dd.errors++;

  // Hit-limit + error classification (429/529 zaehlen auch ohne pre-computed hit_limit-Feld)
  if (rec.hit_limit || status === 429 || status === 529) {
    dd.hit_limit_count++;
  }
  let ec = rec.error_class;
  if (ec) dd.error_classes[ec] = (dd.error_classes[ec] || 0) + 1;

  // B3: False 429 — client-generated rate limit (no cf-ray = not from Anthropic)
  if (status === 429) {
    let rah = rec.response_anthropic_headers || {};
    if (!rah['cf-ray']) dd.false_429s++;
  }

  if (tsEnd.length >= 13) {
    let hour = Number.parseInt(tsEnd.slice(11, 13), 10);
    if (!Number.isNaN(hour) && hour >= 0 && hour <= 23) {
      dd.hours[hour] = (dd.hours[hour] || 0) + 1;
    }
  }
  return { dur: dur, status: status };
}

// B4: Context Reset heuristic — cache_creation spikes after high cache_read phase.
function _accContextReset(dd, u, status) {
  if (!u || status !== 200) return;
  let crt = u.cache_read_input_tokens || 0;
  let cct = u.cache_creation_input_tokens || 0;
  if (crt > 100000) dd._prev_cache_read_high = true;
  if (dd._prev_cache_read_high && cct > 0 && crt < cct) {
    dd.context_resets++;
    dd._prev_cache_read_high = false;
  }
}

function _accPerHourLatency(dd, tsEnd, dur, status) {
  if (tsEnd.length < 13 || dur <= 0 || status !== 200) return;
  let lhour = Number.parseInt(tsEnd.slice(11, 13), 10);
  if (Number.isNaN(lhour) || lhour < 0 || lhour > 23) return;
  if (!dd.per_hour_latency[lhour]) dd.per_hour_latency[lhour] = { sum: 0, count: 0, max: 0 };
  dd.per_hour_latency[lhour].sum += dur;
  dd.per_hour_latency[lhour].count++;
  if (dur > dd.per_hour_latency[lhour].max) dd.per_hour_latency[lhour].max = dur;
}

/** Usage tokens, context-reset heuristic, cache health, cold starts, per-hour latency. */
function proxyNdjsonAccumulateUsageCacheLatency(dd, rec, tsEnd, dur, status, u) {
  if (u) {
    dd.input_tokens += (u.input_tokens || 0);
    dd.output_tokens += (u.output_tokens || 0);
    dd.cache_read_tokens += (u.cache_read_input_tokens || 0);
    dd.cache_creation_tokens += (u.cache_creation_input_tokens || 0);
  }

  _accContextReset(dd, u, status);

  let ch = rec.cache_health || 'na';
  if (dd.cache_health[ch] === undefined) dd.cache_health.na++;
  else dd.cache_health[ch]++;

  let crr = rec.cache_read_ratio;
  if (typeof crr === 'number' && u && status === 200) {
    dd.cache_ratios.push(crr);
    if (crr < 0.5) dd.cold_starts++;
  }

  _accPerHourLatency(dd, tsEnd, dur, status);
}

function _accModelStats(dd, model, dur, u) {
  if (!dd.models[model]) {
    dd.models[model] = {
      requests: 0,
      avg_duration_ms: 0,
      total_duration_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      estimated_cost_usd: 0
    };
  }
  dd.models[model].requests++;
  dd.models[model].total_duration_ms += dur;
  if (u) {
    dd.models[model].input_tokens += (u.input_tokens || 0);
    dd.models[model].output_tokens += (u.output_tokens || 0);
    dd.models[model].cache_read_tokens += (u.cache_read_input_tokens || 0);
    dd.models[model].cache_creation_tokens += (u.cache_creation_input_tokens || 0);
    dd.models[model].estimated_cost_usd += _usageCostUsd(u, model);
  }
}

function _accStopReasons(dd, rh2) {
  if (!rh2.stop_reason) return;
  if (!dd.stop_reasons) dd.stop_reasons = {};
  dd.stop_reasons[rh2.stop_reason] = (dd.stop_reasons[rh2.stop_reason] || 0) + 1;
}

// q5/q7-Sample aus dem Rate-Limit-Snapshot ziehen (traegt response_model + response_transport).
function _pushQ5Sample(dd, rec, tsEnd, u, snap) {
  let q5Str = snap['anthropic-ratelimit-unified-5h-utilization'];
  let q7Str = snap['anthropic-ratelimit-unified-7d-utilization'];
  if (q5Str == null) return;
  let q5Num = Number.parseFloat(q5Str);
  let q7Num = q7Str == null ? null : Number.parseFloat(q7Str);
  let ovStr = snap['anthropic-ratelimit-unified-overage-utilization'];
  if (Number.isNaN(q5Num) || q5Num < 0) return;
  let sampleModel = rec.response_model || rec.response_hints?.response_model || rec.request_hints?.model || 'unknown';
  let sampleCost = _usageCostBreakdown(u || {}, sampleModel);
  dd.q5_samples.push({
    ts: tsEnd,
    q5: q5Num,
    q7: q7Num,
    ov: ovStr == null ? null : Number.parseFloat(ovStr),
    model: sampleModel,
    response_model: rec.response_model || rec.response_hints?.response_model || null,
    response_transport: rec.response_transport || rec.response_hints?.response_transport || null,
    status: snap['anthropic-ratelimit-unified-7d-status'] || null,
    tokens: (u?.input_tokens || 0) + (u?.output_tokens || 0),
    input_tokens: u?.input_tokens || 0,
    output_tokens: u?.output_tokens || 0,
    cache_read: u?.cache_read_input_tokens || 0,
    cache_creation: u?.cache_creation_input_tokens || 0,
    cost_usd: _roundUsd(sampleCost.input + sampleCost.output + sampleCost.cache_read + sampleCost.cache_creation),
    cache_read_cost_usd: _roundUsd(sampleCost.cache_read),
    cache_creation_cost_usd: _roundUsd(sampleCost.cache_creation),
    source: rec.source || null
  });
}

function buildRequestCostFever(samples) {
  let synthetic = {
    points: [],
    model: 'request telemetry',
    model_counts: {},
    model_costs: {},
    model_first_ts: {},
    model_last_ts: {},
    usage: { output: 0, cache_read: 0 },
    cost_usd: 0
  };
  for (let sample of samples || []) {
    if (!sample?.ts) continue;
    let model = sample.model || 'unknown';
    synthetic.model_counts[model] = (synthetic.model_counts[model] || 0) + 1;
    synthetic.model_costs[model] = (synthetic.model_costs[model] || 0) + (sample.cost_usd || 0);
    if (!synthetic.model_first_ts[model]) synthetic.model_first_ts[model] = sample.ts;
    synthetic.model_last_ts[model] = sample.ts;
    synthetic.usage.output += sample.output_tokens || 0;
    synthetic.usage.cache_read += sample.cache_read || 0;
    synthetic.cost_usd += sample.cost_usd || 0;
    synthetic.points.push({
      ts: sample.ts,
      bytes: 0,
      cost_usd: sample.cost_usd || 0,
      cache_read_cost_usd: sample.cache_read_cost_usd || 0,
      cache_creation_cost_usd: sample.cache_creation_cost_usd || 0,
      cache_read_tokens: sample.cache_read || 0,
      cache_creation_tokens: sample.cache_creation || 0
    });
  }
  if (!synthetic.points.length) return { timeline: [], live_timeline: [], sessions: [], total_sessions: 0, total_cost_usd: 0, request_only: true };
  let result = buildCostFever({ request_telemetry: synthetic });
  result.sessions = [];
  result.total_sessions = 0;
  result.request_only = true;
  result.request_count = synthetic.points.length;
  return result;
}

function _accRateLimit(dd, rec, tsEnd, u) {
  let rlh = rec.response_anthropic_headers;
  if (!rlh) return;
  let snap = {};
  let hasRl = false;
  for (let rk in rlh) {
    if (rk.startsWith('anthropic-ratelimit')) {
      snap[rk] = rlh[rk];
      hasRl = true;
    }
  }
  if (!hasRl) return;
  snap._ts = tsEnd;
  snap._account_key = rec.account_key || null;
  snap._organization_id = rlh['anthropic-organization-id'] || null;
  // Different Anthropic model paths expose different subsets. Fable/credit
  // responses may contain only overage fields and no q5/q7 values. Merge the
  // fresh fields into the last snapshot instead of erasing still-current quota
  // fields. Keep sampling based on the unmerged response so a missing q5 header
  // does not become a fabricated flat q5 observation.
  let previous = dd.rate_limit_snapshots[0] || {};
  let merged = Object.assign({}, previous, snap);
  if (snap['anthropic-ratelimit-unified-overage-status'] === 'allowed') {
    delete merged['anthropic-ratelimit-unified-overage-disabled-reason'];
  }
  dd.rate_limit_snapshots = [merged];
  _pushQ5Sample(dd, rec, tsEnd, u, snap);

  if (Number(rec.upstream_status || 0) === 200 && u) {
    let model = rec.response_model || rec.response_hints?.response_model
      || rec.request_hints?.model || 'unknown';
    // The bearer-derived account_key can rotate with credentials. Anthropic's
    // response organization id is the stable billing/account scope.
    let accountKey = snap._organization_id || rec.account_key || 'unknown';
    let cost = _usageCostUsd(u, model);
    if (!dd.overage_usage.accounts[accountKey]) {
      dd.overage_usage.accounts[accountKey] = {
        requests: 0,
        estimated_cost_usd: 0,
        total_requests: 0,
        total_estimated_cost_usd: 0,
        plan_unmarked_requests: 0,
        plan_unmarked_cost_usd: 0,
        models: {}
      };
    }
    let accountUsage = dd.overage_usage.accounts[accountKey];
    if (!accountUsage.models[model]) {
      accountUsage.models[model] = {
        requests: 0,
        estimated_cost_usd: 0,
        total_requests: 0,
        total_estimated_cost_usd: 0,
        plan_unmarked_requests: 0,
        plan_unmarked_cost_usd: 0
      };
    }
    let accountModel = accountUsage.models[model];
    let isOverage = String(snap['anthropic-ratelimit-unified-overage-in-use']).toLowerCase() === 'true';
    accountUsage.total_requests++;
    accountUsage.total_estimated_cost_usd += cost;
    accountModel.total_requests++;
    accountModel.total_estimated_cost_usd += cost;
    if (isOverage) {
      dd.overage_usage.requests++;
      dd.overage_usage.estimated_cost_usd += cost;
      if (!dd.overage_usage.models[model]) {
        dd.overage_usage.models[model] = { requests: 0, estimated_cost_usd: 0 };
      }
      dd.overage_usage.models[model].requests++;
      dd.overage_usage.models[model].estimated_cost_usd += cost;
      accountUsage.requests++;
      accountUsage.estimated_cost_usd += cost;
      accountModel.requests++;
      accountModel.estimated_cost_usd += cost;
    } else {
      accountUsage.plan_unmarked_requests++;
      accountUsage.plan_unmarked_cost_usd += cost;
      accountModel.plan_unmarked_requests++;
      accountModel.plan_unmarked_cost_usd += cost;
    }
  }
}

// TTL-Tier, cc_plan, ephemeral tokens, peak-hour, data_source.
function _accInteropCounters(dd, rec, tsEnd) {
  let ttl = rec.ttl_tier || 'unknown';
  if (dd.ttl_tiers[ttl] === undefined) dd.ttl_tiers.unknown++;
  else dd.ttl_tiers[ttl]++;

  if (rec.cc_plan) dd.cc_plans[rec.cc_plan] = (dd.cc_plans[rec.cc_plan] || 0) + 1;

  dd.ephemeral_1h_tokens += (rec.ephemeral_1h_input_tokens || 0);
  dd.ephemeral_5m_tokens += (rec.ephemeral_5m_input_tokens || 0);

  let isPeak = rec.peak_hour == null ? _isPeakHour(tsEnd) : rec.peak_hour;
  if (isPeak) dd.peak_hour_requests++;
  else dd.off_peak_requests++;

  let src = rec.source || 'proxy';
  dd.data_sources[src] = (dd.data_sources[src] || 0) + 1;
}

// Connection-Type inkl. Cursor-Idle-Heuristik + non-LLM housekeeping (monitor).
// Non-inference traffic — Claude Code control-plane (worker/events, heartbeat, presence),
// telemetry (event_logging), oauth, bootstrap, mcp-registry, desktop-update — is demoted
// to 'monitor' so the default Request-Feed shows only real model/inference requests (each
// with a model). Nothing is dropped: the Monitor toggle reveals the demoted rows, and the
// frontend already excludes 'monitor' from the feed list + vendor counts (gateway.js).
function _resolveConnType(rec, sourceFile, rpcMethod) {
  let connType = rec.connection_type || 'forward';
  let isCursor = (rec.client_type || '').includes('cursor') || detectProvider(sourceFile, rec) === 'cursor';
  if (isCursor) {
    // Connect protocol idle RPCs (GetTeams, AvailableModels etc.)
    if (rpcMethod && rpcMethod !== 'Run' && rpcMethod !== 'StreamChat' && rpcMethod !== 'Chat') connType = 'monitor';
    // Plain HTTPS without model/usage (polling, config, telemetry)
    if (!rpcMethod && !rec.usage && !rec.response_hints?.response_model && !rec.cursor_model) connType = 'monitor';
    return connType;
  }
  // Anthropic / OpenAI (+ future): a record is a real inference request only if it hits a
  // model endpoint or carries a model signal (usage / response_model). Everything else is
  // control-plane housekeeping → monitor.
  let p = rec.path || '';
  let isModelCall = p.startsWith('/v1/messages')          // Anthropic (incl. count_tokens)
    || p.includes('/codex/responses')                     // Codex
    || p.startsWith('/v1/chat/completions')               // OpenAI Chat Completions
    || p.startsWith('/v1/responses');                     // OpenAI Responses
  // Model signal = an actually-served model name (string). NOT rec.usage — some accumulator
  // steps normalize usage to an empty object {}, and !!{} is true, which would keep every
  // housekeeping record in the feed.
  let hasModelSignal = !!rec.response_model || !!(rec.response_hints && rec.response_hints.response_model);
  if (!isModelCall && !hasModelSignal) connType = 'monitor';
  return connType;
}

// Client-Type: nur ueberschreiben, wenn Cursor sich als etwas anderes ausgibt.
function _resolveClientType(rec, sourceFile) {
  let detectedProvider = detectProvider(sourceFile, rec);
  let rawClientType = rec.client_type || 'unknown';
  if (detectedProvider === 'cursor' && !rawClientType.includes('cursor')) return 'cursor';
  return rawClientType;
}

function _accGatewayFixes(dd, gfa, tsEnd) {
  if (!Array.isArray(gfa)) return;
  let gfHour = tsEnd.length >= 13 ? String(new Date(tsEnd).getUTCHours()) : null;
  for (let gfi of gfa) {
    dd.gateway_fix_counts[gfi] = (dd.gateway_fix_counts[gfi] || 0) + 1;
    if (gfHour !== null) {
      if (!dd.gateway_fix_hourly[gfi]) dd.gateway_fix_hourly[gfi] = {};
      dd.gateway_fix_hourly[gfi][gfHour] = (dd.gateway_fix_hourly[gfi][gfHour] || 0) + 1;
    }
  }
}

// Hourly token breakdown (cache_read, overhead, output).
function _accTokensHourly(dd, u, tsEnd) {
  if (!u || tsEnd.length < 13) return;
  let gtHour = String(new Date(tsEnd).getUTCHours());
  if (!dd.gateway_tokens_hourly[gtHour]) {
    dd.gateway_tokens_hourly[gtHour] = { cache_read: 0, cache_creation: 0, input: 0, output: 0, requests: 0 };
  }
  let gth = dd.gateway_tokens_hourly[gtHour];
  gth.cache_read += (u.cache_read_input_tokens || 0);
  gth.cache_creation += (u.cache_creation_input_tokens || 0);
  gth.input += (u.input_tokens || 0);
  gth.output += (u.output_tokens || 0);
  gth.requests++;
}

function _accResetTimestamps(dd, rlh) {
  if (!rlh) return;
  let r5h = rlh['anthropic-ratelimit-unified-5h-reset'];
  let r7d = rlh['anthropic-ratelimit-unified-7d-reset'];
  if (r5h) dd.gateway_reset.ts_5h = Number.parseInt(r5h, 10) || 0;
  if (r7d) dd.gateway_reset.ts_7d = Number.parseInt(r7d, 10) || 0;
}

// Feed-Entry in logische Gruppen geteilt (Spread), damit keine Helferfunktion eine lange
// `||`-Default-Kette traegt — identische Semantik, kein zusaetzlicher Laufzeitaufwand.
function _feedCore(rec, tsEnd, u, dur, gfa) {
  return {
    ts: tsEnd,
    model: rec.response_model || rec.response_hints?.response_model || rec.request_hints?.model || 'unknown',
    duration_ms: dur,
    cache_health: rec.cache_health || 'na',
    status: rec.upstream_status || 0,
    fixes: gfa || [],
    input_tokens: u?.input_tokens || 0,
    output_tokens: u?.output_tokens || 0,
    cache_read: u?.cache_read_input_tokens || 0,
    thinking_tokens: rec.thinking_tokens_est || 0,
    response_model: rec.response_model || rec.response_hints?.response_model || null,
    response_transport: rec.response_transport || rec.response_hints?.response_transport || null
  };
}

function _feedSource(rec, ua) {
  return {
    source_ip: rec.source_ip || rec.req_headers_redacted?.['x-forwarded-for']?.split(',')[0]?.trim() || rec.remote_addr || null,
    source_os: rec.source_os || rec.cursor_os || rec.req_headers_redacted?.['x-stainless-os'] || rec.req_headers_redacted?.['x-cursor-client-os'] || _osFromIp(rec.source_ip || rec.remote_addr) || null,
    source_cli: /claude-cli\/([^\s(]+)/.exec(ua)?.[1] || rec.cursor_version || rec.req_headers_redacted?.['x-cursor-client-version'] || null,
    source_client: /\(([^)]+)\)/.exec(ua)?.[1] || null,
    tls: rec.tls || false,
    session_id: rec.session_id || null,
    account_key: rec.account_key || null,
    serializer_wait_ms: rec.serializer_wait_ms || 0,
    mitm_host: rec.mitm_host || null,
    upstream: rec.upstream || null,
    rpc_method: rec.rpc_method || null,
    rpc_service: rec.rpc_service || null
  };
}

function _feedCursor(rec) {
  return {
    cursor_model: rec.cursor_model || null,
    cursor_model_family: rec.cursor_summary?.model_family || rec.response_hints?.cursor_model_family || null,
    cursor_request_id: rec.cursor_summary?.request_id || rec.response_hints?.cursor_request_id || null,
    cursor_frame_count: rec.cursor_summary?.frame_count || rec.response_hints?.cursor_frame_count || 0,
    cursor_gzip_frames: rec.cursor_summary?.gzip_frame_count || rec.response_hints?.cursor_gzip_frames || 0,
    cursor_reasoning_blocks: rec.cursor_summary?.reasoning_blocks || rec.response_hints?.cursor_reasoning_blocks || 0,
    cursor_text_blocks: rec.cursor_summary?.text_blocks || rec.response_hints?.cursor_text_blocks || 0,
    cursor_tool_calls: rec.cursor_summary?.tool_calls || rec.response_hints?.cursor_tool_calls || 0,
    ghost_mode: rec.ghost_mode || false,
    response_bytes: rec.response_bytes_logged || 0,
    anthropic_msg_id: rec.cursor_summary?.anthropic_msg_id || null,
    security_hits: rec.security_hits || null
  };
}

// meta = { clientType, connType, provider } — gebuendelt, um die Parameterliste kurz zu halten (S107).
function _buildFeedEntry(rec, tsEnd, u, dur, gfa, meta) {
  let ua = rec.req_headers_redacted?.['user-agent'] || '';
  return {
    ..._feedCore(rec, tsEnd, u, dur, gfa),
    ..._feedSource(rec, ua),
    ..._feedCursor(rec),
    client_type: meta.clientType,
    connection_type: meta.connType,
    provider: meta.provider
  };
}

// Per-provider buffer (5000 each).
function _accProviderBuffer(dd, feedEntry, provider) {
  if (!dd.gateway_requests_by_provider[provider]) dd.gateway_requests_by_provider[provider] = [];
  let provBuf = dd.gateway_requests_by_provider[provider];
  provBuf.push(feedEntry);
  if (provBuf.length > 5000) dd.gateway_requests_by_provider[provider] = provBuf.slice(-5000);
}

// Cursor-spezifische Frame-/Block-Aggregation im Provider-Bucket.
function _accProviderCursor(pb, feedEntry) {
  pb.cursor_frames += feedEntry.cursor_frame_count || 0;
  pb.cursor_reasoning_blocks += feedEntry.cursor_reasoning_blocks || 0;
  pb.cursor_text_blocks += feedEntry.cursor_text_blocks || 0;
  pb.cursor_tool_calls += feedEntry.cursor_tool_calls || 0;
  pb.cursor_gzip_frames += feedEntry.cursor_gzip_frames || 0;
  if (feedEntry.anthropic_msg_id) pb.anthropic_proxied++;
}

// Per-provider day aggregation.
function _accProviderDay(dd, feedEntry, rec, u, dur, provider) {
  if (!dd.providers[provider]) dd.providers[provider] = emptyProviderBucket();
  let pb = dd.providers[provider];
  pb.requests++;
  if ((rec.upstream_status || 0) >= 400) pb.errors++;
  pb.total_duration_ms += dur;
  pb.input_tokens += u?.input_tokens || 0;
  pb.output_tokens += u?.output_tokens || 0;
  pb.cache_read_tokens += u?.cache_read_input_tokens || 0;
  pb.cache_creation_tokens += u?.cache_creation_input_tokens || 0;
  pb.thinking_tokens += rec.thinking_tokens_est || 0;
  pb.response_bytes += rec.response_bytes_logged || 0;
  let provModel = feedEntry.cursor_model || feedEntry.response_model || feedEntry.model || 'unknown';
  pb.models[provModel] = (pb.models[provModel] || 0) + 1;
  pb.status_codes[feedEntry.status] = (pb.status_codes[feedEntry.status] || 0) + 1;
  if (provider === 'cursor') _accProviderCursor(pb, feedEntry);
}

function _accProviderBucket(dd, feedEntry, rec, u, dur, provider) {
  _accProviderBuffer(dd, feedEntry, provider);
  _accProviderDay(dd, feedEntry, rec, u, dur, provider);
}

// CC-version aggregate (multi-day persistent basis for trajectory markers). NDJSON is
// append-only in arrival order, so the first record seen for a version is the earliest.
function _accCcVersions(dd, feedEntry) {
  if (!feedEntry.source_cli) return;
  let cv = dd.gateway_cc_versions[feedEntry.source_cli];
  if (cv) {
    cv.count++;
  } else {
    dd.gateway_cc_versions[feedEntry.source_cli] = { first_seen_ts: feedEntry.ts, count: 1 };
  }
}

// Session-ID aufloesen: explizit, Cursor request_id, sonst IP+Zeit-Gap-Backfill.
function _resolveSessionId(rec, tsEnd, dd, ctxBytes, rpc) {
  let sid = rec.session_id || rec.req_headers_redacted?.['x-claude-code-session-id'] || rec.req_headers_redacted?.['x-client-request-id'] || rec.req_headers_redacted?.session_id;
  // For Cursor RPC: use request_id as session fallback
  if (!sid && rpc) sid = rec.cursor_summary?.request_id || null;
  // Backfill: infer session from IP + time gap when session_id missing
  if (!sid && (ctxBytes > 0 || rpc)) {
    let bfIp = rec.source_ip || rec.req_headers_redacted?.['x-forwarded-for']?.split(',')[0]?.trim() || '?';
    if (!dd._backfillState) dd._backfillState = {};
    let bfs = dd._backfillState[bfIp] || { lastTs: 0, counter: 0 };
    let tsMs = new Date(tsEnd).getTime();
    if (!bfs.lastTs || (tsMs - bfs.lastTs) > 300000) bfs.counter++;
    bfs.lastTs = tsMs;
    dd._backfillState[bfIp] = bfs;
    sid = 'bf-' + bfIp.replaceAll('.', '_') + '-' + String(bfs.counter).padStart(3, '0');
  }
  return sid;
}

function _initSession(rec, clientType, provider) {
  let srcIp = rec.req_headers_redacted?.['x-forwarded-for']?.split(',')[0]?.trim() || '';
  let srcOs = rec.req_headers_redacted?.['x-stainless-os'] || '';
  let srcLabel = srcIp ? srcIp.split('.').pop() : '';
  if (srcOs) srcLabel += srcLabel ? '/' + srcOs.charAt(0) : srcOs.charAt(0);
  return {
    points: [],
    model: rec.request_hints?.model || 'unknown',
    model_counts: {},
    model_costs: {},
    model_first_ts: {},
    model_last_ts: {},
    transport: null,
    transport_counts: {},
    source: srcLabel,
    source_ip: srcIp || null,
    client_type: clientType,
    connection_type: rec.connection_type || 'forward',
    provider: provider,
    usage: _emptyUsage(),
    cost_usd: 0
  };
}

// Dominanter Transport pro Session (sse | json | connect), analog zum Modell.
function _accSessionTransport(sess, rec) {
  let reqTransport = rec.response_transport || rec.response_hints?.response_transport || null;
  if (!reqTransport) return;
  if (!sess.transport_counts) sess.transport_counts = {};
  sess.transport_counts[reqTransport] = (sess.transport_counts[reqTransport] || 0) + 1;
  sess.transport = _dominantKey(sess.transport_counts, sess.transport);
}

// Per-session context-growth tracking. /v1/messages (Claude Code, Desktop) + Cursor RPC.
function _accSessionGrowth(dd, rec, tsEnd, dur, clientType, provider, usage) {
  let recPath = rec.path || '';
  let rpc = rec.rpc_method || '';
  let isApiCall = recPath.startsWith('/v1/messages')
    || rpc === 'StreamChat' || rpc === 'Run' || rpc === 'Chat'
    || recPath.includes('/codex/responses')
    || recPath.startsWith('/v1/chat/completions')
    || recPath.startsWith('/v1/responses');
  if (!isApiCall) return;
  let ctxBytes = rec.context_bytes || rec.request_meta?.content_length || 0;
  let sid = _resolveSessionId(rec, tsEnd, dd, ctxBytes, rpc);
  if (!sid || (ctxBytes <= 0 && !rpc)) return;
  if (!dd.gateway_sessions[sid]) dd.gateway_sessions[sid] = _initSession(rec, clientType, provider);
  let sess = dd.gateway_sessions[sid];
  // Track model per request — prefer response_model (actual served) over request model
  let reqModel = rec.response_model || rec.response_hints?.response_model || rec.request_hints?.model || 'unknown';
  sess.model_counts[reqModel] = (sess.model_counts[reqModel] || 0) + 1;
  sess.model = _dominantKey(sess.model_counts, '');
  _accSessionTransport(sess, rec);
  sess.client_type = clientType;
  if (rec.connection_type) sess.connection_type = rec.connection_type;
  let requestCostBreakdown = _usageCostBreakdown(usage, reqModel);
  let requestCost = requestCostBreakdown.input + requestCostBreakdown.output +
    requestCostBreakdown.cache_read + requestCostBreakdown.cache_creation;
  sess.model_costs[reqModel] = (sess.model_costs[reqModel] || 0) + requestCost;
  if (!sess.model_first_ts[reqModel]) sess.model_first_ts[reqModel] = tsEnd;
  sess.model_last_ts[reqModel] = tsEnd;
  if (!sess.usage) sess.usage = _emptyUsage();
  sess.usage.input += usage?.input_tokens || 0;
  sess.usage.output += usage?.output_tokens || 0;
  sess.usage.cache_read += usage?.cache_read_input_tokens || 0;
  sess.usage.cache_creation += usage?.cache_creation_input_tokens || 0;
  sess.cost_usd = (sess.cost_usd || 0) + requestCost;
  sess.points.push({
    ts: tsEnd,
    bytes: ctxBytes,
    duration_ms: dur,
    cache_health: rec.cache_health || 'na',
    model: reqModel,
    cost_usd: _roundUsd(requestCost),
    cache_read_cost_usd: _roundUsd(requestCostBreakdown.cache_read),
    cache_creation_cost_usd: _roundUsd(requestCostBreakdown.cache_creation),
    cache_read_tokens: usage?.cache_read_input_tokens || 0,
    cache_creation_tokens: usage?.cache_creation_input_tokens || 0
  });
  if (sess.points.length > 500) sess.points = sess.points.slice(-500);
}

/** Models, stop reasons, rate-limit snapshot + q5 samples, cache-fix interop fields. */
function proxyNdjsonAccumulateModelsRateInterop(dd, rec, tsEnd, u, dur, sourceFile) {
  let model = rec.response_model || rec.response_hints?.response_model || rec.request_hints?.model || 'unknown';
  _accModelStats(dd, model, dur, u);
  _accStopReasons(dd, rec.response_hints || {});
  _accRateLimit(dd, rec, tsEnd, u);
  _accInteropCounters(dd, rec, tsEnd);

  let rpcMethod = rec.rpc_method || '';
  let connType = _resolveConnType(rec, sourceFile, rpcMethod);
  dd.connection_types[connType] = (dd.connection_types[connType] || 0) + 1;

  let clientType = _resolveClientType(rec, sourceFile);
  dd.client_types[clientType] = (dd.client_types[clientType] || 0) + 1;

  let gfa = rec.gateway_fixes_applied;
  _accGatewayFixes(dd, gfa, tsEnd);

  // Gateway dashboard: thinking tokens
  dd.gateway_thinking_tokens += (rec.thinking_tokens_est || 0);
  dd.gateway_thinking_chars += (rec.thinking_chars || 0);

  _accTokensHourly(dd, u, tsEnd);
  _accResetTimestamps(dd, rec.response_anthropic_headers);

  let provider = detectProvider(sourceFile, rec);
  let feedEntry = _buildFeedEntry(rec, tsEnd, u, dur, gfa, { clientType: clientType, connType: connType, provider: provider });
  _accProviderBucket(dd, feedEntry, rec, u, dur, provider);

  // Merged buffer (500 recent across all providers)
  dd.gateway_last_requests.push(feedEntry);
  if (dd.gateway_last_requests.length > 500) dd.gateway_last_requests = dd.gateway_last_requests.slice(-500);

  _accCcVersions(dd, feedEntry);
  _accSessionGrowth(dd, rec, tsEnd, dur, clientType, provider, u);
}

// ---------------------------------------------------------------------------
// Main parse orchestrator
// ---------------------------------------------------------------------------

function _monitorProvider(mHost, rec, currentFile) {
  let hh = (mHost || '').toLowerCase();
  if (hh.includes('cursor')) return 'cursor';
  if (hh.includes('openai.com') || hh.includes('chatgpt.com')) return 'openai';
  if (hh.includes('anthropic')) return 'anthropic';
  return detectProvider(currentFile, rec);
}

function _monitorEntry(rec, tsEnd, mHost, provider) {
  return {
    ts: tsEnd, model: mHost, duration_ms: rec.duration_ms || 0,
    cache_health: 'na', status: 0, fixes: [],
    input_tokens: 0, output_tokens: 0, cache_read: 0, thinking_tokens: 0,
    response_model: null, source_ip: rec.source_ip || null,
    source_os: rec.source_os || _osFromIp(rec.source_ip) || null,
    client_type: 'monitor', connection_type: 'monitor', tls: false,
    provider: provider,
    monitor_bytes_sent: rec.bytes_sent || 0, monitor_bytes_received: rec.bytes_received || 0
  };
}

// Stundenbucket eines Monitor-Hosts (count / bytes / latency).
function _accMonitorHourly(mon, tsEnd, rec) {
  if (tsEnd.length < 13) return;
  let monHour = String(new Date(tsEnd).getUTCHours());
  if (!mon.hourly[monHour]) mon.hourly[monHour] = { count: 0, bytes_received: 0, total_ms: 0 };
  mon.hourly[monHour].count++;
  mon.hourly[monHour].bytes_received += rec.bytes_received || 0;
  mon.hourly[monHour].total_ms += rec.duration_ms || 0;
}

// Connect-monitor records (passthrough metadata only).
function _handleConnectMonitor(dd, rec, tsEnd, currentFile) {
  dd.connect_monitor_count++;
  let mHost = rec.hostname || 'unknown';
  if (!dd.connect_monitor[mHost]) dd.connect_monitor[mHost] = { count: 0, bytes_sent: 0, bytes_received: 0, total_ms: 0, latencies: [], hourly: {} };
  let mon = dd.connect_monitor[mHost];
  mon.count++;
  mon.bytes_sent += rec.bytes_sent || 0;
  mon.bytes_received += rec.bytes_received || 0;
  mon.total_ms += rec.duration_ms || 0;
  if (rec.duration_ms) mon.latencies.push(rec.duration_ms);
  if (mon.latencies.length > 1000) mon.latencies = mon.latencies.slice(-1000);
  _accMonitorHourly(mon, tsEnd, rec);
  let monProvider = _monitorProvider(mHost, rec, currentFile);
  let monEntry = _monitorEntry(rec, tsEnd, mHost, monProvider);
  dd.gateway_last_requests.push(monEntry);
  if (dd.gateway_last_requests.length > 500) dd.gateway_last_requests = dd.gateway_last_requests.slice(-500);
  // Also bucket monitor entries per-provider so the vendor filter + Monitor toggle
  // work together (not only in the merged "all" view).
  if (!dd.gateway_requests_by_provider[monProvider]) dd.gateway_requests_by_provider[monProvider] = [];
  let monBuf = dd.gateway_requests_by_provider[monProvider];
  monBuf.push(monEntry);
  if (monBuf.length > 5000) dd.gateway_requests_by_provider[monProvider] = monBuf.slice(-5000);
}

function _processNdjsonLine(line, daily, currentFile) {
  if (!line.trim()) return;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (parseErr) {
    serviceLog.debug('proxy-parse', 'skip malformed ndjson line: ' + (parseErr.message || parseErr));
    return;
  }

  // Skip error-only records
  if (rec.error && !rec.ts_end) return;

  // Normalize via adapter (fills defaults, computes derived fields)
  rec = adapter.normalizeRecord(rec);

  let tsEnd = rec.ts_end || rec.ts_start || '';
  if (tsEnd.length < 10) return;
  let dayKey = tsEnd.slice(0, 10);

  if (!daily[dayKey]) daily[dayKey] = emptyProxyDayBucket();
  let dd = daily[dayKey];

  if (rec.type === 'connect-monitor') {
    _handleConnectMonitor(dd, rec, tsEnd, currentFile);
    return;
  }

  let durStatus = proxyNdjsonAccumulateRequestDuration(dd, rec, tsEnd);
  let u = rec.usage;
  proxyNdjsonAccumulateUsageCacheLatency(dd, rec, tsEnd, durStatus.dur, durStatus.status, u);
  proxyNdjsonAccumulateModelsRateInterop(dd, rec, tsEnd, u, durStatus.dur, currentFile);
}

// File-Auswahl: explizite Liste oder Discovery + 31d-Fenster.
function _resolveParseFiles(opts) {
  if (Array.isArray(opts.files)) return opts.files.slice();
  let files = collectProxyNdjsonFiles();
  // Aggregation window (default 31d): unbounded growth crossed V8's max string
  // length in the /api/debug/proxy-logs export on 2026-06-04 — every file outside
  // the window is excluded by the YYYY-MM-DD in its basename; undated files kept.
  let parseMaxDays = Number(process.env.PROXY_PARSE_MAX_DAYS) > 0
    ? Number(process.env.PROXY_PARSE_MAX_DAYS) : 31;
  let parseCutoffKey = new Date(Date.now() - parseMaxDays * 86400000).toISOString().slice(0, 10);
  let allFilesCount = files.length;
  let filtered = files.filter(function (f) {
    let m = /(\d{4}-\d{2}-\d{2})[^\\/]*\.ndjson$/.exec(String(f));
    return !m || m[1] >= parseCutoffKey;
  });
  if (filtered.length < allFilesCount) {
    serviceLog.info('proxy-parse', 'window ' + parseMaxDays + 'd: parsing ' + filtered.length +
      '/' + allFilesCount + ' files (cutoff ' + parseCutoffKey + ')');
  }
  return filtered;
}

/**
 * @param {Object} [opts]
 * @param {string[]|null} [opts.files] - Explicit file set; skips discovery AND
 *   the 31d window filter (the caller already selected the files).
 * @param {boolean} [opts.latestDayFull=true] - false → every day gets the
 *   compact form (used by the per-day cache builder).
 */
function parseProxyNdjsonFiles(opts) {
  opts = opts || {};
  let latestDayFull = opts.latestDayFull !== false;
  let files = _resolveParseFiles(opts);
  let cacheFixFiles = opts.files ? [] : cacheFixUsage.collect(process.env, usageScanRoots.HOME);
  let cacheFixDebug = opts.files ? { file: null, days: {} } :
    require('./cache-fix-debug-adapter').collect(process.env, usageScanRoots.HOME);
  let daily = {};
  let seenIds = new Set();

  for (let file of files) {
    try {
      forEachJsonlLineSync(file, function (line) {
        try {
          let rec = JSON.parse(line);
          if (rec.req_id && seenIds.has(rec.req_id)) return;
          if (rec.req_id) seenIds.add(rec.req_id);
        } catch (e) { return; }
        _processNdjsonLine(line, daily, file);
      });
    } catch (e) {
      serviceLog.warn('proxy-parse', 'ndjson read failed ' + file + ': ' + (e.message || e));
    }
  }
  for (let file of cacheFixFiles) {
    let evidenceSource = /(?:^|[\\/])claude-meter\.jsonl$/i.test(file)
      ? 'claude-code-meter'
      : 'claude-code-cache-fix';
    try {
      forEachJsonlLineSync(file, function (line) {
        let raw;
        try { raw = JSON.parse(line); } catch (e) { return; }
        let rec = cacheFixUsage.translate(raw, evidenceSource);
        if (!rec || seenIds.has(rec.req_id)) return;
        seenIds.add(rec.req_id);
        _processNdjsonLine(JSON.stringify(rec), daily, file);
      });
    } catch (e) {
      serviceLog.warn('evidence-parse', 'cache-fix usage read failed ' + file + ': ' + (e.message || e));
    }
  }

  // Build result array
  let days = Object.keys(daily).sort(function (a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  });
  let result = [];
  for (let key of days) {
    let isLatest = latestDayFull && key === days.at(-1);
    let built = buildProxyDayResult(key, daily[key], isLatest);
    if (cacheFixDebug.days[key]) built.cache_fix_debug = cacheFixDebug.days[key];
    result.push(built);
  }

  return {
    proxy_days: result,
    proxy_log_dir: getProxyLogDir(),
    proxy_files: files.length,
    cache_fix_usage_files: cacheFixFiles.length,
    cache_fix_debug_file: cacheFixDebug.file,
    evidence_files: files.length + cacheFixFiles.length,
    host_labels: {},
    account_labels: {},
    generated: new Date().toISOString()
  };
}

function _modelAverages(models) {
  for (let mk of Object.keys(models)) {
    let m = models[mk];
    m.avg_duration_ms = m.requests > 0 ? Math.round(m.total_duration_ms / m.requests) : 0;
    m.estimated_cost_usd = _roundUsd(m.estimated_cost_usd || 0);
  }
}

function _estimatedCostBreakdown(models) {
  let out = { input: 0, output: 0, cache_read: 0, cache_creation: 0, total: 0 };
  for (let model of Object.keys(models || {})) {
    let m = models[model] || {};
    let price = priceForModel(model) || FALLBACK_ANTHROPIC_PRICE;
    out.input += (m.input_tokens || 0) * price.input / 1e6;
    out.output += (m.output_tokens || 0) * price.output / 1e6;
    out.cache_read += (m.cache_read_tokens || 0) * price.cache_read / 1e6;
    out.cache_creation += (m.cache_creation_tokens || 0) * price.cache_creation / 1e6;
  }
  out.total = out.input + out.output + out.cache_read + out.cache_creation;
  for (let key of Object.keys(out)) out[key] = _roundUsd(out[key]);
  return out;
}

// Quota benchmark: visible tokens per 1% of 5h window consumption.
function _finalizeQuotaBenchmark(dayResult, q5stats) {
  dayResult.q5_consumed_pct = Math.round(q5stats.consumed * 10000) / 100;
  dayResult.q5_samples = q5stats.count;
  dayResult.proxy_active_visible_tokens = q5stats.tokens;
  if (q5stats.consumed > 0.0005 && q5stats.tokens > 0 && q5stats.count >= 3) {
    dayResult.visible_tokens_per_pct = Math.round(q5stats.tokens / (q5stats.consumed * 100));
    dayResult.visible_tokens_per_pct_method = 'cumulative_delta';
  }
}

/**
 * Build the per-day result object from an accumulated day bucket.
 * isLatest controls the heavy buffers: full gateway_last_requests /
 * gateway_requests_by_provider / gateway_sessions / M(t) for the live day,
 * compact forms for historical days (saves ~40MB on SSE and keeps per-day
 * cache files small).
 */
function buildProxyDayResult(key, d, isLatest) {
  _modelAverages(d.models);
  d.overage_usage.estimated_cost_usd = _roundUsd(d.overage_usage.estimated_cost_usd);
  for (let overageModel of Object.keys(d.overage_usage.models)) {
    d.overage_usage.models[overageModel].estimated_cost_usd =
      _roundUsd(d.overage_usage.models[overageModel].estimated_cost_usd);
  }
  for (let accountKey of Object.keys(d.overage_usage.accounts)) {
    let accountUsage = d.overage_usage.accounts[accountKey];
    accountUsage.estimated_cost_usd = _roundUsd(accountUsage.estimated_cost_usd);
    accountUsage.total_estimated_cost_usd = _roundUsd(accountUsage.total_estimated_cost_usd);
    accountUsage.plan_unmarked_cost_usd = _roundUsd(accountUsage.plan_unmarked_cost_usd);
    for (let model of Object.keys(accountUsage.models)) {
      accountUsage.models[model].estimated_cost_usd =
        _roundUsd(accountUsage.models[model].estimated_cost_usd);
      accountUsage.models[model].total_estimated_cost_usd =
        _roundUsd(accountUsage.models[model].total_estimated_cost_usd);
      accountUsage.models[model].plan_unmarked_cost_usd =
        _roundUsd(accountUsage.models[model].plan_unmarked_cost_usd);
    }
  }
  let costFever = buildCostFever(d.gateway_sessions);
  if (!costFever.timeline.length && d.q5_samples?.length) {
    costFever = buildRequestCostFever(d.q5_samples);
  }
  let dayResult = {
    date: key,
    requests: d.requests,
    errors: d.errors,
    error_rate: d.requests > 0 ? Math.round(d.errors / d.requests * 10000) / 100 : 0,
    avg_duration_ms: d.requests > 0 ? Math.round(d.total_duration_ms / d.requests) : 0,
    min_duration_ms: d.min_duration_ms === Infinity ? 0 : d.min_duration_ms,
    max_duration_ms: d.max_duration_ms,
    input_tokens: d.input_tokens,
    output_tokens: d.output_tokens,
    cache_read_tokens: d.cache_read_tokens,
    cache_creation_tokens: d.cache_creation_tokens,
    total_tokens: d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_creation_tokens,
    cache_read_ratio: (d.cache_read_tokens + d.cache_creation_tokens) > 0
      ? Math.round(d.cache_read_tokens / (d.cache_read_tokens + d.cache_creation_tokens) * 10000) / 10000
      : null,
    cache_health: d.cache_health,
    models: d.models,
    estimated_cost: _estimatedCostBreakdown(d.models),
    status_codes: d.status_codes,
    hours: d.hours,
    active_hours: Object.keys(d.hours).length,
    rate_limit: d.rate_limit_snapshots.length ? d.rate_limit_snapshots[0] : null,
    overage_usage: d.overage_usage,
    per_hour_latency: d.per_hour_latency,
    false_429s: d.false_429s,
    context_resets: d.context_resets,
    stop_reasons: d.stop_reasons || {},
    visible_tokens_per_pct: null,
    visible_tokens_per_pct_method: null,
    q5_consumed_pct: 0,
    q5_samples: 0,
    proxy_active_visible_tokens: 0,
    // claude-code-cache-fix interop
    ttl_tiers: d.ttl_tiers,
    peak_hour_requests: d.peak_hour_requests,
    off_peak_requests: d.off_peak_requests,
    ephemeral_1h_tokens: d.ephemeral_1h_tokens,
    ephemeral_5m_tokens: d.ephemeral_5m_tokens,
    data_sources: d.data_sources,
    connection_types: d.connection_types,
    client_types: d.client_types,
    cc_plans: d.cc_plans,
    providers: d.providers,
    // gateway dashboard
    // Sort by ts: scan-roots merges multi-client × multi-vendor NDJSON in
    // file-order, so unsorted q5_samples appear interleaved on category x-
    // axis charts (cut-impact, efficiency-history). The Quota-Timeline chart
    // escaped this because it uses a numeric time-axis, but cut-impact is built
    // from a labelled-category axis where insertion-order is the visual order.
    gateway_quota_timeline: (d.q5_samples || []).slice().sort(_byTsNum),
    gateway_thinking_tokens: d.gateway_thinking_tokens,
    gateway_thinking_chars: d.gateway_thinking_chars,
    gateway_fix_counts: d.gateway_fix_counts,
    gateway_fix_hourly: d.gateway_fix_hourly,
    gateway_tokens_hourly: d.gateway_tokens_hourly,
    connect_monitor: d.connect_monitor,
    connect_monitor_count: d.connect_monitor_count,
    gateway_reset: d.gateway_reset,
    // Only include full buffers for the latest day (saves ~40MB on SSE)
    gateway_last_requests: isLatest ? d.gateway_last_requests : [],
    gateway_requests_by_provider: isLatest ? d.gateway_requests_by_provider : {},
    // Older days: compact session summary (hour buckets only) for heatmap historie
    gateway_sessions: isLatest ? d.gateway_sessions : compactSessionSummary(d.gateway_sessions),
    gateway_cut_impacts: computeCutImpacts(d.q5_samples || []),
    gateway_cost_fever: costFever,
    // Cost Intelligence: M(t) per session (latest day only — full session data
    // is dropped for older days to save SSE payload).
    gateway_mt_sessions: isLatest ? computeSessionMt(d.gateway_sessions) : [],
    // Burn-rate projection — computed for every day with >=3 q5_samples so the
    // multi-day trajectory chart can plot historical projections, not just the
    // latest day. Output is small (a single object per day).
    gateway_burn_rate: (d.q5_samples && d.q5_samples.length >= 3) ? computeBurnRate(d.q5_samples, d.gateway_reset) : null,
    // Persistent CC-version aggregate (small, multi-day basis for trajectory
    // version markers). Empty {} for days that pre-date this field.
    gateway_cc_versions: d.gateway_cc_versions || {}
  };
  _finalizeQuotaBenchmark(dayResult, computeQ5Consumption(d.q5_samples));
  return dayResult;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseProxyNdjsonFiles: parseProxyNdjsonFiles,
  buildProxyDayResult: buildProxyDayResult,
  emptyProxyDayBucket: emptyProxyDayBucket,
  computeQ5Consumption: computeQ5Consumption,
  computeCutImpacts: computeCutImpacts,
  computeSessionMt: computeSessionMt,
  buildCostFever: buildCostFever,
  buildRequestCostFever: buildRequestCostFever,
  computeBurnRate: computeBurnRate,
  fitQuadratic: fitQuadratic
};
