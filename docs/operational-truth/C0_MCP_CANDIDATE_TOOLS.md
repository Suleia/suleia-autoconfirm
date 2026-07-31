# Candidate MCP tools — not exposed

The current MCP remains exactly eight tools. These contracts are design-only:

| Candidate | Input | Output | Scope | Limits and masking |
|---|---|---|---|---|
| get_truth_snapshot | masked canonical ID, as-of | Truth Snapshot | truth:read | no PII; bounded facts; cursor pagination |
| get_connector_health | connector, time window | transport/data health | health:read | aggregate only; no credentials |
| get_migration_readiness | optional component | readiness blockers | migration:read | no production mutation |
| get_replay | masked canonical ID, as-of | replay hash/result | replay:read | bounded events; no raw payload |
| get_parity_summary | module, cursor | dimension results | parity:read | no opaque percentage; bounded page |

Risks include identity probing, inference from small groups, oversized output and stale evidence. Future exposure would require minimum cohorts, authorization scopes, pagination, rate limits, output masking and a new explicit checkpoint.

