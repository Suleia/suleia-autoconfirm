# Confirmation Agent Functional Baseline

## Freeze status

```text
Component: Render acceptance / confirmation automation
Status: FUNCTIONALLY_FROZEN
Production authority: legacy agent
Baseline branch: main
Baseline commit: 9569b01cc9af936bcf919dee5fe9f33d7151057d
Baseline recorded: 2026-08-19
```

This document records observed production behavior; it does not redefine desired behavior. During the shadow migration, the files in the freeze manifest must not change without separate, explicit authorization and a deliberate baseline update.

The following remain prohibited by the freeze: rule, prompt, timing, trigger, endpoint, worker, API, persistence, state, and execution changes in the confirmation flow. The new Decision Engine is an observer only.

## Production provenance

Read-only Render API evidence collected on 2026-08-19 established:

| Field | Observed value |
|---|---|
| Service | `suleia-autoconfirm` |
| Type | Docker web service |
| Repository branch | `main` |
| Effective Render `rootDir` | `autoconfirm` |
| Automatic deploy | disabled |
| Live deploy | `dep-da307mnlk1mc73f4v460` |
| Live commit | `9569b01cc9af936bcf919dee5fe9f33d7151057d` |
| Live status | `live` |
| Live completion | `2026-08-19T19:29:01.088461Z` |

This resolves the duplicated-tree ambiguity: production builds the rich `autoconfirm/**` tree. The older root `server.mjs` and root `src/**` copies are not the baseline and must not be substituted.

The production Dockerfile currently starts from Node 20, while the required reproducible validation baseline uses Node 22.22.0. Phase 0.5 does not change the Dockerfile. Node 22.22 evidence proves requested test compatibility, not a runtime upgrade.

## Entrypoints and scheduling

| Entrypoint | Location | Current role |
|---|---|---|
| Server startup | `autoconfirm/server.mjs` | Hydrates state and starts configured internal timers. |
| Dropea webhook | `POST /webhooks/dropea/:token` | Ingests an order asynchronously after acknowledging the request. |
| Shopify webhook | `POST /webhooks/shopify/:token` | Ingests a Shopify order asynchronously. |
| Poll cron | `POST /api/cron/poll-orders` | Reads and ingests pending orders. |
| Confirmation cron | `POST /api/cron/auto-confirm` | Runs the existing confirmation queue. |
| Full cycle cron | `POST /api/cron/automation-cycle` | Polls, sends applicable templates, confirms, sweeps unanswered orders, then refreshes the operational projection. |
| Unanswered cron | `POST /api/cron/unanswered-cancellations` | Runs the existing 48-hour rejection flow. |
| Repair endpoint | `POST /api/logistics/repair-delayed-confirmation-timer` | Repairs one delayed timer, then invokes the current queue. |
| CLI | `tools/auto-confirm.mjs` | Invokes the same existing queue. |
| Poll-cycle CLI | `tools/poll-orders.mjs` | Invokes the complete existing store automation cycle. |
| Unanswered CLI | `tools/unanswered-cancellations.mjs` | Invokes the existing unanswered-order sweep, optionally for supplied order IDs. |
| Render HTTP cron client | `scripts/render-cron-unanswered-cancellations.mjs` | Calls the protected unanswered endpoint and summarizes its current result. |
| Contabo persistent timer | `infrastructure/vps/suleia-render-automation.timer` | Calls Render's full cycle every five minutes using a host lock. |
| Internal poller | `autoconfirm/server.mjs` | First poll after 15 seconds, then the configured interval (five minutes in the blueprint). |
| Internal unanswered sweep | `autoconfirm/server.mjs` | First sweep after 30 seconds, then its configured interval. |
| Render unanswered cron | `autoconfirm/render.yaml` | Runs the cancellation command on the existing schedule. |

The complete-cycle path has an in-process lock. Direct auto-confirm and other entrypoints do not share one global distributed lock. That fact is frozen as current behavior, not endorsed as a future design.

## Current decision flow

For each candidate, the observed order is:

1. Apply the existing blocked-customer policy.
2. Associate the current Dropea order with its Chatby subscriber.
3. Ignore orders outside the current pending state.
4. Apply training-sheet overrides only in the current simulation path.
5. Skip confirmation when no usable Chatby thread exists.
6. Read inbound customer messages associated with the current order window.
7. Resolve any already scheduled delayed confirmation.
8. Apply the deterministic intent classifier.
9. Evaluate current Chatby field/button evidence.
10. Use the existing Assistant/Responses classifiers only as fallbacks.

### Confirmation evidence

