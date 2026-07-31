# Suleia Enterprise Intelligence Platform

## Position

This is a target design above, not a replacement for, the Suleia Operating
System. It consumes masked, versioned and auditable outputs from the Event
Store, Digital Twins, deterministic Decision and Policy Engines, PostgreSQL
and the private read-only MCP.

```text
Suleia Operating System
  -> Enterprise Intelligence Platform
     -> Business Graph
     -> Decision and Knowledge Memory
     -> Enterprise Digital Twins
     -> Economic and Strategic Brains
     -> Process, Policy and Operational Intelligence
     -> Enterprise Control Tower
```

## Invariants

- PostgreSQL remains the only planned database; no graph or vector database.
- Deterministic SQL, rules, statistics and simulations only.
- No OpenAI API, external AI, embeddings or local LLM.
- Entity correlation uses technical identifiers, never approximate PII.
- Outputs are masked, paginated, rate-limited and auditable.
- Intelligence may calculate and recommend but cannot authorize actions.
- Phase C Design creates no tables, services, workers or MCP tools.

## Candidate read contracts

The following are specifications only and are not exposed by MCP: company
twin, business graph summary, decision memory, similar decisions, economic
summary, strategic summary, process bottlenecks, policy performance, product,
carrier and campaign twins, and migration status.

| candidate tool | future scope | bounded input | output class |
|---|---|---|---|
| `get_company_twin` | `company:read` | `as_of` | one masked snapshot |
| `get_business_graph_summary` | `graph:read` | entity type/id, depth <= 3 | paginated verified edges |
| `get_decision_memory` | `decisions:read` | decision or masked order id | one structured record |
| `find_similar_decisions` | `decisions:read` | typed dimensions, cursor | rule-matched page |
| `get_economic_summary` | `economics:read` | bounded period, dimensions | aggregate measures |
| `get_strategic_summary` | `strategy:read` | bounded period | structured recommendations |
| `get_process_bottlenecks` | `processes:read` | process/version/period | aggregate bottlenecks |
| `get_policy_performance` | `policies:read` | policy/version/period | simulated/outcome metrics |
| `get_product_twin` | `twins:read` | technical product id, `as_of` | masked product twin |
| `get_carrier_twin` | `twins:read` | technical carrier id, `as_of` | carrier twin |
| `get_campaign_twin` | `twins:read` | technical campaign id, `as_of` | campaign twin |
| `get_migration_status` | `migration:read` | component/cursor | parity page |

Every future contract requires a dedicated read scope, masked identifiers,
bounded date ranges, cursor pagination, maximum response size, safe audit
event, per-principal rate limit and `actions_executed=0`.

Candidate defaults are page size 25, hard maximum 100, opaque cursors, depth
maximum 3, 50 KiB response maximum, 30 requests per minute per principal and a
15-second execution timeout. These limits require review before exposure.

## Resource budget

Design and Phase B add zero VPS runtime usage because nothing is deployed.
Future C-CORE is constrained to the existing PostgreSQL and Node containers:
zero new services, zero permanent workers and no additional database. Storage
must be estimated as `daily_rows * average_masked_row_bytes * retention_days`
plus indexes and at most 25% extra for materialized summaries. C-CORE must
measure this with fixtures before accepting any fixed capacity claim. Connection
pools, refresh schedules and memory limits remain unchanged until a measured
need is separately authorized.

## Delivery phases

1. **C-DESIGN:** documents and contracts only.
2. **C-CORE:** owner-authorized relational schemas, events and read models.
3. **D-INTELLIGENCE:** deterministic analytics and policy performance.
4. **E-CONTROL-TOWER:** read-only interface.
5. **F-SHADOW:** owner-authorized real-data read-only comparison.

No later phase is authorized by this design.
