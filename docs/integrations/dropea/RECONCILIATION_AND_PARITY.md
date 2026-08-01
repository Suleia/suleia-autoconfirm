# Reconciliation and production parity

The reconciliation worker compares the required pairs: Dropea webhook/GET,
Chatby webhook/GET, Event Store/Digital Twin, legacy/Decision Memory and
timers/Digital Twin. It records `MATCH`, `EXPECTED_DIFFERENCE`,
`UNEXPECTED_DIFFERENCE`, `STALE`, `MISSING_EVENT`, `OUT_OF_ORDER`,
`IDENTITY_MISMATCH`, `PAGINATION_INCOMPLETE` or `BLOCKED`. It never silently
repairs a discrepancy.

The current production confirmation/cancellation behavior is pinned as
`CURRENT_PROD_CANONICAL_BEHAVIOUR`. A SHA-256 golden digest covers action,
route, workflow, reason codes and review routing for all 32 anonymized cases.
Any change blocks the checkpoint. The deprecated 36-hour case remains
comparison-only; no new 36-hour timer exists.

All reconciliation and parity records carry the zero-action simulation
envelope.
