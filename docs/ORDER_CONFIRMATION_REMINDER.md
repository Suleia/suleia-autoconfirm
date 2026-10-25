# Order confirmation reminder · two hours after purchase

An isolated additional message for a real, still-pending order. It never confirms,
cancels, discounts, changes addresses or edits Chatby flows, fields or tags. The
initial, prepared and incident senders retain their existing owners and timers.

## Verified contract and sender

The Chatby catalogue was read on 25 October 2026 at 15:54 UTC. Exactly one
`dropea_pedido_reminder_v1` / `es_ES` is APPROVED, category UTILITY, Chatby ID
1472493 and Meta ID1344752647520812. Its four BODY parameters are, in order:
COD amount, street/address line2, city and postcode. The existing quick-reply
routes remain unchanged. Runtime rechecks approval, IDs, components and routes.

Semantic component SHA256:
`aedc6d5323134e060b06332a0ce67e47dacad3c53efb2f0f2c636347d1f165fc`.
Callback SHA256:
`a1747e6a5ddee303e8ef3de475ce56d65a1f4a0cc8853b9c5ee6dd4fc457d8c9`.
Provider examples are excluded from semantic hashing and repository fixtures.

The owner explicitly confirmed native Confirmaciones Reminder1/2 are disabled
(reply4148e11e4f95437484f4628f28a6172e); their API exposes names, not conditions.
No native flow was changed. The sole new owner is
`ORDER_CONFIRMATION_REMINDER_OWNER=render_order_reminder`. The generic sender
rejects this exact template; only the dedicated reminder sender can dispatch it.

## Eligibility

The canonical identity is `dropea:<verified-store-id>:<numeric-order-id>`.
Due time is canonical purchase +2hours: fresh provider external_created_at, or
provider created_at only when the external purchase timestamp is absent.
Invalid, future or zone-less clocks block. Ingestion, update, poll and initial
message times are never substituted. UTC is internal; reports use Europe/Madrid.

Every send requires all of the following:

- The exact current ES COD order remains PENDING in fresh provider/local reads,
  with no confirmed_at or active incident/address/missing-data/import workflow.
- The verified initial `dropea_pedido_nuevo_v1` ledger belongs to this order and
  conversation; its accepted WAMID and timestamp match the actual provider initial
  message after purchase. A local sent flag alone cannot qualify.
- The subscriber has an unambiguous current order field, exact full phone and
  conversation. There is no phone-only fallback, synthetic binding or contact edit.
- Complete provider history proves no valid inbound after the verified initial.
  Every button, text, audio, question or ambiguous input blocks, regardless of
  intent. Same-second input blocks conservatively; older input does not.
- No prior reminder or unresolved assigning attempt exists for this order.
- All four parameters come from this exact fresh order, including current amount,
  address, city and five-digit postcode. No geocoder/address resolver is called.

Incomplete reads, unknown directions/timestamps, conflicting fields and uncertain
coverage block sending. Confirmation, cancellation and fulfilment states block.

## Dispatch, uniqueness and uncertainty

The existing database primary key supplies uniqueness for the fenced namespace:

`ORDER_REMINDER:<canonical_order_id>:dropea_pedido_reminder_v1`

Writes require that key, exact template and claim UUID. Only this logical ledger
and `app_state.order_confirmation_reminder_v1` are written. Initial, prepared,
incident, discount, global runtime state and order/timer records are untouched.

The sender reserves one bounded30second slot in the existing paced Chatby HTTP
queue. It re-reads the approved catalogue, subscriber/history and supplier/local
order before the sole assigning POST. Conversation freshness remains10seconds;
POST timeout remains12seconds. Old evidence is never relabeled. All nested HTTP
calls retain shared pacing/cooldown; other callers keep their original branch.

Pending-incident coverage is bounded to300 records/3pages. Evidence is reused
for less than120seconds and renewed in the final guard if a queue wait aged it.
An incomplete/failed renewal blocks; a newly observed incident prevents dispatch.

