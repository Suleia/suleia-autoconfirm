# Test plan

## Unit

- Event idempotency and immutability.
- Timer derivation.
- Digital Twin replay and point-in-time build.
- Contradiction detection.
- Deterministic routing.
- PII masking.

## Fixtures

Twenty-five fictitious orders cover:

- confirmation wait;
- changed mind;
- incidents;
- stale data;
- no evidence;
- delivered orders;
- legacy 36-hour comparison;
- duplicate action proposals;
- critical-risk blocking.
- UNKNOWN 72-hour preservation with administrative alert, `HUMAN_REVIEW`, `NO_ACTION` and zero execution.
- ingestion source allowlisting and source-record deduplication.

## Integration

- PostgreSQL migrations and rollback.
- Read-only role grants.
- MCP stdio client.
- MCP Streamable HTTP client.
- Authentication, scopes and rate limits.
- Audit insert and PII scan.
- Backup and isolated restore.

## Acceptance

- Existing application regression suite passes.
- MCP suite passes.
- Platform core suite passes.
- Fixture validator passes.
- Compose services become healthy.
- No production endpoint is called.
- `actions_executed = 0` everywhere.

Docker integration tests remain pending because Docker is not installed locally.
