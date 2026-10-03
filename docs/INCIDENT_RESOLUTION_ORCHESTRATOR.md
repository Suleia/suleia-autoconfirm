# Incident resolution rollout — 2026-10-03

The existing LIVE notification, discount-offer and no-response return lanes run
first and retain their existing policies and claims. An additive observer then
persists an exact-order incident twin, composable customer intent, resolution
plan, supersession history, one next route, owner, deadlines and verification.
Confirmation detection and Chatby configuration are unchanged.

## Capability and policy matrix

| Workflow | Prepared response action | Activation / limitation |
| --- | --- | --- |
| REJECTED accepts €5 | APPLY_DISCOUNT → VERIFY_DISCOUNT → RETRY → VERIFY → follow-up | HUMAN_REVIEW: economic mutation contract unavailable |
| REJECTED wants delivery without discount | RETRY with explicit date/window | SHADOW; exact-issue canary required |
| REJECTED explicitly requests return | REQUEST_RETURN | SHADOW; distinct from existing LIVE silence policy |
| AUSENTE date/window or agency | RETRY / PICKUP_AT_AGENCY | SHADOW; exact-issue canary required |
| AUSENTE silence or discount acceptance | Existing notification/offer only | No implicit return; discount-application policy required |
| ADDRESS complete / confirmed | CHANGE_ADDRESS / PROVIDE_SOLUTION | Existing policy retained; new executor SHADOW |
| ADDRESS partial / accepts discount | Existing missing-details owner / MANUAL_DISCOUNT_RECOVERY | HUMAN_REVIEW |

The official Dropea v2 ResolveIssueInput contract supports retry, agency, return,
address and solution. Retry needs a date and morning/afternoon/evening window.
Solution notes are request-only: a subsequent resolved state does not prove the
carrier read the note. The order PATCH line-item price contract does not establish
that an existing parcel's COD collectible changes. There is no verified economic
adapter; sending a support email would not constitute APPLY_DISCOUNT success.
No real new write canary or capability promotion is claimed by this release.

## Persistence and execution

Private Supabase app_state records use incident_e2e_current and incident_e2e_event
namespaces. Plans contain hashes, codes and timestamps, not customer prose,
addresses or phone numbers. Store requests have a five-second timeout. Per-case
failures are isolated from the already-completed legacy incident loop.

New capability flags use INCIDENT_E2E_<WORKFLOW>_<ACTION>_MODE, _BREAKER,
_ISSUE_ID and _CANARY_VERIFIED. Default is SHADOW. CANARY requires CLOSED and the
exact issue ID. LIVE additionally requires separately verified canary evidence.
Each write rereads provider identity, pending/active state, current order status,
exact Chatby order binding, last relevant response and capabilities before and
after its durable claim. The intent hash must still match. Existing return/address
claims are reused. One POST maximum; timeouts and conflicts become UNKNOWN and
require read-only reconciliation, never a blind retry. Historical execution is
forbidden. Superseded actions remain auditable.

## Observation, panel and metrics

The Render dashboard exposes replied-unresolved, stuck and prepared filters.
The Operations integration projects the same allowlisted observation through
migration 052 and customer_replied_unresolved_incidents. It does not execute
provider actions. Missing/stale observations are not success. Terminal delivery
and return outcomes are distinguished from a verified provider resolution.

Metrics are restricted to PERSISTED_ORCHESTRATOR_CASES. An empty denominator is
null. Human-review-required is distinct from an actually observed human touch.
Autonomous resolution is attributed only after a verified orchestrator action
and a terminal logistics result. Historical counts are read-only diagnostic
proxies, not claims of unresolved current orders or actions this release took.

The lifecycle monitor reads bot-inclusive history and reconciles exact template,
provider message ID, current order binding and timestamp into five categories:
TRUE_MISSING_SEND, PROVIDER_SENT_MONITOR_MISSED, STALE_MONITOR,
ALREADY_SUPERSEDED and NEEDS_REVIEW. The new reconciler never sends a message.

## Validation and rollback

The service suite covers acceptance/manual fallback, discount rejection while
wanting delivery, explicit return, dates/windows/agency, complete/partial/confirmed
address, late intent changes, duplicates, provider timeout/conflict, durable
storage, unknown reconciliation and stuck detection. Provider simulations are
tests, not real canaries. Deployment and live metrics are recorded in Agent Hub.

Render rollback: redeploy a3a8003edbced452f6d0e565ca80a1c2b675e904, or disable only
INCIDENT_E2E_OBSERVER_ENABLED while diagnosing. Existing LIVE flags stay intact.
The Operations deployment backs up original images, environment and mounts,
checks all unaffected service IDs (including the absent controller), and records
a runtime-preserving rollback override. Migration 052 is additive; rollback does
not delete observations or alter provider state.
