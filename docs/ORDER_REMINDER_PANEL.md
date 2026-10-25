# Isolated two-hour reminder card

PR153 adds a separate `REMINDER PEDIDO · 2H` card to Automation. The API reuses
its existing FinanceReportClient authenticated Render session for one GET to
`/api/order-reminder/status`; the Operations route retains existing OAuth. No
new secret, sender, scheduler, database migration or action button is introduced.

The card reports actual SHADOW/CANARY/LIVE mode, last natural cycle, unique
per-day verified sends and observed outcome counters, bounded queue coverage
and retained unknown sends. Missing/unreadable/stale evidence stays explicit;
no missing metric becomes a fictional zero. Intent, addresses and conversation
text do not cross this read boundary.

Runtime79a2746 was deployed25October17:08:46UTC over the actual51f15ed API and
static release. Only server routing, the new reader and automation-panel.js
changed.385 application files and48 static files matched the captured base plus
these three exact tested files. Bot PID/release/env/token/admins, all other API
environment, finance rates, import/address observers and unrelated containers
were retained. Public panel/asset200/no-store; new and old private data routes
401 anonymously; the real existing authenticated Render client read succeeded.

Full isolated Node22/PG17 regression:1419/1419 pass,0fail/0skip,150files. One
unchanged order benchmark failed on the initial run; identical-source retry
passed without changing the order code, test or threshold. This is regression
evidence, not a production performance claim. All three deployed file hashes
match that archive.

Root-only predecessor state and guarded application/static rollback are at
`/root/suleia-order-reminder-panel-deploy/79a2746/`. The deployment script shares
the existing deploy lock, refuses financial windows/in-flight/unknown work,
restarts API/static only and preserves every preceding Compose file. Rollback
refuses a superseding release/environment; it restores code only, never ledger,
customer state, timers, policy or flags. Rollback is prepared, not exercised.

Worker rollout in PR152 is now LIVE_VERIFIED. The final independent audit
verified 8 actual reminders exactly once with correct order, recipient, body and
parameters; zero unresolved attempts. Three consecutive natural cycles from the
current worker process are recorded in its ORDER_REMINDER_DEPLOYMENT.json. The
actual existing authenticated card reader returns LIVE/FRESH. No browser was used
for this verification; source/asset, DOM tests, API and authenticated machine
reads provide the evidence. See ORDER_REMINDER_PANEL_DEPLOYMENT.json for the
final preservation and access checks.
