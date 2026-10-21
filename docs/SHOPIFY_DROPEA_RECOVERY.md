# Hourly Shopify to Dropea recovery

Owner authorization: 21 October 2026, recover order #3136 and activate hourly review/recovery of Shopify orders missing from Dropea. This worker only imports missing orders; existing confirmation, cancellation, incident and message policies remain owned by their existing services.

## What it does

The dedicated worker scans every page of open, unfulfilled Shopify orders and checks the exact order reference in Dropea store 16088. Existing references are never created again, including completed or cancelled Dropea orders. Native imports get a 30-minute grace period. Missing COD orders up to seven days old can be created only with an unambiguous SKU in the store's live linked catalog, sufficient stock, complete original mainland Spanish address and a live standard GLS 96|18 service. Other cases stay visible in the result for review. No postal-code substitution is allowed.

Discounted line amounts are distributed in integer cents, preserving exact units and the Shopify total. An odd cent may split one source line into two lines of the same variant. Non-representable shipping/extra charges, refunds, partial quantities, stale orders, blocked customers, non-COD orders and other destinations require review. An absent COD email remains blank and is never invented; provider rejection must be surfaced.

Before the single creation POST, a persistent Supabase ledger claim uses `shopify_dropea_import_v1` and the Shopify order ID, and the source and Dropea are reread. The API receives a stable per-store/per-order Idempotency-Key. A fresh GET and unique external-reference lookup verify reference, store, total, currency, payment method, variant quantities and original address. A timeout or uncertain result remains claimed and cannot trigger a blind creation replay. The operation endpoint can be polled when the provider returns its asynchronous operation ID. Missing or ambiguous dependencies fail closed.

## Operation

Run `node autoconfirm/tools/recover-shopify-dropea.mjs` for a read-only audit, or target `--order-id=<Shopify numeric ID>`. Writes require both `--live` and `SULEIA_SHOPIFY_DROPEA_LIVE=true`. Use trusted runtime variables; never pass or log credentials as command arguments.

The server timer runs at minute 05 of every hour, UTC (also hourly in Europe/Madrid), with persistent scheduling and a non-overlap file lock. It is independent of the operator's PC and does not replace the existing five-minute automation or half-hour incident timers. `latest.json` records every scanned order and the precise blocking reason; `actions.jsonl` records attempted and verified/uncertain actions with order ID, reason and timestamps, without customer contacts. Both are private in `/var/lib/suleia-shopify-dropea`.

The deployment uses a dedicated immutable release under `/opt/suleia-shopify-dropea/releases/<commit>`, its own environment file, and the existing Node runtime. Copy only Shopify read credentials, Supabase ledger credentials and the existing Dropea read/create credentials to that protected environment; no Render management credential is needed on the server. Start with a read-only targeted audit, then one authorized canary and a second reconciliation before enabling the timer. Keep live disabled until the canary preserves all postconditions.

Rollback: disable/stop only `suleia-shopify-dropea-recovery.timer`; do not clear claims or delete imported orders. Retain the audit trail and reconcile any uncertain provider operation before another attempt. This deployment does not alter the Render revision or the incident release gate.
