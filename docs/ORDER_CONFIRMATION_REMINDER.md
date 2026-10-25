# Order confirmation reminder, two hours after purchase

This is an additive message lane. It never confirms, cancels, discounts, changes
an address, edits a Chatby flow, or writes a different template's delivery row.
The existing initial/prepared/incident senders and timers remain owners of their
current work. The Render implementation derives from actual live d175378, not
the historical worker tree in the VPS panel branch.

## Verified template and ownership

Chatby catalogue, 25 October 2026 15:54 UTC: exactly one approved UTILITY template
`dropea_pedido_reminder_v1`, locale `es_ES`, Chatby1472493 / Meta1344752647520812.
Four BODY parameters, in order: COD amount, address, city, postcode. The existing
two quick replies keep their exact callback routes. Runtime verifies approval,
IDs, semantic component hash and callback hash before each assigning attempt.
Examples from the catalogue are excluded from fixtures and semantic hashing;
they are not message content or customer/order evidence.

Semantic components SHA256:
`aedc6d5323134e060b06332a0ce67e47dacad3c53efb2f0f2c636347d1f165fc`.
Callback SHA256:
`a1747e6a5ddee303e8ef3de475ce56d65a1f4a0cc8853b9c5ee6dd4fc457d8c9`.
Original complete catalogue-component digest, including its examples:
`6a0c5ac01aed86df99cec9f9a750b9e778993bf3241ec7e600f0faebec7f43d8`.

The API exposes the names of Confirmaciones Reminder1/2, not their enabled
conditions. The owner explicitly confirmed both native reminders are disabled
in reply4148e11e4f95437484f4628f28a6172e. No native flow was edited. Exclusive new
owner: `ORDER_CONFIRMATION_REMINDER_OWNER=render_order_reminder`. Its attestation
is independent of all existing ownership flags. Generic sendWhatsappTemplate
rejects this exact new template; only the dedicated sender can dispatch it.

## Eligibility and evidence

Canonical identity is `dropea:<verified-store-id>:<numeric-order-id>`. The anchor
is the fresh provider's external purchase timestamp, or provider created_at only
when no external purchase timestamp exists. Local ingestion, update and initial
delivery times are never substituted. Zone-less/invalid/future clocks block.
Internal timestamps are UTC; reporting uses Europe/Madrid, including DST.

Only exact current ES COD pending orders can qualify. Active issues are read
with the existing read-only V2 client, bounded to300 pending issues and no retry
loop. Address/missing-data/import-recovery markers block; Shopify-only records
without a canonical Dropea order are excluded. No address resolver/geocoder runs.
Each order is freshly re-read; read failures and incomplete coverage block.

The current subscriber must have an unambiguous exact order field, exact full
recipient and conversation. There is no phone-only lookup, synthetic order-field
injection, contact creation, field/tag update or fallback. The initial ledger's
exact order/conversation, accepted WAMID and timestamp must match the actual
provider initial-template message after the canonical purchase. A local sent
flag alone never qualifies.

Chat history is bounded from purchase, then activity is scoped after the verified
initial message. Every valid inbound blocks, including buttons, audio, ambiguous
text and `hola`; intent is irrelevant. Same-second input blocks conservatively.
Missing timestamps/direction, wrong thread or saturated pagination never prove
silence. Initial and reminder messages must use their exact provider names.

## Persistence and sending

The existing Supabase table's primary key supplies database uniqueness. The new
logical delivery ledger has its own fenced namespace:

`ORDER_REMINDER:<canonical_order_id>:dropea_pedido_reminder_v1`

All writes require that key and exact reminder template; updates also require
the owning claim UUID and permitted state. No new row is created in the initial,
prepared, incident or discount logical ledgers. SHADOW and replay never reserve
a send. Runtime status uses only its own app_state key
`order_confirmation_reminder_v1`; it does not write the global runtime_state.

After a persistent claim, re-verify the catalogue before actually re-reading the
order/conversation. A slow catalogue cannot consume the final conversation
freshness window; old evidence is never relabeled or given a longer limit.
Persist SENDING
before the single shared-queue POST. The transport checks owner, flags, canary
scope, claim, recipient, exact parameters and ten-second freshness again after
waiting for the queue. It never retries the POST. Only a proven pre-dispatch
failure with no send start can be reclaimed by a conditional update.

