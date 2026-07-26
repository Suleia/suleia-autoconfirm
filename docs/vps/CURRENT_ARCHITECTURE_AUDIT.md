# Current architecture audit

## Scope

This audit describes the current Render and Supabase application only to prepare a reversible migration. It does not change production.

## Runtime

- One Node.js web service starts from `autoconfirm/server.mjs`.
- HTTP routes, webhooks, scheduled loops, automation logic and dashboard delivery share the same runtime.
- Periodic work is implemented with in-process timers. A restart can interrupt a cycle and a second instance can duplicate work unless idempotency is enforced externally.
- Production connectors live under `autoconfirm/src/clients`.
- Business workflows live under `autoconfirm/src/workflows`.

## Persistence

- Local JSON files are used as an operational fallback.
- Supabase is used for mirrored state, hydration and shared persistence.
- Service-role access can bypass row-level security and must not be reused by the future MCP service.
- The current model is state-oriented. The target adds an immutable Event Store so every decision can be reconstructed.

## External dependencies

- Dropea, Chatby, Shopify, Meta and transport integrations are production dependencies.
- OpenAI assistant and legacy spreadsheet paths still exist in the current application.
- The new staging platform imports none of these production clients and disables all external LLM calls.

## Principal risks

1. A single process combines API, scheduling and automation responsibilities.
2. In-process scheduling is vulnerable to restart gaps and duplicate execution.
3. Production state is harder to reconstruct without an append-only event history.
4. Broad service credentials increase blast radius.
5. Render and Supabase availability or networking can affect several workflows at once.

## Migration response

- Modular monolith deployed as isolated process containers.
- PostgreSQL as the source of truth.
- Append-only events and explicit idempotency keys.
- Separate least-privilege roles.
- Read-only MCP with masked output.
- Simulation-only staging until all authorization gates are passed.
- No Render or Supabase production shutdown before a verified rollback window.
