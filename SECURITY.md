# Security policy

## Supported versions

Security fixes are applied to the latest `main` branch and the latest published
release.

## Reporting

Please do not disclose a suspected vulnerability in a public issue. Use the
private vulnerability-reporting channel on the GitHub repository or contact
the maintainers through the Asseris organization profile.

Include reproduction steps, affected version and the expected impact. Do not
include real Claude session logs, API keys, cookies or account identifiers.

## Local trust boundary

The server binds to `127.0.0.1` by default and has no authentication layer.
Only bind it to another interface when the surrounding network/container
provides an appropriate access-control boundary.

Browser API requests are restricted to the dashboard origin. Responses use a
nonce-bound Content Security Policy, deny framing and disable MIME sniffing.
Browser libraries and fonts are served locally from pinned dependencies.

Keep the source-log directories readable only by the account running the
dashboard. Put writable derived state in `CLAUDE_USAGE_STATE_DIR`; for
containers, mount source logs read-only and use a separate state volume.
