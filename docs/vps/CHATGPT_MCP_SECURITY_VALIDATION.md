# ChatGPT MCP security validation

## Current result

- VPS deployment: 9/9 containers healthy on 2026-07-28.
- MCP test suite: 24/24 passing locally and in the deployed container.
- Staging safety validator: passed with `actions_executed=0`.
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
- Network exposure: SSH only; HTTP and HTTPS remain bound to loopback.
- PostgreSQL: `suleia_mcp_readonly` has no role-escalation or database-create
  flags, no direct `core.orders` privileges, can select the masked MCP view and
  fails a real INSERT attempt.
- Runtime OpenAI audit: no API key in active containers, no runtime imports and
  no OpenAI cron or systemd references.

## Mandatory pending checks

- Confirm ChatGPT-plan compatibility manually.
- Install and validate an established OAuth provider.
- Validate expired-token, revocation and OAuth discovery paths.
- Verify the remote scan from ChatGPT after the endpoint is authorized.

These are connection blockers, not waived risks.
