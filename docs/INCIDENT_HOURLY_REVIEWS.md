# Hourly autonomous incident reviews

The owner requested hourly reviews on 26 October 2026. The existing dedicated VPS
worker now runs once at startup and then every 60 minutes, including nights and
weekends. No second cron, sender or Codex heartbeat is created; the old desktop
retry monitor remains paused. The notification controller keeps its separate
existing delivery-observation schedule.

The cadence change is in `schedule.mjs`. Its busy guard still prevents
overlapping runs. The 25 minute watchdog stays unchanged; readiness freshness is
derived from the interval plus that watchdog and 5 minutes of grace, now 90 minutes.
An overdue or failed cycle, absent session or uncertain write still fails closed.
No customer intent, price, confirmation, discount, return, retry, idempotency or
provider policy changes accompany the cadence adjustment.

The first restart exposed a blank dedicated Chatby account view. The existing
idle session probe now waits for its visible search control, reloads that same
account view at most once if absent, and checks the control again. It never
logs in, reads credentials, touches the composer or navigates another account.
A URL containing the account id alone no longer counts as an authenticated
Chatby view. A persistent blank page, login redirect or wrong account fails
closed. The live status and capture checks retain their separate checks.

Real verification case ES1478167 / issue 1373299 was already resolved by this
worker before the current request: provider SOLUTION_PROVIDED at 26 October 18:08 UTC,
verified ledger and independently persisted-detail evidence match 28 October 2026
afternoon and the customer's exact 16:00–19:00 preference. Do not submit it again
or confuse a saved delivery instruction with physical delivery.

Deploy only on the current worker image, after an idle cycle and with no pending
write/reconciliation journal. Preserve control files, credentials, profiles,
mounts and all claims/evidence. Verify the exact tested schedule bytes and live
health interval/next-run time. Rollback is code-only while idle; never restore
business state. New replies remain subject to all existing current-order,
settling, cancellation, availability and independent-result checks.

Production verification at 26 October 19:36 UTC: image `34fb85d`, both sessions
valid, AUTO/READY, first fresh cycle completed without errors or new writes.
Next run 20:34:58 UTC. Source regression: 408/408; exact-image regression:
210/210 (overlapping groups). See `INCIDENT_HOURLY_DEPLOYMENT_20261026.json`
for the sanitized receipt and guarded idle rollback path.
