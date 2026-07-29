/**
 * @asseris-module       Slideouts
 * @asseris-description  Auto-annotated module metadata for public/js/core/slideouts.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * core/slideouts.js — Update/model-change slideout panel, day diagnostic section.
 *
 * Extracted from dashboard.client.js (Phase 11a).
 *
 * Exposes on window:
 *   fmtUtcHmFromDayHour(h)
 *   appendDayDiagnosticSlideoutSection(bodyEl, d)
 *   openUpdateSlideout(dayIndex)
 *   openModelChangeSlideout(dayIndex)
 *   closeUpdateSlideout()
 *   initUpdateSlideoutOnce()
 */
(function () {
  function logSlideoutErr(err) {
    if (window.appLogger) window.appLogger.debugM('ui-core-slideouts', 'catch', 'optional_err', err?.message == null ? err : err.message);
  }

  function t(k) { return (window.t || function (x) { return x; })(k); }
  function tr(k, m) { return (window.tr || function (x) { return x; })(k, m); }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Hours 0–24 as HH:MM (UTC-day as per server-side outage_spans). */
  function fmtUtcHmFromDayHour(h) {
    if (h == null || Number.isNaN(Number(h))) return '?';
    var hi = Math.floor(h);
    var mi = Math.round((h - hi) * 60);
    while (mi >= 60) { hi++; mi -= 60; }
    while (mi < 0) { hi--; mi += 60; }
    if (hi < 0) hi = 0;
    if (hi > 24) hi = 24;
    function p2(n) { return n < 10 ? '0' + n : String(n); }
    return p2(hi) + ':' + p2(mi);
  }

  // ── Day Diagnostic Section ──────────────────────────────────────────────────

  /** Appends Anthropic outage + forensic context only in the slideout (not in chart tooltip). */
  function appendDayDiagnosticSlideoutSection(bodyEl, d) {
    if (!bodyEl || !d) return;
    var incs = d.outage_incidents || [];
    var spans = d.outage_spans || [];
    var showOut =
      (d.outage_hours || 0) > 0 ||
      incs.length > 0 ||
      spans.length > 0 ||
      !!d.outage_likely;
    var showForensic = d.forensic_hint && String(d.forensic_hint).trim().length > 0;
    if (!showOut && !showForensic) return;
    var wrap = document.createElement('div');
    wrap.className = 'upd-slide-diagnostics';
    wrap.style.marginTop = '16px';
    wrap.style.paddingTop = '14px';
    wrap.style.borderTop = '1px solid #2A2D34';
    if (showOut) {
      var hOut = document.createElement('div');
      hOut.style.fontWeight = '600';
      hOut.style.color = '#A0875E';
      hOut.style.marginBottom = '8px';
      hOut.textContent = t('updateSlideoutStatusHeading');
      wrap.appendChild(hOut);
      var srv = typeof d.outage_server_hours === 'number' ? d.outage_server_hours : 0;
      var cli = typeof d.outage_client_hours === 'number' ? d.outage_client_hours : 0;
      var tot = d.outage_hours || 0;
      if (tot > 0 || srv > 0 || cli > 0) {
        var pH = document.createElement('p');
        pH.className = 'upd-meta';
        pH.style.marginBottom = '8px';
        pH.textContent = tr('updateSlideoutOutageHoursLine', {
          total: String(tot),
          srv: String(srv),
          cli: String(cli)
        });
        wrap.appendChild(pH);
      }
      if (d.outage_likely && (d.hit_limit || 0) > 0) {
        var pL = document.createElement('p');
        pL.className = 'upd-meta';
        pL.style.color = '#fbbf24';
        pL.style.marginBottom = '8px';
        pL.textContent = t('updateSlideoutLikelyHit');
        wrap.appendChild(pL);
      }
      if (incs.length > 0) {
        var hI = document.createElement('div');
        hI.style.fontWeight = '600';
        hI.style.fontSize = '0.72rem';
        hI.style.color = '#EFE7D6';
        hI.style.marginBottom = '4px';
        hI.textContent = t('updateSlideoutOutageIncidents');
        wrap.appendChild(hI);
        var ulI = document.createElement('ul');
        ulI.style.margin = '0 0 10px 0';
        ulI.style.paddingLeft = '1.2em';
        ulI.style.fontSize = '0.72rem';
        ulI.style.lineHeight = '1.45';
        ulI.style.color = '#F7F3EC';
        for (var inc of incs) {
          var liInc = document.createElement('li');
          var imp = String(inc.impact || 'none').toUpperCase();
          var k = inc.kind ? ' (' + inc.kind + ')' : '';
          var parts = ['[' + imp + '] ' + (inc.name || '') + k];
          if (inc.created_at) {
            try {
              parts.push(t('updateSlideoutIncidentStart') + ' ' + new Date(inc.created_at).toLocaleString());
            } catch (err) { logSlideoutErr(err); }
          }
          if (inc.resolved_at) {
            try {
              parts.push(t('updateSlideoutIncidentResolved') + ' ' + new Date(inc.resolved_at).toLocaleString());
            } catch (err) { logSlideoutErr(err); }
          } else if (inc.created_at) {
            parts.push(t('updateSlideoutIncidentOngoing'));
          }
          liInc.textContent = parts.join(' \u00b7 ');
          ulI.appendChild(liInc);
        }
        wrap.appendChild(ulI);
      }
      if (spans.length > 0) {
        var hS = document.createElement('div');
        hS.style.fontWeight = '600';
        hS.style.fontSize = '0.72rem';
        hS.style.color = '#EFE7D6';
        hS.style.marginBottom = '4px';
        hS.textContent = t('updateSlideoutOutageSpans');
        wrap.appendChild(hS);
        var ulS = document.createElement('ul');
        ulS.style.margin = '0 0 0 0';
        ulS.style.paddingLeft = '1.2em';
        ulS.style.fontSize = '0.68rem';
        ulS.style.lineHeight = '1.45';
        ulS.style.color = '#A0875E';
        for (var sp of spans) {
          var liS = document.createElement('li');
          var impS = String(sp.impact || 'none').toUpperCase();
          var kS = sp.kind ? ' (' + sp.kind + ')' : '';
          liS.textContent =
            fmtUtcHmFromDayHour(sp.from) +
            '\u2013' +
            fmtUtcHmFromDayHour(sp.to) +
            ' UTC \u00b7 [' +
            impS +
            '] ' +
            (sp.name || '') +
            kS;
          ulS.appendChild(liS);
        }
        wrap.appendChild(ulS);
      }
    }
    if (showForensic) {
      var hF = document.createElement('div');
      hF.style.fontWeight = '600';
      hF.style.color = '#A0875E';
      hF.style.marginTop = showOut ? '12px' : '0';
      hF.style.marginBottom = '6px';
      hF.textContent = t('updateSlideoutForensicHeading');
      wrap.appendChild(hF);
      var pC = document.createElement('p');
      pC.className = 'upd-ver';
      pC.style.fontSize = '0.8rem';
      pC.textContent = (d.forensic_code || '\u2014') + (d.date ? ' \u00b7 ' + d.date : '');
      wrap.appendChild(pC);
      var pHint = document.createElement('p');
      pHint.className = 'upd-meta';
      pHint.style.lineHeight = '1.45';
      pHint.textContent = String(d.forensic_hint);
      wrap.appendChild(pHint);
    }
    bodyEl.appendChild(wrap);
  }

  // ── Slideout Open/Close ─────────────────────────────────────────────────────

  function openUpdateSlideout(dayIndex) {
    var data = window.__dashboardState.getData();
    if (!data?.days || data.days[dayIndex] == null) return;
    var d = data.days[dayIndex];
    var vc = d.version_change;
    var titleEl = document.getElementById('update-sl-title');
    var bodyEl = document.getElementById('update-sl-body');
    var panel = document.getElementById('update-slideout');
    var back = document.getElementById('update-slideout-backdrop');
    if (!titleEl || !bodyEl || !panel || !back) return;
    titleEl.textContent = d.date + ' \u2014 ' + t('updateSlideoutHeading');
    bodyEl.textContent = '';
    if (!vc) {
      bodyEl.appendChild(document.createTextNode(t('updateSlideoutNoDetail')));
    } else {
      var pVer = document.createElement('p');
      pVer.className = 'upd-ver';
      var verStr = vc.added?.length ? vc.added.join(', ') : '';
      if (vc.from) verStr = vc.from + ' \u2192 ' + verStr;
      pVer.textContent = verStr;
      bodyEl.appendChild(pVer);
      var meta = document.createElement('p');
      meta.className = 'upd-meta';
      var metaParts = [];
      if (vc.release_when) metaParts.push(String(vc.release_when));
      if (vc.release_utc_ymd) metaParts.push('UTC: ' + vc.release_utc_ymd);
      if (vc.release_local_ymd && vc.release_local_ymd !== vc.release_utc_ymd) metaParts.push('local: ' + vc.release_local_ymd);
      meta.textContent = metaParts.join(' \u00b7 ');
      if (meta.textContent) bodyEl.appendChild(meta);
      var hl = vc.highlights || [];
      var gl = vc.github_release_links || [];
      if (hl.length) {
        var h3 = document.createElement('div');
        h3.style.fontWeight = '600';
        h3.style.color = '#A0875E';
        h3.style.marginTop = '10px';
        h3.textContent = t('updateSlideoutHighlights');
        bodyEl.appendChild(h3);
        var ul = document.createElement('ul');
        for (var hi = 0; hi < Math.min(8, hl.length); hi++) {
          var li = document.createElement('li');
          li.textContent = String(hl[hi]).slice(0, 400);
          ul.appendChild(li);
        }
        bodyEl.appendChild(ul);
      } else if (gl.length) {
        var pNote = document.createElement('p');
        pNote.className = 'upd-meta';
        pNote.style.marginTop = '10px';
        pNote.textContent = t('updateSlideoutHighlightsEmpty');
        bodyEl.appendChild(pNote);
      }
      if (gl.length) {
        var ghH = document.createElement('div');
        ghH.style.fontWeight = '600';
        ghH.style.color = '#A0875E';
        ghH.style.marginTop = '10px';
        ghH.textContent = t('updateSlideoutGithubReleases');
        bodyEl.appendChild(ghH);
        var ulg = document.createElement('ul');
        ulg.style.marginTop = '6px';
        ulg.style.paddingLeft = '1.2em';
        for (var _glItem of gl) {
          var gli = document.createElement('li');
          var a = document.createElement('a');
          a.href = _glItem.url;
          a.textContent = 'v' + _glItem.version;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.style.color = '#D4AF7F';
          gli.appendChild(a);
          ulg.appendChild(gli);
        }
        bodyEl.appendChild(ulg);
      }
    }
    appendDayDiagnosticSlideoutSection(bodyEl, d);
    panel.classList.add('open');
    back.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function openModelChangeSlideout(dayIndex) {
    var data = window.__dashboardState.getData();
    if (!data?.days || data.days[dayIndex] == null) return;
    var d = data.days[dayIndex];
    var mc = d.model_change;
    var titleEl = document.getElementById('update-sl-title');
    var bodyEl = document.getElementById('update-sl-body');
    var panel = document.getElementById('update-slideout');
    var back = document.getElementById('update-slideout-backdrop');
    if (!titleEl || !bodyEl || !panel || !back) return;
    titleEl.textContent = d.date + ' \u2014 ' + t('modelSlideoutHeading');
    bodyEl.textContent = '';
    if (!mc) {
      bodyEl.appendChild(document.createTextNode(t('modelSlideoutNoDetail')));
    } else {
      if (mc.added?.length) {
        var pAdd = document.createElement('p');
        pAdd.className = 'upd-ver';
        pAdd.style.color = '#67e8f9';
        pAdd.textContent = t('tooltipModelAdded') + mc.added.join(', ');
        bodyEl.appendChild(pAdd);
      }
      if (mc.removed?.length) {
        var pRem = document.createElement('p');
        pRem.className = 'upd-meta';
        pRem.textContent = t('tooltipModelRemoved') + mc.removed.join(', ');
        bodyEl.appendChild(pRem);
      }
      if (!bodyEl.children.length) {
        bodyEl.appendChild(document.createTextNode(t('modelSlideoutNoDetail')));
      }
    }
    appendDayDiagnosticSlideoutSection(bodyEl, d);
    panel.classList.add('open');
    back.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function closeUpdateSlideout() {
    var panel = document.getElementById('update-slideout');
    var back = document.getElementById('update-slideout-backdrop');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    if (back) back.classList.remove('open');
  }

  var __updateSlideoutUiBound = false;
  function initUpdateSlideoutOnce() {
    if (__updateSlideoutUiBound) return;
    __updateSlideoutUiBound = true;
    document.body.addEventListener('click', function (ev) {
      var mDot = ev.target.closest('.fs-model-mark');
      if (mDot?.dataset.dayIndex != null) {
        ev.preventDefault();
        openModelChangeSlideout(Number.parseInt(mDot.dataset.dayIndex, 10));
        return;
      }
      var uDot = ev.target.closest('.fs-update-mark');
      if (uDot?.dataset.dayIndex != null) {
        ev.preventDefault();
        openUpdateSlideout(Number.parseInt(uDot.dataset.dayIndex, 10));
      }
    });
    var back = document.getElementById('update-slideout-backdrop');
    if (back) back.addEventListener('click', closeUpdateSlideout);
    var cls = document.getElementById('update-sl-close');
    if (cls) cls.addEventListener('click', closeUpdateSlideout);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeUpdateSlideout();
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────────────

  window.fmtUtcHmFromDayHour = fmtUtcHmFromDayHour;
  window.appendDayDiagnosticSlideoutSection = appendDayDiagnosticSlideoutSection;
  window.openUpdateSlideout = openUpdateSlideout;
  window.openModelChangeSlideout = openModelChangeSlideout;
  window.closeUpdateSlideout = closeUpdateSlideout;
  window.initUpdateSlideoutOnce = initUpdateSlideoutOnce;
})();
