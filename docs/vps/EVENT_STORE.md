# Event Store

Each fact is appended once with:

- event ID and order ID;
- source and hashed source record reference;
- occurrence and reception timestamps;
- schema version;
- masked payload;
- checksum and deduplication key;
- trust, freshness and masking metadata;
- correlation and causation IDs;
- optional superseded event reference;
- `run_mode = SIMULATION`.

Corrections append a new event and reference the superseded event. Database triggers reject update and delete operations. Replay is ordered by occurrence time and then reception time.

The in-memory prototype mirrors these semantics and validates idempotency and immutable reads.
