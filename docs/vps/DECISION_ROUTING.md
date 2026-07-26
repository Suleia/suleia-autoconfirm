# Decision routing

| Route | Meaning | Staging behavior |
| --- | --- | --- |
| `DETERMINISTIC` | Clear policy and sufficient evidence | Record simulation only |
| `AI_REVIEW` | Moderate uncertainty | Queue only; external LLM disabled |
| `HUMAN_REVIEW` | High risk or operational ambiguity | Require human decision |
| `BLOCKED` | Stale, contradictory or unsafe data | No proposal may progress |

## Risk gates

- HIGH risk always requires human review.
- CRITICAL risk is always blocked before any review or execution route.
- UNKNOWN cases cannot be cancelled automatically before or after 72 hours; at 72 hours they enter human review.
- Stale critical sources block.
- Contradictory customer intent blocks.
- Duplicate action proposals block.
- Missing evidence routes away from deterministic execution.
- No staging route can execute an external action.
