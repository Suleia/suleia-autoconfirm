# Telegram and V5.1 budget review reliability

Owner request: 23 October 2026, repair the Telegram error when preparing a
+10 EUR proposal for active campaigns with ROAS greater than 3.8, and audit
automatic budget reviews. Based on the deployed V5.1 source, excluding V6.

## Findings and correction

The production proposal endpoint returned HTTP 200 after 19,005 ms, while the
Telegram bridge aborted after 12,000 ms. The proposal could therefore exist
without reaching the user. The bridge now permits a bounded 45 seconds and
does not retry requests. Errors return an allowlisted diagnostic code and
direct the user to history before repeating a financial instruction. Neither
provider text nor credentials are returned or logged.

A multi-campaign proposal now captures minimum constraints once and reuses
that capture for its items. Concurrent reads coalesce; later confirmation
still reads fresh constraints. Failed evidence is not cached as verified.
The existing scheduler warms the existing GET-only learning task during the
45 seconds before a review; it neither claims a slot nor writes a budget.
Cold proposal protection preparation returns within eight seconds while the
same background read continues. No second executor or schedule was added.

Budget messages fit Telegram's text limit. Every eligible campaign's identity,
before/after budget and metrics must be displayed before confirmation is
offered. Oversized eligible selections require a narrower proposal. All-blocked
proposals have no confirmation button. Critical unverified night caps are
visible before campaign detail. The Spanish phrase “en aquellas campañas”
supports the same strict single ROAS filter; ambiguous alternatives still ask
for clarification.

## Financial policy retained

LIVE V5.1, fixed 10 EUR ordinary steps, 15 EUR minimum, 70 EUR campaign maximum,
1,000 EUR configured global exposure, 30 EUR cumulative positive changes per
Madrid day, no additional observed-spend ceiling, three initial purchases and
three new purchases after an increase. The special reductions, night caps,
actor confirmation, fresh revalidation, account lock, persistent claims,
uncertain-result reconciliation and first-write verification are retained.
Learning, external changes and insufficient evidence remain blockers.

At 06:52 UTC on 23 October the ledger contained 171 BLOCKED operations and no
own verified Meta budget write. Meta subsequently confirmed active learning
and same-day external budget/status changes. An enabled LIVE scheduler does
not mean a change was applied. The previous night cap was not certified and
must not be reported as achieved.

## Validation

361 tests passed on the production Node 22 runtime with an ephemeral
PostgreSQL 17 socket-only database, no network or production credentials,
including transport delay, safe errors, message size, actor authorization,
V5.1 policy, incremental evidence, locks, idempotency, scheduler, uncertainty
and fresh readback contracts. Production containers were unchanged by tests.

Deployment uses a source hash check against the existing API/bot, a minimal
API image overlay and atomic bot module replacement with backups. It keeps
the existing runtime policy, identities, token, panel and unrelated services.
Rollback restores the previous API image and bot modules; never delete ledger
claims or replay an uncertain write.
