# Incident discounts belong to the current order

A reused Chatby conversation can contain offers and replies from older orders.
The existing incident sender previously interpreted the whole thread before
checking the current Shopify/Dropea pair. An old discount could suppress a due
offer and attach its old acceptance/deadline to a newer order.

The same sender now requires the current provider order ID and creation time.
Every batch and fresh pre-send conversation is bounded by that creation time.
Merchandise and discount evidence before it cannot verify a delivery or an
acceptance for the current order. Unknown timestamps remain in the evidence and
block unsafe decisions; they are never discarded to manufacture silence.

Same-order offers remain deduplicated across later/reopened carrier incidents.
The persistent ledger is unchanged: an exact-order receipt predating its order
is an explicit conflict, never removed or silently reset. All existing claim,
24-hour delay, current issue, one-hour acceptance settling, amount, cancellation,
return and cross-source guards remain in effect. No template, flow, owner,
schedule, budget, order-confirmation or Shopify-import change is included.

The production incident lane reads a numeric Shopify source reference directly,
with a two-result bound and exact local name/phone checks. Older incidents no
longer fall outside the newest-250-order window. Explicit reference mismatches
cannot fall back to a nearby purchase; duplicate source identities block. Only
the reference-free compatibility path retains the old bounded lookup. An active,
uncancelled EUR source with the same total is required, and the fresh Dropea
pre-send read must retain the same reference and amount. No order is edited to
make this comparison pass.

Regression includes older offer/acceptance followed by a new order, old initial
notification, same-order later incidence, unknown/future timestamps, conflicting
ledger, missing current-order creation and complete sender final reads. The
accepted-discount support worker remains the established separate owner; a sent
offer is not a customer acceptance, and a support request is not applied COD.

Deployment must target the exact current Render revision plus this narrow diff.
Preserve all environment variables and shared durable claims. Verify the deployed
revision, operational health, completed natural half-hour cycle and fresh provider
outcomes before reporting any real customer action. Rollback changes code only;
it never restores a historical ledger or replays an uncertain send.

## VPS cron response diagnostics

`run-incidents-cycle.sh` retains the same lock, endpoint, timeout and single POST.
Install `validate-incidents-cycle-response.py` at
`/usr/local/lib/suleia/validate-incidents-cycle-response.py` before atomically
replacing the launcher. The existing timer/service/environment are unchanged.

The validator writes sanitized, private `last-run.json` and `last-failure.json`
receipts alongside the existing `last-cycle.json`. Failed communication preserves
the last acknowledged completion and records HTTP/curl status with outcome
`UNKNOWN`, never a claim that no customer actions ran. No response bodies,
messages, contacts or provider diagnostics are retained. Reconcile the backend
cache/ledgers read-only after an uncertain response; never retry that POST merely
because systemd reports failure. A subsequent natural scheduled cycle retains
the established persistent claims.

Rollback restores the previous launcher from its private backup. Do not restore
historical customer state or remove claims. Validator fixture tests cover valid,
invalid, partial, transport and HTTP outcomes and preservation of the last
acknowledged completion without personal data.

An acknowledged HTTP200 batch can still have incomplete customer reads. The
receipt reports verified/partial/blocked/unknown read coverage separately from
transport completion. The authenticated VPS entry point now invokes the same
existing result-driven cooldown recovery as the scheduled wrapper. It reuses
the existing queue, singleton timer, provider cooldown/backoff and durable
claims; it adds no periodic owner. Provider-throttled absent/address reads are
also recoverable. Unknown HTTP outcomes, thrown requests and non-success
payloads do not authorize recovery from this entry point. Customer settling,
offer delays and current-state rereads remain mandatory on every resumed batch.
`/health.incidentReadRecovery` exposes only its pending state/time.
