# Dropea canonical models

Status: `SHADOW_READ_ONLY` / `SIMULATION_ONLY`

## Order identity

The Dropea order ID is the stable primary anchor. Other technical identifiers
can verify the relationship, but adding or changing an external reference does
not change `canonical_order_id`.

Identity links are HMAC-SHA-256 values produced with a protected runtime key.
Only documented technical namespaces are accepted. Names, phone numbers,
emails, addresses, amounts, products, dates and text similarity are never used
to join records.

Only `EXACT` and `VERIFIED` identities are eligible for full shadow comparison.
`PARTIAL`, `UNKNOWN` and `CONFLICTING` identities remain visible with a blocking
reason and cannot drive a decision.

## Order state

`status` and `sub_status` remain separate source fields. A single versioned
mapper derives `canonical_state` for operator reads. Unknown future enum values
are retained for diagnosis but map to `UNKNOWN_UNSUPPORTED`, with decision
eligibility disabled.

No shipping address, customer contact details, note contents, tax identity or
tracking URL enters the canonical order read model. Tracking references are
HMAC pseudonyms.

## Issue state

The issue model keeps three independent axes:

1. `type`: what happened.
2. `status`: the Dropea management workflow.
3. `resolution_status`: the resolution already applied.

The operational queue predicate is exact: `status=PENDING` and
`is_active=true`, and only for supported enums. `INFO`, inactive, resolved and
unknown-enum issues never enter the actionable queue.

Pickup points retain only a pseudonymous technical ID, display label, country,
active flag and update time. Address, phone, email and coordinates are omitted.

All canonical outputs contain the zero-action envelope. These mappers cannot
confirm, cancel, resolve, message, discount or write to a production source.
