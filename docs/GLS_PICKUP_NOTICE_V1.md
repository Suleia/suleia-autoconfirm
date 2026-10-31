# GLS pickup notice 1

Owner authorization: dedicated 31 October 2026 request. This capability runs
as a bounded final stage of the existing 30-minute VPS incident worker. It
does not create a service, scheduler, global sender, interpreter or logistics
writer. Only the new `suleia_gls_recogida_aviso_1_v1` template is owned here.

The owner's final inline body takes precedence over the attachment's older
mapping: 1 name, 2 order, 3 products/quantities, 4 verified pending COD,
5 agency, 6 agency address, 7 agency locality, 8 opening hours, 9 agency phone,
10 exact tracking link. Chatby keys are `BODY_{{1}}` through `BODY_{{10}}`.
The agency details appear first in the visible message. The exact submitted
body and representative non-customer examples are in `gls-pickup-template.mjs`.
No wording, renumbering, other templates or flows were changed.

Template administration uses the documented Chatby `/whatsapp-template/create`
and `/whatsapp-template/list` operations. A private exclusive-create journal
was written before the sole creation request. Its file and the real IDs stay
in the existing private state volume. Future invocations list/reconcile only;
an unknown create response never authorizes another creation. Worker cycles
require exact APPROVED es_ES UTILITY content and both real provider IDs.

Official directory entry:
https://gls-group.com/ES/es/buscador-codigos-postales/

Its actual public iframe is
https://www.gls-spain.es/es/iframe-buscador-codigos-postales-cloned/
and its observed HTML form POSTs `postalcode` back to that page. The module
checks the official entry point still links this form, then submits the real
public form. It parses only the Agencia GLS result and its explicit labelled
fields. A changed schema/challenge/429 fails closed, without private APIs,
generated signatures, authentication bypass or a second browser.

Directory cache: ES + current shipment postal code + agency code, at most
24 hours; a changed agency invalidates old entries. Concurrent postal lookups
are coalesced. Directory data never proves shipment availability.

Tracking reads use one ephemeral page in the existing dedicated browser
context. Only the exact current native `mygls.gls-spain.es/e/.../.../es` URL
is accepted. No pickup request/action is clicked. Physical availability,
agency identity, stable ready-event identity and pending COD must be directly
verifiable. Unknown/changed provider UI cannot unlock sending. Private
diagnostics stay on the VPS. No undocumented HMAC tracking API is used here.
The explicit `allowVerifiedTrackingFallback` policy permits a directory outage
fallback only when that exact fresh tracking UI supplies the complete agency,
hours, direct phone, READY event identity and COD. A directory/tracking conflict
cannot use fallback. Provider Retry-After deadlines persist in the existing
private cache and prevent new GLS requests until they expire.
GLS publishes 910806229 as a general/central contact; it is never accepted as
a verified direct agency phone. Real written hours such as “De 9 a 14 y de
16 a 19” are preserved. Missing hours or direct contact block that case.
Only necessary Cookiebot consent and Flutter's accessibility activation may
be clicked. Pickup/redelivery actions are never clicked. The existing typed
read-only probe queue can inspect one exact active GLS order/issue, with a
short-lived request, no arbitrary URL and no customer/logistics writes.

Eligibility requires exact canonical `PICKUP_AT_AGENCY`, active native issue,
same shipment/current destination, READY tracking, matching agency, current
COD and amount reconciliation, exact subscribed Chatby identity/order,
existing V3 compilation and no incompatible current instruction. Accepted
discounts need the existing owner's verified final-amount receipt AND a fresh
matching native total/logistics COD; email/solution alone is insufficient.
The existing exact-order discount-offer ledger is also re-read before sending.
An offer from an older administrative issue without a reconciled owner receipt
blocks the quote conservatively, even if the current V3 conversation anchor
does not contain that offer. This does not apply or repeat a discount.

Each episode reserves `GLS_PICKUP_NOTICE_1:<order>:<tracking>:<ready-event>`
in the existing durable template ledger. Administrative issue IDs are absent
from this key. Before the sole message POST the existing serialized Chatby
queue re-reads exact native data, subscriber, complete transcript, approval
and public tracking. A changed conversation blocks the POST. An interrupted
claim, timeout or uncertain outcome is history reconciliation only. Even a
proven zero-POST claim remains reserved for review; it is never blindly reset.

Control is an isolated `glsPickupNotice` object in existing retry-control:
`enabled`, `mode` SHADOW/CANARY/LIVE and authorization reference
`OWNER-2026-10-31-GLS-PICKUP-1`. A pinned durable first canary must have exact
recipient/content/time/WAMID history readback before effective LIVE. Pending
approval and missing logistics evidence do not relax this gate. Notices 2–4
are disabled schema entries only, without templates or deadlines.

Report: private `/state/gls-pickup-report.json`, mirrored to app_state key
`gls_pickup_notice_v1`. Counters are observations/actions in the current cycle,
not lifetime sales or messages read. Provider acceptance, verified history,
customer replies and physical collection are separate concepts. Customer Care
receives read-only evidence through the existing incident metadata; its
interpretation and confirmation/return/discount/action owners are untouched.

Rollback: disable only `glsPickupNotice.enabled`, preserving all other keys.
Keep all claims, template IDs/submission journal and sent/unknown receipts.
For code rollback restore the backed-up actual image/container and prior
read-only projection/static assets. Do not delete the template, reset claims,
resend a canary, copy desktop sessions or replace the whole control file with
an old unrelated configuration. Production deployment receipts must name the
tested source/image and preserve environment, mounts and security settings.
