# Write path inventory

**Phase:** 0.5 — P0 containment
**Evidence cut:** 2026-08-20
**Render reference:** `main@9569b01cc9af936bcf919dee5fe9f33d7151057d`
**Contabo reference:** `deploy/contabo-operations-live@e17141edc87710c21dcf3c2292816a3f15218f12` plus the un-deployed Phase 0.5 branch

`main` and `deploy` have divergent histories. A path observed in one plane must not be assumed to exist in the other.

## Classification

| Class | Meaning |
|---|---|
| `LEGACY_APPROVED` | Pre-existing path retained only to preserve current production behavior. It is inventoried, not declared risk-free or migrated. |
| `NEW_GATEWAY` | New path that can only enter through `ExecutionGateway`. Phase 0.5 never authorizes external execution. |
| `UNSAFE_BYPASS` | Mutating or triggering path that bypasses the new boundary or has a demonstrated fail-open P0. |
| `UNKNOWN` | Effective semantics or credential capability are not proven. Treat as blocked for new automation. |

`LEGACY_APPROVED` is a temporary compatibility classification. It does not authorize new callers, expansion or reuse by the shadow architecture.

## Render legacy external effects

| ID | Effect and implementation | Class | Idempotency / guard evidence | Phase 0.5 treatment |
|---|---|---|---|---|
| `L-01` | Confirm a Dropea V2 order through `autoconfirm/src/clients/dropea-v2-order-actions.mjs`, called by delayed confirmation and post-confirm recovery in `orders.mjs` | `LEGACY_APPROVED` | Stable provider header derived as `suleia-confirm-{orderId}`; approved hosts, scopes and expiry validated | `FUNCTIONALLY_FROZEN`; do not route through the new Gateway |
| `L-02` | Cancel after a later cancellation or promotion change in `orders.mjs::processDelayedConfirmation` | `LEGACY_APPROVED` | Stable Dropea cancel key; the associated Chatby text does not have equivalent remote idempotency evidence | Frozen with the current confirmation/cancellation contract |
| `L-03` | Repair `ERROR/REVIEW`, refresh shipping or retry confirmation in `orders.mjs::inspectAndRepairConfirmedDropeaOrder` | `LEGACY_APPROVED` | The V2 retry has a stable key; bulk repair and shipping refresh lack durable reconciliation evidence | Preserve behavior; retain as an explicit risk |
| `L-04` | Cancel a blocked customer in `orders.mjs::applyBlockedCustomerPolicy` | `UNSAFE_BYPASS` | Cancellation can occur before the later general dry-run branch | Live P0; documented, not changed under the freeze |
| `L-05` | Cancel an unanswered order in `unanswered-cancellations.mjs::runUnansweredCancellationSweep` | `UNSAFE_BYPASS` | V2 call has a key, but `dryRun = agentDryRun && !enabled`; the effective real-enable flag can override apparent dry-run | Live P0; do not reproduce in the new architecture |
| `L-06` | Cancel from `POST /api/logistics/cancel-dropea-order` | `UNSAFE_BYPASS` | Direct legacy client call; dashboard-action authorization inherits cron authorization | Live P0 while cron auth is fail-open |
| `L-07` | Resolve an incident, return to origin or request depot pickup through `executeIncidentOperationalDecision` and the Dropea GraphQL/REST clients | `UNSAFE_BYPASS` | Local bounded ledger only; no distributed transaction or remote-unknown reconciliation | Dormant in the current V2 read-only route and guarded by `INCIDENT_RESOLUTION_REAL_ENABLED=false`; any activation remains blocked |
| `L-08` | Create/update a Chatby contact, clear confirmation state, send order templates or text, with Meta as the existing fallback | `LEGACY_APPROVED` | Persistent plus in-memory claims cover lifecycle templates; not every contact or free-text mutation has a provider key | Preserve current behavior; forbid new shadow imports |
| `L-09` | Send incident/discount templates from dormant legacy modules | `UNSAFE_BYPASS` | Partial template claim; no common Policy Gate | Keep disconnected from the current V2 read-only route |
| `L-10` | Send real templates from `tools/send-chatby-template-orders.mjs` or `tools/verify-chatby-template-orders.mjs` | `UNSAFE_BYPASS` | Tool-specific checks only | Never run against real customers during migration testing |
| `L-11` | Invoke the unanswered sweep from the Telegram command path | `UNSAFE_BYPASS` | Inherits the sweep's partial protections; webhook authentication accepts a missing secret | Live P0; no customer-impacting test was run |
| `L-12` | Trigger polling, template delivery, confirmation or cancellation from `/api/cron/*`, Render scheduling or the VPS timer | `UNSAFE_BYPASS` | In-process lock and VPS `flock` do not form a distributed lock; missing `CRON_SECRET` authorizes the request | Live P0; unchanged because changing callers/triggers could alter the frozen automation |

