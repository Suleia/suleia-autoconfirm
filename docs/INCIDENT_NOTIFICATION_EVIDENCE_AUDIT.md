# Notification-scoped incident evidence

Scope: canonical private Operations panel and read-only MCP, not live Render
rejection recovery or customer-impacting actions. No Chatby template/flow edits.

## Findings

- Incident creation was used as the response boundary; initial-order interactions
  could become incident evidence. Actual notification is now required.
- Persisted button selection preferred a recognized old intent over a newer
  unknown response. The latest eligible inbound message now wins chronologically.
- Provider template `payload.name` was omitted. Existing notification aliases
  are recognized without changing template delivery rules.
- Cached reads were restamped as fresh. The true provider-read timestamp and
  covered history start now survive caching and persistence.
- Historical append-only records and stored AUSENTE shadow decisions could be
  presented as current. SQL revalidates evidence and decision binding before
  filtering/counting/pagination; stale decisions remain historical.
- Incomplete or truncated history could be misreported as silence. A current
  exact-case read must cover the first observed notification. Missing proof is
  NOT_VERIFIABLE, never proof of customer silence or consent.

## Attribution and proposal rules

Require the exact issue/order pair, observed relevant outbound notification,
strictly later inbound input, a current case read covering that interval, and no
later provider failure. Initial lifecycle templates are context only. Overlapping
active issues using the same notification family fail closed.

The latest response includes unknown messages and changes of mind. Missing
capability, stale Dropea, unverified chat, and ambiguous input require review.
Rejection recommendations preserve the existing fixed-discount/24-hour workflow;
this read-only change does not execute or reconfigure it.

AUSENTE remains RECIPIENT_ABSENT_POLICY_V1 SHADOW. An unbound simulation cannot
revive a legacy return/retry proposal; it requires canonical recomputation with
date, custody, delivery attempt, calendar and declared capability. Timer creation,
duration and persisted deadlines are not changed by this migration.

## Verification

Focused synthetic tests cover before/equal/after notification, all recognized
families, exact identity, newer ambiguity/cancellation, missing notification,
truncated history, stale cached reads, outbound/system inputs and stale shadows.
Migration dry-run is validated against the private database inside a transaction
that is rolled back. Publication/deployment and post-deployment results are
recorded separately in the Agent Hub after actual verification.

### Deployed verification (2026-09-16)

- Exact canonical code release: `a3e7d113d803838563f379284238db674786a661`
  on isolated branch `fix/incident-notification-evidence`; not merged into Render.
- 556/556 canonical regression tests pass, zero skipped/failed, including a
  cache regression preserving actual provider observation/notification times.
- Migration 036 dry-run and real execution pass. The deploy helper now keeps
  migration stdin open and checks view existence before service activation.
- Actual private panel role: overview/detail pass; global invalid response
  attributions and invalid decision projections both zero. Independent MCP
  confirms original confirmation is no longer current incident evidence.
- Six filters using the real MCP read role match projected decision, QA,
  human-review, customer-response and evidence-status fields before pagination.
- Autonomous worker completes its first natural cycle: `first_cycle_complete`
  and `last_sync_ok` true, `last_error` null, zero messages/actions/writes.
- Current active cases require verified notification/history coverage, so the
  panel correctly reports missing proof instead of inventing customer silence.
  This does not mean that customers did not respond, or pause live rejection
  recovery. It is an honest limit of the currently ingested evidence.
- All 596 pre-deployment timer rows match the private backup byte-for-field:
  zero missing timers, changed invariants or changed existing rows. Comparison
  uses a temporary transaction-local table and rolls back.
- Public HTTPS assets match the exact release SHA-256:
  `app.js`: `4b28b41386eba6fa42474a2de3b1cddc89a4bf4d28510aba60a1b98ddd2ffcd0`,
  `styles.css`: `b737ff7945a973c3aee07ff19a2fc30e11566b95518ee407207e80ad26622c3a`,
  `index.html`: `6b4bcfc86c97c12754e7ac87c18fb4a0061d295df2240237249ef4cb0032148a`.
- Private HTTP without an authorized session returns 401. No browser was used;
  served assets and private read-model behavior were verified, not screenshots.
- Deployment checks preserve all pre-existing env/config/private mounts; no
  external messages/actions are executed by this correction.

Customer texts, phone numbers, operational case identifiers and credentials are
deliberately excluded from this repository report and coordination comments.
