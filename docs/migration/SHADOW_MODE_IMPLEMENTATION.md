# Shadow Mode implementation plan

## Safety boundary

The current system remains authoritative. The VPS may read mirrored inputs,
derive masked state and propose simulations. It cannot send, confirm, cancel,
return, discount or write to any production connector.

## Flow

1. Capture source record identifiers and timestamps without changing current
   delivery.
2. Ingest through allowlisted read adapters with idempotency.
3. Build the VPS Order Digital Twin at a declared snapshot.
4. Evaluate current-version policies through Risk, QA, Compliance and the
   simulation-only authorization contract.
5. Normalize the current-system result and VPS result.
6. Store a masked comparison event and reason codes.
7. Route unexpected differences, false positives/negatives and insufficient
   data to human review.

## Comparison contract

`comparison_id`, masked order id, source snapshot, VPS snapshot, policy
versions, current state, simulated state, timer differences, proposed-action
difference, latency, incident difference, classification, reason codes,
freshness, reviewer status, later outcome and schema version.

## Readiness gates

- no direct PII or secret in comparison data;
- complete source correlation and no ambiguous orders;
- reproducible timers and policy versions;
- zero write clients/imports and zero action execution;
- target accuracy thresholds approved separately;
- rollback means stopping mirror ingestion only; authority never moved.

Shadow operation is not authorized by this document.
