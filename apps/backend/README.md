# Backend

The backend is a dependency-free Node.js application that reads local evidence
and serves the dashboard.

- `dashboard-server.js` composes the local scanner, caches and HTTP server.
- `entrypoints/dashboard.js` starts the UI process.
- `entrypoints/jsonl-agent.js` scans Claude session JSONL.
- `entrypoints/provider-agent.js` refreshes optional public metadata.

All imported request telemetry is treated as read-only evidence.
