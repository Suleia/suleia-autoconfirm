# Ads Intelligence V2 — release candidate, phases A–E

This release prepares the existing Meta reader, operations API/panel and Telegram
bot for a shared SIMULATION/SHADOW workflow. It does not activate LIVE, deploy
services, change approved budget limits or change logistics integrations.

## Delivery and source branches

The deployed VPS source and Render/Telegram main are on different existing
branches. The two PRs intentionally share identical `services/meta-ads` V2 files:

- `codex/ads-intelligence-v2`, based on main: canonical reader, metrics,
  diagnostics, durable executor interfaces, Render compatibility adapter and
  Telegram bridge. The existing read-only transport is reused from the VPS.
- `codex/ads-intelligence-v2-vps`, based on `feat/order-intelligence` (including
  the already-merged incident panel PR #113):
  the same canonical modules, migration 054, existing API integration and panel.

Do not merge the entire VPS branch into Render main as a deployment shortcut.
Review/deploy only the intended component artifacts. Neither PR is auto-merged.

## Phase A — data contract and historical recovery

The canonical reader is `services/meta-ads/meta-ads-client.mjs`. It is GET-only,
uses Bearer headers, bounds pagination and retries, validates the Graph host and
version and rejects incomplete collections. The new `readInsights` contract is
explicit `7d_click + 1d_view`, `action_report_time=conversion`, EUR and the account
timezone. It deliberately does not combine account-specific attribution with
these windows. Existing policy V1 readers remain compatibility interfaces and
must not be mixed into V2 decisions. Changing attribution may change conversions
and ROAS; review that difference before cutover.

`metrics.mjs` chooses a single purchase scope (website, then omni, then purchase),
uses that same scope for count and value, rejects conflicting duplicate values,
and calculates ROAS = attributed purchase value / spend. It never trusts the first
provider ratio or sums overlapping aliases. Missing, ZERO, ZERO_SPEND and
AMBIGUOUS remain distinct. A zero denominator produces no ratio. Link CTR/CPC
are separate from all-click CTR/CPC in the Render compatibility adapter.

The legacy Render adapter is enabled only by `META_CANONICAL_READ_ENABLED=true`.
Field names remain stable. Multi-month daily reads are split into bounded
31-day queries. Explicit dates replace presets. Token-in-URL handling and first
page-only campaign inventory are fixed even while the compatibility flag is off.

Migration 054 adds facts and daily coverage to the existing PostgreSQL economics
schema, not another database. A fact key includes account, level, entity, start,
end and contract. Repeated observations replace facts; older observations cannot
overwrite newer data. Daily coverage and facts commit together. A later empty
query supersedes prior membership without converting missing data to zero or
deleting its evidence. The spend view returns NULL/NO_ROWS or INCOMPLETE when
appropriate. No sum combines daily and multi-day facts or different contracts.

Historical recovery command, after migration and deployment authorization:

    node services/meta-ads/cli/sync-intelligence.mjs 2026-08-30 2026-10-21

Uses a dedicated `ADS_INTELLIGENCE_DATABASE_URL` connection to the existing
PostgreSQL, and only canonical facts/coverage. It queries campaign/adset/ad daily
data serially, stops on incomplete reads and uses a global advisory sync lock.
Dates must be explicit, not future, and span at most one year. This command was
not run against the operational database. The frozen Supabase table is retained
as legacy historical evidence, and is not silently relabelled fresh. New V2
consumers use the canonical facts; the separate Render finance path remains
compatible pending its own flagged cutover. Existing schedulers can invoke this
entrypoint; this change enables no additional scheduler.

## Phase B — diagnostics and proposals

Diagnostics compare the same entity, level and attribution against an adjacent
equal-length completed period. Partial today is labelled and not judged against
a full prior day. Relative changes are hypotheses, not causal proof or budget
policy. Missing baselines/sample settings cause abstention. Signals include CTR,
CPC, CPM, funnel-stage decline, ROAS decline and possible fatigue supported by
frequency plus CTR plus CPA/ROAS. A verified economic context can supply a
break-even CPA or ROAS target; no default margin or net profit is invented.

Every finding includes rule version, evidence, severity, probable and alternate
causes, confidence, impact, action, expected result and risks. The current
diagnostic reference is entity-specific; product attribution/margin remains a
separate prerequisite for claims of campaign profit or profitability-based
automatic selection.

The mandatory Spanish instruction parses a 10 EUR absolute delta, strict ROAS
>5 and today's Madrid date. The complete current inventory is read with
pagination; only configured/effectively ACTIVE campaigns enter the all-active
proposal. An active ad is required as additional delivery eligibility evidence.
This is not proof that Meta will deliver impressions. ABO/lifetime budgets,
ambiguous metrics, insufficient sample, absent limits and active/unknown native
rules block individual items. A proposal records the request, actor, filters,
contract, evidence, old/new budget and expiry.

Current observed owner limits, read on 2026-10-21: 100 EUR/day and 10% per change.
With both limits, **no +10 EUR increase is possible**: a budget below 100 EUR
exceeds the percentage limit, and 100 EUR exceeds the new-budget maximum.
The implementation preserves those limits. Tests that permit +10 use explicitly
different fixture policies, never a production policy change.

Minimum spend, purchase count and impressions require explicit configuration.
No deployment policy is inferred from test-only 15 EUR / 2 purchases / 500
impressions. Conditional budget proposals block until these settings are reviewed.

## Phase C — existing Telegram

`ads-gateway.mjs` sends authenticated requests to the existing operations API.
It creates no new bot/poller. It uses the update ID as the request key, so replay
after delivery failure returns the same proposal. Explicit buttons carry a
proposal ID; natural confirmation only resolves one unexpired pending proposal
for that actor. Missing periods, vague profitability and ambiguous campaign names
ask for clarification. Absolute, percentage and target budgets are distinct.
The original private numeric identity gate and stale-message checks remain.

The bridge requires HTTPS, a private service credential of at least 32 characters
and the server-side Telegram actor allowlist. Existing panel OAuth cannot submit
bridge commands; unauthenticated reads are also rejected. Credentials remain in
trusted runtime secret storage. No URL, token, raw provider exception or actor ID
is written to public service logs. The operations panel remains a read-only
consumer; approvals happen in the existing Telegram chat.

`ADS_INTELLIGENCE_TELEGRAM_ENABLED=true` requires both API URL and bridge token
and rejects `META_WRITES_ENABLED=true`. Old local write routes cannot run through
the V2 handler. Existing one-campaign proposals are not migrated into new batch
approvals; they must be reviewed/cancelled before cutover.

## Phase D — single durable executor, simulation and shadow

`AdsIntelligence.confirm` is the shared execution entrypoint. PostgreSQL claims
the proposal once and locks account+campaign across processes. A unique operation
key is proposal+campaign; a partial unique index permits at most one unresolved
external operation per account+campaign. The durable EXECUTING claim precedes
the future writer call. State/result and append-only audit events update in a
single statement. A crash after claim never permits a blind retry.

Confirmation re-reads inventory, rules, delivery, account, budget and selection
metrics. It rejects changed policy/mode, expired proposals, external budget changes,
changed evidence/day, invalid samples or filters. EUR deltas and percentages
round once using integer arithmetic. Unknown provider results stay blocked;
read-only reconciliation can observe the desired budget without claiming which
operator changed it. A circuit breaker blocks subsequent attempts after an
unknown write. Confirming a SIMULATION/SHADOW proposal never calls a writer.

Production factory has `LIVE_COMPILED=false` and supplies no mutable Meta writer
in SIMULATION/SHADOW. Both a LIVE mode request and enabling write flags fail
closed. The guarded POST transport is implemented and tested only with fake
HTTP responses; it cannot be constructed by the production factory in this
release. It requires a single canary campaign, a last-moment account/budget read,
and sends one absolute cent assignment with no retries. Confirmed provider
rejections are FAILED; uncertain results are UNKNOWN. Offline engine harnesses
also validate partial-failure and readback transitions. No real POST was sent.

The older VPS policy V1 remains SIMULATION/SHADOW and its writer is still absent.
It defines 15/70 EUR minimum/maximum, a 35 EUR night cap and +10 EUR when ROAS
is strictly above 6. Those values differ from Telegram's approved 100 EUR/10%
limits and the requested ROAS >5 filter. They are not changed or silently merged.
Before any later LIVE release, all mutation consumers must use the shared executor;
native rules and external operators require a reviewed conflict policy. A lock
cannot prevent another human or Meta-native rule from changing a budget.

## Phase E — deployment preparation and rollback

New runtime settings default to disabled:

    ADS_INTELLIGENCE_READ_ENABLED=false
    ADS_INTELLIGENCE_WRITES_ENABLED=false
    ADS_INTELLIGENCE_MODE=SIMULATION
    ADS_INTELLIGENCE_TELEGRAM_ENABLED=false
    META_CANONICAL_READ_ENABLED=false

Required on authorized cutover: existing Meta credentials/account/version;
existing approved max budget/change values; numeric Telegram allowlist; reviewed
ADS_MIN_SPEND_EUR, ADS_MIN_PURCHASES, ADS_MIN_IMPRESSIONS and
ADS_MIN_FUNNEL_EVENTS (stage-denominator sample); private bridge token;
HTTPS bridge URL; dedicated database login granted only `suleia_ads_executor`
against the existing PostgreSQL. The migration creates a NOLOGIN capability role;
creating the login/secret is a private provisioning step, not committed code.
The role can modify only Ads tables, and can append but not update audit events.
It receives no order, incident or provider-action permissions.

Suggested cutover: back up current component releases; apply additive migration;
provision scoped credentials privately; deploy API/panel with reading and SHADOW
only; run bounded backfill and compare daily totals; deploy the existing bot
with the bridge enabled and legacy writes disabled. Verify one owner message,
buttons, replay, repeated confirmation and post-action reads. Do not migrate
logistics container versions or restart unrelated services.

Rollback: disable the V2 bridge/read flags, restore prior API/panel/bot releases,
and retain Ads facts/proposals/events for review. Never reset unknown operations
or delete journals as a retry mechanism. Additive migration can remain in place.
No operational data/table needs to be dropped.

Validation commands:

    node --test services/meta-ads/*.test.mjs
    node --test services/meta-ads/budget/*.test.mjs
    node --test infrastructure/telegram-center/center.test.mjs infrastructure/telegram-center/ads-gateway.test.mjs
    node --test autoconfirm/src/clients/meta.test.mjs
    node --test apps/api/server.test.mjs apps/api/ads-intelligence.test.mjs

The full Telegram suite requires Linux (directory fsync and service symlinks).
`ledger.integration.test.mjs` runs only with ADS_TEST_ISOLATED=true, a socket-only
ephemeral PostgreSQL database named ads_v2_test, and no production URL. It validates
the actual migration, persistence, duplicate claims, cross-session locks, facts,
coverage, least privilege and a concurrent engine confirmation in SHADOW.

Optional real read validation (trusted environment, no sends/persistence):

    node services/meta-ads/cli/validate-shadow.mjs --real-read-only

The harness rejects every non-GET provider request. Its sample settings are
test-only and are explicitly identified as such in output.

## Phase F — not authorized or enabled

LIVE requires a separate explicit owner authorization, reviewed release and a
named single campaign for a controlled reversible test. Permission scopes alone
are not authorization. Resolve approved-policy conflicts, sample settings,
competing writers, token lifecycle and attribution reconciliation first. A
completed SHADOW run is not evidence that a real write has been executed safely.
The future gate review must also set ADS_LIVE_CANARY_CAMPAIGN_ID to that one
campaign and preserve independent write flags and legacy-writer exclusion.
