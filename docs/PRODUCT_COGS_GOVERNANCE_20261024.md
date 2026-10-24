# Governed product cost correction — 24 October 2026

## Authorization and observed baseline

The owner confirms 0.87EUR per delivered unit for Dropea product33560,
variant33788. This is an internal financial tariff, not a provider price change.
Read-only production records establish its first real appearance at
2026-10-19T10:33:27.481Z, business date2026-10-19 in Europe/Madrid. The tariff
must be open-ended from that date; no October-only restriction or SKU alias.

The baseline has four delivered units missing cost, two on19October and two
on20October. Other recognized product cost is423.42EUR in the source report
generated2026-10-24T17:50:40.097Z. The missing four units add3.48EUR; that is
not the whole month's product subtotal. October headline product/total costs,
net profit,ROI,margin are null. The five source cost/profit/daily reconciliation
checks fail. May–September totals and daily reports were captured privately
before changes. Final numbers must come from regenerated reports; current Meta
spend and ongoing order outcomes may change while this task runs.

## Canonical source and propagation

The authority is economics.finance_cost_rates in VPS PostgreSQL. Migration060
creates or updates one PRODUCT_COGS rate for the exact product/variant at0.87EUR,
source OWNER_VERIFIED_PRODUCT_COST, with effective_from computed from the real
first order and effective_to null. It refuses ambiguous existing rates.

Configuration changes use a SECURITY DEFINER function limited to PRODUCT_COGS,
the existing enabled Suleia store and validated amounts/dates/identities.
The Operations role receives execute permission on that function, not general
INSERT/UPDATE access to the tariff table. Public and the MCP reader cannot
execute it. Audit records retain before/after values, operation, principal hash,
time and a monotonic revision. Row versions prevent lost concurrent edits;
transaction locks and overlap checks prevent duplicate competing tariffs.

The existing authenticated FinanceReportClient mirrors the normalized owner
tariffs to a protected financial-only Render endpoint. The durable Supabase
app_state snapshot is a read-model copy, not a second editable tariff authority.
No new secret, role, OAuth scope or public access is introduced. Monotonic
canonical revisions and serialized source writes reject older snapshots. A
changed tariff clears financial caches and queues the affected months through
the existing financial refresh path. A change during a running refresh schedules
one follow-up. There is no new business worker or timer.

The source builder applies the owner tariff before a positive applicable final
supplier product cost, then existing positive wholesale/business fallbacks.
Zero wholesale alone stays MISSING. Return policy, real daily Meta source,
created-order cohort, Madrid dates and every non-financial action remain intact.

## Partial reports and product findings

Unknown product cost stays null in day/order/product/month financial totals;
knownProductCost and productCostCoverage retain the known subtotal. Only dependent
profit/ratio values become unknown. Applying expense accrual cannot turn that
unknown into a free product or daily profit.

The source report identifies missing products with PRODUCT_COGS_MISSING,
category PRODUCT_COST_MISSING, product/variant, available SKU/name, units,
order IDs, days and first/last observations. The live SQL finding view additionally
flags financially active incoming order identities on normal ingestion, before
a delivered-order monthly report needs their COGS. No extra scheduler is needed.
The existing panel preserves the known cards/series and shows known product
cost plus explicit missing product/units/orders/days. Distribution distinguishes
null (No disponible) from a confirmed zero (0.00EUR).

Configuración financiera → Costes de producto lists identity, unit cost, source,
effective date and status. Authenticated internal edits are audited and trigger
the same propagation. Neither provider nor storefront prices are changed.

## Validation, release and reversal

Focused synthetic tests cover1/2/3units at0.87 (0.87/1.74/2.61EUR), two repaired
two-unit orders (3.48EUR), adding that to other recognized product costs, exact
identity and effective-date matching, source priority, unknown versus zero,
all five daily/monthly reconciliation controls, durable/idempotent propagation,
out-of-order revisions, in-flight refresh follow-up and authenticated route
isolation. Isolated PostgreSQL tests cover seeding, duplication, permissions,
audit, optimistic version, overlap, automatic findings and up/down/up/down
reversal while preserving unrelated tariff edits and the immutable audit trail.

At this documentation revision the immutable artifacts are prepared and broader
Linux suites are running; no production tariff, runtime or report has been
changed. Staged VPS candidate dd7bd3082f8d18fca87ef7c0f630585fef4293b9 has six
API files and four static financial files. Render source candidate
c295287ed11f7a021d6369ed9379f97039326776 applies only the financial source
patch over the actual live1808f34, preserving its newer confirmation/incident
code. Migration060 has passed16checks on isolated PostgreSQL17, no network or
production credentials. Final acceptance, actual deployment and numeric/visual
postconditions will be appended only after they pass.

Prior API image/panel mount, Render revision/environment fingerprints, target
rate rows and source reports are retained privately. The SQL down script refuses
to overwrite later tariff changes and retains its audit history. Reversal must
restore the prior financial runtime/source and only the exact backed-up tariff
state, then regenerate affected financial reports. It never restores customer
orders, replays provider actions or overwrites later unrelated configuration.
