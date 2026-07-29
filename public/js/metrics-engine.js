/**
 * @asseris-module       Metrics Engine
 * @asseris-description  Auto-annotated module metadata for public/js/metrics-engine.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * metrics-engine.js — Predictive & Composite Metrics for ASSERIS
 *
 * Modules:
 *   1. Saturation Score (capacity stress 0-100)
 *   2. Quota ETA Forecast (minutes until quota exhaustion)
 *   3. EWMA Smoother (exponentially weighted moving average)
 *   4. Composite Health Score (0-100, inverted: 100 = perfect)
 *   5. Root Cause Attribution (top factors for anomalies)
 *   6. Narrative Summary Builder (human-readable status lines)
 *   7. Seasonality Baseline (hourly/dow patterns)
 *
 * All functions are pure — no DOM, no side effects.
 * Exposed on window.__metricsEngine.
 */
'use strict';
(function () {

  // ── Helpers ──────────────────────────────────────────────────────

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function normalize(v, min, max) {
    if (max <= min) return 0;
    return clamp((v - min) / (max - min), 0, 1);
  }

  function pctStr(v) { return (v * 100).toFixed(1) + '%'; }

  // ── 1. Saturation Score ─────────────────────────────────────────

  /**
   * Capacity stress indicator: 0 = idle, 100 = saturated.
   * @param {object} pd - proxy day object
   * @returns {number} 0-100
   */
  function calcSaturationScore(pd) {
    if (!pd) return 0;
    var rl = pd.rate_limit || {};
    var q5 = Number.parseFloat(rl['anthropic-ratelimit-unified-5h-utilization'] || 0);

    var latencyNorm = normalize(pd.avg_duration_ms || 0, 2000, 30000);
    var errorNorm   = normalize(pd.error_rate || 0, 0, 10);
    var cacheMiss   = 1 - (pd.cache_read_ratio || 0);
    var cacheMissNorm = normalize(cacheMiss, 0, 0.5);
    var quotaNorm   = normalize(q5, 0.3, 1.0);

    var score =
      latencyNorm  * 0.30 +
      errorNorm    * 0.20 +
      cacheMissNorm * 0.15 +
      quotaNorm    * 0.35;

    return Math.round(score * 100);
  }

  // ── 2. Quota ETA Forecast ───────────────────────────────────────

  /**
   * Estimate minutes until 5h quota window exhaustion.
   * @param {object} pd - proxy day with rate_limit + q5_samples
   * @returns {{ minutesLeft: number, burnPerMin: number, confidence: string, pct5h: number }}
   */
  /**
   * Estimate remaining time until quota exhaustion (best-case, linear).
   * For the real acceleration curve see the Budget Drain chart.
   * Capped at 300 min (5h rolling window).
   */
  function estimateQuotaETA(pd) {
    var result = { minutesLeft: -1, burnPerMin: 0, confidence: 'none', pct5h: 0 };
    if (!pd?.rate_limit) return result;

    var rl = pd.rate_limit;
    var q5 = Number.parseFloat(rl['anthropic-ratelimit-unified-5h-utilization'] || 0);
    result.pct5h = Math.round(q5 * 1000) / 10;
    var remaining = (1 - q5) * 100;

    // Best source: proxy q5_samples with timestamps
    var samples = Array.isArray(pd.q5_samples) ? pd.q5_samples : [];
    if (samples.length >= 2) {
      var n = Math.min(samples.length, 10);
      var recent = samples.slice(-n);
      // Session-boundary detection: find the last significant q5 drop OR time gap.
      // Only use samples AFTER the most recent boundary to avoid stale burn-rate from previous session.
      var cutIdx = 0;
      for (var si = 1; si < recent.length; si++) {
        var drop = (recent[si - 1].q5 - recent[si].q5) * 100;
        var gapMin = (recent[si].ts - recent[si - 1].ts) / 60000;
        if (drop > 2 || gapMin > 5) cutIdx = si; // >2% drop OR >5min gap = session boundary
      }
      if (cutIdx > 0) {
        recent = recent.slice(cutIdx);
      }
      if (recent.length >= 2) {
        var tMin = (recent[recent.length - 1].ts - recent[0].ts) / 60000;
        var pDelta = (recent[recent.length - 1].q5 - recent[0].q5) * 100;
        if (tMin > 1 && pDelta > 0) {
          result.burnPerMin = Math.round(pDelta / tMin * 100) / 100;
          result.minutesLeft = Math.min(300, Math.round(remaining / result.burnPerMin));
          result.confidence = (recent.length >= 5 ? 'high' : recent.length >= 3 ? 'medium' : 'low');
          result.sessionBoundaryDetected = cutIdx > 0;
          return result;
        }
      }
    }

    // Fallback: average over active hours
    if (pd.active_hours > 0 && q5 > 0) {
      result.burnPerMin = Math.round((q5 * 100) / (pd.active_hours * 60) * 100) / 100;
      result.minutesLeft = result.burnPerMin > 0 ? Math.min(300, Math.round(remaining / result.burnPerMin)) : -1;
      result.confidence = 'low';
    }
    return result;
  }

  // ── 3. EWMA Smoother ───────────────────────────────────────────

  /**
   * Exponentially weighted moving average.
   * @param {number[]} values
   * @param {number} alpha - smoothing factor (0-1, default 0.3)
   * @returns {number} smoothed latest value
   */
  function ewma(values, alpha) {
    if (!values?.length) return 0;
    if (alpha == null) alpha = 0.3;
    var s = values[0];
    for (var i = 1; i < values.length; i++) {
      s = alpha * values[i] + (1 - alpha) * s;
    }
    return Math.round(s * 100) / 100;
  }

  /**
   * EWMA over full array (returns smoothed array).
   */
  function ewmaArray(values, alpha) {
    if (!values?.length) return [];
    if (alpha == null) alpha = 0.3;
    var out = [values[0]];
    for (var i = 1; i < values.length; i++) {
      out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
    }
    return out;
  }

  // ── 4. Composite Health Score ───────────────────────────────────

  /**
   * Aggregate health score: 100 = perfect, 0 = everything broken.
   * @param {object} ind - health indicators from computeHealthIndicators
   * @param {object} pd  - latest proxy day
   * @returns {number} 0-100
   */
  function calcHealthScore(ind, pd) {
    if (!ind) return 50;

    // Reliability (35%): error rate, retries, false 429s, interrupts
    var errorPenalty   = normalize(ind.errorRate || 0, 0, 10);
    var retryPenalty   = normalize(ind.retries || 0, 0, 20);
    var f429Penalty    = normalize(ind.false429 || 0, 0, 10);
    var interruptPen   = normalize(ind.interrupts || 0, 0, 15);
    var reliability    = 1 - (errorPenalty * 0.4 + retryPenalty * 0.25 + f429Penalty * 0.15 + interruptPen * 0.2);

    // Capacity (30%): latency, quota, cold starts, hit limits
    var latencyPenalty = normalize(ind.latency || 0, 2, 30);
    var quotaPenalty   = normalize(ind.quota5h || 0, 30, 100);
    var coldPenalty    = normalize(ind.coldStarts || 0, 0, 10);
    var hitPenalty     = normalize(ind.hitLimits || 0, 0, 50);
    var capacity       = 1 - (latencyPenalty * 0.35 + quotaPenalty * 0.35 + coldPenalty * 0.15 + hitPenalty * 0.15);

    // Efficiency (35%): cache health, overhead/thinking gap, truncations
    var cacheGood      = normalize(ind.cacheHealth || 0, 50, 100);
    var thinkGapPen    = normalize(ind.thinkingGap || 0, 0, 100);
    var truncPenalty   = normalize(ind.truncations || 0, 0, 20);
    var efficiency     = cacheGood * 0.5 + (1 - thinkGapPen) * 0.3 + (1 - truncPenalty) * 0.2;

    var score = reliability * 0.35 + capacity * 0.30 + efficiency * 0.35;
    return Math.round(clamp(score, 0, 1) * 100);
  }

  // ── 5. Root Cause Attribution ───────────────────────────────────

  /**
   * Detect top factors contributing to degradation.
   * @param {object} today - proxy day
   * @param {object} yesterday - proxy day (baseline)
   * @returns {Array<{factor: string, delta: number, pct: string, severity: string}>}
   */
  function detectRootCause(today, yesterday) {
    if (!today || !yesterday) return [];

    var factors = [];

    function addFactor(name, todayVal, baseVal, threshold) {
      if (baseVal <= 0) baseVal = 0.001;
      var delta = todayVal - baseVal;
      var pctChange = delta / baseVal;
      if (Math.abs(pctChange) > threshold) {
        factors.push({
          factor: name,
          delta: Math.round(delta * 100) / 100,
          pct: (pctChange > 0 ? '+' : '') + Math.round(pctChange * 100) + '%',
          severity: Math.abs(pctChange) > 0.5 ? 'high' : 'medium'
        });
      }
    }

    addFactor('Latency', today.avg_duration_ms || 0, yesterday.avg_duration_ms || 1, 0.15);
    addFactor('Error Rate', today.error_rate || 0, yesterday.error_rate || 0.001, 0.2);
    addFactor('Requests', today.requests || 0, yesterday.requests || 1, 0.2);

    // Cache miss delta
    var todayCacheMiss = 1 - (today.cache_read_ratio || 0);
    var yestCacheMiss  = 1 - (yesterday.cache_read_ratio || 0);
    addFactor('Cache Miss', todayCacheMiss, yestCacheMiss || 0.001, 0.15);

    // Opus share shift
    var todayModels = today.models || {};
    var yestModels  = yesterday.models || {};
    var todayOpus = 0, todayTotal = 0, yestOpus = 0, yestTotal = 0;
    for (var mk in todayModels) {
      if (!Object.hasOwn(todayModels, mk)) continue;
      todayTotal += todayModels[mk].requests || 0;
      if (mk.includes('opus')) todayOpus += todayModels[mk].requests || 0;
    }
    for (var mk2 in yestModels) {
      if (!Object.hasOwn(yestModels, mk2)) continue;
      yestTotal += yestModels[mk2].requests || 0;
      if (mk2.includes('opus')) yestOpus += yestModels[mk2].requests || 0;
    }
    var todayOpusPct = todayTotal > 0 ? todayOpus / todayTotal : 0;
    var yestOpusPct  = yestTotal > 0 ? yestOpus / yestTotal : 0;
    addFactor('Opus Share', todayOpusPct, yestOpusPct || 0.001, 0.1);

    // Sort by absolute delta magnitude
    factors.sort(function (a, b) {
      return Math.abs(Number.parseFloat(b.pct)) - Math.abs(Number.parseFloat(a.pct));
    });

    return factors.slice(0, 5);
  }

  // ── 6. Narrative Summary Builder ────────────────────────────────

  /**
   * Build human-readable status lines from metrics.
   * @param {object} m - { saturation, healthScore, quotaETA, rootCause, pd }
   * @returns {string[]}
   */
  function buildNarrativeSummary(m) {
    var lines = [];

    // Saturation
    if (m.saturation >= 75) lines.push('Capacity stress: critical (' + m.saturation + '/100)');
    else if (m.saturation >= 50) lines.push('Capacity stress: elevated (' + m.saturation + '/100)');
    else if (m.saturation >= 25) lines.push('Capacity stress: moderate (' + m.saturation + '/100)');
    else lines.push('Capacity stress: low (' + m.saturation + '/100)');

    // Health
    if (m.healthScore >= 80) lines.push('System health: good (' + m.healthScore + '/100)');
    else if (m.healthScore >= 50) lines.push('System health: degraded (' + m.healthScore + '/100)');
    else lines.push('System health: poor (' + m.healthScore + '/100)');

    // Quota
    if (m.quotaETA && m.quotaETA.minutesLeft > 0) {
      var hrs = Math.floor(m.quotaETA.minutesLeft / 60);
      var mins = m.quotaETA.minutesLeft % 60;
      var etaStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
      lines.push('Quota 5h: ' + m.quotaETA.pct5h + '% used, ~' + etaStr + ' remaining');
    } else if (m.quotaETA && m.quotaETA.pct5h > 0) {
      lines.push('Quota 5h: ' + m.quotaETA.pct5h + '% used');
    }

    // Latency
    if (m.pd) {
      var lat = m.pd.avg_duration_ms || 0;
      if (lat > 15000) lines.push('Latency: high (' + (lat / 1000).toFixed(1) + 's avg)');
      else if (lat > 5000) lines.push('Latency: elevated (' + (lat / 1000).toFixed(1) + 's avg)');
      else lines.push('Latency: stable (' + (lat / 1000).toFixed(1) + 's avg)');
    }

    // Root cause
    if (m.rootCause?.length && m.saturation >= 40) {
      var rc = m.rootCause[0];
      lines.push('Primary factor: ' + rc.factor + ' ' + rc.pct);
    }

    // Error rate
    if (m.pd && (m.pd.error_rate || 0) > 2) {
      lines.push('Error rate elevated: ' + (m.pd.error_rate || 0).toFixed(1) + '%');
    }

    return lines;
  }

  // ── 7. Seasonality Baseline ─────────────────────────────────────

  /**
   * Compute average metrics per hour-of-day across multiple proxy days.
   * @param {object[]} proxyDays
   * @returns {{ byHour: {requests: number, latency: number}[], peakHour: number, quietHour: number }}
   */
  function seasonalityBaseline(proxyDays) {
    var hourBuckets = [];
    for (var h = 0; h < 24; h++) {
      hourBuckets.push({ totalReqs: 0, totalLatency: 0, latencyCount: 0, dayCount: 0 });
    }

    for (var pd of proxyDays) {
      var hours = pd.hours || {};
      var latH  = pd.per_hour_latency || {};

      for (var hk = 0; hk < 24; hk++) {
        var reqs = hours[String(hk)] || 0;
        hourBuckets[hk].totalReqs += reqs;
        if (reqs > 0) hourBuckets[hk].dayCount++;

        var lat = latH[String(hk)];
        if (lat && lat.count > 0) {
          hourBuckets[hk].totalLatency += lat.sum;
          hourBuckets[hk].latencyCount += lat.count;
        }
      }
    }

    var byHour = [];
    var peakHour = 0, peakReqs = 0, quietHour = 0, quietReqs = Infinity;
    for (var hi = 0; hi < 24; hi++) {
      var b = hourBuckets[hi];
      var avgReqs = b.dayCount > 0 ? Math.round(b.totalReqs / b.dayCount) : 0;
      var avgLat  = b.latencyCount > 0 ? Math.round(b.totalLatency / b.latencyCount) : 0;
      byHour.push({ hour: hi, avgRequests: avgReqs, avgLatencyMs: avgLat });
      if (avgReqs > peakReqs) { peakReqs = avgReqs; peakHour = hi; }
      if (avgReqs < quietReqs) { quietReqs = avgReqs; quietHour = hi; }
    }

    return { byHour: byHour, peakHour: peakHour, quietHour: quietHour };
  }

  // ── Compute All (convenience) ───────────────────────────────────

  /**
   * Compute all metrics from dashboard data.
   * @param {object} data - full /api/usage response
   * @param {object} healthIndicators - from computeHealthIndicators()
   * @returns {object} all computed metrics
   */
  function computeAll(data, healthIndicators) {
    var proxyDays = data.proxy?.proxy_days || [];
    var latestPd = proxyDays.length ? proxyDays[proxyDays.length - 1] : null;
    var prevPd   = proxyDays.length > 1 ? proxyDays[proxyDays.length - 2] : null;

    var saturation = calcSaturationScore(latestPd);
    var quotaETA   = estimateQuotaETA(latestPd);
    var healthScore = calcHealthScore(healthIndicators, latestPd);
    var rootCause  = detectRootCause(latestPd, prevPd);
    var seasonal   = seasonalityBaseline(proxyDays);

    var narrative = buildNarrativeSummary({
      saturation: saturation,
      healthScore: healthScore,
      quotaETA: quotaETA,
      rootCause: rootCause,
      pd: latestPd
    });

    return {
      saturation: saturation,
      healthScore: healthScore,
      quotaETA: quotaETA,
      rootCause: rootCause,
      narrative: narrative,
      seasonality: seasonal,
      ts: Date.now()
    };
  }

  // ── Split-Advisor Tier-1 ────────────────────────────────────────

  function splitAdvisorTier1(quotaETA, tabCount) {
    tabCount = Math.max(1, Math.min(tabCount || 3, 10));
    var minutesLeft = quotaETA.minutesLeft || 0;

    var urgency = 'safe';
    var warningLevel = 'low';
    var recommendation = '';

    if (minutesLeft < 30) {
      urgency = 'critical';
      warningLevel = 'CRITICAL';
      recommendation = minutesLeft + 'min until estimated 5h limit. Finish or split active work deliberately.';
    } else if (minutesLeft < 60) {
      urgency = 'caution';
      warningLevel = 'HIGH';
      recommendation = minutesLeft + 'min until estimated 5h limit. Avoid starting another long run.';
    } else if (minutesLeft < 120) {
      urgency = 'caution';
      warningLevel = 'MEDIUM';
      recommendation = minutesLeft + 'min until estimated 5h limit.';
    }

    return {
      urgency: urgency,
      warningLevel: warningLevel,
      recommendation: recommendation,
      phantomBudgetPct: null,
      totalPhantom: null,
      minutesLeft: minutesLeft,
      tabCount: tabCount
    };
  }

  // ── Export ───────────────────────────────────────────────────────

  window.__metricsEngine = {
    calcSaturationScore: calcSaturationScore,
    estimateQuotaETA: estimateQuotaETA,
    ewma: ewma,
    ewmaArray: ewmaArray,
    calcHealthScore: calcHealthScore,
    detectRootCause: detectRootCause,
    buildNarrativeSummary: buildNarrativeSummary,
    seasonalityBaseline: seasonalityBaseline,
    computeAll: computeAll,
    splitAdvisorTier1: splitAdvisorTier1
  };

})();
