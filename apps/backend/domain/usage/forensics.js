'use strict';
/**
 * @asseris-module       Forensics
 * @asseris-description  Multi-day pattern detection — peak-day identification, peak-vs-mean
 *                       ratio, output-token plausibility, time-window anomalies. Single
 *                       implementation site for CLS-04..06 (regression detection, drift,
 *                       compaction-rebuild signatures).
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   CLS-04, CLS-05, CLS-06
 * @asseris-anchor       —
 * @asseris-calls        Hit-Limit Detector
 * @asseris-called-by    Usage Scan Orchestrator
 * @asseris-emits        forensic findings per day + week
 * @asseris-consumes     daily aggregates + day-list
 */

var hitLimitMod = require('./hit-limit');
var CACHE_READ_FORENSIC_THRESH = hitLimitMod.CACHE_READ_FORENSIC_THRESH;

// ── Forensik-Konstanten ──────────────────────────────────────────────────
var FORENSIC_MIN_OUTPUT_FOR_PEAK_CMP = 60000;
var FORENSIC_PEAK_RATIO_MIN = 6;
var FORENSIC_PEAK_MIN_CALLS = 120;
var FORENSIC_PEAK_MIN_HOURS = 4;
var FAZIT_MIN_CALLS = 50;
var FAZIT_MIN_HOURS = 2;

// ── Shared Helpers ───────────────────────────────────────────────────────

function dayTotal(r) {
  return r.input + r.output + r.cache_read + r.cache_creation;
}

function detectPeakDay(daily, days) {
  var peakDay = null, peakVal = 0;
  for (var day of days) {
    var t = dayTotal(daily[day]);
    if (t > peakVal) { peakVal = t; peakDay = day; }
  }
  return peakDay;
}

function detectLimitDays(daily, days) {
  // Ein Tag gilt als Limit-Tag wenn:
  //   (a) hit_limit >= 50 (filtert False Positives), ODER
  //   (b) Cache-Read >= 500M (starkes Session-/Cache-Signal)
  var HIT_MIN_THRESHOLD = 50;
  var result = [];
  for (var day of days) {
    var r = daily[day];
    var flags = [];
    if (r.hit_limit >= HIT_MIN_THRESHOLD) flags.push('HIT(' + r.hit_limit + ')');
    if (r.cache_read >= CACHE_READ_FORENSIC_THRESH) flags.push('CACHE>=500M');
    if (flags.length > 0) result.push({ day: day, flags: flags });
  }
  return result;
}

function findBestLimitDayForComparison(limitDays, daily) {
  // Letzter Limit-Tag mit signifikanter Aktivitaet
  for (var i = limitDays.length - 1; i >= 0; i--) {
    var r = daily[limitDays[i].day];
    if (r.calls >= FAZIT_MIN_CALLS && Object.keys(r.hours).length >= FAZIT_MIN_HOURS) {
      return limitDays[i].day;
    }
  }
  // Fallback: letzter Limit-Tag ueberhaupt
  return limitDays.length > 0 ? limitDays[limitDays.length - 1].day : null;
}

// ── Dashboard Forensik-Codes ─────────────────────────────────────────────

function computeForensicForDay(dayKey, r, peakDate, peakTotal) {
  var total = r.input + r.output + r.cache_read + r.cache_creation;
  var activeH = Object.keys(r.hours).length;
  var implied90 = total > 0 ? Math.round(total / 0.9) : 0;
  var vs_peak = peakTotal > 0 && total > 0 ? Math.round(peakTotal / total) : 0;
  var code = '\u2014';
  var hint = 'Kein Forensic-Flag.';

  if (r.cache_read > CACHE_READ_FORENSIC_THRESH) {
    code = '?';
    hint =
      'Cache read \u2265500M (wie token-forensics CLI) \u2014 starkes Session-/Cache-Signal m\u00f6glich.';
  } else if ((r.hit_limit || 0) > 0) {
    code = 'HIT';
    hint =
      'JSONL enth\u00e4lt diesen Tag Rate-/Limit-/429-\u00e4hnliche Zeilen \u2014 eher harter API-/Session-Stop. Unabh\u00e4ngig davon zeigt die Claude-UI oft 90% oder 100%; das sind verschiedene Signale.';
  } else if (
    peakTotal > 0 &&
    total > 0 &&
    dayKey !== peakDate &&
    peakTotal / total >= FORENSIC_PEAK_RATIO_MIN &&
    activeH >= FORENSIC_PEAK_MIN_HOURS &&
    r.calls >= FORENSIC_PEAK_MIN_CALLS &&
    r.output >= FORENSIC_MIN_OUTPUT_FOR_PEAK_CMP
  ) {
    code = '<<P';
    hint =
      'Viel weniger Gesamt-Tokens als am Peak-Tag (' +
      peakDate +
      '), aber mit sp\u00fcrbar viel Output und vielen Calls \u2014 fr\u00fcher grob als \u201e90%?\u201c bezeichnet. Trifft nicht zu, wenn du im 5h-Fenster kaum gearbeitet hast (dann eher Zufall/Subagent-Rauschen); UI-Prozentsatz kann trotzdem 100% sein.';
  }

  return {
    forensic_code: code,
    forensic_hint: hint,
    forensic_implied_cap_90: implied90,
    forensic_vs_peak: vs_peak
  };
}

module.exports = {
  FORENSIC_MIN_OUTPUT_FOR_PEAK_CMP: FORENSIC_MIN_OUTPUT_FOR_PEAK_CMP,
  FORENSIC_PEAK_RATIO_MIN: FORENSIC_PEAK_RATIO_MIN,
  FORENSIC_PEAK_MIN_CALLS: FORENSIC_PEAK_MIN_CALLS,
  FORENSIC_PEAK_MIN_HOURS: FORENSIC_PEAK_MIN_HOURS,
  FAZIT_MIN_CALLS: FAZIT_MIN_CALLS,
  FAZIT_MIN_HOURS: FAZIT_MIN_HOURS,
  dayTotal: dayTotal,
  detectPeakDay: detectPeakDay,
  detectLimitDays: detectLimitDays,
  findBestLimitDayForComparison: findBestLimitDayForComparison,
  computeForensicForDay: computeForensicForDay
};
