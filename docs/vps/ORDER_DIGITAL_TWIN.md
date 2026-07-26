# Order Digital Twin

The Digital Twin is a reproducible view derived from events, never a manually edited source of truth.

It contains:

- canonical status;
- customer intent;
- confirmation and cancellation timestamps;
- incident state;
- logistics state;
- active and expired timers;
- source freshness and completeness;
- contradictions and warnings;
- evidence event IDs;
- deterministic snapshot version.

Supported operations:

- `buildCurrentTwin(orderId)`;
- `buildTwinAt(orderId, timestamp)`;
- `rebuildTwin(orderId)`;
- `compareTwins(left, right)`.

Any stale critical source, contradictory intent or duplicate action proposal blocks automatic routing.
