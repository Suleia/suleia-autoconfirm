# Chatby integration recovery — 2026-08-07

## Scope and safety

The audit used Chatby GET reads and masked VPS data only. It changed no Chatby
template, flow, contact, message, button, order or external system. All customer
and production write switches remained disabled.

## Root cause

Chatby conversations were present for all 18 active incidents. The previous
collector inspected only the `Dropea: Número` subscriber field. That field is
not a stable order identity during incident workflows: for many current cases
it contains a historical incident reference.

The exact current Dropea order id is present in the protected technical fields
`[Dropea] Cod Payload.order_id`, `[Dropea] Issue Payload.order_id` and
`[Dropea] Issue Payload.order.id`. The collector ignored those fields, so 16
real conversations were incorrectly classified as unavailable. Ten of those
references could also be proven through the masked V1 history bridge. The
technical payload proves all 18 directly, including the contacts with more
than one order; phone matching is therefore unnecessary.

## End-to-end status

| Stage | Status | Evidence |
|---|---|---|
| Configuration | WORKING | HTTPS allowlist, read mode enabled, write mode disabled |
| Credential | WORKING | Protected runtime credential accepted; value never emitted |
| Chatby endpoint | WORKING | Official `app.chatby.io` endpoint |
| Subscriber API | WORKING | 898 subscribers, 9/9 pages, complete pagination |
| Message API | WORKING | All 18 linked conversations returned complete message pages |
| VPS polling sync | WORKING | GET-only collector and five-minute reconciliation |
| Technical order identity | WORKING after repair | Exact payload order id now precedes legacy subscriber field |
| `Dropea: Número` alone | STALE | May contain an incident id and is no longer treated as authoritative |
| `conversation_id` | WORKING after repair | Persisted only as HMAC |
| `contact_id` | WORKING after repair | Persisted only as HMAC; never used as order identity |
| `message_id` | WORKING | Stable HMAC and idempotent payload constraint |
| V1/V2 bridge | PARTIAL but non-blocking | Ten historical links independently verified; V2 payload covers all 18 |
| Phone normalization | WORKING as diagnostic only | Never selected as primary identity |
| Templates/buttons/inbound/outbound | WORKING | Sanitized type, time and intent metadata; no raw customer text persisted |
| Timestamps/freshness | WORKING after repair | Separate last customer/Suleia activity, age and freshness |
| Retries | WORKING | Bounded GET retries; mutating methods blocked before transport |
| Render legacy | WORKING | Public health HTTP 200; Chatby configured/ready; no reported error |
| Chatby webhook receiver on VPS | NOT_CONNECTED | Receiver library exists but no public route/runtime subscription is wired |
| Dropea webhook receiver | PARTIAL | Configured separately; no real delivery observed at the prior checkpoint |

The missing Chatby webhook does not remove conversation coverage because the
complete GET polling path is authoritative for this read-only checkpoint. It
remains a separate future delivery-latency improvement.

## Conversation model

Each current incident now records one of `NONE`, `FOUND`, `MULTIPLE`, `STALE`,
`BROKEN` or `UNKNOWN`, together with a reason code and exact identity method.
For a found conversation the model also stores masked technical hashes, last
customer and Suleia activity, last button intent, latest template hash,
whether the customer replied after the current incident, age, freshness and
message count.

`NONE` never means “the customer did not reply”. It means only that no exact
conversation identity was found. Incident interpretation remains `UNKNOWN`
with the precise Chatby reason whenever the source is unavailable.

## Recovery outcome

- Active incidents audited: 18.
- Conversations technically proven: 18.
- Conversations invented or associated by fuzzy matching: 0.
- Phone-primary associations: 0.
- External methods: GET only.
- Actions executed: 0.
- Production writes: 0.
- Messages/templates sent: 0.

Operations Center and the existing eight MCP tools expose the new masked
conversation status, reason, activity, intent, confidence and policy context.
No MCP write tool was added.
