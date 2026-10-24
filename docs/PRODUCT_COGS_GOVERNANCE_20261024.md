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

Before acceptance the initial staged VPS candidate
dd7bd3082f8d18fca87ef7c0f630585fef4293b9 contained six API files and four
static financial files. No production tariff, runtime or report had changed at
that point. The initial Render source candidate
c295287ed11f7a021d6369ed9379f97039326776 applied only the financial source
patch over the actual live1808f34, preserving its newer confirmation/incident
code. Migration060 had passed16checks on isolated PostgreSQL17, no network or
production credentials. The final accepted artifacts and verified production
postconditions are recorded below.

Prior API image/panel mount, Render revision/environment fingerprints, target
rate rows and source reports are retained privately. The SQL down script refuses
to overwrite later tariff changes and retains its audit history. Reversal must
restore the prior financial runtime/source and only the exact backed-up tariff
state, then regenerate affected financial reports. It never restores customer
orders, replays provider actions or overwrites later unrelated configuration.

## Accepted release and observed results

PR145 contains the API, panel, migration and integration contract; PR146 contains
only the financial source changes over the actual Render production baseline.
Final API artifact f72bf2cac58812d84b62a571853ed17b66e3f174 passed1215/1215
tests in132files on isolated Linux Node22. Render artifact
d175378d288d33823ced70f8db3b3a806854377e passed585/585tests in61files on
isolated Node24. There were no skips. The PostgreSQL17 governance/rollback
suite passed16checks. Fixture environment and temporary stores-path problems
were fixed in the isolated acceptance harness; production safety rules were
not weakened. Source tests no longer depend on a panel-only module; the five
canonical reconciliation controls have a separate cross-service test.

Render deployment dep-dbefua0473hc73d6b770 is LIVE at d175378. Its four existing
revision gates match the accepted artifact; all other environment values retain
their prior fingerprint. Health.ok remains true. The unrelated overall
operational=false flag was already present before this task and is not claimed
fixed by this financial release.

Migration060 and the API/panel artifact applied2026-10-24T18:57:34UTC. The
healthy API image is suleia-finance-cogs:f72bf2c, immutable ID
sha256:e58ec45e33d65a137c906f6568f75b10ad2818b85b070c7d1a21ef399da0b3a8.
All19protected budget-source hashes, effective API environment except its build
revision, bot PID/configuration and unrelated container identities were verified
unchanged. The single canonical0.87EUR tariff starts2026-10-19 with no end date;
the audit has exactly one owner-authorized seed entry. Operations may execute
the narrow writer; the MCP reader cannot. Unauthenticated configuration and
source-snapshot requests return401.

The canonical mirror triggered the existing source refresh. Independent
verification at2026-10-24T18:58:56UTC read the completed report generated
2026-10-24T18:58:00.043Z, with matching tariff version and refreshing=false:

| October MTD field | Verified EUR or ratio |
| --- | ---: |
| Recognized delivered revenue | 6063.01EUR |
| Product cost | 426.90EUR |
| Previously known product subtotal | 423.42EUR |
| Four repaired units | +3.48EUR |
| Outbound shipping | 1361.66EUR |
| COD | 228.00EUR |
| Fulfillment | 330.00EUR |
| Returns | 322.02EUR |
| Dropea adjustments | 337.45EUR |
| Logistics subtotal | 2579.13EUR |
| Actual Meta daily spend | 3721.76EUR |
| Fixed costs | 176.39EUR |
| One-off and other costs | 0.00EUR |
| Total costs | 6904.18EUR |
| Exact net profit, provisional MTD | -841.17EUR |
| ROI | -12.18% |
| Net margin | -13.87% |
| ROAS | 1.63 |

Missing units fell4→0; all five required source controls pass, and
exactProfitAvailable=true. The six original quality issues (missing units plus
five reconciliation failures) fell to zero. The live product-cost finding view
also has zero pending products. The target's four baseline delivered units were
matched to the same exact order IDs and independently checked at1.74EUR for
each two-unit order. The month's product cost is423.42+3.48=426.90EUR.
Other current-month logistics and advertising inputs advanced naturally during
the task; they are fresh report observations, not changes to their policies.

19October has total costs396.899583EUR and net profit97.960417EUR internally
(396.90/97.96displayed);20October has284.549583/-69.619583EUR
(284.55/-69.62displayed). Both days, cumulative profit and the monthly footer
reconcile. Every pre-existing numeric monthly total and daily field for
May–September matches the private before snapshot exactly.

October is still a provisional purchase cohort. The monthly history comparison
now contains its complete numeric costs/profit and an explicitly marked MTD bar.
The existing guard against presenting a current MTD cohort as a comparable full
closed month remains; headline percentage comparisons correctly say unavailable.
No temporal accounting model or comparison policy was silently changed.

## Visual acceptance and retained reversal

Authenticated Chrome verification inspected October cards, daily and cumulative
graphs, the19/20October rows, TOTAL DEL MES, product distribution426.90EUR,
the monthly history bar and financial quality33/33controls with no findings.
All six financial months were selected in the UI and their original totals
confirmed. The product-cost table lists the exact0.87EUR owner tariff, and the
edit form preserves its locked identity, date and version; the form was opened
and cancelled without saving a production test edit. No browser console errors
were observed. Private screenshots remain under
output/finance-product-cogs-20261024/ and were not uploaded to GitHub.

A two-rule static follow-up a2f2f4f5c23a6039fb3ce7473d65e688cc6c6d28 keeps
the tariff status and Edit button readable. It passed57/57panel tests and was
applied2026-10-24T19:02:32UTC to
/opt/suleia-panel-releases/finance-cogs-a2f2f4f. API identity/environment and
bot configuration stayed unchanged. All four served financial assets match
accepted hashes and return Cache-Control:no-store.

Root-private receipts are retained at
/root/suleia-finance-cogs-20261024/f72bf2c/: applied.json,
panel-followup-applied.json, http-runtime-proof.json, financial-result.json,
the three acceptance logs, prior runtime overrides, prior tariff rows and
before/after reports. They contain no publicly shared credentials.

Rollback requires the same idle-operation/runtime-drift guards: restore the
prior API image suleia-panel-data-repair:e767d13 and prior static mount
/opt/suleia-panel-releases/panel-navigation-91dfb47 from the saved override;
restore Render1808f34 and its four backed-up revision pins while preserving
all unrelated environment values; apply060down only if its seed tariff has not
been subsequently edited; regenerate the financial report with the restored
source. The down script preserves later unrelated tariff edits and audit
history. Its up/down/up/down behavior passed the isolated database drill.
Do not restore operational orders or replay any provider/Meta/customer action.
