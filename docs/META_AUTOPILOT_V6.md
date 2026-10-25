# Meta Autopilot V6

Owner request and production deployment authorization: 25 October 2026. The
owner separately approved **+360 EUR/day aggregate increases**, shared by the
scheduler and confirmed manual commands, after reviewing nine active campaigns
with 287.67 EUR/day configured and a possible 647.67 EUR/day after four increases
per campaign on that inventory. This is configured budget exposure, not spend.

## Exact monetary contract

| Control | V6 |
| --- | --- |
| Profile / version | V6_FIXED_EUR / SULEIA_META_AUTOPILOT_V6 |
| Currency / business clock | EUR / Europe/Madrid, including DST |
| Absolute target ceiling, every channel | 10000 cents per campaign per day |
| Global active configured budgets | 100000 cents |
| Aggregate positive changes per Madrid day | 36000 cents, scheduler + manual |
| Operating floor | 1500 cents or a higher campaign-verified Meta constraint |
| Observed spend ceiling | UNLIMITED_AUTHORIZED; a fresh account read is still required to increase |
| First increase | Today ROAS >3.8, at least 3 matching purchases, approved spend/impression sample |
| Later increase | 3 genuinely new eligible post-change purchases, not aggregate attribution deltas |
| Increase windows | 10:00, 12:00, 16:00, 18:00; +1000 cents, capped at 10000; max 4/day |
| Day decreases | Only 12:00/16:00/18:00, ROAS <2.5, 15 EUR/1000 impressions/120 minutes, no recovery |
| Day cut base | Verified 08:00 budget; 10% +10% +5%, maximum 25% total, no missed-slot catch-up |
| Night | One 22:30 cut to max(verified floor, round(fresh budget *0.70)), independent of performance |
| Morning | Observe at 08:00; never restore the prior day's budget |

The approval reference, exact finite aggregate and environment must agree. An
optional explicit authorization expiry is enforced during preparation and fresh
revalidation, including manual commands. No expiry or additional spend limit was
invented. V5.1 remains an offline compatibility profile; the V6 runtime does not
use its 70 EUR clamp, progressive night slots or 20/25 EUR caps.

## Root causes and repairs

The audited production base was address-import-recovery2868d39, including V11/BI,
image ac40cc50b6e4e23db381b16b4badc9b0988e396bf58b68085bacaaf4e6a9202e.
The API timer was running LIVE, but the ledger had 612 BLOCKED operations and no
verified assignment. LIVE flags were not evidence of financial execution.

The engine imposed 7000 cents after loading the environment's 100 EUR limit.
Scheduled decisions also inherited weekly sample, campaign age and volatility
vetoes. V6 retains those as analytical context while independently requiring
complete operational metadata, activity/rules, active-learning protection and
exact matching of any exempted own verified budget changes. External and uncertain
changes remain blocking. Aggregate allocation follows the normalized ranking
instead of rejecting every candidate when the total batch exceeds its allowance.

The old 11:00 FAILED slot retained only AUTOPILOT_REVIEW_FAILED. Its historical
exception cannot be recovered from that ledger; attributing that particular slot
to code17 would be speculation. New slot, validation, execution and interruption
receipts retain allowlisted phase, HTTP status, numeric provider code/subcode,
assigning-vs-validate-only POST state and verification state. Provider messages,
URLs, credentials and personal data are excluded.

The canonical V11 reader already classifies HTTP400/code17/subcode2446079 as a
quota error. The assigning transport now feeds its quota headers and failures
into the same queue. Financial verification has priority; a bounded reservation
defers optional analyses. The executive report waits without claiming or failing
its four-part delivery while the financial lane is reserved. No token rotation,
quota bypass, second reader, scheduler or assigning transport was introduced.

## Durable financial safety

The same account/campaign advisory locks, PostgreSQL operation ledger and canary
are reused. Every assigning path checks the independent 10000-cent constant at
the transport boundary. The legacy bot controller/API have the same ceiling;
legacy writes remain disabled. No adset or lifetime-budget fallback exists.

Migration061 adds a unique operation-ledger key for account + campaign + Madrid
date + NIGHT_22_30, independent of proposal and release version. The observed
before/target values are frozen before POST. A trigger prevents removing or
rewriting the reservation. FAILED/UNKNOWN/EXECUTING consume that night's claim.
An unresolved operation also prevents another night's assignment. A new night
can cut again only after the previous operation has a verified outcome. The
actual percentage and readback are recorded, including a floor-limited cut.

