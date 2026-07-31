# Connector Health Engine

Every connector has two independent states:

- `transport_health`: reachability, authentication, permissions, latency, timeouts, errors and breaker state.
- `data_health`: schema, pagination, freshness, counts, duplicates and technical identity-linking rate.

Allowed states are HEALTHY, DEGRADED, UNSTABLE, STALE, UNAVAILABLE, MISCONFIGURED and BLOCKED. A successful endpoint response therefore cannot prove complete or correct data.

