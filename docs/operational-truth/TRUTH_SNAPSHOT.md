# Truth Snapshot

Each snapshot contains a deterministic ID, canonical order ID, explicit `as_of`, expected/available/missing sources, categorized facts, identity/timeline/timer/policy/decision/replay/parity states, quality score, confidence and exact blocking reasons.

The contract excludes PII and secret-shaped fields. `generated_at` equals the caller-supplied reference time; no hidden current clock is used. `migration_eligible` and `shadow_eligible` fail closed on missing sources, conflicts, stale facts, weak identity or non-reproducible replay.