SENDING is persisted before POST. A proven pre-POST failure with null send start
can be reclaimed by a conditional update. A timeout, lost receipt or crash after
start remains SEND_UNKNOWN/SENDING: later cycles only reconcile provider history,
never blindly resend. At most20 exact same-store existing reservations are retained
for reconciliation even after orders leave pending; those entries cannot send.

Verification requires one accepted WAMID, exact order/thread/recipient, approved
template, full rendered-body hash and unique history message. Chatby API output
uses `agent`, native output uses `out`; only those outbound types qualify.
Receipts retain the required clocks, checks, claim, provider ID, status and reason.
No customer conversation, phone or address is copied into repository evidence.

## Natural scheduler and panel

The same existing5minute tick invokes `ORDER_CONFIRMATION_REMINDER_SCAN` in one
independent coalesced job lane using the existing scheduler primitive. An unrelated
long workflow cannot stall reminder scheduling. No new interval/global poller is
created; existing jobs, their mutual order and their deadlines remain unchanged.
There is still only one shared Chatby HTTP queue and one reminder sender.

Candidate reads use canonical purchase timestamps, pending state and the actual
cancellation lookback:48hours in this deployment, maximum72hours. At most300
recent rows are read; two candidates rotate per natural job. Exact terminal
reminder keys are excluded before batching. Coverage is reported explicitly;
this is not a guarantee that every due order is dispatched at precisely2hours.

Daily counters use unique observed order IDs and Madrid dates. Eligible/successful
observations survive deduplication; rollover never clears delivery keys. Unknown
attempts remain visible across subsequent held/reconciliation cycles.

Automation displays a separate **REMINDER PEDIDO · 2H** card. Its read-only API
reuses existing authenticated Render access and Operations OAuth. Only whitelisted
mode, freshness, counts, coverage and canary metadata cross that boundary. Missing
or stale readings are labeled explicitly; there are no send/action buttons.

## Rollout and evidence

The owner-authorized sequence is SHADOW → read-only replay → one naturally
eligible real canary → verified readback → LIVE → three natural consecutive cycles.
No fake orders, test customer messages or forced cycles are used.

The original read-only replay evaluated63 recent canonical orders with14 eligible,
31 recorded confirmations before2hours,39 post-initial inputs,21 verified silent
histories and60 verified initials;0sends/claims/status writes. Counts overlap and
represent a moving snapshot. See [replay receipt](ORDER_REMINDER_REPLAY.json).

The genuine canary produced one message18:22:03UTC. The original verifier held
uncertainty because the provider labeled it `agent`; it did not resend. Independent
provider reads verified the exact body/recipient/thread/parameters. At18:33:47UTC,
a send-disabled, claim-disabled metadata reconciliation marked the existing row
VERIFIED. It used natural:false and preserved the four genuine cycle entries.
LIVE was enabled only after that durable, independently checked proof.

Current runtime, exact test archives, natural cycles, final message checks,
preservation checks and captured predecessors are recorded in
[deployment evidence](ORDER_REMINDER_DEPLOYMENT.json). Worker code derives from
the actual live d175378 baseline, not the older worker tree in the panel branch.

## Stop and rollback

Disable only ORDER_REMINDER_ENABLED, ORDER_REMINDER_REAL_SENDS and
ORDER_REMINDER_CANARY_ENABLED to stop this lane. Preserve its delivery keys,
provider IDs, claims, uncertainty and canary audit. Never clear a claim or another
template ledger to force a send.

Guarded application rollback uses the captured actual Render predecessor and
matching unchanged-source address regression gates. VPS API/static rollback uses
its separately captured predecessor and existing deploy lock. Both refuse a
superseding release/configuration. Restore code only; never restore historical
customer/order/financial/timer state. Encrypted configuration backups stay in
trusted local storage. Rollback is prepared, not exercised as a test.

Provider contract: [Chatby Automation API](https://app.chatby.io/api).
