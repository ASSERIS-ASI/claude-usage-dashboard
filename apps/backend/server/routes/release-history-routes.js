'use strict';

/**
 * Read-only release-history endpoint. Published Gitea releases are mirrored
 * to GitHub; the provider supplies that public feed or its offline fallback.
 */
function register(deps) {
  var getReleaseHistory = deps.getReleaseHistory;
  var serviceLog = deps.serviceLog;

  function handle(pathname, req, res) {
    if (pathname !== '/api/release-history') return false;

    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return true;
    }

    getReleaseHistory(function (error, history) {
      if (error) {
        serviceLog.error('release-history', 'could not load history: ' + (error.message || error));
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({ error: 'release_history_unavailable' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(history));
    });
    return true;
  }

  return { handle: handle };
}

module.exports = { register: register };
