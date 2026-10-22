# V6 — read-only production and historical audit

Extraction: **2026-10-22 21:50–22:09 UTC** (23:50–00:09 Madrid, crossing into
23 October). The business case is the fixed Madrid day **22 October**. Later
ShopifyQL recheck used that same fixed day. No financial, order, template,
customer-message, campaign or production SQL mutation was performed.

## Actual baseline

- PR #115 (`ec34f338…`) and #116 (`ce306c46…`) remained open/unmerged. They are
  historical V2 branches, not evidence of the current deployed implementation.
- Current API image: `suleia-budget-autopilot-live-api:e4d3b9d` / runtime revision
  `e4d3b9d230b218cc79f8e71b49593128ec9d9c74`; Node 22.22.0 and Graph v25.0.
- Development base: `b9e8e4bc5966af894e69e54f413acad8d2357488` in PR #134, containing
  the current V3/V4/V5.1 implementation and subsequent validation/docs fixes.
- Existing Telegram service active/running, two numeric allowed actors. No token,
  user ID, permission, admin or bot session was changed for V6.
- Existing V5.1 runtime LIVE; six latest captured night slots completed BLOCKED,
  each with zero external writes. The captured operation table had 144 BLOCKED
  operations and no verified financial canary. This is not a claim that LIVE has
  changed a budget. V6 did not retry, unblock or alter it.
- Persisted canonical coverage before this audit was 14–22 October (nine days),
  not 90 days. The independent read-only history extraction below did not write
  back snapshots or claim database coverage had expanded.

The previous authorizations remain: EUR 10 steps; EUR 15 minimum / EUR 70 maximum
per campaign; EUR 1,000 configured global budget exposure; EUR 30 cumulative daily
positive changes; no additional observed-spend cap; V5.1 Madrid slots, incremental
purchases and reduction evidence; learning/external-change/uncertainty blocks and
the existing supervised account executor. No policy file/executor changed in V6.

## The 22 October case

The supplied 190 EUR / eight purchases and Shopify 11 orders were an earlier
cut. They were not reused as current facts or compared as if timestamps matched.

Meta read at **22:07:41 UTC** returned EUR **249.39** spend, 16,869 impressions,
854 link clicks, 583 landing views, 58 cart events and 57 checkout events across
nine campaign rows. Seven rows explicitly supplied purchases/value, summing to
**15 attributed purchases** in that known subset. Two spending campaigns omitted
the preferred purchase event. Therefore the canonical whole-account purchases,
CPA and ROAS remain **unknown**, rather than treating omissions as zero or
dividing all spend by the known subset's purchases.

The existing minimal Shopify reader, at **22:09:37 UTC**, returned **17 distinct
non-test, non-cancelled orders**, EUR **494.83** in order totals. ShopifyQL sales
for the same day also returned 17 orders; its net-sales measure was consistent
with that snapshot at this cut. This agreement does not make order total, net
sales, collected cash and profit interchangeable definitions.

Shop identity matched the VPS configuration and connector. ShopifyQL sessions
still returned zero cart/checkout session events despite orders. This discrepancy
requires reconciliation; it is **not proof that customers cannot use checkout**.
Possible explanations include channel/population differences, COD/custom order
paths, consent/session instrumentation and reporting lag. No code or tracking
setting was changed to force agreement.

Required next evidence: reconcile sales channels, creation/processing timestamps,
COD order path and consent/session events for the same store/timezone; verify the
Pixel/CAPI event scope/deduplication separately. Campaign-level order/cost links
are not verified, so no settled profit, break-even CPA or product margin is
attributed to any campaign.

## Historical extraction

Read all pages through the existing GET-only client in three bounded 30-day
chunks per hierarchy level. Periods end 21 October, avoiding a partial current
day. Campaign, adset and ad spend reconcile; their totals are alternatives at
different hierarchy levels and must **not be added together**.

| Period | Campaign spend | Observed coverage | Unique entities with rows |
|---|---:|---|---|
| 22 Sep–21 Oct (30 days) | EUR 3,614.26 | Rows on all 30 days | 15 campaigns |
| 24 Jul–21 Oct (90 days) | EUR 9,945.66 | Rows on 74/90 days | 24 campaigns, 86 adsets, 106 ads |

The 90-day extraction included 357 campaign-day and 1,272 ad-day rows. Missing
days/entities are unknown, not invented zero activity. Daily unique reach was
not summed, and frequency for reconstructed multi-day entities was left unknown.
Purchase omissions/mixed completeness prevent a whole-period canonical ROAS/CPA.
No “most profitable campaign” or financial winner can be defended from this data.

The development analyzer was exercised on these authentic extracts. Its 30-day
review produced nine purchase-measurement checks, one CPC-rise hypothesis and one
CPM-rise hypothesis, rather than invented global conversion statistics. It did
not declare a winner. Ninety-day observations primarily require purchase coverage
reconciliation; the previous 90-day baseline was not extracted, so no 90-versus-
previous-90 deterioration claim is made. Recent days remain subject to conversion
lag and Meta's 2026 attribution rollout cannot be assigned an account-specific
effective date from the available evidence.

## Evidence and next action

Detailed provider extracts and test logs remain in the owner's private local
output directory, outside the commit. Only aggregate business findings and
synthetic local screenshots are published in this PR; no customer records,
contacts, conversations or credentials are included.

See [architecture, source registry, 298-test verification and release/rollback
plan](ADS_INTELLIGENCE_V6.md). V6 is a development deliverable pending review and
approval to merge/deploy. Existing logistics recovery, incidents, Shopify theme,
campaigns and budget policy remain outside this change.
