# Supabase decommission plan

Supabase shutdown is migration Phase 8 and is not authorized.

Prerequisites: Render already decommissioned safely, PostgreSQL is approved as
authority, all tables/views/functions and delivery-ledger semantics reconcile,
dual-write is no longer needed, retention/export requirements are reviewed,
backup and restore are verified, consumers are inventoried and rollback is
timed.

Planned sequence is final consistent export, checksum/count reconciliation,
read-only retention window, revoke consumers gradually, observe, preserve an
encrypted recovery copy, then remove the project only with explicit owner
approval. Missing records, ledger divergence, unknown consumers or restore
failure blocks shutdown immediately.
