# Current business rules preserved by Phase A

Phase A does not change production behavior. The following rules are recorded
to prevent organizational names or future modules from overriding the current
logic.

## Confirmation

- Confirmation evidence must belong to the current order.
- Wait one hour and re-read the conversation.
- Later cancellation, correction, change of mind or equivalent revocation
  blocks confirmation.
- An address-change request is not itself a confirmation.

## Timers

- Confirmation: 1 hour.
- AUSENTE, FALTAN_DATOS and NO_RESPUESTA incidents: 48 hours.
- UNKNOWN: human review at 72 hours with no action.
- Historic 36-hour behavior is comparison-only and cannot execute.
- Commercial timer remains disabled until separately approved.

## Refusal and return

Current carrier refusal plus explicit current customer return intent may
produce a `RETURN_TO_ORIGIN` proposal. It must not offer a discount or start
commercial recovery. Contradictory or superseded evidence routes to review.

## Agency pickup

Agency pickup requires current carrier evidence. A customer preference alone
does not prove availability. No unsupported opening hours or availability may
be promised, and discounts remain blocked.

## Discounts and messaging

Discount automation is disabled. No template or customer message is authorized
by Phase A. Lifecycle templates must remain idempotent per order.

## Execution

All new organization contracts are simulation-only. Existing production logic
remains the source of truth and no action executor is enabled.