- Explicit affirmative text or the recognized Chatby button produces `CONFIRM` with the current deterministic confidence.
- A persistent Chatby confirmation tag alone is insufficient.
- The confirmation timestamp, or an inbound confirmation timestamp, must be at or after the current order's valid start.
- An outbound bot/agent message is not customer confirmation.
- Among recognized inbound confirmation and cancellation messages, the newest message wins.
- A sufficiently complete address-change message currently becomes a logistical confirmation with confidence 98. It is evaluated before the newest-message loop. This is a documented current-behavior exception and a known conflict risk.

### Conditions that do not confirm

- Explicit rejection, cancellation, regret, or refusal.
- Incomplete address or delivery-data change request.
- Promotion/offer change request.
- Ambiguous text without a recognized intent.
- No usable Chatby subscriber or no current confirmation evidence.
- Non-pending order.
- Unpaid Shopify order.
- Active delayed window not yet due.

### One-hour delayed confirmation

- The current delay is one hour (`CONFIRMATION_DELAY_HOURS=1` in the deployed blueprint).
- An initial eligible confirmation stores `CONFIRM_DELAY_PENDING`; it does not immediately confirm Dropea.
- The stored start, due time, and source survive later order synchronization.
- Before acting at maturity, the agent re-reads current Chatby evidence.
- A later cancellation cancels/rejects the order through the existing Dropea path.
- A later promotion change cancels and sends the existing Chatby text.
- A later incomplete address change holds the confirmation.
- A repeated confirmation does not restart the timer.
- If real delayed confirmation is disabled, the result is `would_confirm_after_delay`.
- If enabled, the existing Dropea V2 action adapter performs one governed confirmation request and the existing verification/repair behavior follows.

### Shopify behavior

- Shopify is read for financial status.
- A paid Shopify order can be recorded as locally confirmed.
- The agent does not mutate Shopify to perform that confirmation.
- An unpaid Shopify order remains in manual review.

## Effective configuration precedence

The legacy flow does not have a single execution-mode authority. Effective store settings are resolved as:

```text
environment override > data/stores.json > hard-coded default
```

Relevant current defaults in `autoconfirm/src/config.mjs` are:

| Setting | Default/current meaning |
|---|---|
| `AGENT_DRY_RUN` | `true`; not a global safety switch. |
| `AGENT_ENABLED` | `false` by default; primarily gates Assistant use, not deterministic maturity. |
| `DELAYED_CONFIRM_REAL_ENABLED` | `false` by code default; deployed configuration controls real delayed confirmation. |
| `CONFIRMATION_DELAY_HOURS` | `1`. |
| `UNANSWERED_CANCEL_AFTER_HOURS` | `48`. |
| `UNANSWERED_REJECT_REAL_ENABLED` | `true` by code default. |
| `INCIDENT_RESOLUTION_REAL_ENABLED` | `false` by code default. |
| `CONFIDENCE_THRESHOLD` | `90`. |

### Effective live configuration evidence

A read-only Render API and `/health` observation on 2026-08-20 recorded only allowlisted, non-secret behavior values:

| Effective field | Observed value |
|---|---|
| `agentEnabled` | `true` |
| `agentDryRun` | `false` |
| `delayedConfirmRealEnabled` | `true` |
| `confirmationDelayHours` | `1` |
| `autoPollEnabled` | `true` |
| `autoPollIntervalMinutes` | `5` |
| `unansweredCancellationIntervalMinutes` | `60` |
| `unansweredCancelAfterHours` | `48` |
| `unansweredRejectRealEnabled` | `true` |
| confirmation automation reported enabled | `true` |
| unanswered automation reported enabled | `true` |
| `INCIDENT_RESOLUTION_REAL_ENABLED` environment override | `false` |

Secret-safe presence evidence, without values:

| Configuration key | Present and non-empty |
|---|---:|
| `CRON_SECRET` | no |
| `TELEGRAM_WEBHOOK_SECRET` | no |
| `CHATBY_TOKEN` | yes |
| `DROPEA_ACTIONS_STORES_CONFIG` | yes |

The canonical SHA-256 of the whitelisted effective health map is `73ec313b332e3a4c6554156a038853817ffbbef1f72a39dcab1064043adc2cc6`. The canonical SHA-256 of the whitelisted Render environment/presence map is `fe5f2985c281e6d1c7c64b0b0fb71b8abeb425d0c5f3cbbf6e1b481ed35f746d`. Neither input contains a secret value.

The missing cron and Telegram secrets make the already-characterized fail-open paths concrete live P0s. Fixing them safely requires coordinated secret provisioning and caller rollout; changing code alone would stop the currently active automation. This freeze PR therefore documents and gates the issue without altering production.

No Phase 0.5 mode resolver is imported into `autoconfirm/**`. Doing so would change precedence and violate the freeze.

## Adjacent 48-hour cancellation behavior

The unanswered-order worker is operationally adjacent to confirmation and is therefore included in the checksum contract.

