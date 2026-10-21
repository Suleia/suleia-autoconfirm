# Ads Intelligence V2 — phase evidence, 2026-10-21

Release status: implemented and tested in isolated environments; not deployed.
Meta LIVE is blocked by the release gate. Production advertising writes: **0**.
Production Telegram messages sent by validation: **0**. Operational database
backfills/migrations performed: **0**.

| Phase | Implemented | Evidence | Remaining / risk | Rollback |
|---|---|---|---|---|
| A | Canonical GET reader, normalized null/zero/ambiguous metrics, explicit attribution, Render adapter, idempotent facts and coverage, bounded historical sync | Main suite: 88 pass; migration/coverage validated against isolated PostgreSQL; real three-level spend reconciliation | Production historical backfill and flagged consumer cutover pending. Attribution differs from legacy account settings; do not mix contracts | Disable canonical flag; retain historical facts/coverage |
| B | Entity-period baselines, funnel and multi-signal fatigue diagnostics, sample gates, strict ROAS filters, EUR integer budget proposals | Boundary cases include >5 / exactly 5, missing/ambiguous ROAS, zero spend, zero purchases with sufficient checkout sample, ABO, inactive campaign and approved-limit conflicts | Product margin/attribution is not certified; no invented net profit. Sample thresholds require review | Disable diagnostics/proposal feature; retain evidence |
| C | Existing Telegram bot bridge, identity checks, explicit buttons, unique natural confirmation, update-key replay | Linux suite: 78 pass, including existing bot service/storage tests and new gateway/executor tests | Private bridge credentials and deployment settings not provisioned. No live owner message sent by these tests | Restore prior bot release and disable bridge; legacy writes remain false |
| D | PostgreSQL proposal claims, per-campaign locks, unique unresolved operations, journal/events, breaker, readback/reconciliation; guarded POST adapter | Isolated PostgreSQL integration passes actual migration, restart persistence, cross-session locks, coverage, permissions and concurrent SHADOW engine confirmation. Offline adapter tests prove no retries and safe request format | A controlled real canary remains prohibited pending explicit authorization, named campaign and release-gate review. External operators cannot be locked by PostgreSQL | Disable flags; preserve UNKNOWN/EXECUTING journals and reconcile without replay |
| E | Existing API/panel integration, filters, pending proposals, history, limits, blocking reasons, release/runbook | VPS regression suite: 138 pass, one PostgreSQL test skipped locally and passed separately in isolation. Includes API and 39 panel tests. Diff/syntax checks pass | Component deployment and visual owner review pending; no browser used. No production services restarted for this release | Restore prior component releases; additive migration may remain |
| F | Authorization boundary prepared | LIVE_COMPILED=false; setting LIVE/write env flags is rejected before HTTP | Explicit owner authorization, scoped settings and one named reversible canary required | No LIVE activation exists to revert |

Suite counts overlap; do not sum them as distinct tests. All write transport
success/failure tests used fake HTTP responses. A fake-writer success is not
claimed as a real Meta modification.

## Real read-only validation

At 2026-10-21T08:46:31.501Z the new code completed the mandatory request in SHADOW
with an in-memory ledger and a GET-only fetch guard. It selected **8 active
campaigns** from the freshly read inventory. Earlier that morning the inventory
had grown from the audit's 30 to 31 campaigns, demonstrating that the code does
not pin a stale list. The eight selected items were blocked by the preserved
10% limit and/or sample/ROAS criteria; no budget was modified.

For seven complete local days, 2026-10-14 through 2026-10-20:

| Meta level | Insight rows | Spend EUR | Pagination |
|---|---:|---:|---|
| campaign | 9 | 955.16 | complete |
| adset | 22 | 955.16 | complete |
| ad | 33 | 955.16 | complete |

The harness asserts cent-level reconciliation and rejects non-GET provider
requests. Twelve GET requests; zero Telegram sends and zero database writes.
The observed sample policy (15 EUR / 2 purchases / 500 impressions) was explicitly
**test-only**, not deployed or approved as a business policy. The operational
limits read from trusted configuration were 100 EUR/day and 10% change.

Native Meta rule inventory was complete and returned zero rules at
2026-10-21T08:04:18.790Z. This does not prove absence of human/external changes.
Token access works at read time; expiry/renewal remains a pre-LIVE check.

## VPS state and scope

Post-test health inventory showed API, ingestion, materializer, PostgreSQL,
MCP and reverse proxy healthy. Telegram remained active/running with its original
activation timestamp 2026-10-20 09:30:14 UTC. Test containers had no network or
published ports and used temporary data; they did not connect to production DB.

An unrelated existing `recipient-absent-live-controller` health check was failing
when checked at 08:47 UTC (8 consecutive failures; process started the preceding
day). It was not restarted or modified. This is a production observation for
the logistics owner, outside V2's explicit scope exclusion. No claim is made
that the entire VPS is healthy.

## Approval boundary

The next reviewable step is a component-only SHADOW deployment using the runbook,
not a merge/deploy of unrelated VPS or logistics changes. Before authorizing
LIVE, review the approved-budget conflict (+10 EUR is impossible under both
100 EUR maximum and 10% change), sample thresholds, attribution, competing writer
exclusion, token lifecycle and the named canary/reversal procedure. This release
does not change any of those business policies automatically.
