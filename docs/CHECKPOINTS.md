# Suleia checkpoints

This file is the high-level checkpoint index. Detailed VPS history remains in
`docs/vps/CHECKPOINTS.md`.

## Autonomous Operations Company

| Phase | Scope | Status |
|---|---|---|
| A | Organization, departments, deterministic agent contracts, documentation | Complete |
| B | Policy, Risk, QA, Compliance, authorization and audit | Complete locally; not deployed |
| C-DESIGN | Enterprise Intelligence, Business Graph, Decision Memory, Twins and migration contracts | Design complete; no runtime implementation |
| C-CORE | PostgreSQL schemas, read models and events | Not started; authorization required |
| D-INTELLIGENCE | Deterministic analytics, patterns and policy performance | Not started |
| E-CONTROL-TOWER | Read-only enterprise interface | Not started |
| F-SHADOW | Real-data read-only mirror and parity | Not started |
| G | Canary and rollback preparation | Not started |

No later phase starts automatically. A HIGH or CRITICAL risk, behavior change,
write surface, failed rollback, failed backup or failed critical suite blocks
progress.
