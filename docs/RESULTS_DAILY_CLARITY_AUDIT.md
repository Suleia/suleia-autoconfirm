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
  Unknown daily event totals remain unknown; the settlement footer must not
  substitute counts from the different creation-cohort summary.
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
the repository safety rule. Exact deployed assets, API-role reports and rendering
with those reports must be checked after publication; evidence is added below.

### Initial live verification, 2026-09-17

Release `b1f7e139b5c61ca91e39efe32c0cbacf28be071b` was deployed only to
API and review-panel. Runtime preservation checks passed; other service container
identities were unchanged and no migrations or production order actions occurred.
HTTPS returned 200 for all three panel assets; SHA-256 hashes matched the deployed
files. The financial endpoint remained protected (unauthenticated 401).

Using the existing API database role (`suleia_api_login`), the deployed panel code
rendered with each of the five private financial reports in a Node VM, not a browser.
All referenced HTML controls, ten headline cards, five-month return-rate history,
both table bases and interactive day selection passed. All financial controls
passed; source daily net profit and fixed costs reconciled to the cohort headlines.
Observed settlement days numbered 31 / 30 / 31 / 31 / 17. Settlement component/date/
finality/duplicate-conflict audit counters were all zero.

The unchanged ingestion worker subsequently reported 503 due to
`CHATBY_READ_FAILED`; Dropea read events continued to report `READ_OK`.
This is a separate connector failure, not proof that every source is current.
No worker restart or messaging change was made. Snapshot freshness is visible
on the panel and independent direct Meta verification remains pending as above.

Additional regression covers crossing midnight with a missing snapshot: incomplete
event totals and the settlement footer stay unavailable rather than borrowing
monthly cohort counts. Final release verification follows publication of that guard.

### Final live verification, 2026-09-17

Final deployed code: `854848e5ef53bfd85f676dc6072d0c5f5d798580`.
The isolated deployment again confirmed preserved API environment/config/mounts,
unchanged worker/MCP/scheduler/engine container identities and zero migrations.
The API was healthy; no claim is made that the unchanged Chatby connector is healthy.
All 563 canonical tests passed again (zero failures/skips).

Public HTTPS asset hashes matched the release exactly (HTTP 200):

| Asset | SHA-256 |
| --- | --- |
| app.js | `6fc4f81f95a288101ea573d2933097d83e8f96951e64db590a98d296d0b10d0f` |
| styles.css | `ce33df4465a7b792071fdd6c9ff110d0537faf3d5b6dffaa47b786862f164801` |
| index.html | `2800a445db202e346df5c0d41be56af7cd851c387bdea7ab6fe2c713d47594a9` |

`tools/verify-results-live.mjs` was rerun against the final deployed module/HTML
and the five private reports: all controls, both daily-table bases, chart day
selection, ten metric cards, five-month return-rate history and reconciliations
passed. Current-month results changed during observation as new returns arrived;
they are snapshots, not immutable or finally closed figures.

An additional direct order-level crosscheck at **2026-09-17 04:46:58 UTC** traversed
17 Dropea pages / 1,613 orders and compared **all 1,114 settled report orders**:
35 / 199 / 451 / 206 / 223 by creation month May–September.
There were **zero** missing direct matches, outcome mismatches, settlement-date
mismatches, Dropea-expense mismatches or nonfinal settled breakdowns.
Only privacy-minimised projections were streamed in memory between the trusted
services. No projections, customer identities, messages or credentials were saved
or included in this repository. Zero actions/writes were performed.

The September snapshot contained 372 created orders against 373 in the newer
direct read. The final settled rows all matched; one newly observed nonsettled
order was outside the older snapshot. Therefore the panel is not asserted to be
transactionally realtime, and source observation times must be respected.

For the remaining independent Meta leg, Render documents a per-key GET that avoids
listing all environment secrets: [retrieve environment variable](https://api-docs.render.com/reference/retrieve-env-var).
No credential GET was attempted after the security rejection. The remaining next
step is explicit authorisation for only the stored Meta credential/config required
for read-only account daily-insights verification, without exposing its value.
