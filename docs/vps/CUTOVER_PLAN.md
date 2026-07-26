# Cutover plan

This plan is not authorized for execution.

## Preconditions

- Two successful restore drills.
- Seven days of stable shadow comparison.
- No unresolved PII findings.
- No write capability in MCP.
- Decision parity threshold approved.
- Recovery time and recovery point objectives approved.

## Proposed sequence

1. Announce maintenance window.
2. Record source cursors and checksums.
3. Pause new writes at the old application boundary.
4. Apply final incremental import.
5. Reconcile counts and checksums.
6. Enable VPS API traffic.
7. Keep external action executor disabled initially.
8. Observe health and decision parity.
9. Enable production actions only under a separate authorization.

Any failed checkpoint triggers rollback.
