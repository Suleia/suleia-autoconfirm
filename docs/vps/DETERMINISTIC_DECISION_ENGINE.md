# Deterministic Decision Engine

## Priority order

1. Delivered or terminal order: no action.
2. Explicit customer cancellation: propose cancellation for review.
3. Active incident: use the incident workflow.
4. Confirmed order: wait one hour, then propose confirmation.
5. Historic 36-hour unanswered threshold: comparison only.
6. Insufficient evidence: wait.

## Output

Every result includes:

- route and proposed action;
- confidence breakdown;
- reason and evidence;
- policy versions;
- alternatives;
- risk and QA status;
- missing information;
- review requirement;
- `actions_executed = 0`;
- `run_mode = SIMULATION`.

No executor is imported or called by this package.
