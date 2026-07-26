# Database migration plan

## Direction

Supabase production to isolated PostgreSQL staging, one way only.

## Rehearsal sequence

1. Create a Supabase database user restricted to read-only views.
2. Export with `export_supabase.sh`.
3. Verify archive checksum.
4. Transform records into canonical contracts.
5. Mask PII before staging import.
6. Import into an isolated PostgreSQL database.
7. Verify table counts and checksums.
8. Rebuild Digital Twins from events.
9. Compare sampled decisions with the current system.
10. Destroy the rehearsal database if validation fails.

## Hard stops

- No real export before authorization.
- No service-role key.
- No bidirectional replication.
- No import into production.
- No source deletion.
- No Render or Supabase shutdown.

## Acceptance

- Counts reconcile.
- Checksums reconcile.
- PII scan is clean.
- Event replay is deterministic.
- Source freshness is visible.
- MCP role cannot write.
- All simulated decisions execute zero actions.
