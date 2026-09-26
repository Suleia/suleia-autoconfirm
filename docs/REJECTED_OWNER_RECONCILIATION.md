# RECIPIENT_REJECTED — owner reconciliation, 2026-09-26

The productive contact owner is native Chatby (published Incidencias Mensajes
subflow). Render owns the existing 5 EUR offer and return scheduler; Supabase
retains its durable delivery/action claims. The VPS imports evidence and exposes
the canonical workflow. Its ingestion remains read only towards providers.

## Verified contract

- Initial template: `dropea_incidencia_mercancia_v1`, Chatby 1472499,
  Meta 1976251392983791, APPROVED. No template changes.
- Offer: `es_es_dropea_incidencia_descuento_5_v1`, Chatby 1472467,
  Meta 1438962828042597, APPROVED. Exactly 5 EUR, after 24 hours from
  verified initial contact without customer activity.
- Owner explicitly approved changing the wait after the verified offer from
  24 to 48 hours. Single existing scheduler; no second timer/writer.
- Return uses official V2 issue resolve with RESOLVED / RETURN_REQUESTED;
  exact order/issue GET verification and prior order return guard required.
- Offer delivery is not evidence that the payable amount was reduced.

## Discount application contract clarified by owner

Send an email to `soporte@dropea.com` with the order ID and final amount,
then supply an incident solution requesting delivery at that discounted amount.
The sender account/provider is not yet configured or verified in this repository.
Render contains a pure, tested planner; it does not send mail or execute this new
recovery path. A mail acknowledgement is not verification of the collectible
amount. Re-read the actual provider amount and solution before marking applied.
Timeouts require reconciliation, never blind replay. Dedupe is order + recovery
offer + EUR 500 cents, even if a later issue exists for the same order.

## Observability

Migration 048 adds sanitized owner decisions and observed returns to the existing
discount projection. Real verified offers/returns stay REAL despite ingestion
running SHADOW_READ_ONLY. Unknown application/delivery capabilities stay unknown
or OFF. Fresh owner health determines stages; missing health does not manufacture
LIVE. The Render master controls Render actions, not native Chatby contact.
Metrics state coverage and leave recovered profit/delivery attribution unavailable.

## Outstanding boundaries

Actual discount application and subsequent delivery are not yet LIVE. Explicit
return without a previous verified offer is also not covered by the existing
return lane. A closed issue alone is not a verified return. Historical acceptance
does not prove a changed payable amount. Preserve AUSENTE controller, flags,
callbacks, templates, timer and canary; no new provider writer in the VPS.

Local validation: 1,206 tests passed before final additional sanitization test.
Deployment script tests the exact image, preserves runtime environment and the
dedicated AUSENTE controller identity, and changes only API, panel and ingestion.
Rollback restores those images; the additive evidence column is retained.
