# AI review queue

The AI review queue stores moderate-uncertainty decisions for interactive analysis. It does not call an external model automatically.

Queue items reference an immutable decision record. They include the masked context, snapshot version, reason codes, risk, confidence, freshness, policy gaps, evidence event IDs, alternatives and review result. They can be read through MCP and compared with the current system. Completion cannot execute an external action in staging.

Entry criteria include:

- sufficient evidence but confidence below deterministic threshold;
- no critical source staleness;
- no contradiction;
- non-critical risk.

Anything riskier routes to human review.

Every row is constrained to `run_mode=SIMULATION` and `actions_executed=0`.
