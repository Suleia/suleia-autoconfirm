# Migration Readiness Score

Readiness is a gated classification, not an average. It records infrastructure, connector, data, identity, business-rule, timer, decision, security, backup, restore, rollback, observability, operations and human-review dimensions.

Any critical quality issue, non-restorable backup, unvalidated rollback, weak identity, possible production write, enabled Action Executor, missing critical parity, non-reproducible replay or unsafe read path yields NOT_READY. With no blocker and complete comparison/quality evidence it may yield SHADOW_READY.

CANARY_READY and CUTOVER_READY are criteria-only fields and always `false` in C0.

