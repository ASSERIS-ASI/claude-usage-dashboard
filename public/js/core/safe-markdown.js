/**
 * @asseris-module       Safe Markdown
 * @asseris-description  Converts Markdown to a deliberately restricted HTML
 *                       subset before it reaches an innerHTML sink.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';

(function (global) {
  var SANITIZE_OPTIONS = {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      'button', 'embed', 'form', 'iframe', 'input', 'math', 'object',
      'option', 'select', 'style', 'svg', 'textarea'
    ],
    FORBID_ATTR: ['srcdoc', 'style']
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function render(markdown) {
    var source = String(markdown == null ? '' : markdown);
    if (!global.marked || typeof global.marked.parse !== 'function' ||
        !global.DOMPurify || typeof global.DOMPurify.sanitize !== 'function') {
      return '<pre class="markdown-fallback">' + escapeHtml(source) + '</pre>';
    }
    return global.DOMPurify.sanitize(global.marked.parse(source), SANITIZE_OPTIONS);
  }

  global.__safeMarkdown = {
    escapeHtml: escapeHtml,
    render: render
  };
  global.renderSafeMarkdown = render;
})(window);
