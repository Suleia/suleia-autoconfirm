# Hourly autonomous incident reviews

The owner requested hourly reviews on26October2026. The existing dedicated VPS
worker now runs once at startup and then every60minutes, including nights and
weekends. No second cron, sender or Codex heartbeat is created; the old desktop
retry monitor remains paused. The notification controller keeps its separate
existing delivery-observation schedule.

The cadence change is in `schedule.mjs`. Its busy guard still prevents
overlapping runs. The25minute watchdog stays unchanged; readiness freshness is
derived from the interval plus that watchdog and5minutes of grace, now90minutes.
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

Real verification case ES1478167 / issue1373299 was already resolved by this
worker before the current request: provider SOLUTION_PROVIDED at26October18:08UTC,
verified ledger and independently persisted-detail evidence match28October2026
afternoon and the customer's exact16:00–19:00 preference. Do not submit it again
or confuse a saved delivery instruction with physical delivery.

Deploy only on the current worker image, after an idle cycle and with no pending
write/reconciliation journal. Preserve control files, credentials, profiles,
mounts and all claims/evidence. Verify the exact tested schedule bytes and live
health interval/next-run time. Rollback is code-only while idle; never restore
business state. New replies remain subject to all existing current-order,
settling, cancellation, availability and independent-result checks.
