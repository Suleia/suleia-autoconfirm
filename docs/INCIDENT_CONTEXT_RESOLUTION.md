# Contextual incident delivery resolution

The existing VPS delivery-reply worker combines a customer's delivery schedule
with contact instructions, preserving both in its evidence and provider note.
A request to call before arrival is parsed separately from the time window.
It does not turn a conditional request, a replacement telephone number, an
address change or a request for agency collection into home delivery.

Payment questions retain the requested day/window and verified order amount.
Payday is not confirmation that cash is available. Day-only dates are proposed
for clarification within the message's calendar month only when unambiguous;
there is no invented rollover to another month. A recent courtesy response
keeps the original substantive request, while the existing one-hour settling
guard also waits for the latest input. The 24-hour free-text window is measured
from the latest customer input; expired dates and later cancellations still
block the old request. Agency requests identify carrier availability as the
missing evidence instead of asking for an unrelated delivery schedule.

An abandoned preparation can advance the SAME shared issue reservation only
when the original retry audit explicitly reports FAILED_PRE_SAVE and the
completed original cycle independently records saveAttempted=false. The owner,
order, issue, previous attempt, date and window must match; any live journal,
unknown write or conflicting later audit blocks recovery. A conditional update
fences the original key/status/owner/timestamp, so only one contender succeeds.
The original preparation proof remains in the receipt. It is never a general
release of old reservations. Fresh customer/provider revalidation, prior-return
guards and the normal persistent pre-write journal remain mandatory.

There is no new scheduler, sender, model connection, template or external
decision service. Support-discount receipts, address/return owners, order
confirmations, imports and budget automations are unchanged. A provider-verified
solution means the delivery instruction was saved, not that physical delivery
or collection has already occurred.
