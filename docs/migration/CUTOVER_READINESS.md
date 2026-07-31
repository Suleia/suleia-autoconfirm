# Cutover readiness

Current verdict: **NOT READY**. No canary or cutover is authorized.

Required gates include complete inventory, read-only mirror, reconciled counts
and checksums, timer and decision parity, resolved historic-policy conflict,
persistent idempotency parity, masked audit, connector error handling,
backpressure, backup restore, RPO/RTO, security review, capacity test, dual
verification, owner-approved thresholds and a timed rollback drill.

The action executor, production writes, customer messages, confirmation,
cancellation, return and discounts must remain false until a separate,
customer-impact authorization. Secrets move only after functional parity and
never through Git or chat.

Current blockers are production-data mirror approval, operational connector
read credentials on VPS, policy conflict resolution, ledger parity, real-data
shadow evidence and economic/capacity thresholds.
