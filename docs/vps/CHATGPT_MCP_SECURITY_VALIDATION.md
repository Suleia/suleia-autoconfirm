# ChatGPT MCP security validation

## Current result

- Public endpoint: disabled.
- Authentication: private bearer for local/VPS tests; not approved publicly.
- OAuth: required before any public connection; not yet configured.
- Tool count: exactly eight.
- Tool mode: read-only and simulation-only.
- Rate limit: 30 requests per minute per source.
- Maximum response: 50 KiB.
- Timeline limit: 100 events.
- Decision limit: 20 decisions.
- Review list limit: 5 orders.
- Tool timeout: configurable, 10 seconds by default.
- PII boundary: recursive masking plus final-response scan.
- Audit: hashes parameters and order references; never stores payloads or auth
  headers.
- Container: non-root, read-only filesystem, no host network, no Docker socket,
  all capabilities dropped, PID/CPU/RAM limits and rotated logs.

## Mandatory pending checks

- Confirm ChatGPT-plan compatibility manually.
- Install and validate an established OAuth provider.
- Validate expired-token, revocation and OAuth discovery paths.
- Verify the remote scan from ChatGPT after the endpoint is authorized.

These are connection blockers, not waived risks.

