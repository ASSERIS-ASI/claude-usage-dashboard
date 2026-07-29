'use strict';

/**
 * Local dashboard layout persistence.
 *
 * The public dashboard has no remote gateway, sync client, or outbound layout
 * proxy. Layouts are read from and written to the standalone product state
 * directory through layoutStore.
 */
function register(deps) {
  var layoutStore = deps.layoutStore;
  var serviceLog = deps.serviceLog;

  function handle(pathname, req, res) {
    if (pathname !== '/api/layout') return false;

    if (req.method === 'GET') {
      var current = layoutStore.readLayout();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Layout-Mtime': String(current.mtime || 0)
      });
      res.end(current.data === null ? 'null' : JSON.stringify(current.data));
      return true;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      var body = '';
      req.on('data', function (chunk) {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) req.destroy();
      });
      req.on('end', function () {
        try {
          var written = layoutStore.writeLayout(JSON.parse(body));
          serviceLog.info('layout', 'saved ' + body.length + ' bytes');
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Layout-Mtime': String(written.mtime || 0)
          });
          res.end('{"ok":true}');
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'invalid_layout', detail: error.message }));
        }
      });
      return true;
    }

    if (req.method === 'DELETE') {
      layoutStore.deleteLayout();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"ok":true}');
      return true;
    }

    res.writeHead(405, { Allow: 'GET, PUT, POST, DELETE' });
    res.end();
    return true;
  }

  return { handle: handle };
}

module.exports = { register: register };
