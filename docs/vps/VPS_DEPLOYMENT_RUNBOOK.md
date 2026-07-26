# VPS deployment runbook

This runbook is prepared but must not be executed without authorization.

## Stage 0: authorization gates

- VPS purchase approved.
- Provider and region approved.
- Domain names approved.
- Staging credentials generated.
- No production connector secrets present.

## Stage 1: host

- Apply `VPS_SECURITY_HARDENING.md`.
- Clone the authorized commit.
- Copy `.env.vps.example` to an untracked `.env`.
- Generate unique database passwords and MCP bearer token.
- Confirm all mandatory safety flags.

## Stage 2: local host validation

- Validate Compose.
- Build images.
- Start PostgreSQL only.
- Run migrations.
- Verify roles and grants.
- Start internal services.
- Load one masked fixture order.
- Run MCP local-client tests.

## Stage 3: private staging

- Keep firewall access restricted.
- Validate health endpoints.
- Validate MCP authorization and scopes.
- Confirm no PII in response or logs.
- Confirm every simulation reports zero actions.
- Run backup and restore drill.

## Stage 4: public staging

This stage requires a second explicit authorization. Only Caddy may expose HTTPS. No production data or writes are permitted.

## Rollback

Stop the Compose project, preserve logs, restore the previous database snapshot if needed and follow `ROLLBACK_PLAN.md`.
