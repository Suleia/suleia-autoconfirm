# Ads Intelligence V4 — development candidate

Extends the existing draft PRs #115 (shared reader, Render compatibility and
Telegram) and #116 (VPS API/panel). No merge, deployment, operational migration,
timer installation, notification activation or real advertising write occurred.
`LIVE_COMPILED=false` and both existing monetary limits remain unchanged.

## Architecture and reuse

- `algorithm-reader.mjs`: canonical GET-only Meta client, 30 complete Madrid
  days, source-specific coverage/timestamps, daily campaign/adset/ad facts,
  inventory/objectives/bids/learning, rankings, native rules and activity history.
  Today's activities are read separately for current-budget protection.
- `algorithm.mjs`: actual-hour bins using the existing business-day module,
  interarrival intervals, exposure-correct weekday/weekend profiles, dispersion,
  exploratory Poisson parametric bootstrap (499 replications, refitted rates,
  fixed seed), moment-fit negative binomial and lag-one association. These do
  not identify causal effects. No opaque training or self-modifying criteria.
- `algorithm-orders.mjs`: selected Shopify fields, bounded host-pinned pagination,
  exclusive end boundary and existing `createShopifyReadAuth` credential refresh.
  OAuth authentication can POST only to its existing token endpoint; order reads
  are GET. No contact/address fields are requested. The unchanged helper is
  included in the VPS artifact; existing integration behavior is not edited.
- `algorithm-operations.mjs`: parameterized exact-reference HMAC join in an
  explicit PostgreSQL READ ONLY transaction; no inference from time or product.
- UTM traceability accepts exactly one preserved numeric ad ID and a valid
  Meta source; the ad must resolve uniquely in the actual inventory. It is
  labeled source-recorded traceability, distinct from Meta attribution.
- Budget history keeps unknown formats unknown, distinguishes budget edits from
  scheduling configuration, and classifies provider-reported pauses/reactivations.
  Full-day 1/3/7-day before/after windows exclude the edit day, identify nearby
  configuration changes and disclose outcome-window maturity/confounding.
- `runtime.mjs`: one coalesced historical read/cache (10 minutes), existing V3
  overview/cache unchanged. Cold Telegram queries return a bounded preparation
  message; they do not create another job or a deferred monetary proposal.
- `intelligence.mjs`: the existing V2 executor receives learning assessment on
  proposal and confirmation. Missing/disabled evidence blocks, as do changed
  criteria, recent changes, insufficient multiday samples, stale history,
  unverified economics and automation conflicts. Original limits/idempotency,
  locks, TTL, confirmation and unknown-result reconciliation are preserved.
- `morning.mjs`, `command-service.mjs`, existing `ads-gateway.mjs`: prepared
  morning summary, shared conversational diagnosis and mechanical simulation.
  No second Telegram update consumer or recurrent notification transport.
- VPS `ads-algorithm-v4.{js,css}`: integrated “Algoritmo y comportamiento” view;
  hour-series toggles/calendar/campaign selection, changes timeline, stability,
  cohort states, explanations, simulator and review history. Existing V3 design
  and functionality remain. Untrusted names use textContent; no HTML injection.

## Semantics and safeguards

Meta retains `7d_click + 1d_view`, conversion report date, EUR and Europe/Madrid.
Shopify creation, Meta delivery/attribution, source observation and ingestion
are distinct clocks. Hourly actions are returned by the live API, but physical
conversion-hour semantics were not verified; no cross-clock hourly rate is
calculated. Filtered Shopify series hide account-wide traffic instead of mixing
scopes. Plotted series have explicitly separate normalized scales.

Missing purchase aliases stay unknown, never zero. Current entity inventory is
not historical inventory. Native-rule absence and incomplete external history
do not prove that no other automation changed budgets. Snapshot disagreement
blocks reconciliation; a multi-request report is not an atomic provider snapshot.

Learning criteria version `meta-learning-v4.1`: 7 distinct valid days, at least
15 purchases, EUR50 spend and 3,000 impressions in the recent 7 complete days,
campaign age at least 7 days, 72-hour observation after significant changes,
one daily budget change and maximum 10% cumulative variation. They are proposed
diagnostic safeguards, not proof of profitability or guaranteed learning safety.
`ADS_LEARNING_POLICY_JSON` requires a new explicit version and positive validated
known fields. Every assessment records the full criteria; financial limits are
separate and remain enforced. The criteria do not adapt autonomously.

Simulator budgets are integer cents. Budget × days is an explicit mechanical
assumption, not a guaranteed spend cap. Constant-CPA scenarios are hypothetical,
never a forecast of sales, profit or learning. Simulation cannot execute Meta.

Exploratory COD cohorts use 14 days of maturity, exact order-reference linkage
and source-captured attribution. Delivery is not settlement. Without verified
cash/cost evidence, realized profit, shipping and returns remain unavailable;
no advertising ROAS is labeled net profit. Maturity needs validation against
actual fulfillment and settlement lags before financial decision use.

## API and durable review

