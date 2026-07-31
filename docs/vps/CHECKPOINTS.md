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
- Thirty-two fictitious, masked fixtures.

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
- Thirty-two fixture simulations and fifteen MCP tests passed.

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

## Checkpoint H - Incident evidence workflows

Status: implemented and validated in simulation.

- Direct return requires aligned current customer and carrier evidence.
- Agency pickup requires current carrier or incident-history confirmation.
- Later incompatible evidence supersedes earlier evidence and routes to human
  review.
- The agency message is proposed only; it is never sent.
- Explicit current return intent blocks discounts and commercial recovery.
- Seven new anonymized fixtures pass, for 32 total.

Final invariant: `ACTIONS_EXECUTED=0`.

## Checkpoint E-G authorized read continuation - 2026-07-28

Status: executed as safe `INCOMPLETE`.

- Owner authorized semantic read-only `POST` queries for Dropea and GLS.
- Dropea completed one page and returned zero orders created in the interval.
- GLS completed five of five tracking queries.
- The current-system cache authenticated and returned 12 records.
- Exact Dropea-tag references produced three `PARTIAL_MATCH` comparisons;
  nine remained `INSUFFICIENT_DATA`.
- All twelve routes remain `BLOCKED` because the current-system cache is
  explicitly non-authoritative for completeness.
- No fuzzy identity matching, customer action or external write occurred.

Final invariants: `ACTIONS_EXECUTED=0`, `PII_PERSISTED_COUNT=0`.

## Checkpoint E-G continuation - 2026-07-28

Status: executed as `INCOMPLETE`.

- Exact Europe/Madrid interval applied.
- Shopify pagination complete: 12 orders in one page.
- Chatby pagination complete: nine pages.
- Twelve orders masked and simulated.
- Dropea, GLS and current-system comparison remained unavailable.
- All twelve decisions routed to `BLOCKED`.
- Masked report persisted privately on the VPS with mode `0600`.

Final invariants: `ACTIONS_EXECUTED=0`, `PII_PERSISTED_COUNT=0`.
# ChatGPT private MCP checkpoint — prepared, not activated

- Secure MCP Tunnel rejected because it requires an OpenAI Platform API key
  and calls to `api.openai.com`.
- Private MCP hardened to eight strict read/simulation tools.
- Public MCP endpoint remains disabled.
- OAuth and ChatGPT-plan compatibility are mandatory pending gates.
- Discount automation remains disabled and no template send is authorized.
- Required steady state: `run_mode=SIMULATION`, `actions_executed=0`.

## Autonomous Operations Company — Phase A

Status: implemented and stopped for owner review on 2026-07-31.

- Six organizational layers defined.
- Forty departments have explicit ownership, responsibilities and outputs.
- Forty deterministic primary-agent contracts are simulation-only.
- Executive snapshot contract validates zero actions and zero production writes.
- Current one-hour, 48-hour, 72-hour, disabled-discount and idempotency rules
  are documented without behavior changes.
- No new service, database migration, endpoint, connector or executor was added.
- Phase B has not started.

Required invariants: `OPENAI_API_CALLS=0`, `EXTERNAL_AI_CALLS=0`,
`ACTIONS_EXECUTED=0`, `PRODUCTION_WRITES=0`, `MESSAGES_SENT=0`.
