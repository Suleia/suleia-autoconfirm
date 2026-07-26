# PostgreSQL architecture

## Schemas

| Schema | Purpose |
| --- | --- |
| `raw` | Masked ingestion records and source checksums |
| `core` | Orders, conversations, incidents, timers and freshness |
| `events` | Immutable order Event Store |
| `decisions` | Decisions, evidence, confidence, QA and review queues |
| `configuration` | Versioned policies |
| `operations` | Durable jobs, idempotency and reconciliation |
| `mcp` | MCP call audit |
| `audit` | Masked application audit events |

## Group roles

- `suleia_api`: panel/API read and controlled application writes.
- `suleia_ingestion`: append source data and update canonical entities.
- `suleia_decision_engine`: read evidence, append simulated decisions and timers.
- `suleia_mcp_readonly`: select only through masked `mcp.*` views, except append-only MCP audit.
- `suleia_backup`: select-only backup.
- `suleia_migrations`: reserved migration ownership group.

Login users and passwords are not created in source control. They must be provisioned on the VPS and granted exactly one group role.

## Important invariants

- Timestamps use `timestamptz` and UTC.
- Events cannot be updated or deleted.
- Decision records enforce `actions_executed = 0`.
- Decision records enforce `run_mode = SIMULATION`.
- Deduplication keys are unique.
- PostgreSQL is not internet-accessible.
- The MCP role has no direct access to `core`, `events`, `decisions` or `configuration`.
