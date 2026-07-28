# Incident return-to-origin policy

Version: `vps-staging-v1`
Mode: `SIMULATION`

## Deterministic rule

Select `INCIDENT_RETURN_TO_ORIGIN` and propose `RETURN_TO_ORIGIN` only when:

- the current order is shipped or has an active carrier incident;
- independent carrier evidence is current and equals
  `SHIPMENT_NOT_ACCEPTED`;
- the latest explicit customer intent for the same order is `RETURN`;
- no later customer event revokes that intent;
- no later logistics event contradicts the return.

The route is `DETERMINISTIC`, risk and QA gates must pass, and
`actions_executed` remains zero.

## Strict commercial gate

An explicit current `RETURN` intent disables discount and commercial recovery
proposals. An `OFFER_DISCOUNT_5` proposal cannot supersede a return.

If carrier evidence is absent, stale or contradictory, the safe result is
`HUMAN_REVIEW` with `NO_ACTION`.

## Audit fields

The decision records the incident history, current customer intent and
evidence, current carrier state and evidence, latest relevant event, freshness,
conflicts, workflow, route, confidence, policy version and both risk and QA
gate results.
