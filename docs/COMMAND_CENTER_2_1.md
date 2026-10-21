# Command Center 2.1 — Telegram development delivery

Prepared 2026-10-21. Not deployed. Based on PR #124 / `031d5eb` (the existing Telegram gateway); companion API changes are based on PR #123 / `1b02399`. Existing V3/V4 readers, actor authorization, admin linking and sole polling process are retained. No live Telegram messages, Meta changes or Dropea actions were executed.

## Changes

- `compact-reports.mjs`: escaped HTML, bold ROAS, deterministic ranking, four campaigns per page, two entities per diagnostic page, real observation dates, stale/coverage warnings and up to three evidence-backed recommendations. Active campaigns without a valid ROAS remain visible as N/D; one purchase is not a winner. Explicit product mappings only.
- `ads-gateway.mjs`: formats canonical API reports and supports bounded read-only navigation requests over the existing signed bridge.
- `controller.mjs`: durable opaque buttons tied to numeric actor, private chat and original message. Refresh edits the original message; per-message concurrency and two-second cooldown prevent repeated refreshes. Errors retain the previous report. Tokens expire after 24 hours and are bounded in number.
- `api.mjs`: sends intact HTML messages with a hard size limit. Existing plain-text and proposal behavior is retained.
- `compact-reports.test.mjs`: formatting, ranking, identity, refresh, edits, failures and no duplicate polling/message regression coverage.

## Evidence and limitations

`command-center-2-1-evidence.json` records example message bodies and actual navigation request structures from the formatter. Meta values are explicitly synthetic. It is protocol evidence, not a screenshot or proof of live Telegram delivery.

Real read-only Dropea query on 2026-10-21 returned 22 distinct orders created in the Madrid business day: 18 confirmed, 3 pending and 1 cancelled. All 22 rows were returned; observation 20:58:10 Madrid, query measurement 21:00:18. The cancelled row has FINISH provider status and CANCELLED lifecycle status; confirmation timestamps correctly identify logistics-advanced orders. Import coverage is not independently certified. The 22/17/4/1 reference at 20:28 remains a historical fixture and is not hardcoded in production.

Measured offline formatting (100 runs): median 0.886 ms, p95 1.727 ms, maximum 26.797 ms. Real MCP read took 16.1 s; this is not the bot/API path. End-to-end Telegram latency and the 3s/5s objectives remain unverified. No live Meta credentials/bridge or Telegram deployment session are available in this workspace.

Focused Telegram validation: 39 tests across compact reports, gateway and admin link. Companion API validation: 97 tests. The full existing Telegram suite cannot pass on this Windows host because its Linux-specific directory fsync and symlink/storage checks raise EPERM; no production storage guarantees were weakened to bypass this. Re-run the full suite under the supported Node 22/Linux runtime before release.

## Deployment and rollback (requires owner authorization)

1. Review both stacked PRs and compare with the current deployed revisions. Preserve later changes, including incident panel PR #127; do not replace a whole current release with an older branch snapshot.
2. Run full Telegram, Command Center, Meta and API regression tests on Linux/Node 22. Verify the canonical order query with the existing read-only database role, complete importer coverage and the real historical reconciliation.
3. Deploy only the companion API changes first, retaining existing credentials, financial controls, permissions and database grants. No migration or new secrets are required. Optional `ADS_VERIFIED_PRODUCT_LINKS_JSON` needs operator-validated entries; missing mappings do not block reports.
4. Exercise authorized read-only bridge requests for orders, campaigns, diagnosis and ads; compare panel and Telegram data from the same snapshot. Measure cold/warm and concurrent p50/p95 latency and verify provider errors/stale fallbacks.
5. Stop the existing Telegram service, back up its state and record its immutable release path, switch that same service to the reviewed Telegram build, restart once. Never start a second poller. Preserve allowlist and admin verification files.
6. With explicit permission to send test messages, verify refresh/edit/pagination with both authorized administrators and denied identity cases. Capture masked Telegram evidence.
7. Roll back by stopping that service, restoring the recorded previous release and restarting once. Extra read-button state is ignored by the older code. Revert only the companion API commits if needed; retain later unrelated fixes. No database migration rollback or provider mutations are required.

## Handoff for the repository owner

FROM: Codex
STATUS: implemented in development; live acceptance pending
SCOPE: existing Telegram gateway and shared Command Center reporting
EVIDENCE: focused tests and anonymized protocol evidence above
RISKS: full Linux suite, source coverage, real Meta consistency and latency need server verification; no on-demand Dropea refresh capability exists in the current API role
NEXT: review companion changes and perform authorized staging verification before requesting production deployment

No Agent Hub comment was sent from this chat; this handoff is ready for the owner to post.
