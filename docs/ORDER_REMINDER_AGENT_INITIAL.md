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

Deployment/readback evidence is recorded separately after verification. Use a
guarded code-only deployment against the actual base, preserve every existing
ledger and keep all non-revision environment values identical. Roll back only
the application revision and its four unchanged-source safety revision gates;
never restore historical order, message or timer data.
