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

Customer texts, phone numbers, operational case identifiers and credentials are
deliberately excluded from this repository report and coordination comments.
