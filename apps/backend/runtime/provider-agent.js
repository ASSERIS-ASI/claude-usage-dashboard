/**
 * @asseris-module       Provider Agent
 * @asseris-description  Canonical runtime provider-agent implementation.
 * @asseris-pillar       sensor
 * @asseris-domain       agent-process
 * @asseris-stage        core
 */
/**
 * provider-agent.js — Standalone background agent for public metadata fetches.
 * Canonical path: apps/backend/runtime/provider-agent.js
 * Stage 16 hard-cut: root scripts wrapper removed.
 *
 * Runs independently of the dashboard server. Handles:
 *   1. Outage/Releases/Marketplace fetches → disk cache → notify dashboard
 *
 * Usage:
 *   node start.js provider-agent
 *   node apps/backend/runtime/provider-agent.js
 *   node apps/backend/entrypoints/provider-agent.js
 *
 * Environment:
 *   CLAUDE_USAGE_DASHBOARD_URL  (default: http://localhost:3333)
 *   CLAUDE_USAGE_PROVIDER_OUTAGE_INTERVAL_MS     (default: 300000 = 5 min)
 *   CLAUDE_USAGE_PROVIDER_RELEASES_INTERVAL_MS   (default: 3600000 = 1h)
 *   CLAUDE_USAGE_PROVIDER_MARKETPLACE_INTERVAL_MS (default: 21600000 = 6h)
 */

var serviceLog = require('../infra/service-logger');
var { notifyDashboard: _notifyDashboard } = require('../infra/notify-dashboard');

var outageClient = require('../infra/providers/outage-client');
var releasesClient = require('../infra/providers/github-releases-client');
var marketplaceClient = require('../infra/providers/marketplace-client');

// ── Config ──────────────────────────────────────────────────────────────

var DASHBOARD_URL = (process.env.CLAUDE_USAGE_DASHBOARD_URL || 'http://localhost:3333').replace(/\/+$/, '');

var OUTAGE_INTERVAL = parseInt(process.env.CLAUDE_USAGE_PROVIDER_OUTAGE_INTERVAL_MS, 10) || 300000;
var RELEASES_INTERVAL = parseInt(process.env.CLAUDE_USAGE_PROVIDER_RELEASES_INTERVAL_MS, 10) || 3600000;
var MARKETPLACE_INTERVAL = parseInt(process.env.CLAUDE_USAGE_PROVIDER_MARKETPLACE_INTERVAL_MS, 10) || 21600000;

// ── Notify Dashboard ────────────────────────────────────────────────────

function notifyDashboard(source) {
  _notifyDashboard(DASHBOARD_URL, source, serviceLog);
}

// ── Provider Refresh + Notify ───────────────────────────────────────────

function refreshOutage() {
  serviceLog.info('provider-agent', 'refreshing outage...');
  outageClient.refreshOutageCache(serviceLog, function () {
    notifyDashboard('outage');
  });
}

function refreshReleases() {
  serviceLog.info('provider-agent', 'refreshing releases...');
  releasesClient.refreshReleasesCache(serviceLog);
  setTimeout(function () { notifyDashboard('releases'); }, 5000);
}

function refreshMarketplace() {
  serviceLog.info('provider-agent', 'refreshing marketplace...');
  marketplaceClient.refreshMarketplaceExtensionCache(serviceLog, function () {
    notifyDashboard('marketplace');
  });
}

// ── Startup ─────────────────────────────────────────────────────────────

serviceLog.info('provider-agent', 'starting');
serviceLog.info('provider-agent', 'dashboard: ' + DASHBOARD_URL);
serviceLog.info('provider-agent', 'intervals: outage=' + (OUTAGE_INTERVAL / 1000) + 's, releases=' + (RELEASES_INTERVAL / 1000) + 's, marketplace=' + (MARKETPLACE_INTERVAL / 1000) + 's');

// Staggered startup
setTimeout(refreshOutage, 500);
setTimeout(refreshReleases, 2500);
setTimeout(refreshMarketplace, 4500);

// Recurring intervals
setInterval(refreshOutage, OUTAGE_INTERVAL);
setInterval(refreshReleases, RELEASES_INTERVAL);
setInterval(refreshMarketplace, MARKETPLACE_INTERVAL);

serviceLog.info('provider-agent', 'running — Ctrl+C to stop');
