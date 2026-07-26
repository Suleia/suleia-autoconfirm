# Current status

Date: 2026-07-26

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

## Explicitly not done

- No VPS has been purchased.
- No DNS has been changed.
- Nothing has been deployed publicly.
- No production data or credentials have been imported.
- No live webhook, cron, polling or external write has been enabled.
- Render and Supabase production remain untouched.

## Local limitation

Docker is not installed on this workstation. Compose has therefore been inspected statically but has not yet completed a real container start.

PostgreSQL is not installed locally, so the SQL migrations have not yet been executed by a database engine. Static checks and application tests do not replace that integration gate.

## Safety invariant

Every staging decision must contain:

```json
{
  "run_mode": "SIMULATION",
  "actions_executed": 0
}
```
