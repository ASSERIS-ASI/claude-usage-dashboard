/**
 * @asseris-module       Report Modal
 * @asseris-description  Auto-annotated module metadata for public/js/core/report-modal.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/report-modal.js — Forensic report generation, modal open/close, download/copy.
 *
 * Extracted from dashboard.client.js (Phase 11a).
 *
 * Exposes on window:
 *   generateForensicReportMd(data)
 *   openReportModal()
 *   closeReportModal()
 *   downloadReport()
 *   copyReport()
 */
(function () {
  function t(k) { return (window.t || function (x) { return x; })(k); }
  function fmt(n) { return (window.fmt || function (x) { return String(x); })(n); }

  function __rptDayTotal(d) {
    return (d.input || 0) + (d.output || 0) + (d.cache_read || 0) + (d.cache_creation || 0);
  }

  function __rptSigCell(d) {
    var s = d.session_signals || {};
    return (s.continue || 0) + '/' + (s.resume || 0) + '/' + (s.retry || 0) + '/' + (s.interrupt || 0);
  }

  function generateForensicReportMd(data) {
    var days = data.days || [];
    if (!days.length) return t('reportNoData');
    var isDE = (typeof window.getLang === 'function' ? window.getLang() : 'en') === 'de';
    var CACHE_THRESH = 500000000;
    var HIT_MIN = 50;
    var md = [];
    var now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Detect peak + limit days
    var peakDay = null;
    var peakVal = 0;
    for (var dy of days) {
      var tt = __rptDayTotal(dy);
      if (tt > peakVal) { peakVal = tt; peakDay = dy; }
    }
    var limitDays = [];
    for (var dy2 of days) {
      var fl = [];
      if ((dy2.hit_limit || 0) >= HIT_MIN) fl.push('HIT(' + dy2.hit_limit + ')');
      if ((dy2.cache_read || 0) >= CACHE_THRESH) fl.push('CACHE\u2265500M');
      if (fl.length) limitDays.push({ d: dy2, flags: fl });
    }

    md.push(
      '# Forensic Report \u2014 Claude Code Token Usage',
      '',
      (isDE ? 'Erstellt: ' : 'Generated: ') + now,
      (isDE ? 'Peak-Tag: ' : 'Peak day: ') + (peakDay ? peakDay.date + ' (' + fmt(peakVal) + ')' : '\u2014'),
      (isDE ? 'Limit-Tage: ' : 'Limit days: ') + limitDays.length,
      '',
      '## 1. ' + (isDE ? 'Tages\u00fcbersicht' : 'Daily Overview'),
      '',
      '| ' + (isDE ? 'Datum' : 'Date') + ' | Output | Cache Read | C:O | Calls | ' + (isDE ? 'Std.' : 'Hours') + ' | Sig c/r/y/i | Limit |',
      '|------------|----------|------------|--------|-------|-------|-------------|--------|'
    );

    for (var dy3 of days) {
      var cr = dy3.output > 0 ? Math.round(dy3.cache_read / dy3.output) : 0;
      var lim = '\u2014';
      if ((dy3.hit_limit || 0) >= HIT_MIN) lim = 'HIT(' + dy3.hit_limit + ')';
      if ((dy3.cache_read || 0) >= CACHE_THRESH) {
        lim = lim === '\u2014' ? 'CACHE\u2265500M' : lim + ', CACHE\u2265500M';
      }
      md.push('| ' + dy3.date + ' | ' + fmt(dy3.output) + ' | ' + fmt(dy3.cache_read) + ' | ' + cr + 'x | ' + dy3.calls + ' | ' + (dy3.active_hours || 0) + ' | ' + __rptSigCell(dy3) + ' | ' + lim + ' |');
    }
    md.push('');

    md.push(
      '## 2. ' + (isDE ? 'Effizienz' : 'Efficiency'),
      '',
      '| ' + (isDE ? 'Datum' : 'Date') + ' | Overhead | Output/h | Total/h | Subagent% |',
      '|------------|----------|----------|---------|-----------|'
    );
    for (var dy4 of days) {
      var tot2 = __rptDayTotal(dy4);
      var ah = Math.max(1, dy4.active_hours || 1);
      var oh = dy4.output > 0 ? (tot2 / dy4.output).toFixed(0) + 'x' : '\u2014';
      var sp = (dy4.sub_pct || 0) + '%';
      md.push('| ' + dy4.date + ' | ' + oh + ' | ' + fmt(Math.round(dy4.output / ah)) + ' | ' + fmt(Math.round(tot2 / ah)) + ' | ' + sp + ' |');
    }

    // 3. Subagent
    md.push(
      '',
      '## 3. ' + (isDE ? 'Subagent-Analyse' : 'Subagent Analysis'),
      '',
      '| ' + (isDE ? 'Datum' : 'Date') + ' | ' + (isDE ? 'Aufrufe' : 'Calls') + ' | Sub | Sub-Cache | Sub-Cache% |',
      '|------------|--------|------|-----------|------------|'
    );
    for (var dy5 of days) {
      var sc = dy5.sub_cache || 0;
      var scp = (dy5.sub_cache_pct || 0) + '%';
      md.push('| ' + dy5.date + ' | ' + dy5.calls + ' | ' + (dy5.sub_calls || 0) + ' | ' + fmt(sc) + ' | ' + scp + ' |');
    }
    md.push('');

    // 4. Budget estimate
    if (limitDays.length > 0 && peakDay) {
      md.push(
        '## 4. ' + (isDE ? 'Budget-Sch\u00e4tzung' : 'Budget Estimate'),
        '',
        (isDE ? 'Impl@90% = Total / 0.9 (gesch\u00e4tztes Budget wenn ~90% erreicht).' : 'Impl@90% = total / 0.9 (estimated budget if ~90% was reached).'),
        '',
        '| ' + (isDE ? 'Datum' : 'Date') + ' | Total | Impl@90% | vs Peak | ' + (isDE ? 'Std.' : 'Hours') + ' | Signal |',
        '|------------|---------|----------|---------|-------|--------|'
      );
      var prevI = 0;
      for (var ld of limitDays) {
        var tot4 = __rptDayTotal(ld.d);
        var impl = Math.round(tot4 / 0.9);
        var vsp = peakVal > 0 ? (peakVal / impl).toFixed(1) + 'x' : '\u2014';
        var trend = '';
        if (prevI > 0) {
          var ch = Math.round(((impl - prevI) / prevI) * 100);
          if (ch > 5) trend = ' \u2191' + ch + '%';
          else if (ch < -5) trend = ' \u2193' + Math.abs(ch) + '%';
          else trend = ' \u2192';
        }
        prevI = impl;
        md.push('| ' + ld.d.date + ' | ' + fmt(tot4) + ' | ' + fmt(impl) + ' | ' + vsp + ' | ' + (ld.d.active_hours || 0) + ' | ' + ld.flags.join(', ') + trend + ' |');
      }

      // Median
      var ivs = [];
      for (var ld2 of limitDays) {
        if (ld2.d.calls >= 50 && (ld2.d.active_hours || 0) >= 2) ivs.push(Math.round(__rptDayTotal(ld2.d) / 0.9));
      }
      if (ivs.length >= 2) {
        ivs.sort(function (a, b) { return a - b; });
        var med = ivs[Math.floor(ivs.length / 2)];
        md.push(
          '',
          (isDE ? '**Zusammenfassung** (' : '**Summary** (') + ivs.length + (isDE ? ' aussagekr\u00e4ftige Limit-Tage):' : ' meaningful limit days):'),
          '- Median Impl@90%: ~' + fmt(med),
          '- ' + (isDE ? 'Bereich: ' : 'Range: ') + fmt(ivs[0]) + ' .. ' + fmt(ivs.at(-1)),
          '- Peak: ' + fmt(peakVal) + ' (' + peakDay.date + ')'
        );
        if (med > 0) md.push('- Peak / Median: ' + (peakVal / med).toFixed(1) + 'x');
      }
      md.push('');
    }

    // 5. Peak vs Limit comparison
    if (peakDay && limitDays.length > 0) {
      var bestLim = null;
      for (var li5 = limitDays.length - 1; li5 >= 0; li5--) {
        var ld5 = limitDays[li5];
        if (ld5.d.calls >= 50 && (ld5.d.active_hours || 0) >= 2) { bestLim = ld5; break; }
      }
      if (!bestLim) bestLim = limitDays[limitDays.length - 1];
      if (bestLim && bestLim.d.date !== peakDay.date) {
        var tP = __rptDayTotal(peakDay);
        var tL = __rptDayTotal(bestLim.d);
        var crP = peakDay.output > 0 ? Math.round(peakDay.cache_read / peakDay.output) : 0;
        var crL = bestLim.d.output > 0 ? Math.round(bestLim.d.cache_read / bestLim.d.output) : 0;
        md.push(
          '## ' + (isDE ? 'Fazit: Peak vs. Limit-Tag' : 'Conclusion: Peak vs. Limit Day'),
          '',
          '| | ' + peakDay.date + ' (Peak) | ' + bestLim.d.date + ' (Limit) |',
          '|---|---|---|',
          '| Output | ' + fmt(peakDay.output) + ' | ' + fmt(bestLim.d.output) + ' |',
          '| Cache Read | ' + fmt(peakDay.cache_read) + ' | ' + fmt(bestLim.d.cache_read) + ' |',
          '| Total | ' + fmt(tP) + ' | ' + fmt(tL) + ' |',
          '| ' + (isDE ? 'Stunden' : 'Hours') + ' | ' + (peakDay.active_hours || 0) + ' | ' + (bestLim.d.active_hours || 0) + ' |',
          '| Calls | ' + peakDay.calls + ' | ' + bestLim.d.calls + ' |',
          '| C:O Ratio | ' + crP + 'x | ' + crL + 'x |',
          ''
        );
        var impl5 = Math.round(tL / 0.9);
        var drop = impl5 > 0 ? Math.round(tP / impl5) : 0;
        if (drop > 1) {
          md.push('**' + (isDE ? 'Effektive Budget-Reduktion: ~' : 'Effective budget reduction: ~') + drop + 'x**');
          md.push('');
        }
      }
    }

    // ─── Service Impact: Work vs Outage with ASCII bars ───
    var hasAnyOutage = false;
    for (var dayOut of days) {
      if ((dayOut.outage_hours || 0) > 0) { hasAnyOutage = true; break; }
    }
    if (hasAnyOutage) {
      md.push(
        '## ' + (isDE ? 'Service Impact: Arbeitszeit vs. Ausfall' : 'Service Impact: Work vs. Outage'),
        '',
        (isDE ? 'Legende: ' : 'Legend: ') + '\u2588 = ' + (isDE ? 'saubere Arbeit' : 'clean work') + ' | \u2593 = ' + (isDE ? 'Arbeit bei Ausfall' : 'work during outage') + ' | \u2591 = ' + (isDE ? 'Ausfall (keine Arbeit)' : 'outage (no work)'),
        ''
      );
      var maxH = 0;
      var svcRows = [];
      for (var sd of days) {
        var wHrs = Object.keys(sd.hours || {}).map(function (h) { return Number.parseInt(h, 10); });
        var spans = sd.outage_spans || [];
        var affected = 0;
        for (var hour of wHrs) {
          var hitSpan = false;
          for (var span of spans) {
            if (hour >= Math.floor(span.from) && hour < Math.ceil(span.to)) { hitSpan = true; break; }
          }
          if (hitSpan) affected++;
        }
        var outTotal = 0;
        for (var span2 of spans) outTotal += span2.to - span2.from;
        var clean = wHrs.length - affected;
        var outOnly = Math.max(0, Math.round((outTotal - affected) * 10) / 10);
        var totalHRow = clean + affected + outOnly;
        if (totalHRow > maxH) maxH = totalHRow;
        svcRows.push({ date: sd.date, clean: clean, affected: affected, outOnly: outOnly, cr: sd.cache_read || 0, co: sd.cache_output_ratio || 0, outageH: sd.outage_hours || 0, mc: sd.model_change });
      }
      var barW = 40;
      md.push('```');
      for (var r of svcRows) {
        var totalH = r.clean + r.affected + r.outOnly;
        if (totalH === 0 && r.outageH === 0) continue;
        var scale = maxH > 0 ? barW / maxH : 1;
        var bClean = Math.round(r.clean * scale);
        var bAff = Math.round(r.affected * scale);
        var bOut = Math.round(r.outOnly * scale);
        var barSeg = '\u2588'.repeat(bClean) + '\u2593'.repeat(bAff) + '\u2591'.repeat(bOut);
        var label = r.date.slice(5) + ' ' + barSeg + ' ';
        if (r.affected > 0) label += r.clean + 'h+' + (isDE ? r.affected + 'h Ausfall' : r.affected + 'h outage');
        else label += r.clean + 'h';
        if (r.outOnly > 0) label += ' (+' + r.outOnly.toFixed(0) + 'h ' + (isDE ? 'nur Ausfall' : 'outage only') + ')';
        if (r.cr > 0) label += ' | C:' + fmt(r.cr) + ' (' + r.co + 'x)';
        if (r.mc) {
          if (r.mc.added?.length) label += ' \u25c7+' + r.mc.added.join(',');
          if (r.mc.removed?.length) label += ' \u25c7-' + r.mc.removed.join(',');
        }
        md.push(label);
      }
      md.push('```', '');
      var totClean = 0;
      var totAff = 0;
      var totOutOnly = 0;
      for (var rowSum of svcRows) {
        totClean += rowSum.clean;
        totAff += rowSum.affected;
        totOutOnly += rowSum.outOnly;
      }
      md.push((isDE ? '**Gesamt:** ' : '**Total:** ') + totClean + 'h ' + (isDE ? 'saubere Arbeit' : 'clean work') + ' | ' + totAff + 'h ' + (isDE ? 'Arbeit bei Ausfall' : 'work during outage') + ' | ' + Math.round(totOutOnly) + 'h ' + (isDE ? 'Ausfall ohne Arbeit' : 'outage without work'));
      if (totAff > 0 && (totClean + totAff) > 0) {
        var pctAff = Math.round(totAff / (totClean + totAff) * 100);
        md.push((isDE ? '**Betroffene Arbeitszeit: ' : '**Affected work time: ') + pctAff + '%**');
      }
      md.push('');
    }

    // ─── Extension versions & releases ───
    var hasVerChange = false;
    for (var dvc of days) {
      if (dvc.version_change) { hasVerChange = true; break; }
    }
    if (hasVerChange) {
      md.push(
        '## ' + (isDE ? 'Extension-Updates (Claude Code)' : 'Extension Updates (Claude Code)'),
        '',
        '| ' + (isDE ? 'Datum' : 'Date') + ' | Version | Highlights |',
        '|------------|---------|------------|'
      );
      for (var dVer of days) {
        var vc = dVer.version_change;
        if (!vc) continue;
        var ver = vc.added.join(', ');
        if (vc.from) ver = vc.from + ' \u2192 ' + ver;
        var hl = (vc.highlights || []).slice(0, 3).join('; ');
        if (hl.length > 120) hl = hl.slice(0, 117) + '...';
        md.push('| ' + dVer.date + ' | ' + ver + ' | ' + hl + ' |');
      }
      md.push('');
    }

    // ─── Budget Efficiency ───
    var proxy = data.proxy || {};
    var pdays = proxy.proxy_days || [];
    var lastPd = pdays.length > 0 ? pdays[pdays.length - 1] : null;
    if (lastPd) {
      md.push('## ' + (isDE ? 'Budget-Effizienz' : 'Budget Efficiency'), '');
      var rl = lastPd.rate_limit || {};
      var q5r = rl['anthropic-ratelimit-unified-5h-utilization'];
      var q7r = rl['anthropic-ratelimit-unified-7d-utilization'];
      var fbr = rl['anthropic-ratelimit-unified-fallback-percentage'];
      var ovr = rl['anthropic-ratelimit-unified-overage-status'];
      var ovrR = rl['anthropic-ratelimit-unified-overage-disabled-reason'];
      var clm = rl['anthropic-ratelimit-unified-representative-claim'];

      md.push(
        '| ' + (isDE ? 'Metrik' : 'Metric') + ' | ' + (isDE ? 'Wert' : 'Value') + ' | ' + (isDE ? 'Bewertung' : 'Assessment') + ' |',
        '|--------|-------|------------|'
      );
      if (q5r !== undefined && q5r !== null) {
        var q5v = Math.round(Number.parseFloat(q5r) * 1000) / 10;
        var assess5h = q5v > 80 ? '\u26a0 HIGH' : (q5v > 50 ? '\u26a0 MODERATE' : '\u2705 OK');
        md.push('| 5h Quota | ' + q5v + '% | ' + assess5h + ' |');
      }
      if (q7r !== undefined && q7r !== null) {
        var q7v = Math.round(Number.parseFloat(q7r) * 1000) / 10;
        var assess7d = q7v > 80 ? '\u26a0 HIGH' : '\u2705 OK';
        md.push('| 7d Quota | ' + q7v + '% | ' + assess7d + ' |');
      }
      if (fbr !== undefined && fbr !== null) {
        var fbv = Math.round(Number.parseFloat(fbr) * 100);
        var fbAssess = fbv < 100 ? '\u274c REDUCED \u2014 effective budget is ' + fbv + '% of maximum' : '\u2705 FULL';
        md.push('| Fallback % | ' + fbv + '% | ' + fbAssess + ' |');
      }
      if (ovr) {
        var ovrAssess = ovr === 'rejected' ? '\u274c Hard cutoff \u2014 no buffer' : '\u2705 ' + ovr;
        md.push('| Overage | ' + ovr + ' | ' + ovrAssess + ' |');
      }
      if (ovrR) md.push('| Overage Reason | ' + ovrR + ' | |');
      if (clm) {
        var clmNote = clm === 'five_hour' ? '5h window is active constraint' : clm;
        md.push('| Binding Limit | ' + clm.replaceAll('_', ' ') + ' | ' + clmNote + ' |');
      }

      var planLabel = typeof window.getSelectedPlanLabel === 'function' ? window.getSelectedPlanLabel() : '?';
      md.push('| Plan | ' + planLabel + ' | ' + (isDE ? 'manuell gew\u00e4hlt' : 'manually selected') + ' |');

      if (lastPd.visible_tokens_per_pct) {
        md.push('| Tokens/1% | ' + fmt(lastPd.visible_tokens_per_pct) + ' | ' + (isDE ? 'sichtbare Tokens pro 1% Quota' : 'visible tokens per 1% quota') + ' |');
      }
      md.push('');

      var totOut = 0;
      var totAll = 0;
      var totCr = 0;
      var totCc = 0;
      var totRetries = 0;
      var totInterrupts = 0;
      var totTrunc = 0;
      var totOutageH = 0;
      for (var bd of days) {
        totOut += bd.output || 0;
        totAll += bd.total || 0;
        totCr += bd.cache_read || 0;
        totCc += bd.cache_creation || 0;
        var bss = bd.session_signals || {};
        totRetries += bss.retry || 0;
        totInterrupts += bss.interrupt || 0;
        totTrunc += bss.truncated || 0;
        totOutageH += bd.outage_hours || 0;
      }
      var bOverhead = totOut > 0 ? (totAll / totOut).toFixed(1) : '?';
      var bOutputPctRaw = totAll > 0 ? totOut / totAll * 100 : 0;
      var bOutputPct = bOutputPctRaw >= 1 ? Math.round(bOutputPctRaw) : bOutputPctRaw > 0 ? bOutputPctRaw.toFixed(2) : '0';
      var bCmr = (totCc + totCr) > 0 ? Math.round(totCc / (totCc + totCr) * 100) : 0;

      md.push(
        '| ' + (isDE ? 'Metrik' : 'Metric') + ' | ' + (isDE ? 'Wert' : 'Value') + ' |',
        '|--------|-------|',
        '| Effective Output | ' + bOutputPct + '% |',
        '| Overhead Factor | ' + bOverhead + 'x |',
        '| Cache Miss Rate | ' + bCmr + '% |',
        '| Retries | ' + totRetries + ' |',
        '| Interrupts | ' + totInterrupts + ' |',
        '| Tool Bloat (truncated) | ' + totTrunc + ' |',
        '| Outage Loss | ' + totOutageH.toFixed(1) + 'h |',
        ''
      );
    }

    // ─── Release Stability ───
    if (data.release_stability?.summary) {
      var rs = data.release_stability.summary;
      md.push(
        '## ' + (isDE ? 'Release-Stabilit\u00e4t' : 'Release Stability'),
        '',
        '| ' + (isDE ? 'Metrik' : 'Metric') + ' | ' + (isDE ? 'Wert' : 'Value') + ' |',
        '|--------|-------|',
        '| Releases | ' + rs.total + ' (' + rs.daysSpan + (isDE ? ' Tage' : ' days') + ') |',
        '| ' + (isDE ? 'Kadenz' : 'Cadence') + ' | ~' + rs.cadenceDays + (isDE ? ' Tage' : ' days') + ' |',
        '| ' + (isDE ? '\u00dcbersprungen' : 'Skipped') + ' | ' + rs.totalSkipped + ' |',
        '| Hotfixes | ' + rs.hotfixCount + ' |',
        '| Regressions | ' + rs.regressionCount + ' |',
        ''
      );
    }

    // ─── Thinking-Token note ───
    md.push('> ' + (isDE ? '\u26a0 **Hinweis:** Thinking-Tokens (internes Reasoning) erscheinen nicht in der API-Antwort und werden nicht gez\u00e4hlt. Sie belasten wahrscheinlich das Session-Budget.' : '\u26a0 **Note:** Thinking tokens (internal reasoning) do not appear in the API response and are not counted here. They likely count against the session budget.'));
    md.push('');

    md.push('---');
    md.push((isDE ? '*Alle Werte heuristisch \u2014 kein offizieller API-Nachweis. Generiert von ASSERIS.*' : '*All values are heuristic \u2014 not official API proof. Generated by ASSERIS.*'));
    md.push('');
    return md.join('\n');
  }

  // ── Modal DOM helpers ────────────────────────────────────────────────────────

  function __reportModalWrapH2Sections(el) {
    var h2s = el.querySelectorAll('h2');
    for (var sxi = h2s.length - 1; sxi >= 0; sxi--) {
      var h2 = h2s[sxi];
      var details = document.createElement('details');
      details.className = 'report-section';
      details.id = 'rpt-s' + (sxi + 1);
      var summary = document.createElement('summary');
      summary.className = 'report-section-head';
      summary.innerHTML = h2.innerHTML;
      details.appendChild(summary);
      var next = h2.nextElementSibling;
      while (next && next.tagName !== 'H2' && next.tagName !== 'H1' && !next.classList.contains('report-section')) {
        var move = next;
        next = next.nextElementSibling;
        details.appendChild(move);
      }
      h2.parentNode.replaceChild(details, h2);
    }
  }

  function __reportModalBuildNavIndex(el) {
    var secs = el.querySelectorAll('.report-section');
    if (!secs.length) return;
    var nav = document.createElement('nav');
    nav.className = 'report-index';
    nav.innerHTML = '<strong>Contents</strong>';
    var ol = document.createElement('ol');
    for (var nix = 0; nix < secs.length; nix++) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#';
      var secHead = secs[nix].querySelector('.report-section-head');
      a.textContent = secHead ? secHead.textContent.replace(/^\d+\.\s*/, '') : '';
      a.dataset.rptIdx = String(nix);
      li.appendChild(a);
      ol.appendChild(li);
    }
    nav.appendChild(ol);
    el.insertBefore(nav, el.firstChild);
    ol.addEventListener('click', function (e) {
      var link = e.target.tagName === 'A' ? e.target : e.target.closest('a');
      if (!link) link = e.target.parentElement;
      if (link?.dataset?.rptIdx == null) return;
      e.preventDefault();
      e.stopPropagation();
      var idx = Number.parseInt(link.dataset.rptIdx, 10);
      var allSecs = document.getElementById('report-content').querySelectorAll('.report-section');
      if (allSecs[idx]) {
        var wasOpen = allSecs[idx].open;
        allSecs[idx].open = !wasOpen;
        if (!wasOpen) setTimeout(function () { allSecs[idx].scrollIntoView({ block: 'nearest' }); }, 50);
      }
    });
  }

  // ── Modal API ────────────────────────────────────────────────────────────────

  var __lastReportMd = '';

  function openReportModal() {
    if (!window.__dashboardState.getData()?.days?.length) return;
    __lastReportMd = generateForensicReportMd(window.__dashboardState.getData());
    var el = document.getElementById('report-content');
    if (globalThis.marked?.parse) {
      el.innerHTML = globalThis.marked.parse(__lastReportMd);
      __reportModalWrapH2Sections(el);
      __reportModalBuildNavIndex(el);
    } else {
      el.textContent = __lastReportMd;
    }
    document.getElementById('report-modal-title').textContent = t('reportTitle');
    document.getElementById('report-copy-btn').textContent = t('reportCopy');
    document.getElementById('report-download-btn').textContent = t('reportDownload');
    document.getElementById('report-modal-overlay').classList.add('open');
  }

  function closeReportModal() {
    document.getElementById('report-modal-overlay').classList.remove('open');
  }

  function downloadReport() {
    var text = __lastReportMd;
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'forensic-report-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyReport() {
    var text = __lastReportMd;
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById('report-copy-btn');
      var orig = btn.textContent;
      btn.textContent = t('reportCopied');
      setTimeout(function () { btn.textContent = orig; }, 1500);
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────────────

  window.generateForensicReportMd = generateForensicReportMd;
  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
  window.downloadReport = downloadReport;
  window.copyReport = copyReport;
})();
