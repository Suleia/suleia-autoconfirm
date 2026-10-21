# Command Center 2.1 — shared API delivery

Development only, based on PR #123 (`1b02399`), paired with the Telegram changes stacked on PR #124 (`031d5eb`). No deployment, provider messages, budget changes, Dropea writes or new polling process.

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
