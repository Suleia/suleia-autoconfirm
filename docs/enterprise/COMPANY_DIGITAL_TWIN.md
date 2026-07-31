# Company Digital Twin design

The Company Twin is a read-only aggregate of validated domain twins and
platform state. It represents orders, customers, products, campaigns,
carriers, incidents, costs, margins, risks, policies, migration and
infrastructure at one `as_of` boundary.

## Snapshot sections

- operational volume, outcomes, timers, incidents and review queues;
- aggregated customer, product, campaign, supplier and carrier quality;
- revenue, cost, margin, value at risk and recovery;
- current policy versions, conflicts, risk and QA distributions;
- source freshness, missing data and reconciliation status;
- VPS health, PostgreSQL capacity, backups, MCP and migration readiness.

All monetary measures declare currency, basis and completeness. All counters
declare source freshness. Partial input produces explicit `PARTIAL`, never a
fabricated zero. The twin cannot issue commands or become an action gateway.
