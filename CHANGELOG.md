# Changelog

All notable changes to the standalone public Claude Usage Dashboard are
documented here.

## [1.9.0] - 2026-07-29

### Added

- Standalone, local and read-only dashboard distribution maintained by Asseris.
- Import adapters for Claude session JSONL, compatible request NDJSON,
  `claude-code-cache-fix` telemetry and MeterRowSchema v1.
- Local setup flow, multilingual UI, configurable page templates and
  cost-forensic reports.
- Version consistency checks, public-boundary checks, unit tests and runtime
  smoke tests.
- Gitea CI plus verified `main` and release-tag mirroring to GitHub.

### Changed

- The server binds to loopback by default.
- Release history is bundled with the application and remains available
  offline.
- The package and repository metadata now point to
  `ASSERIS-ASI/claude-usage-dashboard`.

### Removed

- Proxy execution, request rewriting, TLS interception, session serialization,
  remote synchronization, authentication control-plane and internal deployment
  configuration.

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
They are deliberately not retargeted to the sanitized repository. The
predecessor `v1.8.4` entry was a draft rather than a published release.

[1.9.0]: https://github.com/ASSERIS-ASI/claude-usage-dashboard/releases/tag/v1.9.0
