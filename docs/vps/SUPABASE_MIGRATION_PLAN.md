# Supabase migration plan

Supabase remains the production data source while PostgreSQL staging is built.

## Principles

- Read-only, one-way extraction.
- Mask before exposure.
- Preserve source IDs only as hashes where possible.
- Reconcile every table.
- Keep a source-to-target mapping report.
- Do not use Supabase service credentials in the MCP.

## Future phases

1. Schema-only rehearsal.
2. One fictitious order.
3. One masked production order after authorization.
4. Masked sample.
5. Full read-only rehearsal.
6. Controlled production cutover.

Each phase has an independent stop/go decision.
