# Suleia Incident Autopilot

## Purpose and boundary

Suleia Incident Autopilot consolidates the existing Event Store, Digital Twin,
policy, timer, simulation and Operations Center components. It does not create a
second operational authority. Render keeps the currently authorised rejection,
discount and return flows unchanged. Every new Autopilot capability is deployed
as `SIMULATION / SHADOW_READ_ONLY` and cannot perform external writes.

## Canonical flow

`incident -> context -> policy -> decision -> simulated action -> verification -> timer -> source refresh -> reevaluation -> final state`

The canonical policy is `autoconfirm/data/incident-policy.json`. A timer expiry
never executes an action: it requests fresh Dropea, Chatby and GLS context and
then reevaluates the policy.

## Evidence rule

A customer action is valid only when it belongs to the exact order and incident,
occurs after the observed incident notification and has a non-ambiguous intent.
The initial `CONFIRMAR MI PEDIDO` lifecycle response and any
`dropea_pedido_*` template context are explicitly excluded. An ambiguous
post-notification interaction remains visible in the panel but cannot authorise
an automated action.

## Persistence and idempotency

Migration `040_incident_autopilot_shadow.sql` adds persistent cases,
transitions, a simulation-only action outbox, verification records and the human
review queue. Action identity is stable for order, incident, action, policy and
payload. Database constraints force external writes and executed-action counters
to zero.

## Panel

The existing Incidencias page is the supervision center. Its KPI predicates are
also used by its filters. The primary table shows order, incident, Autopilot
state, customer evidence, next action, timer, result and priority. Connector
health, expired timers and simulated/verified/failed action counters are visible.
Business funnels remain available as secondary, collapsible information.

## Activation gates

No incident family can become live without a separate owner authorisation,
historical replay with zero unsafe actions, a limited pilot, action verification,
rollback evidence and an explicit per-action kill switch. AUSENTE is the first
candidate; refusal and address flows remain later phases.
