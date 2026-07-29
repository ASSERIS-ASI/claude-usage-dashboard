# Claude Usage Dashboard

Local, read-only analytics for Claude Code sessions, token usage, cache
behaviour, quota signals and estimated cost.

The dashboard reads evidence already present on your machine. It does **not**
proxy Claude traffic, rewrite requests, install certificates, control accounts
or upload your session logs.

## What is included

- Claude Code session JSONL discovery and incremental scanning
- daily usage, model, cache, agent and session analysis
- cost-forensic and counterfactual reports
- configurable dashboard pages and reusable layout templates
- German, English and Korean UI
- optional read-only adapters for:
  - [`cnighswonger/claude-code-cache-fix`](https://github.com/cnighswonger/claude-code-cache-fix) `usage.jsonl` and debug log
  - [`cnighswonger/claude-code-meter`](https://github.com/cnighswonger/claude-code-meter) MeterRowSchema v1
  - compatible request NDJSON

## Requirements

- Node.js 20 or newer
- a modern browser
- local Claude Code logs for usage views
- internet access for the browser-loaded ECharts, DataTables, jQuery, Marked
  and Google Fonts assets

## Start

```bash
git clone https://github.com/ASSERIS-ASI/claude-usage-dashboard.git
cd claude-usage-dashboard
npm ci
npm start
```

Open <http://127.0.0.1:3333>. On first start the setup screen asks for
language, Anthropic plan, source mode and log roots. Selecting a source does
not modify that source.

Useful options:

```bash
node dashboard.js --port=3360
node dashboard.js --host=127.0.0.1 --refresh=180
```

The server binds to `127.0.0.1` by default. Derived state is stored in
`~/.claude/usage-dashboard-product`; override it with
`CLAUDE_USAGE_STATE_DIR`.

## Docker

```bash
docker build -t claude-usage-dashboard .
docker run --rm -p 3333:3333 \
  -v "$HOME/.claude:/home/dashboard/.claude:ro" \
  -v "claude-usage-dashboard-state:/home/dashboard/.claude/usage-dashboard-product" \
  claude-usage-dashboard
```

The source-log mount is read-only. A separate writable volume holds derived
state.

## Data-source modes

| Mode | Input | Adds |
| --- | --- | --- |
| Local | Claude session JSONL | sessions, agents, tokens, estimates |
| Cache Fix | Local JSONL + Cache Fix files | request cache, TTL, quota and observed fix activity |
| Meter | Local JSONL + MeterRow v1 | request, session and agent attribution |

Request telemetry is evidence only. The dashboard contains no proxy execution
path.

## Development

```bash
npm run check
npm test
npm run smoke
```

`npm run check` includes a release-boundary gate that rejects internal hosts
and operational proxy/control-plane modules.

## Project history

This Asseris-maintained continuation is based on the original Claude Usage
Dashboard work by Falk Großwig. Development now happens in the Asseris
repository while preserving the Apache-2.0 license and attribution.

The standalone public line starts with **v1.9.0**. The published
`v1.0.0`–`v1.8.3` lineage remains documented as predecessor history; its Git
tags are not rewritten onto the sanitized repository. See
[CHANGELOG.md](CHANGELOG.md) and [release notes](release-notes/v1.9.0.md).

See [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright © 2026 Asseris and contributors. Licensed under the
[Apache License 2.0](LICENSE).
