'use strict';

/**
 * Minimal local diagnostics for the standalone dashboard.
 *
 * This endpoint reports local scanner state only. It contains no operational
 * proxy, authentication or remote-sync controls.
 */
function register(deps) {
  function handle(pathname, req, res) {
    if (pathname !== '/api/debug/status' || req.method !== 'GET') return false;

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      product: 'Claude Usage Dashboard',
      profile: 'dashboard',
      app_version: deps.__appVersion || 'development',
      local: true,
      read_only_sources: true
    }));
    return true;
  }

  return { handle: handle };
}

module.exports = { register: register };
