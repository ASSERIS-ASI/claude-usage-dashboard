'use strict';

var crypto = require('node:crypto');

function createNonce() {
  return crypto.randomBytes(18).toString('base64');
}

function applySecurityHeaders(res, nonce) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function isSameOriginRequest(req) {
  var fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;

  var origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;

  try {
    var originUrl = new URL(origin);
    var host = String(req.headers.host || '').toLowerCase();
    return !!host && originUrl.host.toLowerCase() === host;
  } catch (_error) {
    return false;
  }
}

function rejectCrossOriginApiRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/') || isSameOriginRequest(req)) return false;
  res.writeHead(403, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify({ error: 'cross_origin_request_rejected' }));
  return true;
}

module.exports = {
  applySecurityHeaders: applySecurityHeaders,
  createNonce: createNonce,
  isSameOriginRequest: isSameOriginRequest,
  rejectCrossOriginApiRequest: rejectCrossOriginApiRequest
};
