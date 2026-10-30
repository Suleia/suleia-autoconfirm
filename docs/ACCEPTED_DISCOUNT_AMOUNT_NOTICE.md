# Accepted EUR5 discount: amount-only customer notice

Owner correction, 31 October 2026. A settled acceptance belongs to the existing accepted-discount support workflow. It must not be routed through a generic cash/date/window clarification quoting the original order amount.

The delivery-reply planner now yields discount discussions and current verified-offer acceptances to their existing owner. Ordinary payment constraints, cancellation, address, agency and delivery preference rules remain unchanged. This is a scoped correction to the deployed VPS baseline `3ad9a8f`, not activation of the pending Customer Care/V3 branches.

The existing VPS support owner can send this informational text:

> Hola, con el descuento de 5 €, el importe final de su pedido es de 24,99 €. Un saludo.

The amount is produced from the exact verified offer's original cents minus 500, reconciled with its final cents. It is not computed by subtracting again from an already discounted current amount. The unchanged `acceptedDiscountPlan` eligibility requires exact current order, verified offer/acceptance, the one-hour settling guard, matching source amounts and the existing activation/return guards. No new date/window or cash confirmation is requested.

The notice reuses the existing `sendDeliveryReplyOnce`, Chatby text adapter and durable `template_delivery_ledger`. Its key is `accepted_discount_amount_notice_v1`, once per order across reopened incidents. The caller revalidates before sending and journals before the only POST. Uncertain sends are read back, never blindly repeated. Existing verifiable agent messages with the same final amount and EUR5 discount suppress duplicates. Messages outside the customer text window are blocked; no template/flow is edited.

The optional notice does not replace the screenshot, support email, exact attachment readback, shared issue claim or verified Dropea solution. A later correction/cancellation still blocks financial actions. Previously processed support claims are not replayed. The notice does not assert that carrier COD has already changed.

Deployment uses a derived image on the exact existing VPS image, replacing only the four modified runtime modules and adding the amount-notice module. Dedicated state/evidence mounts, sessions, timers, settings, entrypoint, security and all other service source remain unchanged. Do not replace the container while a cycle or an uncertain operation is active. Keep the predecessor container/image for reversal.

Validation: focused planner/sender/support regressions, per-order concurrency, reopened incidents, late cancellation, existing human corrections, stale windows, exact cents, unknown results and existing mail-before-solution invariants. Production message delivery must be verified separately; no historical duplicate or artificial canary is required.
