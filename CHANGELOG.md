# Changelog

All notable changes to the standalone public Claude Usage Dashboard are
documented here.

## Unreleased

## [1.10.0] - 2026-07-30

### Added

- Added release-gated GHCR publishing with immutable source-SHA tags, OCI
  provenance, an SBOM and stable semantic-version aliases.
- Added an explicit ASSERIS AISBL trademark notice covering every logo asset in
  `public/img`.

### Security

- Restricted browser API requests to the dashboard origin and removed wildcard
  CORS responses from local data endpoints.
- Added nonce-bound Content Security Policy, frame denial, MIME-sniffing
  protection, referrer policy and permissions policy.
- Replaced browser CDNs with pinned, locally served dependencies and upgraded
  Apache ECharts to the security-fixed 6.1.0 release.
- Upgraded to native DataTables 3, removed the jQuery runtime, and upgraded
  Marked to 18 with DOMPurify sanitization for rendered Markdown.

### Changed

- Made published Gitea releases published to GitHub the canonical source for the
  in-dashboard release history, with a persistent local cache and immutable
  predecessor fallback for offline use.
- Standardized the supported runtime on the Node.js 24 LTS release line.
- Added a dashboard-only Jenkins pipeline with fail-closed CI, dependency
  auditing, SonarQube analysis, Quality Gate enforcement, immutable container
  publishing and Kubernetes rollout.
- Added a dedicated Kubernetes dashboard stack that keeps runtime state on its
  own PVC and exposes only the dashboard HTTP port.
- Documented the read-only `claude-code-cache-fix` combination, including its
  imported telemetry, session-log complement and unavailable fields.
- Consolidated writable derived data under `CLAUDE_USAGE_STATE_DIR`.
- Added a guarded, one-time migration for earlier caches, layouts and custom
  templates without re-importing them after a later layout reset.
- Fixed restored Settings sidebars rendering an empty template list before
  persisted preferences had finished loading.
- Updated the container to separate read-only Claude inputs from writable
  dashboard state and document loopback-only port publishing.
- Completed Korean translation-key parity and made the first-run setup switch
  between German, English and Korean.

### Fixed

- Kept the Release Notes action functional after the Settings sidebar replaces
  its rendered controls.

## [1.9.0] - 2026-07-29

### Added

- Standalone, local and read-only dashboard distribution maintained by Asseris.
- Import adapters for Claude session JSONL, compatible request NDJSON,
  `claude-code-cache-fix` telemetry and MeterRowSchema v1.
- Local setup flow, multilingual UI, configurable page templates and
  cost-forensic reports.
- Version consistency checks, unit tests and runtime smoke tests.
- Automated CI plus verified `main` and release-tag publishing to GitHub.

### Changed

- The server binds to loopback by default.
- Release history is bundled with the application and remains available
  offline.
- The package and repository metadata now point to
  `ASSERIS-ASI/claude-usage-dashboard`.

## Predecessor release lineage

The original public project published the following versions before the
standalone Asseris continuation:

| Version | Date | Public focus |
| --- | --- | --- |
| v1.8.3 | 2026-04-15 | UX, performance and Claude Desktop log discovery |
| v1.8.2 | 2026-04-14 | Empty-data guards |
| v1.8.1 | 2026-04-14 | Widget dispatcher and pricing corrections |
| v1.8.0 | 2026-04-13 | Widget system, templates and ECharts migration |
| v1.7.0 | 2026-04-13 | Apache-2.0 and community files |
| v1.6.0 | 2026-04-11 | Quota and overpayment visualizations |
| v1.5.0 | 2026-04-11 | Code-quality fixes |
| v1.4.0 | 2026-04-11 | Budget drain, burn zone and cache health |
| v1.3.7 | 2026-04-11 | Maintenance release |
| v1.3.6 | 2026-04-11 | Minor fixes |
| v1.3.5 | 2026-04-11 | Economic-chart rendering fixes |
| v1.3.4 | 2026-04-10 | English/Korean documentation and CI |
| v1.3.3 | 2026-04-10 | Economic-section UI fixes |
| v1.3.2 | 2026-04-10 | Code quality and release tooling |
| v1.3.1 | 2026-04-10 | Static-analysis cleanup |
| v1.3.0 | 2026-04-10 | Cache Explosion and Economic Usage |
| v1.2.0 | 2026-04-09 | ECharts proof of concept and data-format docs |
| v1.1.0 | 2026-04-08 | Multi-day trends and Korean UI |
| v1.0.1 | 2026-04-08 | UI, release information and quality gate |
| v1.0.0 | 2026-04-07 | First stable dashboard release |

Those historical tags remain attached to the
[predecessor repository](https://github.com/fgrosswig/claude-usage-dashboard/releases).
They are deliberately not retargeted to the continuation repository. The
predecessor `v1.8.4` entry was a draft rather than a published release.

[1.10.0]: https://github.com/ASSERIS-ASI/claude-usage-dashboard/releases/tag/v1.10.0
[1.9.0]: https://github.com/ASSERIS-ASI/claude-usage-dashboard/releases/tag/v1.9.0
