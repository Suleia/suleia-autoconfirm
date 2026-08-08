# Current status

> Historical status document. The definitive MCP checkpoint supersedes the
> original eight-tool prototype: the server contract is now exactly sixteen
> private read/simulation tools, pending deployment and real ChatGPT
> Refresh/Scan Tools acceptance.

Updated: 2026-07-28

## Completed locally

- Isolated branch: `feature/vps-self-hosted-platform`.
- Safety snapshot tag: `pre-vps-self-hosted-20260726`.
- Docker Compose draft for a single Ubuntu LTS VPS.
- PostgreSQL schemas, append-only Event Store and least-privilege group roles.
- Deterministic Digital Twin and Decision Engine prototypes.
- Streamable HTTP and stdio read-only MCP prototypes.
- Masked fictitious dataset with 25 order scenarios.
- Review panel prototype.
- Backup, restore, verification and migration rehearsal scripts.
- Strict MCP allowlisted views instead of direct schema access.
- Complete masked review queue contracts.
- Local ingestion pipeline with masking and deduplication gates.
- Disabled Action Executor that fails closed.
- Authentication options and OAuth acceptance gates.
- Local validation: 62 current-system tests, 15 MCP tests, 8 platform-core tests and 25 fixtures passed.
- Static secret, syntax and staging-safety scans passed.
- UNKNOWN cases at 72 hours remain `UNKNOWN`, create an administrative alert,
  route to `HUMAN_REVIEW` and execute no action.
- The MCP contract now exposes exactly the eight authorized read/simulation
  tools, including `preview_order_decision` and
  `list_orders_needing_ai_review`.
- A pre-purchase VPS comparison is complete. Hetzner onboarding could not be
  completed by the owner without a VAT ID in the presented flow.
- The replacement recommendation is Contabo Cloud VPS 6 on a one-month
  contract with Auto Backup, estimated at EUR 13.13/month including Spanish
  VAT.
- A two-phase, lockout-safe Contabo host bootstrap is prepared.

## Explicitly not done

- No DNS has been changed.
- Nothing has been deployed publicly.
- No production data or credentials have been imported.
- No live webhook, cron, polling or external write has been enabled.
- Render and Supabase production remain untouched.

## Runtime validation

Docker and PostgreSQL are not installed on the workstation. The corresponding
runtime checks were instead completed on the private Contabo VPS: the Compose
stack is healthy, database roles were inspected, and backup plus isolated
restore passed.

## Current authorization gate

The all-orders-today batch cannot proceed until a pre-existing GET-compatible
Shopify Admin access token and shop domain are available to the runner without
modifying production. No token exchange using `POST` is permitted.

## Safety invariant

Every staging decision must contain:

```json
{
  "run_mode": "SIMULATION",
  "actions_executed": 0
}
```

## VPS and daily real-order checkpoint

The Contabo staging platform is now deployed privately and verified. Nine
containers are healthy, backup and restore were rehearsed, and public
application ingress remains disabled.

The GET-only all-orders-today pipeline is implemented and tested. Its
2026-07-27 live preview stopped safely with
`SHOPIFY_GET_CREDENTIALS_MISSING`: Render exposes Shopify client credentials
but not an Admin access token or shop domain. Token exchange would require a
forbidden `POST`.

No orders were read, no masked real batch was persisted, Render and Supabase
were not modified, and the result remains:

```text
ACTIONS_EXECUTED=0
PII_PERSISTED_COUNT=0
```

## 2026-07-28 masked real-order batch

The existing Shopify application credentials were recovered from approved
local configuration. An ephemeral access token was issued in memory and all
12 orders created in the current Europe/Madrid business day were retrieved
with complete Shopify pagination.

The owner subsequently authorized exact semantic read-only `POST` queries.
Dropea completed one page, GLS completed five tracking lookups, and the
current-system cache authenticated successfully. Exact Dropea-tag references
allowed three partial comparisons; nine orders still lacked a shared exact
reference.

The batch remains conservatively `INCOMPLETE` and routes every order to
`BLOCKED` because the current-system cache declares itself non-authoritative
for completeness. The updated masked report is stored privately on the VPS
with mode `0600`.

`ACTIONS_EXECUTED=0` and `PII_PERSISTED_COUNT=0`.
