'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var security = require('../../apps/backend/server/security-headers');

test('security headers include a nonce-bound, same-origin CSP', function () {
  var values = {};
  security.applySecurityHeaders({
    setHeader: function (name, value) { values[name] = value; }
  }, 'test-nonce');

  assert.match(values['Content-Security-Policy'], /script-src 'self' 'nonce-test-nonce'/);
  assert.match(values['Content-Security-Policy'], /connect-src 'self'/);
  assert.equal(values['X-Content-Type-Options'], 'nosniff');
  assert.equal(values['X-Frame-Options'], 'DENY');
  assert.equal(values['Referrer-Policy'], 'no-referrer');
  assert.equal(values['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('API origin check accepts local tools and matching browser origins', function () {
  assert.equal(security.isSameOriginRequest({ headers: { host: '127.0.0.1:3333' } }), true);
  assert.equal(security.isSameOriginRequest({
    headers: {
      host: '127.0.0.1:3333',
      origin: 'http://127.0.0.1:3333',
      'sec-fetch-site': 'same-origin'
    }
  }), true);
});

test('API origin check rejects cross-site and malformed browser origins', function () {
  assert.equal(security.isSameOriginRequest({
    headers: {
      host: '127.0.0.1:3333',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site'
    }
  }), false);
  assert.equal(security.isSameOriginRequest({
    headers: { host: '127.0.0.1:3333', origin: 'null' }
  }), false);
});
