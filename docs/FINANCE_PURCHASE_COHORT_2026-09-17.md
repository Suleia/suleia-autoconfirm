# Results: purchase-cohort reconciliation (2026-09-17)

Scope: financial Results panel, report reconciliation controls and read-only
verification. No customer sends, order actions, incident policies, templates,
Meta configuration or Render business automation changes.

## Root cause

The monthly headline used orders created in the selected month. The default
daily chart/table instead substituted `dailySettlements`, grouping orders by
actual delivery/return date, including purchases from earlier months. Even the
table's cohort footer could take delivered/returned counts from `eventCounts`.
These were different metrics, not two calculations of the same profit.

Fixed charges also differed: the headline included the full monthly expense
commitment, while settlement diagnostics accrued calendar days. The screenshot
therefore compared 756.98 EUR purchase-cohort provisional profit with 1616.66 EUR
calendar-settlement profit. Neither figure should be relabeled as the other.

## Correct panel contract

- Selected month and day mean **purchase/creation date, Europe/Madrid**.
- Delivered/returned are current outcomes of orders purchased on that date.
- Real revenue is only delivered-order revenue; pending-order costs already
  recognized by the source remain deducted. An open cohort is provisional.
- Hero, daily table, profit chart and return donut use the same purchase cohort.
- Return rate = returned / sent for **only the selected month**; cancelled
  before shipment does not enter its denominator.
- Every observed day has a labeled bar and selectable exact-amount tile.
- Settlement diagnostics remain in the API, not substituted in the panel.
- An event-date outage fallback is not presented as purchase-cohort profit;
  unavailable finance remains unavailable with a visible quality warning.
- Monthly recurring charges are the full monthly commitment, equally
  allocated with internal six-decimal precision over observed eligible days.
  Monthly rounding happens once. No artificial daily cent redistribution.

## Direct independent audit

Read-only Dropea traversal at 16:33:06 UTC: 17 pages, 1625 orders from May through
September; 1132 delivered/returned orders compared against the financial source.
For every month: zero missing orders, outcome, delivery/return-date, purchase-date,
provider-expense, recognized-cost, per-order profit-formula or daily-cohort count
mismatches; all 1132 settled breakdowns are final.

| Purchase month | Orders | Delivered/returned compared | VAT positive | VAT zero |
| --- | ---: | ---: | ---: | ---: |
| May | 61 | 35 | 0 | 35 |
| June | 287 | 199 | 0 | 199 |
| July | 613 | 451 | 0 | 451 |
| August | 279 | 206 | 0 | 206 |
| September | 385 | 241 | 58 | 183 |

VAT and equivalence surcharge were independently calculated from each final
provider breakdown's own tax rates and taxable components; no common blanket
rate. September finalized orders contain 69.73 EUR of VAT/surcharge; no unknown
tax rates in this finalized population. It is already inside Dropea's final
expenses and therefore inside recognized costs, **not deducted a second time**.
`Ajustes / IVA Dropea` also includes other real adjustments; its whole value is
not represented as VAT. The provider total already includes provider product
cost; the business product tariff is added only when the provider reports zero
product cost. Actual returned-order expenses take priority over the 5.26 EUR
per-order fallback and are not multiplied by product units.

| September purchase day | Created | Currently delivered | Currently returned |
| --- | ---: | ---: | ---: |
| 5 | 20 | 11 | 4 |
| 12 | 29 | 15 | 5 |
| 13 | 38 | 18 | 1 |
| 15 | 21 | 11 | 0 |

These are point-in-time results, not promises that open-order outcomes or live
advertising spend will never change. Source snapshots and updated totals are
verified again after deployment.

## Completed deployed verification

Financial executable/asset revision: `2a7798f41ffbcd85cad423c02564495942595269`.
Actual API image ID: `sha256:3d7f76343e2686d055f3953a131bc82ddc46af34a51bcb18168a5412a20fc3a7`.
Actual new image: 684 tests executed, 684 PASS, zero FAIL. An initial pre-rollout
attempt correctly stopped because a UI contract test still expected the old
asset query version; the test was updated to require the new version, and the
entire suite reran successfully before replacement. No failed test was bypassed.
Only API and review-panel changed; nine other container IDs, protected API
environment and mounts, database and incident code were preserved. The
nonfinancial app source prefix is byte-identical after newline normalization.

Public HTTPS checks after the final rollout: HTML/JS/CSS all HTTP 200, `no-store`, exact
published bytes; unauthenticated financial route remains HTTP 401. Actual
`suleia_api_login` data rendered with the deployed HTML and JS successfully for
May/June/July/August/September: 31/30/31/31/17 labeled bars, all exact daily tiles,
selected-month return donut, clickable day details and the same cohort profit
in the table footer and monthly headline. All reconciliation controls passed.
The final review additionally removed event-date counts from historical-chart
tooltips, propagated each historical month's temporal model, and removed false
zero profits/margins for unavailable or event-date fallback history. The actual
API-role verifier also checked every historical tooltip's cohort counts and
profit. The public app JS SHA-256 is
`79043a004bf3a09dfe24b72290013ad678bbd9d4d2916f1dc4b529cbaf99848f`.

An independent **account-level Meta Marketing API** read at 16:47 UTC confirmed
EUR/Europe/Madrid and zero closed-day differences in all five months:
May 301.04, June 1453.10, July 3744.52, August 1902.14 EUR. September report spend
2729.89 versus live 2730.03 differs only by 0.14 EUR in today's still-running
advertising, not a historic/day-attribution error. The old diagnostic endpoint
`/api/finance-meta-source` is a separate Supabase mirror stopped on August 29;
its missing September records and earlier differences are not panel-source
errors. The audit now names this legacy comparison explicitly and offers a
direct independent read tool that fails on any closed-day mismatch.

At the final verification's 16:52:06 source snapshot, September purchase-cohort
revenue 6273.08 minus total costs 5529.48 equals **743.60 EUR provisional**, with 192 delivered and
49 returned. Fixed charges 176.39 and one-off charges 34.99 are deducted. The
current monthly cohort still has 67 sent orders without delivered/returned final
outcome; today's advertising and order states can change this provisional result.
Meta spend is now 2731.11 EUR; its movement since the independent 16:47 audit
is today's active advertising, not a changed historic result. Do not substitute
the screenshot's older value or promise a fixed live profit.

## Regression protection and verification

New report controls check purchase dates, every day's delivered/returned count,
and every day's revenue and six Dropea cost components against actual source
orders. A shifted daily allocation fails even if monthly totals still match.
Tests cover VAT inclusion once, zero-tax orders, actual multi-unit return costs,
missing purchase dates, mixed event dates, null money, every day's label,
interactive details and rejection of an event-date fallback.

Publishing uses an exact-revision, backed-up API + static-panel-only deployment:
actual new-image regression tests, unchanged protected API environment/mounts,
no SQL migration, and unchanged IDs for nine unrelated runtime services
(including ingestion and MCP). Deployed HTML/JS/CSS hashes and actual API-role
data rendered with the served code are verified, without opening a browser.
Detailed customer data, raw order projections and credentials are not persisted
in this report or GitHub. The crosscheck's private projection travels only in
memory; only aggregate results are shown.
