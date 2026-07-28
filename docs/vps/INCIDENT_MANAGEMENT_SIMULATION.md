# Incident management simulation

Updated: 2026-07-28

The VPS decision engine supports two evidence-first incident workflows:

- `INCIDENT_RETURN_TO_ORIGIN`
- `INCIDENT_AGENCY_PICKUP`

## Evidence model

Customer intent and carrier state are derived independently. Every evidence
item retains event id, type, source, occurrence time, trust level and
freshness. The latest relevant event wins only inside its evidence domain;
cross-domain conflicts are made explicit and routed safely.

## Fixtures

Seven anonymized cases extend the original fixture set:

| Case | Expected result |
|---|---|
| Aligned return | `RETURN_TO_ORIGIN / DETERMINISTIC` |
| Return later revoked | `NO_ACTION / HUMAN_REVIEW` |
| Carrier-confirmed agency pickup | `MARK_AGENCY_PICKUP / DETERMINISTIC` |
| Customer-only pickup request | `VERIFY_AGENCY_PICKUP / HUMAN_REVIEW` |
| Pickup superseded by return | `NO_ACTION / HUMAN_REVIEW` |
| Ambiguous absence retry | existing incident wait; never return |
| Return with discount proposal | return prevails; discount blocked |

There are 32 fictitious fixtures in total. Each validation asserts
`actions_executed=0` and `run_mode=SIMULATION`.

## Panel

The private review panel displays the two workflows, their evidence
requirements and the audit fields used by risk and QA gates. The panel does
not expose PII and does not provide an action button.