## Render legacy persistence and operator effects

| ID | Destination | Class | Evidence and limit |
|---|---|---|---|
| `L-13` | Supabase operational mirror | `LEGACY_APPROVED` | `clients/supabase.mjs` and `db/supabase-store.mjs` upsert/insert orders, state, webhook records, ledgers, feedback and memory under the current service role. This credential must not enter shadow. |
| `L-14` | Local JSON/state files | `LEGACY_APPROVED` | Existing operational state only; file/process scope is not distributed idempotency. |
| `L-15` | Google Sheets | `LEGACY_APPROVED` | Existing upsert/append/replace paths for projections and operator memory. |
| `L-16` | Telegram responses and webhook administration | `LEGACY_APPROVED` | Operator communication, not customer communication. This classification does not approve the fail-open trigger in `L-11`. |

The confirmation freeze manifest covers 46 critical production files. Their Git blob identity remains equal to `main@9569b01`; no production source, rule, prompt, timing, API, trigger, state or persistence behavior was changed.

Review detected a generated, untracked `autoconfirm/data/stores.json`. That runtime configuration was not present in the baseline commit, was not authorized and was removed. Final status confirms it is absent and not tracked. Additive ignore rules cover generated state below `autoconfirm/data/`, and freeze validation fails if any such runtime configuration is tracked or staged.

## Contabo shadow and new architecture

| ID | Effect and implementation | Class | State |
|---|---|---|---|
| `N-01` | Project observations to isolated PostgreSQL through `shadow/repository.mjs` and `operations/projector.mjs` | `LEGACY_APPROVED` | Internal shadow persistence only; transactions and `ON CONFLICT` protect several event/projection identities |
| `N-02` | Store authenticated human feedback through `OperationsRepository.recordIncidentFeedback` | `LEGACY_APPROVED` | Writes only to internal decision memory; returns `actions_executed=0` and `production_writes=0` |
| `N-03` | Store observed Dropea/Chatby webhook events and timeline rows | `LEGACY_APPROVED` | Internal PostgreSQL only; event/hash dedupe, no provider mutation |
| `N-04` | Read the Supabase source with a service-role credential in the deployed `e17141e` configuration | `UNSAFE_BYPASS` | Observed requests are GET, but the mounted identity has technical write capability |
| `N-05` | Proposed source identity using `SUPABASE_PUBLISHABLE_KEY` plus a bearer with role `suleia_shadow_reader` | `UNKNOWN` | Branch preflight rejects service-role, secret keys, malformed/expired tokens, wrong issuer and wrong role. No real role, RLS policy, token or negative mutation test has been provisioned or verified. |
| `N-06` | Propose or attempt a new external action through `services/action-executor.mjs` and `platform-core/execution-gateway.mjs` | `NEW_GATEWAY` | Public legacy executor contract stays disabled. The additive Gateway validates snapshot and a canonical semantic idempotency key, then execution mode blocks. No external adapter exists, and caller-supplied preconditions are not yet an authoritative production capability. |
| `N-07` | Dropea GraphQL semantic POST containing an allowlisted query | `UNKNOWN` | No mutation observed in the connector, but the effective API-key scopes are not accredited as read-only. |
| `N-08` | GLS tracking semantic POST | `UNKNOWN` | Observed endpoint is a lookup; read-only capability is not inferred from the endpoint name alone. |
| `N-09` | Chatby GET reads with a shadow token | `UNKNOWN` | HTTP methods are read-only; effective token scopes are not inventoried. |
| `N-10` | OAuth or Render dashboard login POST | `UNKNOWN` | Session/authentication effect, not a business action; host and path remain allowlisted. |

No Dropea, GLS, Chatby, Shopify or Supabase mutation adapter is connected to `NEW_GATEWAY`. The repository safety scan found zero imports of production `autoconfirm` clients from the new architecture.

## Administrative paths outside the runtime

Keycloak/DCR enrollment and configuration scripts mutate staging identity infrastructure only when an operator explicitly invokes them. Supabase role SQL in `infrastructure/supabase/` is design, verification and rollback material and was not applied.

