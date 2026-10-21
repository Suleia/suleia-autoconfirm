# V4 validation — 2026-10-21

Candidate only, on existing draft PRs #115 and #116. No production deployment,
merge, migration, timer, notification or real campaign/budget mutation.

## Executed checks

| Scope | Environment | Result |
| --- | --- | --- |
| Ads + legacy budget policy + API + panel regression | Windows/local loopback | 226 pass, 0 fail, 1 optional PostgreSQL skip |
| Same VPS artifact | Linux, Node 22.22.0, network-disabled read-only container | 226 pass, 0 fail, 1 optional PostgreSQL skip |
| Shared Ads + existing Telegram consumer | Linux, Node 22.22.0, network disabled | 122 pass, 0 fail, 1 optional PostgreSQL skip |
| Migrations 054/055/056, claims, concurrent confirmation and journal | Ephemeral PostgreSQL 17.5, Unix socket only, no network/ports, synthetic data | Pass |
| Desktop/mobile local UI | 1440×1050 and 390×844, external network blocked | Pass; zero JS errors and horizontal overflow |
| Candidate Compose | `docker compose config --quiet`, no secret file loaded | Pass; expected unset-secret warnings only |
| Whitespace/diff integrity | `git diff --check` | Pass |

Groups overlap: do not add these counts as distinct tests. The original V3
groups remain included, along with the legacy night/day simulation tests.

Commands:

```text
node --test services/meta-ads/*.test.mjs services/meta-ads/budget/*.test.mjs apps/api/*.test.mjs apps/review-panel/*.test.mjs
node --test services/meta-ads/*.test.mjs infrastructure/telegram-center/*.test.mjs
ADS_TEST_ISOLATED=true node --test services/meta-ads/ledger.integration.test.mjs
node scripts/ads/algorithm-visual-check.mjs
```

The PostgreSQL test cannot take a production URL: it fixes database
`ads_v2_test`, user `postgres`, Unix socket path and explicit opt-in. The isolated
runner has no external network. Concurrency tests verify one proposal execution,
duplicate-request identity and zero writer invocations. Journal insertion is
idempotent and roles cannot update/delete evidence. 056 remains unapplied in
the operational DB.

Visual QA uses the actual V3/V4 HTML/CSS/JS in a loopback harness and private real
audit snapshot. It tests calendar/series selection, hiding incompatible traffic,
timeline expansion, scenario form, internal fixture review, source error states,
hostile HTML names and responsive layout. UI requests cannot leave loopback;
internal journal writes are test fixtures. Screenshots and request/error logs
are private delivery artifacts, not public sample data.

Performance on the private real 30-day evidence: analysis 1.70 seconds; full uncompressed JSON 3.98 MB for 828 timeline events. Reusing the Madrid formatter and compacting repeated comparison metadata reduced the initial 5.43 seconds / 6.47 MB. Cold provider capture can exceed two minutes; Telegram therefore returns a bounded preparation reply and reuses the same in-flight read. Load/rate measurement remains required before enabling refresh in production.

## Mandatory V4 cases

Covered: clustered chance reference; traffic concentration hypothesis; batch
receipt vs source time; Meta vs Shopify clocks; several hours without purchases;
single-purchase high ROAS; declining CTR with stable frequency; high frequency
without deterioration; CPM increase with stable ROAS; simultaneous creative
change; native-rule conflict; duplicate Telegram confirmation; missing ROAS;
stale/invalid timestamps; missing attribution; 23/25-hour DST days; night decrease
and morning increase; partial API failures; incomplete causal/outcome windows;
unverified hourly conversion clock; external budget mismatch; mature COD cohorts;
ambiguous UTM fields; provider status changes vs budget scheduling; current-day
history absence; exact account checks; parameterized READ ONLY operational joins;
OAuth refresh injected at the API boundary; same cached report in conversation.

The existing architecture-isolation test initially caught a direct operational
auth import. It was fixed through API-layer injection, without weakening the
test. Initial Linux packaging errors were missing fixture/source files; the
complete artifact passed unchanged tests. Automatic approval rejected an earlier
bulk-copy command; explicit reviewed diffs replaced it. Nothing remains blocked
by that rejection.

## Read-only production evidence

Private capture: 21 September–20 October 2026, 30 complete Madrid days. Meta
35 GET initial + 18 GET supplementary; zero Meta writes, operational DB writes
or Telegram sends. Shopify: 425 selected-field orders, two pages, existing OAuth
authentication. Operational queries were explicit READ ONLY transactions.

132 campaign/day, 352 adset/day and 442 ad/day rows reconcile EUR3,482.72 spend.
413 purchases are observed in available aliases at each hierarchy; 17 campaign
daily rows lack the required purchase alias, so the complete aggregate ROAS/CPA
is not fabricated. 2,838 hourly traffic rows; 2,850 action breakdown rows with
unverified physical-conversion clock. 315 amount edits in the historical range;
156 current-day activities kept outside that range. Current native rules: none
returned. No historical VPS-simulator decisions over the interval.

425 Shopify creation timestamps, 412 exact source-recorded ad IDs, 13 unattributed
orders. Exact-reference HMAC join: 418 unique operational matches, 321 confirmed
timestamps and 195 delivered timestamps. Exploratory mature cohort: 203 orders
created by 6 October, 100 delivered; this is not cash settlement or net profit.

Health/read checks preserve the relevant services and existing incident/import
timers. Historical receipt timestamps are incomplete; source-to-first-mirror
lag is measured only for the available Dropea mirror, not claimed as complete
Shopify-to-display latency.

## Limits before deployment

No causal experiment, cash-settlement ledger or full per-order actual cost link
has been validated. Meta help pages returned 429/login; official SDK fields and
real GET responses were available. Budget changes are observational; Power
Editor identifies the application, not the human/automation responsible. Exact
physical conversion hours remain unverified. Current 100 EUR/10% limits are
unchanged; existing V1 simulated policy is documented separately. A proposed
new financial policy, source capabilities, notifications and LIVE each need
their appropriate later review/authorization.
