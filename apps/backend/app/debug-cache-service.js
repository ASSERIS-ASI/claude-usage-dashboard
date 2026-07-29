'use strict';
/**
 * @asseris-module       Debug Cache Service
 * @asseris-description  Backend for /api/debug/cache-files and /api/debug/cache-file-view —
 *                       file listing, path-traversal-guarded read, cache file aggregation.
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Debug Cache Routes
 * @asseris-emits        cache-files list JSON, file-view payload
 * @asseris-consumes     disk cache files, path query
 *
 * Debug Cache Service — debug file listing, path validation, cache file aggregation.
 *
 * Extracted from dashboard-server.js as part of Phase 12e modularization.
 *
 * Usage:
 *   var debugCacheService = require('./debug-cache-service')(opts);
 */
var fs = require('fs');
var path = require('path');

module.exports = function createDebugCacheService(opts) {
  var logOptionalErr          = opts.logOptionalErr;
  var collectTaggedJsonlFiles = opts.collectTaggedJsonlFiles;
  var collectProxyNdjsonFiles = opts.collectProxyNdjsonFiles;
  var collectCacheFixUsageFiles = opts.collectCacheFixUsageFiles || function () { return []; };
  var displayPathForUi        = opts.displayPathForUi;
  var extractCache            = opts.extractCache;
  var USAGE_DAY_CACHE_FILE    = opts.USAGE_DAY_CACHE_FILE;
  var JSONL_TODAY_INDEX_FILE   = opts.JSONL_TODAY_INDEX_FILE;
  var RELEASES_CACHE          = opts.RELEASES_CACHE;
  var OUTAGE_DISK_CACHE       = opts.OUTAGE_DISK_CACHE;
  var MARKETPLACE_CACHE       = opts.MARKETPLACE_CACHE;
  var resolveSessionTurnsCacheDir = opts.resolveSessionTurnsCacheDir;

  var DEBUG_CACHE_FILE_VIEW_MAX_BYTES = 786432;

  function isPathUnderDirectory(fileAbs, dirAbs) {
    var f = path.resolve(fileAbs);
    var d = path.resolve(dirAbs);
    if (f === d) return true;
    return f.startsWith(d + path.sep);
  }

  function debugTaggedJsonlMatchesAbs(abs, tagged) {
    for (var tf of tagged) {
      if (path.resolve(tf.path) === abs) return true;
    }
    return false;
  }

  function debugProxyNdjsonMatchesAbs(abs, proxyPaths) {
    for (var pp of proxyPaths) {
      if (path.resolve(pp) === abs) return true;
    }
    return false;
  }

  function debugPathAllowedForRead(absPath) {
    var abs = path.resolve(absPath);
    try {
      var collected = collectTaggedJsonlFiles();
      if (debugTaggedJsonlMatchesAbs(abs, collected.tagged)) return true;
    } catch (error) { logOptionalErr(error); }
    if (path.resolve(USAGE_DAY_CACHE_FILE) === abs) return true;
    if (path.resolve(JSONL_TODAY_INDEX_FILE) === abs) return true;
    if (path.resolve(RELEASES_CACHE) === abs) return true;
    if (path.resolve(OUTAGE_DISK_CACHE) === abs) return true;
    if (path.resolve(MARKETPLACE_CACHE) === abs) return true;
    if (path.resolve(extractCache.CACHE_FILE) === abs) return true;
    try {
      var proxyPaths = collectProxyNdjsonFiles();
      if (debugProxyNdjsonMatchesAbs(abs, proxyPaths)) return true;
    } catch (error) { logOptionalErr(error); }
    try {
      var cacheFixPaths = collectCacheFixUsageFiles();
      if (debugProxyNdjsonMatchesAbs(abs, cacheFixPaths)) return true;
    } catch (error) { logOptionalErr(error); }
    var stDir = resolveSessionTurnsCacheDir();
    if (stDir && isPathUnderDirectory(abs, stDir)) {
      var bn = path.basename(abs);
      if (bn.includes('..')) return false;
      if (bn.length > 5 && bn.slice(-5) === '.json') return true;
    }
    return false;
  }

  function debugCacheFolderAndFile(absPath) {
    var abs = path.resolve(absPath);
    return {
      folder_ui: displayPathForUi(path.dirname(abs)),
      file_name: path.basename(abs)
    };
  }

  function tryPushDebugCacheKnownPath(out, kind, p) {
    try {
      var st2 = fs.statSync(p);
      var absK = path.resolve(p);
      var metaK = debugCacheFolderAndFile(absK);
      out.push({
        kind: kind,
        label: '',
        path_abs: absK,
        path_ui: displayPathForUi(p),
        folder_ui: metaK.folder_ui,
        file_name: metaK.file_name,
        size: st2.size,
        mtime_ms: Math.floor(st2.mtimeMs)
      });
    } catch (error) { logOptionalErr(error); }
  }

  function compareDebugCacheFileRows(a, b) {
    var fc = (a.folder_ui || '').localeCompare(b.folder_ui || '');
    if (fc !== 0) return fc;
    return (a.file_name || '').localeCompare(b.file_name || '', undefined, { sensitivity: 'base' });
  }

  function appendProxyNdjsonDebugEntries(out) {
    try {
      var pxs = collectProxyNdjsonFiles();
      for (var px of pxs) {
        try {
          var stp = fs.statSync(px);
          var absP = path.resolve(px);
          var metaP = debugCacheFolderAndFile(absP);
          out.push({
            kind: 'proxy_ndjson',
            label: path.basename(px),
            path_abs: absP,
            path_ui: displayPathForUi(px),
            folder_ui: metaP.folder_ui,
            file_name: metaP.file_name,
            size: stp.size,
            mtime_ms: Math.floor(stp.mtimeMs)
          });
        } catch (error) { logOptionalErr(error); }
      }
    } catch (error) { logOptionalErr(error); }
  }

  function appendCacheFixUsageDebugEntries(out) {
    try {
      var files = collectCacheFixUsageFiles();
      for (var file of files) {
        try {
          var stat = fs.statSync(file);
          var absolute = path.resolve(file);
          var meta = debugCacheFolderAndFile(absolute);
          out.push({
            kind: 'cache_fix_usage',
            label: path.basename(file),
            path_abs: absolute,
            path_ui: displayPathForUi(file),
            folder_ui: meta.folder_ui,
            file_name: meta.file_name,
            size: stat.size,
            mtime_ms: Math.floor(stat.mtimeMs)
          });
        } catch (error) { logOptionalErr(error); }
      }
    } catch (error) { logOptionalErr(error); }
  }

  function appendSessionTurnsDiskDebugEntries(out, stDir) {
    try {
      var names = fs.readdirSync(stDir);
      for (var nm of names) {
        if (nm.length < 6 || nm.slice(-5) !== '.json') continue;
        var fp = path.join(stDir, nm);
        try {
          var st3 = fs.statSync(fp);
          var absS = path.resolve(fp);
          var metaS = debugCacheFolderAndFile(absS);
          out.push({
            kind: 'session_turns_disk',
            label: nm,
            path_abs: absS,
            path_ui: displayPathForUi(fp),
            folder_ui: metaS.folder_ui,
            file_name: metaS.file_name,
            size: st3.size,
            mtime_ms: Math.floor(st3.mtimeMs)
          });
        } catch (error) { logOptionalErr(error); }
      }
    } catch (error) { logOptionalErr(error); }
  }

  function collectDebugCacheFilesPayload() {
    var out = [];
    var collected = collectTaggedJsonlFiles();
    for (var t of collected.tagged) {
      try {
        var st = fs.statSync(t.path);
        var absJ = path.resolve(t.path);
        var metaJ = debugCacheFolderAndFile(absJ);
        out.push({
          kind: 'jsonl',
          label: t.label || '',
          path_abs: absJ,
          path_ui: displayPathForUi(t.path),
          folder_ui: metaJ.folder_ui,
          file_name: metaJ.file_name,
          size: st.size,
          mtime_ms: Math.floor(st.mtimeMs)
        });
      } catch (error) { logOptionalErr(error); }
    }
    tryPushDebugCacheKnownPath(out, 'day_cache', USAGE_DAY_CACHE_FILE);
    tryPushDebugCacheKnownPath(out, 'jsonl_today_index', JSONL_TODAY_INDEX_FILE);
    tryPushDebugCacheKnownPath(out, 'extract_cache', extractCache.CACHE_FILE);
    tryPushDebugCacheKnownPath(out, 'releases_disk', RELEASES_CACHE);
    tryPushDebugCacheKnownPath(out, 'outages_disk', OUTAGE_DISK_CACHE);
    tryPushDebugCacheKnownPath(out, 'marketplace_disk', MARKETPLACE_CACHE);
    appendProxyNdjsonDebugEntries(out);
    appendCacheFixUsageDebugEntries(out);
    var stDir = resolveSessionTurnsCacheDir();
    if (stDir) appendSessionTurnsDiskDebugEntries(out, stDir);
    out.sort(compareDebugCacheFileRows);
    return out;
  }

  return {
    collectDebugCacheFilesPayload: collectDebugCacheFilesPayload,
    debugPathAllowedForRead: debugPathAllowedForRead,
    DEBUG_CACHE_FILE_VIEW_MAX_BYTES: DEBUG_CACHE_FILE_VIEW_MAX_BYTES
  };
};
