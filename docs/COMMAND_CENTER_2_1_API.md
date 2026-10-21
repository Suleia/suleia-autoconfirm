# Command Center 2.1 — shared API delivery

Owner-authorized deployment verified on 2026-10-21. Based on PR #123 (`1b02399`), paired with the Telegram changes stacked on PR #124 (`031d5eb`). No provider messages, budget changes, Dropea writes or new polling process.

## Implemented

- `services/command-center/order-summary.mjs`: bounded canonical read from `read_models.operations_order_context`, not the pending queue. Deduplicates market/store/provider ID, uses confirmation timestamps after logistical transitions, gives cancellation precedence and keeps unresolved statuses explicit. Created-today cohort, confirmation events today and rolling last hour are distinct. Madrid calendar boundaries include DST. Only non-personal columns are read.
- Each request checks row `source_updated_at` and `observed_at`, connector success/failure and pagination. Freshness requires complete metadata and less than 60 seconds. Reads are coalesced, database query timeout is 2 seconds, response wait 2.5 seconds, row cap 20,000 with explicit incomplete status on overflow. Failures return a same-day reliable snapshot with an age warning, or unavailable without invented counts.
- Existing API role has no safe read-refresh capability exposed by its repository. `refreshSupported` is false; no ingestion worker or credentials are invented. The reader accepts a future authorized refresh adapter, coalesces it and rereads afterward. The existing importer remains the source owner.
- `center.mjs`: routes the requested Spanish order questions and business analyses; callback reads use the existing actor allowlist and capability roles. Today/previous-day comparison is explicit and does not imply equal elapsed windows.
- Shared Meta runtime: 120-second freshness based on actual observation, calendar-bound cache keys, forced coalesced refresh, 4-second wait budget, stale fallback. Background reads reuse the existing bounded/paginated GET-only client. No duplicate client or Supabase historical primary source.
- Explicit catalogue via `ADS_VERIFIED_PRODUCT_LINKS_JSON`: array of `{campaignId, source, validatedAt, coverage: "COMPLETE", products: [{productId?, sku?, name}]}`. At least one exact product ID or SKU is mandatory. Ambiguous/partial/future mappings produce no identification. Campaign names never infer products. Both API consumers receive the same mapping/metrics; V3 profitability label now says “Validar margen” without verified economics.

## Verification

97 tests pass:

`node --test services/command-center/*.test.mjs services/meta-ads/product-links.test.mjs services/meta-ads/report*.test.mjs services/meta-ads/algorithm*.test.mjs services/meta-ads/meta-ads-client.test.mjs services/meta-ads/purchase-roas.test.mjs services/meta-ads/executor-transport.test.mjs`

Covers historical 22/17/4/1, SHIPPING confirmation, older-order confirmation today, duplicate identities, Madrid midnight/DST, outages, partial coverage, concurrency, read-only queries, forced refresh, missing/ambiguous ROAS, equal ranking inputs, V4 sample protection, and shared panel/Telegram snapshots. SQL transport is mocked in these tests; query permissions/plans and ingestion coverage must be checked on staging. No live Meta reconciliation is claimed.

## Release gates and rollback

Require full Linux/Node 22 Telegram tests, live read-only SQL verification, source coverage, a validated product catalogue where desired, real panel/Telegram Meta reconciliation and cold/warm p50/p95 measurements. Real MCP observation at 20:58 Madrid found 22/18/3/1; the 20:28 22/17/4/1 reference is historical fixture evidence only.

Deploy API before Telegram after owner authorization, retaining all existing credentials and no new grants. Preserve later incident changes when composing release artifacts. Record previous immutable API and Telegram releases and state backup. Roll back only these reporting commits and the single existing Telegram service release; no schema migrations are introduced. Complete deployment and rollback procedure is in the companion Telegram `docs/COMMAND_CENTER_2_1.md`.

## Verified production activation — 2026-10-21

- Active API artifact: `eb510a8ca04ed5925e47417c718fb677bca7e060`, image `suleia-command-center21-api:eb510a8`. Previous image `suleia-command-center2-api:97786dd` retained.
- Independent review found and fixed a stale-fallback presentation regression. The served Ads panel now places an accessible historical-data warning before numbers and recommendations when `cache.status` is `STALE`.
- Full Linux/Node22 API/panel group: 271 passed, zero failures, one unchanged optional PostgreSQL integration skipped. The real canonical query was separately run with the existing read-only operations role: both views accessible, read-only default preserved, 377 ms measured. No migration or new grant.
- Actual read-only source check returned complete metadata and internally consistent cohort/event counts. The importer copy was older than the 60-second threshold and was correctly labelled STALE; no real-time Dropea refresh is claimed.
- Signed real API reads worked for both existing administrators; unknown actors and crossed chats were rejected, and the public reporting route still requires OAuth. Both actors received the same Meta range, attribution, totals and observedAt from the canonical runtime; campaign/ad/adset reads passed. Shared panel routing and served artifact were checked, without claiming a new authenticated browser session.
- Eight warm API reads measured p50 406 ms / p95 1185 ms; this small canary is not a production SLA or Telegram network latency measurement. The cold request returned the bounded preparing response after 4154 ms; coalesced forced reads retained explicitly marked stale data while the background read completed. Missing validated campaign/product catalogue remains unlinked.
- Only the API and panel containers changed. The panel was copied from the actual current release and only `ads-intelligence-v3.js` replaced; later incident-panel PR #127 and all other public files were byte-preserved and checked over HTTPS. All unrelated container identities remained unchanged.
- Meta remains SHADOW with writes false; existing credentials, administrators, database roles, spend limits and operational automations were preserved. Private receipts and logs: `/root/suleia-command-center21-20261021` on the server.
