# Execution checkpoints

Updated: 2026-07-27

## Checkpoint A - Audit

Status: complete locally.

- Canonical repository, productive branch and isolated feature branch identified.
- Safety snapshot created before implementation.
- Existing regression tests executed.
- Current Render, Supabase, workflow and dependency architecture documented.
- Confirmation, cancellation and incident logic inventoried without changing production.

## Checkpoint B - Local prototype

Status: implemented; container/database runtime validation pending.

- Docker Compose and Caddy design.
- PostgreSQL roles, schemas, migrations and rollback scripts.
- Immutable Event Store, Order Digital Twin, Timer Engine and deterministic Decision Engine.
- AI_REVIEW and HUMAN_REVIEW queue contracts.
- Read-only MCP over stdio and Streamable HTTP.
- Internal review panel prototype.
- Twenty-five fictitious, masked fixtures.

Docker and PostgreSQL are unavailable on this workstation. Therefore, container startup and SQL-engine execution are not marked complete.

## Checkpoint C - Local security

Status: complete for static and application-level gates.

- PII masking and ingestion fail-closed tests.
- PostgreSQL least-privilege grants and MCP allowlisted views.
- MCP tool surface frozen to eight read/simulation tools.
- Bearer authentication is local/private only; OAuth remains mandatory before shared staging.
- Action Executor disabled and fail-closed.
- Every simulation reports `actions_executed = 0` and `run_mode = SIMULATION`.
- Critical risk is blocked. UNKNOWN cases remain `UNKNOWN` after 72 hours, emit an administrative alert, move to human review and execute no action.

## Checkpoint D - Private VPS staging

Status: complete and verified.

- Contabo VPS provisioned and hardened with key-only SSH.
- Root and password SSH logins disabled.
- Application ingress remains private; Caddy binds to loopback.
- Nine containers healthy.
- PostgreSQL is isolated from public networks.
- Backup and isolated restore drill passed.
- Twenty-five fixture simulations and fifteen MCP tests passed.

## Checkpoint E-G replacement - All orders created today

Status: `ABORTED` at the mandatory preview gate on 2026-07-27.

The owner replaced the former one-order and small-batch limits with a single
authorized scope: every order created on the Europe/Madrid business date. The
GET-only pipeline and safety tests are complete.

The live preview could not consult Shopify because the Render service lacks a
Shopify Admin access token and shop domain. Client-credential exchange would
require prohibited `POST`. No orders were read, no real batch was persisted,
and no production action occurred.

Final invariants: `ACTIONS_EXECUTED=0`, `PII_PERSISTED_COUNT=0`.