A slot can only be claimed in its actual configured minute. A valid claimed V6
batch can finish within five minutes; restart does not create a new claim or
replay a missed slot. Revalidation checks the frozen proposal, current budget,
policy, identity, minima and uncertainty before the sole absolute assignment.
POSTs are never retried. VERIFIED requires success plus an exact subsequent GET
for account/campaign/currency contract and daily budget. RECONCILED observation
alone does not attribute an uncertain write to this executor or unlock a canary.

The first eligible assignment stays isolated until its exact GET and durable
VERIFIED receipt. Only then can the next sequential V6 item proceed. Any failed
or uncertain canary blocks the remaining batch and subsequent execution under
that approval. No test or deployment manufactures a financial change.

## Data coverage and truthful abstention

Today and the native purchase ROAS use the same canonical conversion-date and
attribution contract. The first increase can use three matching purchases today.
After that, aggregate count growth does **not** prove conversions occurred after
the previous change. A strict event-evidence contract requires deduplicated hashes,
verified campaign attribution and post-change conversion timestamps. No current
production source supplies that verified event stream. Subsequent increases
therefore expose INCREMENTAL_PURCHASE_PROVENANCE_UNVERIFIED until it is available;
the system does not promise four actual increases from repeated aggregate counts.

The 70/20/10 ranking weights normalized scores, never a blended ROAS. Missing
long history is marked missing and weights use only available evidence. No deep
long-history fetch is added to a financial window. A same-hour-yesterday purchase
comparison is not claimed. CPA/cart costs are shown when their numerator and
denominator are known. Recovery detection uses comparable same-day observations;
day cuts block when the 08:00 base or comparable intraday trend is absent. A
deployment after 08:00 does not invent a baseline for the current day. Night cuts
require financial eligibility and fresh budgets/minima, not ROAS/history reads.

## Telegram and panel

The existing bot, numeric administrators, private actor/chat binding, offsets,
idempotency, confirmation workflow and report recipients remain. Monitoring
questions use current evidence and ledger outcomes: budgets, increases, why a
campaign did not increase, ROAS>3.8, verified count, near100, improvement and night.
Queries never become implicit confirmation. Proposed/SHADOW/UNKNOWN are not
reported as executed changes. The existing 22:30 executive report retains four
parts and independent per-recipient send claims.

The existing premium budget subsection shows META AUTOPILOT — CONTROL EN TIEMPO
REAL: actual policy/mode/canary, next/last review, quota/failure, current budgets,
ROAS/purchases, CPA, incremental coverage, recovery/ranking, planned vs verified
changes and exact readbacks. Night counts distinguish eligible/processed/verified/
blocked/held/incidents. No orders, incidents, theme, auth, finance or sidebar
redesign belongs to this release.

## Deployment and rollback

Use infrastructure/vps/deploy-meta-autopilot-v6.py with the exact private manifest.
Stage derives an overlay from the actual API image, panel and bot; before hashes
must match. Safe SHADOW and LIVE configurations are compiled in network-isolated
non-root containers with no server/timer. Application files are restricted to
Meta Autopilot dependencies and its panel/bot surface; unrelated source and
containers are inherited from the captured base. Apply requires the complete
isolated test receipt, a shared deploy lock, quiet window and no in-flight or
uncertain financial operation. The finite360 approval is part of the manifest.

Backups are private under /root/suleia-meta-v6-deploy/<revision>/, including the
actual image/config references, bot env and a budget-ledger export. Verify checks
exact image/files/env, existing bot unit/admin configuration, SQL guard, finance
hashes and unrelated automation/container identity. It does not declare a canary.

Emergency rollback restores the captured actual application base and panel with
the budget lane disabled, preserving ledger, reservations, offsets and all
financial/logistics state. It refuses a superseding release or in-flight write.
It does not reactivate V5.1's progressive cuts or restore historical SHADOW data.
The SQL down migration refuses to drop the night guard once night history exists.

Deployment and real-canary evidence are recorded separately in the release
receipt and Agent Hub. Natural future slots must be observed when they occur;
no claim of a nightly cut is made before a verified natural night execution.

Provider interface reference: [Meta's maintained Campaign SDK definition](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py).