Timeouts, crashes after SENDING and uncertain ledger outcomes stay SEND_UNKNOWN
or retained SENDING. Subsequent cycles only reconcile. Verification requires one
accepted WAMID, exact thread/recipient/order, correct template and full rendered
body hash in provider history. No heuristic retry or alternative template exists.
The receipt keeps required timestamps, flags, claim, provider ID and outcome;
addresses and conversation text are not copied into repository evidence.

## Scheduler, rollout and observability

The existing five-minute background poll tick registers
`ORDER_CONFIRMATION_REMINDER_SCAN` as an independent named job in the shared
serialized/coalescing queue. It does not wait for the long background order
workflow to finish before registering, avoiding a startup tail behind every
other queued workflow. No new interval/global order poller is created and no
existing timer/deadline is reset. Existing jobs retain their mutual order.
The first f25604c natural SHADOW completed17:21:29UTC with2/17 candidates
evaluated,2eligible,0sends/claims and single sender verified; its16-minute
startup wait prompted this scheduling-only correction. Production latency of
the final registration still requires natural observation. Queries use canonical JSON purchase fields, current
pending state, bounded lookback tied to the actual cancellation policy (48h at
audit), at most300 candidate rows. Two candidates per natural job rotate fairly;
an explicit canary is prioritized. Backlog coverage is shown, not hidden.

1. ORDER_REMINDER_ENABLED=true, ORDER_REMINDER_REAL_SENDS=false, canary off.
2. Read-only replay, then natural SHADOW; no customer test messages or fake orders.
3. Explicit ORDER_REMINDER_CANARY_ENABLED=true and one naturally eligible order.
   General REAL_SENDS remains false. Re-read and verify the sole canary.
4. Only a durable verified canary for the same content and owner can unlock LIVE.
5. Observe three consecutive natural cycles, recording verified/unknown/dedupe
   outcomes. Never manufacture a cycle or a customer action to obtain evidence.

The private status endpoint accepts existing dashboard authentication or a
configured existing cron bearer. No new credential or authentication mechanism
is introduced. The Operations API reuses its existing authenticated Render
client, projects only contact-free counts/mode/coverage and performs GET only.
Automation has a separate REMINDER PEDIDO · 2H card, no send controls. Missing or
stale readings remain labeled; unknown sends are not counted as verified sends.

Initial read-only replay completed16:39UTC:63 recent canonical orders,14 eligible,
31 recorded confirmations before two hours,39 with post-initial input,21 without
such input in verified histories,60 verified initials;0 sends/claims/status writes.
These counts overlap and are observations over a moving cohort, not frozen truth.
The earlier broad non-pending block included terminal orders; do not describe all
46 non-pending cases as confirmations. Later runtime classification distinguishes
confirmed/fulfilment states from cancelled/rejected/error states.

## Stop and rollback

Stop this lane by disabling its own ENABLED/REAL_SENDS/CANARY flags. Preserve its
delivery keys, provider IDs, SENDING/UNKNOWN claims and canary audit. Do not delete
claims, clear initial/prepared ledgers or restore historical order/timer state.
Application rollback uses the captured actual preceding Render/VPS revisions and
retains the current live Meta policies and unrelated service configuration.
No production rollback has been exercised merely to claim verification.

Official provider read/send contract: [Chatby Automation API](https://app.chatby.io/api).

## Canary pre-dispatch hold during rollout

At17:39:40UTC the first natural f25604c canary scan correctly retained
ES1484550 as PRE_SEND_BLOCKED / REMINDER_FRESH_READ_EXPIRED with
send_started_at=null. No assigning POST was started, no message was observed
and its initial-template ledger hash remained identical to the17:13baseline.
The shared catalogue wait occurred after the final conversation read. The
correction moves that catalogue read before a real new conversation read;
the ten-second guard and final order check remain unchanged. An inbound
arriving during the catalogue wait still blocks, and an old returned timestamp
still fails. Full corrected regression671/671 passes,0fail/0skip,65files, archive
a76a7a2b27e93b3a2b02c5edd1f375c8f5cb54a1bffa81205e555d853610c9f8.
Only a fenced PRE_SEND_BLOCKED row with no send start can be reclaimed.
No blind retry, alternative template or general LIVE activation is authorized
by this technical hold. Continue the original owner-authorized rollout only
after a naturally eligible canary is actually verified.