- It considers the configured pending states after 48 hours from the Dropea creation time.
- Incident states are excluded.
- Missing token, missing phone, or a Chatby read error blocks cancellation.
- No subscriber is currently interpreted as no response and can remain eligible.
- A current exact customer action/message blocks cancellation.
- A stored local confirmation is reported but is not, by itself, a veto when Chatby evidence cannot be recovered.
- `UNANSWERED_REJECT_REAL_ENABLED=true` currently overrides the general dry-run for this path.
- The blocked-customer policy can cancel before the later dry-run branch.

These points are characterization, not permission to reproduce them in new architecture.

## External dependencies and side effects

| System | Current use |
|---|---|
| Dropea GraphQL/V2 | Read pending/order state; confirm, cancel, repair, and incident actions in existing governed paths. |
| Chatby | Read subscribers/messages; create/update subscribers; send templates/text; update or clear confirmation metadata. |
| Meta WhatsApp | Existing fallback template send. |
| Shopify | Read financial/order state. |
| Google Sheets | Existing projection, training overrides, and decision records. |
| Supabase | Existing operational mirror, state, webhook, and template-ledger persistence. |
| Local disk | Existing orders, state, store config, and webhook deduplication. |
| OpenAI | Existing fallback interpretation through the configured Assistant/Responses paths. |

New shadow code must not call or wrap any of these mutating legacy paths.

## Persistent state

Critical fields include `aiIntent`, `aiConfidence`, `confirmationDelayStartedAt`, `confirmationDueAt`, `confirmationSource`, `confirmedAt`, Chatby template/association state, and raw source metadata. The freeze includes local storage and Supabase mirror implementations because changing their merge behavior can indirectly alter confirmation.

## Regression contract

Run from `autoconfirm/` under Node 22.22.0:

```text
npm run test:confirmation-regression
```

The dedicated suite:

- uses synthetic identifiers and messages only;
- redirects local state to temporary directories;
- performs no production network calls and blocks every unmocked egress attempt;
- replaces inherited persistence paths and credentials even when a stateful regression file is invoked directly without the npm preload;
- keeps generated `stores.json`, `state.json`, `orders.json` and `webhook-events.json` runtime artifacts outside version control, and the pre-commit freeze check includes untracked paths under `autoconfirm/`;
- characterizes intent, temporal precedence, current-order freshness, outbound-message exclusion, timer persistence, strict subscriber matching, V2 scopes/idempotency, cron entrypoints, and Supabase ledger fail-closed behavior;
- validates the exact Git blob identity of 46 critical production files and permits only the additive regression script in `package.json`;
- verifies recursive local dependency closure from the server, poll cycle, Render cron client, confirmation command and unanswered command entrypoints;
- characterizes the one-hour schedule/maturity/re-read path, regret, promotion-change cancellation and exact Chatby reply, repeated-confirmation timer stability, address holds, paid/unpaid Shopify behavior, no-subscriber skip and the current unanswered-cancellation truth table with fixture-only adapters.

The authoritative freeze manifest is:

```text
autoconfirm/tests/regression/confirmation-agent/frozen-files.json
```

At final Phase 0.5 freeze validation: `52/52` dedicated regression tests pass. The complete generic post-change suite is `136/136`; the clean pre-change baseline under Node 22.22.0 was `103/103`.

## Known P0 characterization

The following observed risks are deliberately not repaired inside this freeze PR:

1. Cron authorization accepts requests when `CRON_SECRET` is absent.
2. Telegram webhook authorization also accepts a missing secret; a command path can reach the unanswered sweep.
3. Dashboard-action authorization inherits the cron fallback.
4. The unanswered real-enable/dry-run matrix can result in real cancellation when dry-run appears enabled.
5. Blocked-customer cancellation occurs outside the later general dry-run check.
6. A stored confirmation alone does not veto unanswered cancellation if current Chatby evidence is unavailable.
7. A complete older address change can currently precede a later cancellation because of classifier order.
8. `AGENT_ENABLED` is not a global kill switch, while readiness presentation can imply otherwise.
9. The Contabo runner can report HTTP-level success despite nested cycle errors.
10. Webhooks acknowledge before durable completion and have no durable execution queue.
11. Startup/result logging can expose token-bearing paths or order-derived data.
12. The production runtime remains Node 20 while the requested validation baseline is Node 22.22.

Each needs a separate, isolated authorization if remediation could alter the frozen agent, its triggers, or its timing. Until then it remains a gate/risk, not an unreviewed code change.

## Change control

Any future PR that touches a manifest file must state all of the following:

```text
Confirmation agent behavior changed: NO/YES
Confirmation rules changed: NO/YES
Confirmation timing changed: NO/YES
Explicit behavior-change authorization: reference or NONE
Regression contract: PASS/FAIL
Production customer actions in tests: 0
```

Without explicit authorization, any manifest drift or changed fixture output is a hard `NO-GO`.
