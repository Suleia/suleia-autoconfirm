# Reconciliation Ledger

The local ledger records source pairs, canonical snapshots, compared/equal/different/missing/stale fields, identity confidence, result, recurrence, resolution, fingerprint and idempotency key.

Canonical serialization plus SHA-256 yields a stable fingerprint. Repeating the same idempotency key updates occurrence and last-seen time without inserting another row. JSON serialization/restore proves restart persistence locally. Production persistence is a future C-CORE concern and has not been created or migrated.

Results: MATCH, PARTIAL_MATCH, EXPECTED_DIFFERENCE, UNEXPECTED_DIFFERENCE, INSUFFICIENT_DATA, IDENTITY_MISMATCH, STALE_COMPARISON and NON_REPRODUCIBLE.

