# SULEIA_CUSTOMER_CARE_AGENT

Owner request: 2026-10-30. Initial release is **SHADOW**. A proposal is not an
authorization to change any protected workflow. OpenAI remains disabled, 0 USD.

## Architecture and ownership

`Chatby → exact-order binding → conversation memory → composable intents/facts
→ deterministic policy router → one next action → existing owner → verification`.

The pure interpreter, router, durable store and clarification decorator live in
`autoconfirm/src/customer-care/`. They contain no provider writer. The additive
Render observer runs after the existing incident owners, reusing their messages
and never starting another polling timer or Chatby scan. Its private context is
displayed in the existing incident table, including mode, intent, known/missing
facts, last question, next action, owner, waiting party and verified action.

| Capability | Owner |
| --- | --- |
| Confirmation, cancellation | Existing confirmation/cancellation workflows |
| Initial, reminder, prepared, absent templates | Existing per-template owners |
| Discount offer/application, returns, address | Existing specialist workflows |
| Re-delivery and agency | Existing incident action gateway and its policy |
| Interpretation, context and routing | Customer Care |
| Clarification/status text delivery | Existing `vps_delivery_reply` sender |

The decorator returns legacy solution plans unchanged. Outside its separately
enabled canary it returns legacy message plans unchanged. Delegation records do
not bypass owner gates, the one-hour settling window or a prior uncertain claim.

## Case, intent and slot schemas

Private service-role-governed `app_state` uses:

- `customer_care_case:<canonical_order_id>:<active_issue_id|order>`: current case.
- `customer_care_event:<case_hash>:<projection_hash>`: append-only observation.

The current projection uses compare-and-swap on `updated_at`. Concurrent reads
cannot silently erase newer state. No new database grants, public endpoints,
customer tables, parallel senders or secret stores are introduced.

Case fields include all owner-requested identifiers, current order/issue state,
intents, wants/return/cancellation, offer/response/verified application, schedule,
contact instruction, payment information, address state, agency/non-delivery,
last question, waiting party, verified action, next action, conversation version
and timestamps. `clarifications[]` retains type, missing slots, body hash,
provider id, sent/answered timestamps, answer hash and verification status.

`INTENTS` exports the composable supported vocabulary; `facts` is separate.
Date, window, exact/range time, contact request, payment constraint and address
slots carry event id/time/hash provenance. Relative dates use the customer's
event in Europe/Madrid. Unspecified 12-hour times and conflicting/conditional
requests escalate instead of becoming a provider instruction.

The full bounded current-order transcript is replayed chronologically. Related
successive details accumulate even across messages; courtesy cannot erase them.
Edited events invalidate the old interpretation. A later valid refusal overrides
desire; a later desire after a verified irreversible action requires review.
Pre-order history, mixed conversations, unknown inbound times and unverified
exact-order/active-issue associations block action planning.

## Routing, clarification and payment

Exactly one next action is emitted: RESPOND, DELEGATE,
EXECUTE_AUTHORIZED_ACTION, WAITING_CUSTOMER, WAITING_PROVIDER or HUMAN_REVIEW.
The initial release never uses EXECUTE_AUTHORIZED_ACTION. Existing verified
requests remain waiting for logistics; only actual delivery/return/cancellation
outcomes can close a case. A provider-accepted request is not a delivery.

`requiredMissingSlots` asks only the missing fields required by the supplied
owner policy. Payment confirmation is never a missing slot. If a question is
unanswered, all later scheduler cycles WAITING_CUSTOMER, regardless of elapsed
hours or changed classification reason. Historical repeated questions produce
HIGH `REPEATED_CLARIFICATION` findings; old ledger entries are retained.

Payment wording is information, for example: “El importe pendiente es de
24,99 € y podrá abonarlo al recibirlo en efectivo o con tarjeta.” Amount and
each advertised method must be independently verified; card support is never
inferred from COD. The default observer leaves payment facts unverified until
the owner supplies the verified contract. Reported inability to pay remains a
real constraint for review. Payment information signatures prevent unsolicited
repetition; an explicit new payment question may be answered again.

Status requires a fresh provider read; product/usage answers require a verified
source. There are no generated health/product claims and no LLM API calls.

## Stale plans, metrics and rollout

Each unique/edited inbound increments `conversation_version`. Plans bind that
version, the entire transcript hash and the provider/policy context hash.
Fresh reads must reproduce all of them before the existing sender can write.
The sender's shared persistent claim, single POST and readback remain mandatory;
an uncertain outcome keeps its claim and must not be blindly retried.

Metrics separate interpreted messages, confidence, verified actions, actual
logistics outcomes, clarifications, repeats, human review, stale plans and change
of mind. Unknown denominators/results remain null. Rates use the explicitly
labelled current exact-order cohort; the targets (zero repeats/wrong-order/blind
retries, >90% resolution with an available authorized capability, <1.2 questions
per case) are goals, not claims of achieved production performance.

Feature flags default off:

```
CUSTOMER_CARE_ENABLED=false
CUSTOMER_CARE_CONTEXT_ENABLED=false
CUSTOMER_CARE_CLARIFICATION_ENABLED=false
CUSTOMER_CARE_STATUS_REPLY_ENABLED=false
CUSTOMER_CARE_AI_INTERPRETER_ENABLED=false
CUSTOMER_CARE_MODE=SHADOW
```

The observer can run with the first two true, SHADOW, clarification/status/AI
false. Replay current pending conversations without provider writes. Report
same/improved decisions, fewer questions, detected changes of mind, avoided
wrong questions and changed human-review routes. Review examples privately.

The VPS canary requires one explicit exact case id and the capability flag;
there is no automatic global promotion. Reuse its native sender, preserve its
independent work budget and all existing operational policy/claim checks.
Verify one naturally eligible clarification before considering broader release.
No fabricated input or replay of a previously sent message is a canary.

Rollback disables Customer Care flags and restores legacy routing immediately.
Preserve all memory, message/action ledgers, claims, evidence and old decisions.
An optional code rollback uses the exact previous Render/VPS revisions, which
are different baselines. Never deploy the stale main tree over either service.

## Validation and remaining limits

Sanitized fixtures cover the six requested real-case patterns, repeated cron
cycles without an answer, payment wording, current-offer yes/no, compound facts,
exact binding, stale/edited plans, irreversible actions, missing-only questions,
unknown payment methods, temporal expiry, CAS races, XSS and disabled/SHADOW
legacy equivalence. Full regression includes the protected workflow suites.

No model fallback is activated. Semantic parsing is intentionally conservative;
unrecognized nuanced/conditional statements escalate. A delegation does not
prove that the existing owner can execute it. Provider freshness and current
authorization are always revalidated by that owner. Production rollout receipts,
test totals and sanitized replay results must be reported separately from these
architecture and policy contracts.
