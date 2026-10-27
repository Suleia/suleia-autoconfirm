# Accepted discounts and incident reviews every 30 minutes

The owner's 27 October 2026 instruction supersedes the hourly cadence. Reuse
the existing dedicated VPS worker: startup and every 30 minutes, with the
overlap guard and 25 minute watchdog. No second sender, cron or Codex heartbeat.
Readiness expires after 60 minutes without a fresh completed cycle.

The support lane rereads the exact order, original verified offer and latest
customer response. Its existing one-hour settling boundary, cancellation,
amount, return, persistent per-order and shared-issue checks remain unchanged.
After settling: genuine Chatby offer/acceptance captures, one support email,
independent body/attachment verification, then one detailed Dropea solution
and provider-operation verification. The standard solution now explicitly
states the original amount, EUR5 reduction, final collectable amount and
customer delivery intent. It requests the new amount, without claiming that
the carrier applied it or delivered the parcel. Old saved plans/receipts stay
unchanged. Failed/waiting cases retain issue identity in contact-free feedback;
failures expose only bounded reasons and the human-review requirement.

## Saved-detail repair

The dedicated Dropea view retained a range ending 26 October and hid a current
27 October issue. Before exact order/issue lookup, clear only the uniquely
observed date-filter control in that authenticated incident view, then verify
the date input is empty and its filter chip disappeared. Angular can retain
the previous URL until the next search is submitted; do not wait for that
navigation before submitting the exact-order search. Missing/ambiguous controls, unrelated
origins/routes and unchanged filters fail closed. Exact issue/order/phone
checks still apply. The read-only probe uses the same repair.

An uncertain existing journal may be preserved byte-for-byte through this
idle code-only release. The new runtime must reconcile it through provider
state and the exact persisted note; it cannot replay the original write.
Rollback is code-only and never restores business state, claims or journals.

## Verified support outcome

The startup cycle of `e5607ac` sent exactly one email for ES1477822 at
27 October 17:34:55 UTC with two genuine Chatby images. Independent mailbox
readback verifies the exact body and both attachment bytes. The support and
shared-issue receipts are verified; the provider operation is completed and
issue1373114 is RESOLVED/SOLUTION_PROVIDED at 17:35:07 UTC. The recorded note
explicitly contains original EUR34.99, EUR5 reduction and collectable EUR29.99.
The fresh order amount is still EUR34.99, so no carrier amount change or
physical delivery is claimed. No historical email/solution was replayed.

The saved solution for ES1485722 / issue1375009 was independently reconciled
at 17:40:52 UTC after the visible-date repair. Its exact persisted-note hash
matches, and the original provider timestamp remains 11:38:18 UTC. The
journal was cleared only after durable verified completion, without a POST.

Final source `3ad9a8f`: 415/415 isolated source regressions and 217/217 exact
image tests passed (overlapping groups, zero failures/skips). At 17:51:50 UTC,
the existing worker was AUTO/READY, both sessions valid and no journal held.
The full cycle completed at 17:44:19 UTC; next trigger 18:08:50 UTC, exactly
30 minutes after its start. All eleven cumulative runtime files and private
configuration checks matched; unrelated containers remained unchanged.
Saved-detail verification at 17:50:58 UTC independently confirms the exact
discount note. The temporary read-only wait for asynchronous history was
restored byte-for-byte before final verification. Sanitized receipt:
`DISCOUNT_HALF_HOUR_DEPLOYMENT_20261027.json`.

## Case boundaries

- ES1459938, ES1457181 and ES1459392 already have email/provider receipts;
  do not resend or rewrite those verified solutions.
- ES1473771 has an explicit carrier reply that its return cannot be stopped.
  Preserve the rejected original operation; never claim recovery.
- ES1477822 accepted EUR34.99 to EUR29.99 at 27 October 16:30:24 UTC.
  The verified send respected the one-hour settling boundary.
- ES1485722 / issue1375009 is verified by persisted-note reconciliation.
  Preserve the original claim and provider timestamp; never replay it.
