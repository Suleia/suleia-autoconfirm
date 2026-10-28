# Verified API/manual initial templates and the two-hour reminder

The reminder must accept a provider initial message marked `agent` as well as
`out`, provided all existing exact receipt checks succeed. Chatby returns native
automation output as `out` and approved API/manual output as `agent`. The reminder
readback verifier already supports those two outbound representations.

Previously `initialProof()` accepted only `out`. A valid, explicitly authorized
manual initial delivery was therefore repeatedly classified as
`INITIAL_TEMPLATE_NOT_VERIFIED`, even with a matching accepted WAMID and durable
sent receipt. The confirmed affected case is ES1488064: a fresh 28 October check
found a pending order, one exact initial message from 27 October, complete history,
no later inbound, and matching recipient, conversation, order and timestamp.

## Narrow change

Only the direction discriminator in reminder initial-proof validation changes.
The following gates remain mandatory and unchanged:

- Exactly one provider history message matching the ledger's accepted WAMID.
- Exact initial template, current order, ledger conversation and subscriber.
- Matching ledger/provider send timestamp, at or after canonical purchase.
- Current pending order, complete readable history, exact recipient/order field.
- No customer input, active incident, address/import recovery or prior reminder.
- Existing dedicated sender, durable reminder claim and final fresh preflight.

Inbound, notes, system entries, unknown directions, wrong templates/identities,
missing or duplicate WAMIDs and timestamp mismatches still block. This change does
not send or resend initial templates, modify any template/flow, change owners,
introduce another sender, alter confirmation/cancellation, or reset timers.

The existing natural job remains the only executor. A still-eligible real order
can receive its single reminder after deployment, with the existing readback.
No test reminder is sent to a customer and no delivery claim is cleared.

## Validation

New regression cases cover valid agent initials; rejected WAMID/template/clock/
order/conversation/duplicate evidence; invalid directions; later inbound input;
and exactly one reminder claim without modifying the initial receipt/order.
The three new positive scenarios reproduce the defect before the correction.

Full existing worker regression: **721 passed, 0 failed, 0 skipped, 67 files**,
in a read-only Docker container with network disabled and no production
credentials. Test source archive SHA256:
`8c4636f861a1639da860cc01a55046db30b6f2a2699e02d0dcd04345326db525`.
The actual production base is `82967745f073c028bca46478da9e18c08909ba13`.

Current bounded candidate audit found one affected pending order. The other
candidate was already cancelled upstream and had customer input, so remains
blocked. The worker had already verified four other reminders on 28 October;
this was a compatibility gap, not an inactive global sender.

## Production verification

The owner explicitly approved PR #171 / runtime `7658c56`. The guarded code-only
deployment `dep-dbh14i942hec73e709vg` is live and healthy. All non-revision Render
environment values match the captured baseline; only the four unchanged-source
address safety gates follow the tested revision. Sender/owners and the existing
one-hour confirmation / 48-hour cancellation policies are preserved.

The existing natural scanner sent **one** `es_ES dropea_pedido_reminder_v1` to
ES1488064 on **28 October 2026 at 15:21:42 UTC / 16:21:42 Europe/Madrid**. The
independent provider-history read verifies the accepted WAMID, exact recipient/
conversation, full rendered body and current order parameters. The initial proof
remains valid; its original ledger and all order business-data hashes are intact.

Three consecutive natural cycles on the actual new runtime completed at
15:22:10.524, 15:25:11.409 and 15:29:49.641 UTC, with respectively **1 / 0 / 0**
message writes and zero unknown sends. The terminal reminder key removes the order
before later batching. A second independent history read at 15:30:55 UTC still
finds exactly one reminder. No manual reminder sender or forced scan was used.

All **23** Chatby template catalogue entries retain the same semantic hash; no
template/flow/contact fields were edited. The other current candidate remains
cancelled and correctly held. The worker reports five verified reminders that
day, including four that had already been sent before this repair.

See [deployment receipt](ORDER_REMINDER_AGENT_INITIAL_DEPLOYMENT.json). Runtime
remains `7658c56`; later documentation-only commits are not a new deployment.
Guarded rollback restores only the application predecessor `8296774` and its four
safety revision gates, refusing a superseding release/configuration. Never restore
historical order, message, claim, financial or timer data.
