# Results panel: daily interpretation, charts and financial audit

Scope: finance read model and Results UI only. No Render code deployment,
database migration, messaging, template/flow changes, order actions or Meta writes.
Incident notification/evidence protections remain unchanged.

## Findings and corrections

- A creation-cohort daily bar was titled realised daily profit. Zero revenue
  on newly created orders was mistaken for zero revenue from that day's deliveries.
  Separate calendar settlement analysis now uses each observed actual delivery/
  return date across available creation cohorts. The original management cohort
  remains separate; its monthly headline is not silently reassigned to another month.
- Chart and daily table share an explicit basis selector. The settlement footer
  identifies settlement totals, not creation-cohort headline totals. Costs of
  unsettled orders remain in the cohort and are not falsely called settled gains.
- Today is partial, not closed. Missing financial inputs or a snapshot that has
  not reached today are unavailable, never a fabricated zero-revenue loss.
- Fixed expenses are subtracted once. Cohort reporting includes the full committed
  monthly charge allocated over observed days. Settlement analysis accrues the same
  recurring ledger across eligible calendar days. Both policies are visible.
  Daily precision is retained; rounding is not repeatedly accumulated.
- `inAir` includes incident/residual orders and is not `inTransit`. The operational
  summary now uses the latter. Exact canonical lost/damaged orders are not presented
  as travelling orders. Terminal return rates exclude pre-shipment cancellations.
- Explicit source confirmation counts outrank sent counts. Delivery/return rates
  are calculated from their denominators, not copied from potentially inconsistent
  percentage fields. Current partial/full-prior-month KPI deltas are suppressed.
- The funnel is replaced by a return-rate history for every available month.
  Each month shows returned/sent counts, a rate and unresolved outcomes.
- Native SVG icons distinguish the financial and operational metrics. Daily bars
  have keyboard/touch/hover selection and a readable component card instead of an
  oversized native tooltip. Missing days are not silently removed from the plot.
- Source-cost completeness, per-order cost/profit identities, terminal dates,
  cohort denominators and daily/monthly reconciliation are explicit controls.
  Final-breakdown coverage measures settled orders, not cancelled/pending orders.
  Finance snapshot freshness is displayed independently of worker freshness.

## Private source audit (aggregate, no customer identities)

Direct read-only Dropea GET pagination on 2026-09-17: 1,611 unique orders,
17 pages, complete traversal, zero duplicates, zero actions/writes.

| Creation month | Delivered | Returned | Sent in financial report | Return rate | Final settled breakdowns |
| --- | ---: | ---: | ---: | ---: | ---: |
| May | 25 | 10 | 35 | 28.57% | 35 |
| June | 148 | 51 | 199 | 25.63% | 199 |
| July | 314 | 137 | 452 | 30.31% | 451 |
| August | 150 | 56 | 207 | 27.05% | 206 |
| September (open snapshot) | 180 | 41 | 299 | 13.71% | 221 |

All 1,112 settled financial rows had dates, components and final breakdowns.
Their recognised-cost sums and contribution-profit equations passed without
missing values or discrepancies. Direct Dropea settled expense totals matched
the financial source: 416.80 / 1,444.22 / 3,376.48 / 1,544.04 / 1,607.58 EUR.
Product costs outside the Dropea wallet are distinct from its expense total;
do not add a product amount twice or treat reserved-fund releases as sales.

Monthly recurring charges in the source: May 0; June 35.26; July/August/
September 176.39 EUR. One-offs: June 8.85; July 101.72; September 34.99 EUR.
These reconcile with daily allocations and are included in total costs.

## Evidence limits

Internal arithmetic reconciliation alone is not proof of source freshness.
The legacy stored campaign table exposed by the compatibility Meta-source route
was last updated in August and differs from the primary financial snapshot.
It must not overwrite the report's primary Meta Marketing API data. August
report spend remains 1,902.14 EUR, matching the owner's provided total.

Independent direct Meta account-insights verification was not executed: security
review rejected retrieval of all Render environment secrets. That helper was
removed. No workaround was attempted. Completing this independent leg requires
an approved read-only Meta connector or narrowly authorised access to the existing
Meta credential. Thus no claim is made that all current Meta days were independently
verified. Open snapshots and later final outcomes remain subject to updates.

## Publication and verification

563 canonical regression tests passed, zero failed/skipped before publication.
Isolated deployment script changes only API and review-panel, preserves existing
environment/config/private mounts, checks untouched worker/MCP/scheduler/engine
container identities, and keeps rollback configuration. No browser is used under
the repository safety rule. Exact deployed assets, read-role reports and rendering
with those reports must be checked after publication; evidence is added below.
