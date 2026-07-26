# Human review queue

Human review is mandatory for:

- high or critical risk;
- material missing information;
- unresolved intent conflicts;
- incident actions that affect delivery or return;
- policy ambiguity;
- failed QA gates.

Items have a priority, status, optional assignee, masked context, snapshot version, reason codes, risk, confidence, freshness, policy gaps, evidence, alternatives, notes and final selection. Staging review remains advisory and cannot execute an action.

Every row is constrained to `run_mode=SIMULATION` and `actions_executed=0`.
