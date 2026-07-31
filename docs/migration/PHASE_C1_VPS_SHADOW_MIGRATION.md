# Phase C1 — VPS shadow migration

## Scope

Phase C1 builds a one-way, read-only operational replica on the existing Suleia VPS. Render, Supabase and AutoConfirm remain authoritative and continue operating. The shadow worker may read real source data and write only masked derivatives to the VPS PostgreSQL database.

It cannot send customer messages, confirm or cancel orders, trigger returns, apply discounts, call external AI, expose new MCP tools or write to any source system.

## Safety envelope

The worker fails closed unless all of these conditions hold:

- `APP_ENV=staging`
- `RUN_MODE=SHADOW_READ_ONLY`
- `SIMULATION_ONLY=true`
- real-data reads enabled only for the worker
- production, connector and real-data writes disabled
- actions, customer messages, confirmations, cancellations, returns and discounts disabled
- OpenAI and external LLM calls disabled
- PII masking and audit logging enabled
- the source host is an allowlisted HTTPS Supabase host
- the destination is the local VPS PostgreSQL service

Source access uses HTTP `GET` only. Every record is masked before persistence. Exact joins use HMAC-protected technical order identifiers; identity is never inferred from names, email addresses, phone numbers or approximate matching.

## Database isolation

Migration `005_shadow_operational_replica.sql` adds dedicated schemas for migration control, private masked source records, truth, reconciliation, the enterprise graph, decision memory, twins, economics, process intelligence, knowledge and read models.

The MCP database role cannot access `raw_private`. It receives read access only to allowlisted aggregate views, without changing the frozen eight-tool MCP surface.

All batch rows enforce `SHADOW_READ_ONLY`, `actions_executed=0` and `production_writes=0` with database constraints.

## Load and synchronization

The initial load and each incremental poll are divided into independently audited source-object batches. A batch records its source count, imported count, duplicates, rejections, checksum, masking state and reconciliation state. Incremental reads overlap the last successful timestamp by one second; database uniqueness makes replay idempotent.

`telegram_messages` is classified `MANUAL_REVIEW` and is not imported automatically. A missing optional source table is recorded as missing rather than approximated.

Any record-level masking or persistence error fails the batch and prevents its checkpoint from advancing.

## Backup, restore and rollback gates

Before production-schema application:

1. create a PostgreSQL custom-format backup with mode `0600`;
2. verify its checksum and archive structure;
3. restore it into a disposable database;
4. verify application table recovery;
5. remove the disposable database;
6. apply and roll back migration 005 in a second disposable database.

The verified preflight result was:

`apply=PASS`, `rollback=PASS`, `schemas=11`, `actions=0`, `production_writes=0`.

Rollback of Phase C1 stops the ingestion worker and applies `migrations/rollback/005_shadow_operational_replica.down.sql`. This removes only Phase C1 schemas. It does not alter Render, Supabase, AutoConfirm, Chatby, Shopify, Dropea or GLS.

## Post-load verification

Run `infrastructure/scripts/verify-shadow-state.sh`. It fails if an unsafe capability flag is active, a batch is incomplete, action/write counters are nonzero, or direct email/credential patterns are found in stored masked payloads. Its output contains aggregate counts only.
