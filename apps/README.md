# Application layout

- `backend/entrypoints`: executable process entrypoints.
- `backend/runtime`: runtime composition for the dashboard and local scanner agents.
- `backend/app`: application services and evidence adapters.
- `backend/domain`: usage, cache and forensic calculations.
- `backend/infra`: local persistence and public metadata clients.
- `backend/server`: local HTTP routes and HTML/static-asset delivery.

The repository intentionally contains no proxy runtime, request rewriting,
certificate authority, session serializer, remote sync or authentication
control plane.
