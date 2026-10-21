# Autonomous incident delivery replies

Owner-authorized 2026-10-21. This extends the existing dedicated VPS incident
worker, on its existing 30-minute schedule. It does not add another consumer,
edit Chatby templates/flows, change order-confirmation detection, alter prices
or discounts, or take over address, agency, return and silent-return policies.

The existing screenshot-backed RETRY path runs first and keeps its safeguards.
The additional delivery-reply phase handles pending absent/refused incidents
whose exact-order customer conversation has a settled, fresh delivery request
or explicit non-delivery complaint. It reads consecutive messages together:
a factual work/absence explanation does not erase a preceding delivery date;
a later precise time refines that date, retaining the literal restriction in
the transport solution. Explicit dates are anchored to the message's Madrid
day, including same-day windows that have not expired. Missing-date simple
windows retain the owner's existing next-business-day rule. A statement of
non-delivery alone does not invent a delivery date or promise carrier acceptance.

For a verified non-delivery complaint the exact authorized Chatby text is:

> Hola, no se preocupe y reportamos a la empresa de transporte para que le realicen la entrega. Un saludo

After provider-verified message readback, the worker submits PROVIDE_SOLUTION
with a note saying the customer wants the order and preserving applicable day,
window and literal time restrictions. It verifies identity, resolved state,
SOLUTION_PROVIDED, the exact persisted note and a fresh change timestamp. HTTP
200 alone is insufficient. The existing Dropea API contract for this action
does not accept an attachment; the separately retained RETRY UI path captures
and uploads actual customer evidence whenever that form requires it. Never
claim a private screenshot was attached to an API note when it was not.

Payment/discount dependencies, competing preferences, incomplete instructions
and expired dates instead produce a targeted clarification at most once per
incident. Agency/address requests stay with their existing owner. Cancellation
or return language blocks recovery, including earlier same-incident requests
outside the short reply cluster. Unknown/silent/stale/identity-conflicting cases
cannot produce a transport solution. No discount acceptance is interpreted as
permission to ignore the unverified financial-discount contract.

Identity is rechecked before actions using a forced fresh subscriber index.
The existing merchandise-ledger fallback is accepted only after matching the
exact order, conversation, sent timestamp, outgoing WAMID and live transcript.
A cache association label or matching phone alone is insufficient.

The one-hour settling window, 24-hour customer-text window, later-message
checks, prior-return guard and durable Supabase ledger are mandatory. Message
keys are `incident_delivery_ack_v1:<issue>` and
`incident_delivery_clarify_v1:<issue>`. Transport solutions use the same
`incident_resolution_v1:<issue>` claim as the existing retry worker. No existing
claim is deleted/reclaimed to force execution. Journal before every POST;
read back ambiguous outcomes and never repeat a mutation. An inflight solution
is reconciled before another new solution is admitted. Private journals/proofs
and customer text remain outside Git.

Activation uses additional fields in the existing private `retry-control.json`:
`deliveryReplyMode` defaults to no writes; `AUTO_CANARY` with
`deliveryReplyCanaryOrderId` admits only the selected natural case, then promotes
to `AUTO` only after its message (if required) and exact solution are verified.
The existing `mode` must also be AUTO/AUTO_CANARY. Setting
`deliveryReplyMode=OBSERVE_ONLY` rolls back this phase without disabling existing
incident workers. No service or API flag enables Meta writes.

The scoped provider credential loader can also load the existing issue-action
configuration and its referenced secret from protected server storage. JWT
scope/expiry checks remain in the existing issue-action client. Neither tokens
nor environment values are copied into source, CLI arguments or logs.

Private evidence: `delivery-reply-audit.jsonl`, `delivery-reply-inflight.json`
and `delivery-reply-report.json`; the sanitized decision/result projection is
also stored in `app_state:vps_incident_delivery_replies_v1`. Provider resolution
is distinct from final delivery: require later carrier/order outcome evidence.
No matching message or screenshot is fabricated, and no unit test proves the
real transport or WhatsApp message path.

Validation includes synthetic-context tests, wrong identity, chronology,
settling/expiry, cancellation/agency/address/payment precedence, exact message
idempotency/readback, shared claims, journal-before-write, one uncertain POST
and exact provider-note verification, plus existing incident/retry regressions.