All routes retain the existing OAuth boundary. Telegram retains body-bound HMAC,
private actor authorization, proposal-specific confirmation and idempotency.

| Method and route | Behavior |
| --- | --- |
| GET `/api/operations/ads-intelligence/algorithm` | Read-only historical report |
| GET `.../algorithm/simulate?campaignId=...&newBudgetCents=...&days=...` | Mechanical SHADOW scenario; no execution |
| GET `.../algorithm/journal` | Latest 50 saved diagnoses/reviews |
| POST `.../algorithm/journal` | Explicit internal evidence/review append; no external effect |
| POST existing `/api/internal/ads-intelligence/command` | Same bot, analysis/proposal/confirmation path |

Migration **056** adds only `economics.ads_algorithm_journal`. Diagnostic,
recommendation, approval/rejection, false-positive, observation and experiment-
design records retain evidence digest, interval, criteria and actor hash.
The executor gets SELECT/INSERT, without UPDATE/DELETE. Readers get SELECT only.
Conflicting duplicate appends do nothing. An approval records review only.
GET reports do not persist or mutate operational records. Migration is prepared,
not applied to production. Audit/review records do not create experiments.

## Real evidence, testing and remaining limits

See `ADS_INTELLIGENCE_V4_AUDIT.md` for the sanitized commercial findings and the
private delivery folder for charts/CSV/screenshots. Raw orders, activity actor
identities, credentials and signed creative URLs are excluded from Git.

Test commands and final counts are recorded in `ADS_INTELLIGENCE_V4_VALIDATION.md`.
Isolated PostgreSQL tests guard against accepting a production URL and use only
synthetic fixtures, a socket-only ephemeral instance and a network-disabled
test runner. Visual QA blocks external requests and uses the actual local assets.

Actual Meta learning/ranking fields remain provider-dependent. Rankings returned
UNKNOWN for all 61 available ad ranking rows. Inventory included 17 LEARNING,
4 FAIL, 1 SUCCESS and 82 unexposed adset states; only active-child states protect
an active campaign. None of these implies knowledge of Meta's private algorithm.

## Proposed unified budget policy — not activated

The current Telegram configuration is EUR100 / 10% per edit. The VPS V1
SIMULATION policy is different: EUR15–70, EUR35 night cap, 00:00–07:00 Madrid,
EUR10 increment at ROAS >6. The past 30 days contain no decisions of that
simulator. Neither policy is silently replaced or reconciled by weakening it.

Propose one owner per campaign, retain current caps/percentages, explicitly
separate absolute delta, cumulative daily variation, daily change count,
cooldown, time-bounded owner exceptions and a separately approved global account
spend guard. Default to no intervention when verified economics, mature history,
global exposure or automation ownership is unknown. No absolute EUR10 change
can satisfy both the current EUR100 cap and 10% limit: eligibility must remain
blocked until a separate owner-approved policy review changes that conflict.

Compare stable, night/morning, gradual and adaptive policies prospectively with
non-overlapping randomized campaign groups, stable creatives/bids, baseline
trend/weekday adjustment, mature outcomes and a pre-specified loss stop. Require
power analysis before fixing duration. Two weekly cycles alone do not guarantee
enough evidence. No experiment was executed.

## Authorized deployment preparation and rollback

1. Review both PRs and authorize the deployment separately. No automatic merge.
2. Back up PostgreSQL; apply additive 054, 055 and 056 through the existing
   migration mechanism. Verify SELECT-only and executor append permissions.
3. Publish API/panel and the compatible existing bot as separate components.
   Reuse the existing protected Meta/Shopify credentials and bot secret; no
   plaintext values in Compose, examples, logs or PRs. Operational linkage needs
   explicit approval for the existing HMAC capability and SELECT permission;
   do not broaden the API role to bypass a missing grant.
4. Read features start OFF: `ADS_ALGORITHM_ENABLED=false`,
   `ADS_ALGORITHM_SHOPIFY_READ_ENABLED=false`,
   `ADS_ALGORITHM_OPERATIONS_READ_ENABLED=false`. Existing Ads read/monitor flags
   remain independently OFF by default. Enable only authorized sources after
   measuring cold-read latency and rate usage. No timer is added by V4.
5. Read-only/SHADOW verification must check account/currency/timezone, freshness,
   same-contract panel/Telegram values, order traceability, field masking,
   journal permissions, notification quietness and zero external writes.
6. A morning/alert channel needs owner authorization and validation before send
   activation. Keep `META_WRITES_ENABLED=false`,
   `ADS_INTELLIGENCE_WRITES_ENABLED=false`, `LIVE_COMPILED=false` throughout.
   Future LIVE requires a separate reviewed release, scoped authorization and
   verified financial/global spend policy; enabling an environment flag is not enough.

Rollback: disable the V4 flags and restore prior API/panel/bot artifacts. Retain
the append-only audit table. Do not roll back operational/financial tables or
change campaign budgets. No financial compensating action is needed for this
development-only release because no advertising mutation was executed.
