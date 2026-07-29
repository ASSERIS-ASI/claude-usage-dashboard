'use strict';

/**
 * Product release history provider.
 *
 * Published Gitea releases are mirrored to the public GitHub repository. This
 * client reads that public release feed, keeps a local disk cache and merges
 * it with the immutable predecessor fallback bundled with the dashboard.
 */
var fs = require('node:fs');
var path = require('node:path');
var httpClient = require('../http-client');
var storagePaths = require('../../domain/usage/storage-paths');

var RELEASES_API_URL =
  'https://api.github.com/repos/ASSERIS-ASI/claude-usage-dashboard/releases?per_page=100';
var DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
var DEFAULT_TIMEOUT_MS = 5000;
var VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

function noOp() {}

function loggerOrDefault(serviceLog) {
  return serviceLog || { warn: noOp };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.draft || entry.prerelease) return null;
  var tag = String(entry.tag_name || '').trim();
  if (!tag) return null;
  return {
    tag_name: tag,
    published_at: String(entry.published_at || entry.created_at || ''),
    name: String(entry.name || tag),
    body: String(entry.body || '')
  };
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeEntry).filter(Boolean);
}

function versionParts(tag) {
  var match = VERSION_RE.exec(String(tag || ''));
  if (!match) return null;
  return {
    numbers: [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3], 10)
    ],
    prerelease: match[4] || ''
  };
}

function compareReleaseEntries(left, right) {
  var leftVersion = versionParts(left.tag_name);
  var rightVersion = versionParts(right.tag_name);
  if (leftVersion && rightVersion) {
    for (var index = 0; index < leftVersion.numbers.length; index++) {
      var difference = rightVersion.numbers[index] - leftVersion.numbers[index];
      if (difference) return difference;
    }
    if (!leftVersion.prerelease && rightVersion.prerelease) return -1;
    if (leftVersion.prerelease && !rightVersion.prerelease) return 1;
    var prereleaseOrder = rightVersion.prerelease.localeCompare(leftVersion.prerelease);
    if (prereleaseOrder) return prereleaseOrder;
  }
  return String(right.published_at || '').localeCompare(String(left.published_at || ''));
}

function mergeReleaseEntries(primary, fallback) {
  var byTag = new Map();
  for (var fallbackEntry of normalizeEntries(fallback)) {
    byTag.set(fallbackEntry.tag_name, fallbackEntry);
  }
  for (var primaryEntry of normalizeEntries(primary)) {
    byTag.set(primaryEntry.tag_name, primaryEntry);
  }
  return Array.from(byTag.values()).sort(compareReleaseEntries);
}

function readJson(filePath, serviceLog, label) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    serviceLog.warn('product-releases', label + ' read failed: ' + (error.message || error));
    return null;
  }
}

function readFallback(root, serviceLog) {
  var fallbackPath = path.join(root, 'public', 'release-history-fallback.json');
  return normalizeEntries(readJson(fallbackPath, serviceLog, 'fallback'));
}

function readDiskCache(cacheFile, serviceLog) {
  var parsed = readJson(cacheFile, serviceLog, 'disk cache');
  if (!parsed || typeof parsed !== 'object') return { fetched_at: 0, releases: [] };
  return {
    fetched_at: Number(parsed.fetched_at) || 0,
    releases: normalizeEntries(parsed.releases)
  };
}

function writeDiskCache(cacheFile, cache, serviceLog) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');
  } catch (error) {
    serviceLog.warn('product-releases', 'disk cache write failed: ' + (error.message || error));
  }
}

function githubHeaders() {
  var headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'asseris-claude-usage-dashboard',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  var token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function defaultFetchReleases(callback) {
  httpClient.httpsGetJson(
    RELEASES_API_URL,
    githubHeaders(),
    callback,
    DEFAULT_TIMEOUT_MS
  );
}

function createClient(options) {
  options = options || {};
  var serviceLog = loggerOrDefault(options.serviceLog);
  var cacheFile = options.cacheFile || storagePaths.stateFile('product-release-history.json');
  var cacheTtlMs = Number(options.cacheTtlMs) >= 0
    ? Number(options.cacheTtlMs)
    : DEFAULT_CACHE_TTL_MS;
  var fetchReleases = options.fetchReleases || defaultFetchReleases;
  var cache = readDiskCache(cacheFile, serviceLog);
  var lastAttemptAt = cache.fetched_at;
  var inFlight = [];

  function completePending(error) {
    var pending = inFlight;
    inFlight = [];
    for (var request of pending) {
      var fallback = readFallback(request.root, serviceLog);
      request.callback(error, mergeReleaseEntries(cache.releases, fallback));
    }
  }

  function fetchAndComplete() {
    fetchReleases(function (error, entries) {
      lastAttemptAt = Date.now();
      var normalized = normalizeEntries(entries);
      if (!error && normalized.length) {
        cache = { fetched_at: lastAttemptAt, releases: normalized };
        writeDiskCache(cacheFile, cache, serviceLog);
      } else if (error) {
        serviceLog.warn(
          'product-releases',
          'GitHub release refresh failed; using local cache: ' + (error.message || error)
        );
      }
      completePending(null);
    });
  }

  function getReleaseHistory(root, callback) {
    var now = Date.now();
    if (now - lastAttemptAt < cacheTtlMs) {
      var fallback = readFallback(root, serviceLog);
      process.nextTick(function () {
        callback(null, mergeReleaseEntries(cache.releases, fallback));
      });
      return;
    }

    inFlight.push({ root: root, callback: callback });
    if (inFlight.length === 1) fetchAndComplete();
  }

  return {
    getReleaseHistory: getReleaseHistory
  };
}

module.exports = {
  RELEASES_API_URL: RELEASES_API_URL,
  compareReleaseEntries: compareReleaseEntries,
  createClient: createClient,
  mergeReleaseEntries: mergeReleaseEntries,
  normalizeEntries: normalizeEntries
};
