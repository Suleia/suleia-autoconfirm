# Executive control layer

## Scope

The Executive Control Layer is a read-only consolidation boundary. It consumes
future masked department read models and produces snapshots for human review.
Phase A defines only the contract; it does not create tables, jobs or endpoints.

## Executive snapshot contract

Required fields are maintained in
`packages/platform-core/src/organization/contracts.mjs` and include identity,
generation time, business date, environment, source freshness, order and
incident counts, reviews, timers, policy conflicts, data-quality issues,
economic estimates, schema version and the two safety counters.

Every valid snapshot must satisfy:

```text
actions_executed = 0
production_writes = 0
```

## Freshness and confidence

An executive snapshot must not hide stale or incomplete sources. Future
implementations must show freshness by source, preserve UNKNOWN, expose
divergences and avoid treating absent data as zero activity.

## No command surface

The layer exposes no confirm, cancel, return, discount or messaging command.
Recommendations are informational and require the later governance and human
authorization stages.
