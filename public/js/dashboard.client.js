/**
 * @asseris-module       Dashboard Client
 * @asseris-description  Auto-annotated module metadata for public/js/dashboard.client.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
'use strict';
/**
 * dashboard.client.js — Thin shell / glue (Phase 18 review fix).
 *
 * All logic has been extracted to dedicated modules:
 *   - core/dashboard-utils.js — formatting, forensic scoring, chart data extraction
 *   - core/dashboard-renderer.js — renderDashboard, renderDashboardCore, coalescing
 *   - core/dashboard-boot.js — applyStaticChrome, init sequence, API boot
 *   - core/ui-utils.js — miniMd, inlineMd
 *   - core/tooltips-ko.js — Korean glossary tooltips
 *   - sections/intelligence.js — intelligence metrics section
 *   - sections/health.js — updateStatusLamp (moved)
 *
 * This file exists only for backward compatibility as a script tag target.
 * No active logic remains here.
 */
