# Second-absence return after an unanswered discount

The incident cycle previously sent second-absence recovery offers but routed only recipient rejections into the discount return executor. Second absences therefore remained pending after an unanswered offer.

`ABSENT_DISCOUNT_RETURN_AUTOMATIC_ENABLED=true` enables the new lane. It is disabled by default; the existing exact-incident allowlist can authorize a single case. The existing real-return switch and persistent claim remain required.

Eligibility requires an active, pending, exact-order second absence, exact Chatby association, a verified discount sent after both order and issue creation, and 24 elapsed hours with no later customer action. Any text, button, audio, unknown timestamp, or simultaneous customer interaction blocks this silence policy. Responses remain in their existing resolution flow. Recipient-rejection and address deadlines are unchanged.

The executor rereads the issue and conversation, claims the durable return record, then rereads both again before a single idempotent provider request. Changed order state, identity, phone, allowed actions, offer or customer activity aborts execution. Ambiguous outcomes are not blindly retried. A return is verified only by an independent read of the exact issue with `RESOLVED / RETURN_REQUESTED`; this is a request, not proof the parcel has physically returned.

Validation: 265 workflow and Dropea V2 tests passed, including 24-hour boundary, old-order offer, first absence, customer activity, late changes after claim and duplicate prevention. An owner-authorized production canary on 2026-10-04 reached independently verified RETURN_REQUESTED and was recorded in the persistent action ledger. No customer data is stored in this document.

Rollback: set `ABSENT_DISCOUNT_RETURN_AUTOMATIC_ENABLED=false`. This stops new automatic second-absence returns; it does not undo an already submitted logistics request. Native absent notifications and discount offers retain their existing owners.