These paths are not mounted as MCP tools or decision-engine capabilities. They require separate authorization, staging target validation, secret-safe handling and their own rollback.

`provision-shadow-source-secrets.ps1` accepts an independently supplied publishable key and reader JWT. It no longer retrieves or prints a Render service-role value. The script does not mint or prove the reader.

## Semantic POST review

HTTP `POST` is not automatically a business mutation. These cases were reviewed separately:

- Shopify and Dropea GraphQL queries;
- GLS tracking search;
- Chatby template listing;
- OAuth/token exchange;
- dashboard login.

They remain `UNKNOWN` for reuse until contract and credential scopes are proven. They are not precedent for allowing generic POST in shadow.

## Credential capability inventory

| Credential | Plane | Possible capability | Status |
|---|---|---|---|
| Dropea V2 action JWT | Render | Read, confirm and cancel under inspected scopes | `LEGACY_APPROVED`, frozen caller only |
| Legacy Dropea access/API credentials | Render | Reads plus repair or incident mutation paths | Must not be supplied to the new Gateway |
| Render Chatby token | Render | Reads, contact mutation and messaging | `LEGACY_APPROVED`, existing flows only |
| Shadow Chatby token | Contabo | Effective scopes not proven | `UNKNOWN` |
| Render Supabase service role | Render | Existing production persistence | `LEGACY_APPROVED`; never copy to shadow |
| Deployed shadow Supabase service role | Contabo | Technical write capability | `UNSAFE_BYPASS` |
| Proposed publishable key + reader JWT | Phase 0.5 branch | Intended allowlisted `SELECT` only | `UNKNOWN` until deployed permission-level proof |

No credential values, fragments or reversible fingerprints are recorded here.

## Idempotency status

| Path | Evidence | Remaining limit |
|---|---|---|
| Dropea V2 confirm/cancel | Stable provider `Idempotency-Key` | No proof of every ambiguous commit/reconciliation case |
| Legacy Chatby templates | Persistent and in-memory claims | Uneven coverage across processes and message types |
| Legacy incident actions | Bounded local ledger | Not durable or distributed |
| Shadow PostgreSQL | Keys, transactions and `ON CONFLICT` | Internal persistence only |
| New action envelope | Gateway-derived key over order, action, state version and input hash; caller-selected key rejected | Ledger is in-memory and there is no external adapter |
| Cron/schedulers | In-process lock and partial `flock` | No single distributed owner/lock |

Production-grade action idempotency is therefore not complete. Before any external capability, the in-memory claim must become durable and transactional with crash/restart, concurrency, remote-unknown and reconciliation tests.

## Import and execution rule

```text
new architecture external mutation
-> ExecutionGateway only
```

New code may not import production clients directly. `LEGACY_APPROVED` paths:

- are limited to the frozen snapshot;
- cannot gain new callers;
- cannot be used as shadow libraries;
- require explicit authorization and regression evidence if changed.

Any unlisted path defaults to `UNKNOWN` and is blocked.

## Evidence and gates

| Gate | Result |
|---|---|
| New direct mutators outside Gateway | `0`; static safety checks pass |
| Gateway external execution | `0`; blocked and adapter absent |
| Phase 0.5 production deployments | `0` |
| New external writes during tests/work | `0` |
| Real customer messages/actions during tests/work | `0` |
| Non-allowlisted runtime config in intended commit | `0`; detected `autoconfirm/data/stores.json` was removed and is absent/untracked in final status |
| Service-role removed from proposed shadow artifacts | PASS in branch tests; not deployed |
| Permission-level Supabase reader | Not accredited; `NO-GO` |
| Chatby shadow least privilege | Not accredited |
| Critical cron/Telegram fail-open | Active; `NO-GO` |
| Future external execution: durable idempotency and adapter | Not implemented; `NO-GO` for Phase 7/capability activation, not for read-only State Builder work |
| Future external execution: authoritative Gateway preconditions | Not implemented; caller context is untrusted and remains `NO-GO` for any capability activation |

## Rollback

The branch is not deployed and applies no database migration. Reverting its commits removes the new resolver, Gateway, validation artifacts and documentation without external reconciliation.

For a future reader rollout:

1. create and verify the technical reader under separate approval;
2. prove allowed reads and denied writes;
3. deploy only the shadow worker;
4. on failure, stop or revert that worker;
5. never reintroduce service-role as a shadow fallback;
6. leave Render unchanged.
