/**
 * @asseris-module       Dashboard Utils
 * @asseris-description  Auto-annotated module metadata for public/js/core/dashboard-utils.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/dashboard-utils.js — Shared formatting, forensic scoring,
 * chart data extraction, and session signal utilities (Phase 18 review fix).
 *
 * Extracted from dashboard.client.js. All functions exposed on window
 * for consumption by section renderers and the dashboard renderer.
 */
(function () { try {
var defined_colors = {
  blue: "#B8915A", purple: "#D4AF7F", green: "#22c55e", amber: "#f59e0b",
  red: "#ef4444", cyan: "#B8915A", slate: "#8C6A3F", pink: "#db27b4"
};
var model_family_colors = {
  haiku: "#a855f7",
  opus: "#8C6A3F",
  sonnet: "#f59e0b",
  fable: "#ec4899"
};
function modelFamilyColor(model, fallback) {
  var value = String(model || "").toLowerCase();
  var configured = window.__productSetup?.model_colors || {};
  for (var family in model_family_colors) {
    if (value.includes(family)) return configured[family] || model_family_colors[family];
  }
  return fallback || defined_colors.slate;
}
function modelFamilyRgba(model, alpha, fallback) {
  var hex = modelFamilyColor(model, fallback).replace('#', '');
  var r = Number.parseInt(hex.slice(0, 2), 16);
  var g = Number.parseInt(hex.slice(2, 4), 16);
  var b = Number.parseInt(hex.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function fmt(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+"B";
  if (n >= 1e6) return (n/1e6).toFixed(1)+"M";
  if (n >= 1e3) return (n/1e3).toFixed(1)+"K";
  return String(n);
}
function pct(a,b){return b>0?(a/b*100).toFixed(1)+"%":"-";}
function escHtml(s){return String(s==null?"":s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll("\"","&quot;");}
/** Sonar S2486: catch blocks must reference the exception. */
function logClientOptionalErr(err) {
  if (window.appLogger) window.appLogger.debugM('ui-core', 'catch', 'optional_err', err?.message == null ? err : err.message);
  else if (typeof console !== 'undefined' && console.debug) console.debug('[dashboard]', err?.message == null ? err : err.message);
}
/** Stunden mit Arbeit (tokens) ∪ Stunden mit JSONL-Session-Signalen, nach Log-Zeitstempel. */
function unionWorkHourKeys(sd) {
  var m = {};
  var k;
  var ho = sd.hours || {};
  var hs = sd.hour_signals || {};
  for (k in ho) if (Object.hasOwn(ho, k)) m[k] = true;
  for (k in hs) if (Object.hasOwn(hs, k)) m[k] = true;
  return Object.keys(m).map(function (x) { return Number.parseInt(x, 10); }).filter(function (n) { return !Number.isNaN(n) && n >= 0 && n <= 23; });
}
function hourSignalsAt(sd, wh) {
  var hs = sd.hour_signals || {};
  return hs[String(wh)] || hs[wh] || {};
}
function hourHasTokenUsage(sd, wh) {
  var ho = sd.hours || {};
  return (ho[String(wh)] || ho[wh] || 0) > 0;
}
function outageSpanHitsAtHour(spans, wh) {
  var hitSrv = false;
  var hitCli = false;
  for (var span of spans) {
    if (wh >= Math.floor(span.from) && wh < Math.ceil(span.to)) {
      if (span.kind === "server") hitSrv = true;
      else hitCli = true;
    }
  }
  return { hitSrv: hitSrv, hitCli: hitCli };
}
/** Balken: nur Stunden mit echtem Token-Output zählen als betroffen/sauber (kein Aufblasen durch reine Session-Signale). */
function classifyWorkHour(sd, spans, wh) {
  var hasW = hourHasTokenUsage(sd, wh);
  var hit = outageSpanHitsAtHour(spans, wh);
  var sig = hourSignalsAt(sd, wh);
  var ryH = sig.retry || 0;
  var riH = sig.interrupt || 0;
  if (hit.hitSrv && hasW) return "srv";
  if (hit.hitCli && hasW) return "cli";
  if (!hit.hitSrv && !hit.hitCli) {
    if (hasW && ryH > 0) return "srv";
    if (hasW && riH > 0) return "cli";
    if (hasW) return "clean";
  }
  return "none";
}
function sumServiceImpactForDay(sd) {
  var wHrs = unionWorkHourKeys(sd);
  wHrs.sort(function (a, b) { return a - b; });
  var spans = sd.outage_spans || [];
  var affSrv = 0;
  var affCli = 0;
  var cleanCount = 0;
  for (var wh of wHrs) {
    var cls = classifyWorkHour(sd, spans, wh);
    if (cls === "srv") affSrv++;
    else if (cls === "cli") affCli++;
    else if (cls === "clean") cleanCount++;
  }
  var outTotal = 0;
  for (var span of spans) outTotal += span.to - span.from;
  var outOnly = Math.max(0, Math.round((outTotal - affSrv - affCli) * 10) / 10);
  return { cleanWork: cleanCount, affSrv: affSrv, affCli: affCli, outOnly: outOnly };
}
/** Pro Kalendertag: session_signals, outage_hours, cache_read (API) — für Korrelation Interrupt/Outage vs. Cache.
 *  Ausfallstunden als Balken: Höhe skaliert (Stunden vs. JSONL-Zähler), Tooltip zeigt echte h. Reihenfolge im Stack
 *  unten→oben = continue, resume, retry, interrupt, Ausfall (oben), damit Ausfall nicht unter großen Interrupt-Anteilen liegt.
 *  @param {string} [hostLabel] — wenn gesetzt: Signale + Cache Read nur aus days[].hosts[hostLabel]; outage_hours weiter Kalendertag (Anthropic). */
function extractDaySignals(d, hostKey) {
  if (hostKey) {
    var H = d?.hosts?.[hostKey];
    if (H) {
      var sH = H.session_signals || {};
      return { cont: sH.continue || 0, res: sH.resume || 0, retry: sH.retry || 0, intr: sH.interrupt || 0, cacheRead: H.cache_read == null ? 0 : Number(H.cache_read) || 0 };
    }
    return { cont: 0, res: 0, retry: 0, intr: 0, cacheRead: 0 };
  }
  var s = d?.session_signals || {};
  return { cont: s.continue || 0, res: s.resume || 0, retry: s.retry || 0, intr: s.interrupt || 0, cacheRead: d?.cache_read == null ? 0 : Number(d.cache_read) || 0 };
}
function buildSessionSignalsStackedByDay(days, hostLabel) {
  var hostKey = hostLabel && String(hostLabel).trim() ? String(hostLabel).trim() : "";
  var cont = [];
  var res = [];
  var retry = [];
  var intr = [];
  var outageH = [];
  var cacheRead = [];
  for (var d of days) {
    var oh = d?.outage_hours;
    outageH.push(oh != null && !Number.isNaN(Number(oh)) ? Number(oh) : 0);
    var sig = extractDaySignals(d, hostKey);
    cont.push(sig.cont);
    res.push(sig.res);
    retry.push(sig.retry);
    intr.push(sig.intr);
    cacheRead.push(sig.cacheRead);
  }
  var maxSig = 0;
  for (var si = 0; si < cont.length; si++) {
    var rowSum = cont[si] + res[si] + retry[si] + intr[si];
    if (rowSum > maxSig) maxSig = rowSum;
  }
  var maxOut = 0;
  for (var _oh of outageH) {
    if (_oh > maxOut) maxOut = _oh;
  }
  var OUTAGE_VIS_FRAC = 0.22;
  var maxSigEff = maxSig > 0 ? maxSig : maxOut > 1e-9 ? 100 : 1;
  var outageScale = maxOut > 1e-9 ? (OUTAGE_VIS_FRAC * maxSigEff) / maxOut : 1;
  var outageBar = [];
  for (var _ohv of outageH) {
    outageBar.push(Math.round(_ohv * outageScale * 100) / 100);
  }
  return {
    cont: cont,
    res: res,
    retry: retry,
    intr: intr,
    outageH: outageH,
    outageBar: outageBar,
    outageStackScale: outageScale,
    cacheRead: cacheRead
  };
}

// [i18n: t, tr, getLang, setLang, detectLang, updateLangButtons — core/i18n.js]
/** Gleiche Schwellen wie scripts/dashboard-server.js computeForensicForDay — für Host-Filter clientseitig. */
var __FR_CACHE_READ_THRESH = 500000000;
var __FR_MIN_OUT = 60000;
var __FR_PEAK_RATIO = 6;
var __FR_PEAK_CALLS = 120;
var __FR_PEAK_HOURS = 4;
function hostApiToForensicRow(h) {
  if (!h || typeof h !== "object") {
    h = {};
  }
  return {
    input: h.input || 0,
    output: h.output || 0,
    cache_read: h.cache_read || 0,
    cache_creation: h.cache_creation || 0,
    hit_limit: h.hit_limit || 0,
    calls: h.calls || 0,
    hours: h.hours && typeof h.hours === "object" ? h.hours : {}
  };
}
function activeHourKeysCount(hours) {
  if (!hours || typeof hours !== "object") return 0;
  var n = 0;
  for (var k in hours) {
    if (Object.hasOwn(hours, k)) n++;
  }
  return n;
}
function findHostPeakAcrossDays(daysArr, hostKey) {
  var bestD = "";
  var bestT = -1;
  for (var d of daysArr) {
    var hh = d.hosts?.[hostKey];
    if (!hh) continue;
    var tot = (hh.input || 0) + (hh.output || 0) + (hh.cache_read || 0) + (hh.cache_creation || 0);
    if (tot > bestT) {
      bestT = tot;
      bestD = d.date || "";
    }
  }
  return { date: bestT > 0 ? bestD : "", total: bestT > 0 ? bestT : 0 };
}
function computeForensicForDayClient(dayKey, r, peakDate, peakTotal) {
  var total = (r.input || 0) + (r.output || 0) + (r.cache_read || 0) + (r.cache_creation || 0);
  var activeH = activeHourKeysCount(r.hours);
  var implied90 = total > 0 ? Math.round(total / 0.9) : 0;
  var vs_peak = peakTotal > 0 && total > 0 ? Math.round(peakTotal / total) : 0;
  var code = "\u2014";
  var hint = t("forensicClientHintNone");
  if (r.cache_read > __FR_CACHE_READ_THRESH) {
    code = "?";
    hint = t("forensicClientHintCache");
  } else if ((r.hit_limit || 0) > 0) {
    code = "HIT";
    hint = t("forensicClientHintHit");
  } else if (
    peakTotal > 0 &&
    total > 0 &&
    dayKey !== peakDate &&
    peakTotal / total >= __FR_PEAK_RATIO &&
    activeH >= __FR_PEAK_HOURS &&
    r.calls >= __FR_PEAK_CALLS &&
    r.output >= __FR_MIN_OUT
  ) {
    code = "<<P";
    hint = tr("forensicClientHintPeak", { peak: peakDate || "\u2014" });
  }
  return {
    forensic_code: code,
    forensic_hint: hint,
    forensic_implied_cap_90: implied90,
    forensic_vs_peak: vs_peak
  };
}
/** Ordnet forensic_code der Forensic-Chart-Y-Achse zu — wie Legende / forensicDS_score: 3=? · 2=HIT · 1=<<P · 0=— */
function forensicCodeToScore(code) {
  if (!code || code === "\u2014") return 0;
  if (code === "<<P") return 1;
  if (code === "HIT") return 2;
  if (code === "?") return 3;
  return 0;
}
function forensicScoreForChartDay(day, daysArr, hostFilter) {
  var code;
  if (hostFilter) {
    var H = day.hosts?.[hostFilter];
    if (H) {
      var peak = findHostPeakAcrossDays(daysArr, hostFilter);
      var row = hostApiToForensicRow(H);
      code = computeForensicForDayClient(day.date, row, peak.date, peak.total).forensic_code;
    } else {
      code = "\u2014";
    }
  } else {
    code = day.forensic_code;
  }
  return forensicCodeToScore(code);
}
function sumHostNumericField(daysArr, hostK, field) {
  var s = 0;
  for (var _day of daysArr) {
    var hh = _day.hosts?.[hostK];
    s += hh ? hh[field] || 0 : 0;
  }
  return s;
}
function initForensicSummaryToolbarOnce() {
  var act = document.getElementById("forensic-summary-actions");
  if (!act || act.dataset.stopPropBound) return;
  act.dataset.stopPropBound = "1";
  act.addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
}
function getMainChartsScope() {
  try {
    var s = sessionStorage.getItem("usageMainChartsScope");
    if (s === "hourly" || s === "timeline") return s;
  } catch (error) { logClientOptionalErr(error); }
  return "timeline";
}
function setMainChartsScope(val) {
  try {
    sessionStorage.setItem("usageMainChartsScope", val === "hourly" ? "hourly" : "timeline");
  } catch (error) { logClientOptionalErr(error); }
}
function padHour2(n) {
  return n < 10 ? "0" + n : String(n);
}
function buildHourlyAxisLabels() {
  var a = [];
  for (var h = 0; h < 24; h++) a.push(padHour2(h) + ":00");
  return a;
}
function hourBucketCount(hoursObj, h) {
  if (!hoursObj || typeof hoursObj !== "object") return 0;
  var v = hoursObj[String(h)];
  if (v == null) v = hoursObj[h];
  return Number(v) || 0;
}
function dayHourCallWeights(day) {
  var ho = day.hours || {};
  var w = [];
  var sum = 0;
  for (var hi = 0; hi < 24; hi++) {
    var v = hourBucketCount(ho, hi);
    w.push(v);
    sum += v;
  }
  var denom = sum > 0 ? sum : day.calls || 0;
  if (!(denom > 0)) denom = 1;
  return { w: w, denom: denom };
}
function estimatedFieldPerHour(day, field) {
  var hw = dayHourCallWeights(day);
  var total = Number(day[field]) || 0;
  var out = [];
  for (var hj = 0; hj < 24; hj++) {
    out.push(Math.round(total * (hw.w[hj] / hw.denom)));
  }
  return out;
}
function hourlyCacheOutRatioEst(day) {
  var o = estimatedFieldPerHour(day, "output");
  var c = estimatedFieldPerHour(day, "cache_read");
  var r = [];
  for (var hk = 0; hk < 24; hk++) {
    r.push(o[hk] > 0 ? Math.round(c[hk] / o[hk]) : 0);
  }
  return r;
}
/** Hauptcharts: Tagesfeld Gesamt oder gewählte Scan-Quelle (Forensic-Host-Filter). */
function dayNumericForMainCharts(d, hostKey, field) {
  if (hostKey) {
    var H = d.hosts?.[hostKey];
    return H?.[field] != null ? Number(H[field]) || 0 : 0;
  }
  return d[field] != null ? Number(d[field]) || 0 : 0;
}
function dayRatioCacheOutForMainCharts(d, hostKey) {
  if (!hostKey) return d.cache_output_ratio || 0;
  var H = d.hosts?.[hostKey];
  return H?.cache_output_ratio ?? 0;
}
function dayOutputPerHourForMainCharts(d, hostKey) {
  if (!hostKey) return d.output_per_hour || 0;
  var H = d.hosts?.[hostKey];
  return H?.output_per_hour ?? 0;
}
function subCachePctForDayMainCharts(d, hostKey) {
  if (!hostKey) return d.sub_cache_pct != null ? d.sub_cache_pct : 0;
  var H = d.hosts?.[hostKey];
  if (!H) return 0;
  if (H.sub_cache_pct != null) return H.sub_cache_pct;
  var cr = d.cache_read || 0;
  if (cr <= 0) return 0;
  return Math.round(((H.sub_cache || 0) / cr) * 100);
}
function estimatedFieldPerHourHost(day, hostKey, field) {
  if (!hostKey) return estimatedFieldPerHour(day, field);
  var H = day.hosts?.[hostKey];
  if (!H) {
    var z = [];
    for (var zi = 0; zi < 24; zi++) z.push(0);
    return z;
  }
  var pseudoDay = {
    hours: H.hours && typeof H.hours === "object" ? H.hours : {},
    calls: H.calls != null ? H.calls : day.calls || 0
  };
  var hw = dayHourCallWeights(pseudoDay);
  var total = Number(H[field]) || 0;
  var out = [];
  for (var hj = 0; hj < 24; hj++) {
    out.push(Math.round(total * (hw.w[hj] / hw.denom)));
  }
  return out;
}
function hourlyCacheOutRatioEstHost(day, hostKey) {
  var o = estimatedFieldPerHourHost(day, hostKey, "output");
  var c = estimatedFieldPerHourHost(day, hostKey, "cache_read");
  var r = [];
  for (var hk = 0; hk < 24; hk++) {
    r.push(o[hk] > 0 ? Math.round(c[hk] / o[hk]) : 0);
  }
  return r;
}
function hourSignalsArrayForHost(day, hostKey, key) {
  if (!hostKey) return hourSignalsArrayFor(day, key);
  var H = day.hosts?.[hostKey];
  var hs = (H?.hour_signals && typeof H.hour_signals === "object") ? H.hour_signals : {};
  var a = [];
  for (var hh = 0; hh < 24; hh++) {
    var b = hs[String(hh)] || hs[hh] || {};
    a.push(b[key] || 0);
  }
  return a;
}
function hourSignalKey(day, hour, key) {
  var hs = day.hour_signals || {};
  var b = hs[String(hour)] || hs[hour] || {};
  return b[key] || 0;
}
function hourSignalsArrayFor(day, key) {
  var a = [];
  for (var hh = 0; hh < 24; hh++) a.push(hourSignalKey(day, hh, key));
  return a;
}
function destroyMainChartIfScopeMismatch(mainScope, chartKey) {
  var ch = window._charts[chartKey];
  if (ch && ch._dashScope !== mainScope) {
    try {
      if (typeof ch.dispose === 'function') ch.dispose();
      else if (typeof ch.destroy === 'function') ch.destroy();
    } catch (error) { logClientOptionalErr(error); }
    window._charts[chartKey] = null;
  }
}
function syncMainChartsScopeUi() {
  var wrap = document.getElementById("main-charts-scope-wrap");
  var chips = document.getElementById("main-charts-scope-chips");
  if (!wrap || !chips) return;
  var cur = getMainChartsScope();
  if (!chips.dataset.scopeBound) {
    chips.dataset.scopeBound = "1";
    chips.addEventListener("click", function (ev) {
      var b = ev.target.closest(".main-charts-scope-chip");
      if (!b?.dataset.scope) return;
      setMainChartsScope(b.dataset.scope === "hourly" ? "hourly" : "timeline");
      syncMainChartsScopeUi();
      if (window.__dashboardState.getData()) renderDashboard(window.__dashboardState.getData(), true);
    });
  }
  if (!chips.querySelector(".main-charts-scope-chip")) {
    function mkChip(scope, text) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "main-charts-scope-chip";
      btn.dataset.scope = scope;
      btn.textContent = text;
      chips.appendChild(btn);
    }
    mkChip("timeline", t("mainChartsScopeTimeline"));
    mkChip("hourly", t("mainChartsScopeHourly"));
  } else {
    var b0 = chips.querySelector('.main-charts-scope-chip[data-scope="timeline"]');
    var b1 = chips.querySelector('.main-charts-scope-chip[data-scope="hourly"]');
    if (b0) b0.textContent = t("mainChartsScopeTimeline");
    if (b1) b1.textContent = t("mainChartsScopeHourly");
  }
  var lbl = document.getElementById("main-charts-scope-label");
  if (lbl) lbl.textContent = t("mainChartsScopeLabel");
  wrap.setAttribute("aria-label", t("mainChartsScopeAria"));
  var nodes = chips.querySelectorAll(".main-charts-scope-chip");
  for (var nb of nodes) {
    var on = nb.dataset.scope === cur;
    nb.classList.toggle("active", on);
    nb.setAttribute("aria-pressed", on ? "true" : "false");
  }
}
function apiNote(data, deKey, enKey) {
  if (getLang() === "en" && data[enKey]) return data[enKey];
  return data[deKey] || "";
}

// [stream-client: GitHub token, extension timeline, SSE stream — core/stream-client.js]

// ── Window exports ──────────────────────────────────────────────────
window.defined_colors = defined_colors;
window.model_family_colors = model_family_colors;
window.modelFamilyColor = modelFamilyColor;
window.modelFamilyRgba = modelFamilyRgba;
window.escHtml = escHtml;
window.fmt = fmt;
window.pct = pct;
window.logClientOptionalErr = logClientOptionalErr;
window.apiNote = apiNote;
window.getMainChartsScope = getMainChartsScope;
window.setMainChartsScope = setMainChartsScope;
window.syncMainChartsScopeUi = syncMainChartsScopeUi;
window.destroyMainChartIfScopeMismatch = destroyMainChartIfScopeMismatch;
window.forensicCodeToScore = forensicCodeToScore;
window.forensicScoreForChartDay = forensicScoreForChartDay;
window.buildSessionSignalsStackedByDay = buildSessionSignalsStackedByDay;
window.dayNumericForMainCharts = dayNumericForMainCharts;
window.dayRatioCacheOutForMainCharts = dayRatioCacheOutForMainCharts;
window.dayOutputPerHourForMainCharts = dayOutputPerHourForMainCharts;
window.subCachePctForDayMainCharts = subCachePctForDayMainCharts;
window.estimatedFieldPerHour = estimatedFieldPerHour;
window.estimatedFieldPerHourHost = estimatedFieldPerHourHost;
window.hourlyCacheOutRatioEst = hourlyCacheOutRatioEst;
window.hourlyCacheOutRatioEstHost = hourlyCacheOutRatioEstHost;
window.hourSignalsArrayFor = hourSignalsArrayFor;
window.hourSignalsArrayForHost = hourSignalsArrayForHost;
window.buildHourlyAxisLabels = buildHourlyAxisLabels;
window.padHour2 = padHour2;
window.hourBucketCount = hourBucketCount;
window.sumHostNumericField = sumHostNumericField;
window.computeForensicForDayClient = computeForensicForDayClient;
window.hostApiToForensicRow = hostApiToForensicRow;
window.findHostPeakAcrossDays = findHostPeakAcrossDays;
window.unionWorkHourKeys = unionWorkHourKeys;
window.hourSignalsAt = hourSignalsAt;
window.classifyWorkHour = classifyWorkHour;
window.sumServiceImpactForDay = sumServiceImpactForDay;
window.extractDaySignals = extractDaySignals;
window.dayHourCallWeights = dayHourCallWeights;
window.hourSignalKey = hourSignalKey;
window.activeHourKeysCount = activeHourKeysCount;

// Convenience wrappers for __dashboardState filter API (consumed by sections)
window.getFilteredDays = function (d) { return window.__dashboardState.getFilteredDays(d); };
window.getFilterHost = function () { return window.__dashboardState.getFilterHost(); };
window.getForensicHostFilterForCharts = function () { return window.__dashboardState.getForensicHostFilter(); };
} catch (e) { if (window.appLogger) window.appLogger.errorM('ui-core-utils', 'init', 'fail', e?.message || e); } })();
