# Telegram consultation freshness and Dropea synchronization recovery

Owner request: refresh campaign/order answers for the request date, reduce waits,
and avoid describing incomplete or old observations as exact current data.

## Deployed consultation changes

API/bot revision `58e976909927325c23a5bf5979a7fb37cb72aa62`, deployed
2026-10-27 22:42:54 UTC. API image `suleia-telegram-current:58e9769`, immutable
`sha256:bfedbf68d6e9ab6c1a79dfd582b346ddfe823beb23b3463a573c4fdeaea71cb7`.
Seven runtime files over the actual live `suleia-panel-data:141283d` image.
The branch incorporates the already-live PR162 changes with PR160 alerts;
only the explicit overlay files were deployed, never the whole repository.

- Ordinary campaign reads request a forced canonical refresh, including detailed
  review routes. Basic reports fetch only the requested entity level: controlled
  campaign Insights calls fall from nine to three. Existing shared requests,
  financial priority and provider cooldowns remain authoritative.
- Interactive basic reports wait up to ten seconds for the existing refresh job;
  timeout/failure retains its real observation time with a warning. The global
  report-cache default and financial revalidation are unchanged.
- Today/yesterday/relative-period buttons recalculate Europe/Madrid dates when
  clicked. Explicit historical dates remain fixed. Relative basic analyses also
  preserve their period in navigation.
- Orders re-read the canonical mirror on each new request. Query time and source
  observation time are distinct. A failed rolling-hour/48-hour read never returns
  an old rolling window as the requested one.

Real authenticated probes: campaign reads 4,709 ms and 3,990 ms, nine campaigns,
new request-time observation, partial metric coverage explicitly retained. Order
mirror reads 59–142 ms. These are observations, not future latency guarantees.
Unknown and cross-chat users rejected; Juan's existing alert subscription retained.

## Root cause discovered in Dropea

Read-only audit found `dropea_orders_canonical_order_id_key` collisions terminating
the existing ingestion cycle. At 22:43 UTC, only 46 of 2,290 mirrored orders had
recent observations; 13 orders created today still held old observations.
The current provider listing reported 2,291 records. No record was deleted,
merged, reassigned or marked exact to conceal this discrepancy.

Worker revision `b46133877189335f2a704c6ad3cde5a0a1d6b739` deployed 22:52:16 UTC,
image `suleia-telegram-identity:b461338`, immutable
`sha256:504d59f16fd7d3b72849786b135915ea3cd422ccbfa5723dbef03ed2433f467b`.
Only the canonical resolver and Dropea sync module changed over the exact running
`suleia-stabilization-ingestion-worker:9abd3852f22b5e18c7f7f90bde23411ae22e6047`.

An external reference cannot claim a canonical identity already bound to another
market/store/Dropea ID. That row follows the existing conflict exclusion path;
unrelated orders continue. Conflict count persists as checkpoint errors and keeps
source health degraded/coverage unverified. Existing exact identities and unbound
legacy reuse remain supported. No provider write, customer message, importer or
financial execution was introduced. Identity reconciliation remains necessary
before claiming that every source order is represented without ambiguity.

## Validation and recovery

79 initial focused tests; final isolated Node/PostgreSQL suite 585 tests:
582 passed, zero failed, three unrelated DB suites skipped. The new resolver SQL
test and existing incident/order-alert PostgreSQL tests actually ran with network
disabled and no production credentials. An initial new SQL test failed to locate
the repository's `pg` dependency; corrected to its existing package location and
reran successfully. Local Dropea/projector subset also passed all 41 tests before
the PostgreSQL case was added.

API deployment verified 103 untouched API modules and 18 untouched bot modules,
unchanged environments, financial policy, static panel and other containers. Worker
deployment separately verified both source hashes, unchanged environment and all
other container IDs. Same bot/poller, tokens, admins, notifications and existing
ingestion schedule; no new scheduler, AI model, API key or paid OpenAI use.

Private guarded recovery directories:
`/root/suleia-telegram-current-deploy/58e9769` and
`/root/suleia-telegram-identity-deploy/b461338`.
Restore actual previous code images and the prior bot link only. Never restore
business tables, notification receipts, financial ledgers or Telegram offsets.

## Limits

Dropea answers still depend on its existing ingestion cycle: requesting a report
does not force an instantaneous provider sync. Meta can report conversions late
and omit metrics. No promise of exact provider-real-time totals is made; partial,
stale or unavailable observations remain visibly qualified.

Handoff: PR170 contains the consultation improvement and the necessary source
recovery. Production-cycle verification is recorded below when observed.

### Observed recovery

The first repaired source read began 22:52:21 UTC, observed provider data at
22:52:35 UTC, and persisted its completed order checkpoint at 22:54:05 UTC.
Pagination completed for 2,291 source records; one identity conflict is explicitly
retained. All 2,290 mirrored orders and their operational projections now share
the new 22:52:35 observation, zero old rows and zero stale rows from today's
cohort. This proves recovery of the non-conflicting order refresh, not complete
coverage or global worker health. The worker may remain degraded and continue
its other existing phases. There was no forced provider mutation or conflict
resolution; the excluded identity needs separate evidence-based reconciliation.

