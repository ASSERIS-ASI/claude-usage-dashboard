'use strict';
/**
 * @asseris-module       Debug JSONL Routes
 * @asseris-description  Read-only local JSONL inventory and fingerprint plus
 *                       a local scanner rebuild trigger.
 * @asseris-pillar       actuator
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        input
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        Route Helpers, Scan Roots (Usage)
 * @asseris-called-by    Server Composition Root
 * @asseris-emits        jsonl-inventory JSON, fingerprint JSON
 * @asseris-consumes     local JSONL files and configured scan roots
 *
 * server/routes/debug-jsonl-routes.js — local JSONL inventory, fingerprint and rebuild.
 *
 * Split from debug-routes.js (clean-modules Phase 1).
 */

var rh = require('../route-helpers');
var CORS_JSON = rh.CORS_JSON;
var CORS_JSON_NOCACHE = rh.CORS_JSON_NOCACHE;
var getLocalScanRoots = require('../../domain/usage/scan-roots').getLocalScanRoots;
var walkJsonl = require('../../domain/usage/scan-roots').walkJsonl;
function register(deps) {
  var serviceLog = deps.serviceLog;
  var collectTaggedJsonlFiles = deps.collectTaggedJsonlFiles;
  var inventoryScanRoots = deps.inventoryScanRoots || getLocalScanRoots;
  var inventoryWalkJsonl = deps.inventoryWalkJsonl || walkJsonl;

  function handle(pathname, req, res) {
    // ── /api/debug/rebuild-jsonl-cache  POST ──
    if (pathname === '/api/debug/rebuild-jsonl-cache' && req.method === 'POST') {
      var corsJr = CORS_JSON;
      var jsonlAgentPort = Number.parseInt(process.env.CLAUDE_USAGE_JSONL_AGENT_PORT, 10) || 3335;
      serviceLog.info('scanner', 'POST /api/debug/rebuild-jsonl-cache — triggering jsonl-agent');
      var jrReq = require('node:http').request({ hostname: '127.0.0.1', port: jsonlAgentPort, path: '/trigger', method: 'POST', timeout: 5000 });
      jrReq.on('error', function (e) { serviceLog.warn('debug', 'jsonl-agent trigger: ' + (e.message || e)); });
      jrReq.end();
      res.writeHead(200, corsJr);
      res.end(JSON.stringify({ ok: true, message: 'jsonl_rescan_triggered' }));
      return true;
    }

    // ── /api/debug/jsonl-inventory  GET ──
    if (pathname === '/api/debug/jsonl-inventory' && req.method === 'GET') {
      var fs = require('node:fs');
      var path = require('node:path');
      var corsInv = CORS_JSON_NOCACHE;
      var invUrl = new URL(req.url, 'http://localhost');
      var includeSubagents = (invUrl.searchParams.get('include_subagents') || 'true') !== 'false';
      // Inventory always describes local, read-only scan roots.
      var localRoots = inventoryScanRoots();
      var seen = Object.create(null);
      var taggedLocal = [];
      for (var LR of localRoots) {
        for (var lf of inventoryWalkJsonl(LR.path)) {
          var lfAbs = require('node:path').resolve(lf);
          if (seen[lfAbs]) continue;
          seen[lfAbs] = true;
          taggedLocal.push({ path: lfAbs, label: LR.label, rootPath: LR.path });
        }
      }
      var collected = { tagged: taggedLocal, roots: localRoots };

      var rootSummary = collected.roots.map(function (r) {
        var count = collected.tagged.filter(function (f) { return f.rootPath === r.path; }).length;
        return { path: r.path, label: r.label, fileCount: count };
      });

      var totalSize = 0;
      var files = [];
      for (var f of collected.tagged) {
        var isSubagent = f.path.includes('/subagents/') || f.path.includes('\\subagents\\');
        if (!includeSubagents && isSubagent) continue;
        var size = 0;
        var mtime = null;
        try {
          var stat = fs.statSync(f.path);
          size = stat.size;
          mtime = stat.mtime.toISOString();
        } catch (_e) { /* skip */ }
        var relPath = path.relative(f.rootPath, f.path).replace(/\\/g, '/');
        totalSize += size;
        files.push({ path: relPath, absPath: f.path, root: f.label, size: size, mtime: mtime, isSubagent: isSubagent });
      }

      res.writeHead(200, corsInv);
      res.end(JSON.stringify({ roots: rootSummary, files: files, totalSize: totalSize, totalFiles: files.length }));
      return true;
    }

    // ── /api/debug/jsonl-fingerprint  GET ──
    if (pathname === '/api/debug/jsonl-fingerprint' && req.method === 'GET') {
      var crypto = require('node:crypto');
      var corsFingerprint = CORS_JSON_NOCACHE;
      var taggedFp = collectTaggedJsonlFiles().tagged;
      var fp = deps.buildSplitFingerprint(taggedFp);
      var stableHash = crypto.createHash('sha256').update(fp.stable).digest('hex').slice(0, 16);
      var volatileHash = crypto.createHash('sha256').update(fp.volatile).digest('hex').slice(0, 16);
      var fullHash = crypto.createHash('sha256').update(fp.full).digest('hex').slice(0, 16);
      res.writeHead(200, corsFingerprint);
      res.end(JSON.stringify({
        stable: stableHash,
        volatile: volatileHash,
        full: fullHash,
        file_count: taggedFp.length,
        generated: new Date().toISOString()
      }));
      return true;
    }

    return false;
  }

  return { handle: handle };
}

module.exports = { register: register };
