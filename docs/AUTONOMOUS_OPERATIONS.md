# Autonomous Operations: read layer

The incident cockpit and Automation consume `incidentAutonomy` from
`automation-presentation.mjs`. No operational worker imports this presentation
module. Existing classifiers, policies, timers and execution gates remain intact.

Migration 047 adds two SELECT-only views: `operations_workflow_status` and
`operations_workflow_recent_actions`. Summary and metric read models are composed
in the backend from these views and the same incident projection as the cockpit.
No history is rewritten. Roles gain SELECT only. The rollback drops the two views.

Authenticated GET routes under `/api/operations/automation`: `overview`,
`summary`, `workflows`, `workflows/:workflow`, `actions`, `metrics`.
The UI uses one aggregate overview, never one request per card/workflow.
Periods: today in Europe/Madrid, rolling 7 or 30 days. Incident metrics use
incidents created in that period; controls show current state. Rates count unique
canonical incidents. Each metric carries numerator, denominator and definition.
Unavailable attribution or coverage yields null, not zero. In particular a human
review queue does not establish a human intervention; a verified provider action
alone does not prove absence of all human intervention.

Only registered incident types/control records create workflow rows. Shadow
observations establish SHADOW interpretation/decision stages, not operational
activation of other emitters such as Render. Without the actual control, execution
is unknown. AUSENTE notification and resolution modes are independent persisted
controls. Its existing observer health is read once via GET with a 1.5s timeout.
No scheduler, writes, template changes or activation controls are added.

A selected candidate is not a consumed canary. Used counts persisted reservations.
Native notice VERIFIED and resolution APPLIED are real provider observations;
outbox SIMULATED remains PREPARED even when a shadow verification says VERIFIED.
No messages, phone numbers or tokens are included in workflow read views.

Autonomy:
- Ambiguous/missing/currentness-invalid evidence: HUMAN_REVIEW.
- Clear current intent or a verified wait, blocked execution: PREPARED.
- AUTOMATIC additionally requires explicit per-incident allowed action and gate,
  a LIVE/CANARY stage, matching canary and closed protections. Stage mode by itself
  does not authorize an incident. No additional executable permissions are created.

State projection maps real verified/requested/unknown actions to
EXECUTION_VERIFIED/EXECUTION_REQUESTED/EXECUTION_UNKNOWN; otherwise verified wait,
stale evidence, human review, ready or blocked. Technical codes stay in Debug.
Original event timeline is preserved, never synthesized from estimated times.

UI: shared sidebar/layout, cards, badges, filters, table and drawer; AutomationPanel
renders backend values. Incident autonomy sits inside the existing next-action
cell to retain eight compact columns. All workflow controls are read-only text.
Deep link `/operations/#automation`. No finance/provider functionality changes.

Deployment replaces only API and static panel. It preserves service environment,
checks other container identities, tests the exact image and offers rollback.
The audit compares control/timer hashes and real action counts before and after.
Normal background ingestion can update incident counts independently; that is not
a presentation-layer write.
