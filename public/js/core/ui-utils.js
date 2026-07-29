/**
 * @asseris-module       Ui Utils
 * @asseris-description  Auto-annotated module metadata for public/js/core/ui-utils.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
(function () { try {

// ── Mini Markdown → HTML (for release notes) ────────────────────────────
function miniMd(src) {
  var lines = (src || "").split("\n");
  var html = "", inList = false;
  for (var ln of lines) {
    // Headings
    var hm = ln.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      if (inList) { html += "</ul>"; inList = false; }
      var lvl = hm[1].length;
      html += "<h" + lvl + " style=\"font-size:" + (1.1 - lvl * 0.1) + "rem;color:#F7F3EC;margin:10px 0 4px\">" + escHtml(hm[2]) + "</h" + lvl + ">";
      continue;
    }
    // List items
    var lm = ln.match(/^[-*]\s+(?:\[.\]\s*)?(.*)/);
    if (lm) {
      if (!inList) { html += "<ul style=\"margin:4px 0;padding-left:18px\">"; inList = true; }
      html += "<li>" + inlineMd(lm[1]) + "</li>";
      continue;
    }
    // Empty line
    if (!ln.trim()) {
      if (inList) { html += "</ul>"; inList = false; }
      continue;
    }
    // Paragraph
    if (inList) { html += "</ul>"; inList = false; }
    html += "<p style=\"margin:3px 0\">" + inlineMd(ln) + "</p>";
  }
  if (inList) html += "</ul>";
  return html;
}

var escHtml = window.escHtml || function (s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
};

function inlineMd(s) {
  s = escHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code style=\"background:#2A2D34;padding:1px 4px;border-radius:3px;font-size:.9em\">$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\" style=\"color:#D4AF7F\">$1</a>");
  return s;
}

window.miniMd = miniMd;
window.inlineMd = inlineMd;

} catch (e) { if (window.appLogger) window.appLogger.errorM('ui-core-ui-utils', 'init', 'fail', e?.message || e); } })();
