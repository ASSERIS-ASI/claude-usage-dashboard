# Claude Usage Dashboard

[English](README.md) · [Deutsch](README.de.md) · [한국어](README.ko.md)

Local, read-only analytics for Claude Code sessions, token usage, cache
behaviour, quota signals and estimated cost.

The dashboard reads evidence already present on your machine, leaves source
logs unchanged and keeps its derived state local.

## What is included

- Claude Code session JSONL discovery and incremental scanning
- daily usage, model, cache, agent and session analysis
- cost-forensic and counterfactual reports
- configurable dashboard pages, each starting from an editable default template
- dated rate cards, so a past cost is priced with the rates that were published
  when it was incurred
- German, English and Korean UI
- optional read-only adapters for:
  - [`cnighswonger/claude-code-cache-fix`](https://github.com/cnighswonger/claude-code-cache-fix) `usage.jsonl` and debug log
  - [`cnighswonger/claude-code-meter`](https://github.com/cnighswonger/claude-code-meter) MeterRowSchema v1
  - compatible request NDJSON

## Requirements

- Node.js 24 LTS
- a modern browser
- local Claude Code logs for usage views

The browser UI is self-contained: ECharts, DataTables, Marked, DOMPurify and
Cinzel are installed as pinned package dependencies and served locally. The
Gelasio, Carlito and Cascadia Code text faces ship with the source tree under
the SIL Open Font License 1.1. No web font, script or stylesheet is fetched
from a CDN.

## Start

```bash
git clone https://github.com/ASSERIS-ASI/claude-usage-dashboard.git
cd claude-usage-dashboard
npm ci
npm start
```

Open <http://127.0.0.1:3333>. On first start the setup screen asks for
language, Anthropic plan, additive data sources and log roots. Claude JSONL is
the base source; Cache Fix and Code Meter can be enabled independently or
together. Selecting a source does not modify it.

Useful options:

```bash
node dashboard.js --port=3360
node dashboard.js --host=127.0.0.1 --refresh=180
```

The server binds to `127.0.0.1` by default. Derived state is stored in
`~/.claude/usage-dashboard-product`; override it with
`CLAUDE_USAGE_STATE_DIR`. Source logs are only read.

## Docker

Verified public snapshots are published as
`ghcr.io/asseris-asi/claude-usage-dashboard`:

- `edge` follows the public `main` branch.
- `latest`, `vX.Y.Z`, `X.Y.Z`, `X.Y` and `X` are published only for a
  non-prerelease GitHub release.
- `sha-<12 characters>` identifies the exact public source snapshot.
- Published images currently target `linux/amd64`.

Run the current stable image:

```bash
docker pull ghcr.io/asseris-asi/claude-usage-dashboard:latest
docker run --rm --init -p 127.0.0.1:3333:3333 \
  -v "$HOME/.claude:/home/node/.claude:ro" \
  -v "claude-usage-dashboard-state:/data" \
  ghcr.io/asseris-asi/claude-usage-dashboard:latest
```

Or build the same image locally:

```bash
docker build -t claude-usage-dashboard .
docker run --rm --init -p 127.0.0.1:3333:3333 \
  -v "$HOME/.claude:/home/node/.claude:ro" \
  -v "claude-usage-dashboard-state:/data" \
  claude-usage-dashboard
```

The source-log mount is read-only. A separate writable volume holds derived
state. PowerShell equivalent:

```powershell
docker run --rm --init -p 127.0.0.1:3333:3333 `
  -v "${HOME}/.claude:/home/node/.claude:ro" `
  -v "claude-usage-dashboard-state:/data" `
  claude-usage-dashboard
```

### Kubernetes

A dashboard-only Kustomize stack is available under
[`k8s/`](k8s/README.md). It exposes only port `3333` and persists dashboard
state separately from optional source logs:

```bash
kubectl kustomize k8s/overlays/prod
kubectl apply -k k8s/overlays/prod
```

The public GitHub workflows run Node 24 CI. Container images are built only
from verified, scrubbed public snapshots.

## Additive data sources

| Source | Role | Adds |
| --- | --- | --- |
| Claude JSONL | Base | sessions, agents, tokens and estimates |
| Cache Fix | Optional additional service | request cache, TTL, quota and observed fix activity |
| Code Meter | Optional additional service | MeterRow v1 request, session and agent attribution |

The optional services are additive. They may both be enabled; rows that share
the same request identity are merged before aggregation so token usage is not
counted twice. Request telemetry is imported as read-only evidence.

### Using `claude-code-cache-fix`

Run the dashboard alongside
[`cnighswonger/claude-code-cache-fix`](https://github.com/cnighswonger/claude-code-cache-fix)
and enable **Claude Cache Fix** as an additional service during first-run
setup. Keep the Claude session-log roots enabled, then select the Cache Fix
`usage.jsonl` and, when available, its debug log. **Claude Code Meter** may be
enabled at the same time; matching MeterRow v1 records enrich the request with
session and agent attribution.

- `usage.jsonl` adds per-request token classes, model distribution, cache-read
  ratio, ephemeral cache-creation counters and the recorded 5-hour/7-day quota
  signals.
- A compatible diagnostic event log can add explicitly recorded
  applied/skipped fix activity and Cache TTL events. The dashboard does not
  infer those events from ordinary Cache Fix server request/response traces.
- Claude session JSONL remains the source for session boundaries, agents,
  compactions and other session-level analysis.

The integration is read-only. Request duration and HTTP failures are not part
of `usage.jsonl`; they remain unavailable unless a separately supported source
records them, and are never estimated.

Default optional-source locations:

| Source | Default path | Override |
| --- | --- | --- |
| Claude Code sessions | `~/.claude/projects/**/*.jsonl` | setup log roots or `CLAUDE_USAGE_EXTRA_BASES` |
| compatible request telemetry | `~/.claude/anthropic-proxy-logs/**/*.ndjson` | `ANTHROPIC_PROXY_LOG_DIR`, `CLAUDE_USAGE_PROXY_LOG_DIRS` |
| Cache Fix usage | `~/.claude/usage.jsonl` | `CACHE_FIX_USAGE_LOG` |
| Cache Fix activity | `~/.claude/cache-fix-debug.log` | `CACHE_FIX_DEBUG_LOG` |
| Cache Fix request timing | none; proxy mode with the request-log extension only | `CACHE_FIX_REQUEST_LOG` |
| Meter rows | `~/.claude/claude-meter.jsonl` | `CLAUDE_METER_LOG` |

A configured path always wins, an environment override comes next. Failing
both, the dashboard searches the Claude configuration directory and its own
state directory for the artifact by name, so a file dropped one folder over is
still found. The newest match wins. Nothing is invented: an artifact that is
not there is reported as absent rather than assumed at its default path.

### What each source makes available

An additive source is not a switch for more numbers, it decides which analyses
can exist at all. Each artifact declares what it carries, and a chart declares
what it needs:

| Capability | Carried by | Charts that need it |
| --- | --- | --- |
| tokens, session | base source | usage, model and session analysis |
| cache, ttl | Cache Fix usage, Meter rows, request NDJSON | cache-read ratio, TTL tiers |
| quota | Cache Fix usage, Meter rows, request NDJSON | 5-hour and 7-day quota views |
| fixes | Cache Fix activity log | applied and skipped fix activity |
| latency | request NDJSON, Cache Fix request timing | API latency per day and per hour |
| status | request NDJSON | error and 429 rate trends |
| clients | request NDJSON | client comparison and traffic sources |

Charts whose capability no enabled source delivers are hidden rather than
drawn empty, and are dropped from the stored layout — an empty axis reads as
"nothing happened", which is a different and wrong statement. Removal is not
automatically undone: adding the missing source later leaves the chart hidden
until it is switched back on in the layout builder, so a deliberate layout is
never rearranged behind the user's back.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CLAUDE_USAGE_STATE_DIR` | writable directory for setup, caches, layouts and derived history |
| `CLAUDE_USAGE_MIGRATE_LEGACY_STATE=1` | import earlier derived caches and layouts once; enabled by the standard launcher |
| `CLAUDE_CONFIG_DIR` | alternate Claude configuration/input directory |
| `CLAUDE_USAGE_EXTRA_BASES` | additional session-log roots; separated by `;` on Windows and `:` or `;` elsewhere |
| `ANTHROPIC_PROXY_LOG_DIR` | primary compatible request-NDJSON directory |
| `CLAUDE_USAGE_PROXY_LOG_DIRS` | additional request-NDJSON directories |
| `CACHE_FIX_USAGE_LOG` | Cache Fix `usage.jsonl` path |
| `CACHE_FIX_DEBUG_LOG` | Cache Fix activity-log path |
| `CACHE_FIX_REQUEST_LOG` | Cache Fix request-timing log written by the proxy-mode request-log extension |
| `CLAUDE_METER_LOG` | claude-code-meter row path |
| `CLAUDE_USAGE_SCAN_INTERVAL_SEC` | background scan interval |
| `CLAUDE_USAGE_LOG_LEVEL` | server log level |
| `CLAUDE_USAGE_NO_CACHE=1` | diagnostic mode that disables derived scan caches |

The setup screen persists the selected language, plan, additive sources, model
colours and log roots inside `CLAUDE_USAGE_STATE_DIR`. Existing configurations
that used the former `local`, `cache-fix` or `meter` mode are migrated when
read.

A first run also lays out the dashboard: every page starts from its own default
template, stored as an editable copy so it can be rearranged immediately, with
the shipped originals kept as read-only fallbacks. An existing layout is never
overwritten.

The model colours chosen during setup are the colours the charts draw with, so
one model keeps one colour across every view.

## Network and estimates

The dashboard can refresh optional public metadata from
`status.claude.com`, the GitHub Releases API and the Visual Studio Marketplace.
Those refreshes use outbound HTTPS from the local server. Browser assets do
not require a CDN.

Displayed list-price cost and quota projections are estimates derived from
logged token classes and selected plan assumptions; they are not Anthropic
billing records.

### Rate cards

Published token prices change on announced dates, so they are kept as a list of
dated cards instead of one current table. A record is costed with the card that
was valid at its own timestamp — a July figure stays a July figure and is not
silently recomputed at today's rates. Each card names its source and how firm
that source is, so a computed cost remains attributable.

The committed cards are the baseline and are copied into
`rate-cards.ndjson` in the state directory on first setup, so a fresh install
can still price the past. That file is append-only: a new price adds a card,
it never edits an existing one, which is what keeps an earlier computation
reproducible. **Cost Forensic** charts the history per model and marks the day
each card took effect.

## Reset and troubleshooting

Stop the process and remove the directory selected by
`CLAUDE_USAGE_STATE_DIR` to rebuild all derived state. This does not remove
Claude session logs or optional telemetry inputs. If a source is not detected,
verify its path on the setup screen and restart the scan.

## Development

```bash
npm run check
npm test
npm run smoke
```

`npm run check` validates version consistency, distributable contents, module
boundaries and JavaScript syntax.

## Project history

This Asseris-maintained continuation is based on the original Claude Usage
Dashboard work by Falk Großwig. Development, issues and public releases are
available through
[GitHub](https://github.com/ASSERIS-ASI/claude-usage-dashboard). The project
preserves the Apache-2.0 license and attribution.

The standalone public line starts with **v1.9.0**. The published
`v1.0.0`–`v1.8.3` lineage remains documented as predecessor history; its Git
tags are not rewritten onto the continuation repository. See
[CHANGELOG.md](CHANGELOG.md) and the
[published GitHub releases](https://github.com/ASSERIS-ASI/claude-usage-dashboard/releases).

See [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright © 2026 ASSERIS AISBL and contributors. Licensed under the
[Apache License 2.0](LICENSE).

`ASSERIS`, the ASSERIS wordmark and logos are registered trademarks of
ASSERIS AISBL. Apache-2.0 grants no trademark license; see
[TRADEMARKS.md](TRADEMARKS.md).
