# Process Intelligence design

Initial processes are Order Acquisition, Confirmation, Fulfillment, Delivery,
Incident, Recovery, Return, Customer Communication, Human Review, Policy
Change and Migration.

## Process contract

Each definition declares `process_id`, `process_version`, `start_event`,
`end_event`, `states`, `transitions`, `owners`, `departments`, `policies`,
`timers`, `kpis`, `failure_modes`, `risk_levels`, `escalation`, `rollback` and
`audit_requirements`.

Transitions are keyed by normalized event type and evidence, never arrival
order or free-text similarity. A transition cannot perform an action; it may
only derive state and propose review.

Future measurements cover duration, waits, bottlenecks, retries, errors, cost
and outcome. Replayed process instances use the same event and policy versions
to remain reproducible.
