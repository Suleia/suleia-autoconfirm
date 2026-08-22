# Meta Ads Automation architecture

## Scope implemented

META-0 and META-1 add one isolated, read-only module under `services/meta-ads/`. It imports only the generic platform read-only HTTP transport. It does not import or change order acceptance, confirmation, cancellation, incidents, Dropea, GLS, Chatby, the order Decision Engine, or their schedulers/workers.

```text
Meta Marketing API (GET only)
            |
            v
 services/meta-ads
   config -> client -> read cycle
            |
            v
 private in-memory result (SIMULATION)
```

There is no Meta writer, decision engine, database writer, scheduler, Telegram sender, public endpoint, or Operations Center UI in META-0/META-1. Those are later phases and production writes remain structurally unavailable.

## Real infrastructure inventory (2026-08-22)

- Contabo runs Docker Compose with healthy API, MCP, ingestion, PostgreSQL 17.5, reverse proxy, monitoring, and review panel services.
- PostgreSQL is the correct future audit store; no new database is justified.
- The existing `scheduler` container runs `services/process-runner.mjs scheduler`, whose health contract is `NOT_IMPLEMENTED`. It is not suitable for Meta scheduling yet.
- A host systemd timer named `suleia-render-automation.timer` runs the historical Render order cycle. It is outside this module and remains untouched.
- The effective Git checkout reports `e17141ed...`; the host release pointer still targets `47add8f9...`. This traceability drift predates this module and must be corrected separately without changing runtime behavior.
- Contabo has no Meta or Telegram variables. The existing credentials and Telegram runtime are on Render.
- Restart policies and health checks exist for the current stack, but no Meta service has been deployed in these phases.

## Boundaries for later phases

Any future service must have its own container, secret set, database role, systemd timer units, health endpoint, audit tables, and rollback. It must not reuse the placeholder order scheduler or import historical Render workflows.
