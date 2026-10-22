# Second-absence notification

The old notification controller intentionally excluded every order with any
previous absence notice. This suppressed a new notice when a later, distinct
second absence occurred. The owner explicitly requested that second stage on
2026-10-22; it is separate from the unanswered 24-hour discount offer.

The existing single controller/sender, approved `dropea_ausente_v3`, body,
buttons and native reply destinations remain unchanged. Only that controller
is redeployed. Render and other templates/flows remain unchanged.

`second_absence_notice_authorized=true` in the existing control evidence opens
the new stage under all existing master/owner/freshness/current-order guards.
The exact active issue must be a verified second attempt, distinct from and
created after the first notice. The first durable claim must be independently
VERIFIED and its message/WAMID/time must still match the fresh, complete exact
conversation. A first notice already made for a known second attempt cannot
authorize a third-attempt reminder. Unknown/conflicting current attempt,
customer activity after the current issue, cancellation/pickup/address intent,
existing recovery offer, final delivery, return or uncertain history blocks.

The existing transaction locks the same control row and atomically limits each
order to INITIAL plus SECOND_ABSENCE. The existing issue/template primary key
also prevents repeated same-incident sends. No migration or additional grant
is needed. The second stage rereads Chatby and Dropea after its durable claim
before the single POST; uncertainty never releases the claim.

Independent observation bounds the first receipt at its authorized successor's
claim. A genuine extra notice still trips the duplicate breaker. Stage and
predecessor evidence survive receipt updates. The second receipt starts no new
timer and changes no existing deadline. Discount eligibility/first-v3 clock,
returns, logistics execution and customer confirmation logic are unchanged.

The reported order was already FINISH/DELIVERED when audited. Its original
notice and subsequent customer responses were verified. No late absence message
is appropriate, and no test message is sent to that customer.

Validation: the final Linux/Node 22 artifact passed 273 focused absent,
notification, callback and Chatby read regressions. A separate isolated
PostgreSQL 17 test passed concurrent reservations, uncertain predecessor
blocking, independent verification, no third stage and unchanged initial timer.
The test harness supplies the existing migration fixture; no production
credentials, customer data or provider access enter these tests.

Rollback: disable only `second_absence_notice_authorized` to stop new second
claims while retaining deployed observation and every current claim/receipt.
Before restoring the old image, reconcile any existing second-stage claim: the
old verifier cannot distinguish a legitimate successor from a duplicate. Never
restore old DB state or clear claims to force another message.
