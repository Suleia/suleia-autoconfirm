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
