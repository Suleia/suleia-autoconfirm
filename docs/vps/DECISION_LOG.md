# Decision log

## D-001: One VPS, modular monolith

Use one Ubuntu LTS VPS and Docker Compose. Services remain separate processes and containers, but share one repository and one PostgreSQL instance. This keeps operations understandable while preserving boundaries for future scaling.

## D-002: PostgreSQL as the only stateful dependency

Do not add Redis now. Timers, durable jobs, idempotency and review queues fit PostgreSQL. Reconsider Redis only after measured lock contention or queue latency proves a need.

## D-003: Deterministic core, review queues for uncertainty

The Decision Engine remains deterministic. Ambiguous cases route to AI review or human review, but external LLM calls are disabled. No route can execute actions in staging.

## D-004: Append-only order history

Events are immutable. Corrections append a superseding event. Updates and deletes are rejected by a database trigger.

## D-005: MCP is read-only

MCP can query masked staging data and run simulations. It has no write tools, receives a read-only database role and audits every call.

## D-006: 36-hour rule is comparison-only and UNKNOWN is non-actionable

The historic 36-hour cancellation rule is retained only as `COMPARE_LEGACY_36H_ONLY`. Incident workflows use 48-hour review semantics. At and after 72 hours, UNKNOWN cases remain `UNKNOWN`, generate an administrative alert, route to `HUMAN_REVIEW` and return `NO_ACTION`.

## D-007: Preliminary VPS candidate

OVHcloud VPS-2 is the preliminary cost/value candidate because it currently advertises 4 vCores, 8 GB RAM, 75 GB NVMe and a daily backup. Purchase remains pending authorization and a final checkout-price review.

## D-008: No OpenAI API dependency

The new platform does not call OpenAI or another paid LLM API. Interactive ChatGPT access is through the read-only MCP endpoint only.

## D-009: Fail closed when Shopify cannot be read with GET only

The daily real-order batch treats Shopify as the authoritative source for the
set of orders created today. A current-system cache cannot prove completeness.

On 2026-07-27 the mandatory preview found no Shopify Admin access token or shop
domain in the target Render service. Only client credentials were present and
their token exchange requires `POST`, which the checkpoint prohibits.

The batch therefore stopped before reading orders or querying dependent
sources. It must remain `ABORTED` until a pre-existing GET-compatible Shopify
credential is available without changing production.

## D-010: One exact OAuth bootstrap POST, then GET-only Shopify reads

The owner authorized recovering the existing Shopify shop and application
credentials on 2026-07-28. One exact client-credentials request may issue an
ephemeral token held only in memory. The business-source connector remains
GET-only and cannot mutate Shopify.

This exception does not extend to Dropea, GLS, messaging, order changes or any
other external write.
