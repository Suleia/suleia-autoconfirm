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

## D-011: Allow exact semantic read POSTs for Dropea and GLS

The owner explicitly authorized Dropea and GLS access on 2026-07-28. Only the
fixed Dropea GraphQL query endpoint and fixed GLS tracking lookup endpoint may
use `POST`. Request bodies are predetermined read shapes, redirects are
blocked, and every mutation remains prohibited.

Current-system authentication may use its exact login endpoint to obtain an
ephemeral cookie. No dashboard refresh or write endpoint is authorized.
Technical identities may be linked only through exact Shopify references or
explicit Dropea-tagged identifiers; names, phones and addresses are forbidden
for matching.

## D-012: Organization is a contract layer, not a microservice fleet

Phase A models Suleia as six organizational layers with one deterministic
primary agent per department. Departments remain modules in the existing
modular monolith and do not receive containers, databases, credentials or
executors. A future split requires measured technical evidence and a separate
decision.

All Phase A agent contracts are `SIMULATION`, non-executing, non-writing and
external-AI-free. Existing runtime logic remains authoritative until a later
phase is explicitly approved and verified.

## D-013: Executive control is a read model without commands

The Executive Control Layer consolidates future masked summaries but exposes no
confirm, cancel, return, discount or messaging operation. Its snapshot contract
must report `actions_executed=0` and `production_writes=0`.

## D-014: Phase B adds one internal governance layer, not new services

Policy Registry/Lifecycle, conflict resolution, Risk, QA, technical
Compliance, Authorization, Decision Explanation and governance events are
modules in `platform-core`. They remain disconnected from current production
authority and produce simulation results only. No container, worker, queue,
database or MCP tool is added.

## D-015: Enterprise design stays on PostgreSQL

Future Business Graph, Decision Memory and Enterprise Twins are designed as
relational PostgreSQL contracts and read models. No graph database, vector
database, external AI, local LLM or paid service is justified or authorized.
