# Command Center 3 — verified deployment

Verified 2026-10-22 Europe/Madrid. PR #132 is stacked on the API PR #128;
it includes the Telegram modules already introduced by PR #131. No PR was merged.
Runtime revision: `8985416b87ef480d9b0effb976cd6931be467964`.

## Active behavior

- Existing Telegram service, identity, two numeric administrators and durable offset.
  One poller; fresh health reports `SHARED_CONFIRMED_BUDGETS`.
- Only campaign daily budgets can be written. A specific proposal must be confirmed
  by its original actor/private chat within five minutes. Revalidation, durable
  claims, account and campaign locks, read-back and uncertain-result reconciliation
  remain mandatory. No automatic budget optimization or pause/create/delete action.
- Limits approved by the owner: EUR 100/day per campaign; 10% per change;
  EUR 30/day aggregate positive budget increases in Madrid time; one change per
  campaign per 24 hours. Pending/unknown executions reserve the relevant allowance.
  The independent learning protections can impose a stricter delay or block.
- ROAS-filter orders require EUR 15 spend, five purchases and 1,000 impressions.
  Recommendation buttons retain the exact campaign and ROAS threshold during
  revalidation. ROAS +10 means >10; ROAS -3 means <3, not a negative profitability claim.
- Explicit confirmed budget changes do not require claiming verified profitability.
  Missing verified margin remains a warning and the diagnostic recommendation
  continues to abstain. Other existing learning protections remain blocking.
- Natural order summaries support today, yesterday, 14/30 calendar days, rolling
  48 hours, a specific date, date ranges and this month in Europe/Madrid with DST.
  “48 horas antes” asks for clarification. Current states of a creation cohort are
  distinct from confirmation events within the interval; past as-of states are not
  reconstructed without historical evidence.
- Product charts count an order once per product, use provider identity, preserve
  units separately and refresh the same Telegram message. Unknown identity/quantity
  and incomplete coverage are visible.
- PDF and PNG reports include orders, prior complete-period comparison, Meta totals,
  campaign ROAS, up to three priorities, own verified changes and pending proposals,
  source times and limitations. Dropea orders are never added to Meta purchases.
- Daily PDF defaults to 23:55 Europe/Madrid for existing authorized users. It is a
  provisional close. Settings persist per actor. Generation retries are bounded;
  a durable send claim precedes delivery and uncertain sends are never retried.
  No second daemon, poller or importer was added.

## Commands

`Cómo van los pedidos ahora`, `Cómo van los pedidos hoy`,
`Dame información de los pedidos`, `Pedidos de hoy`, `Pedidos de ayer`,
`Pedidos de los últimos 30 días`, `Pedidos de las últimas dos semanas`,
`Pedidos de las últimas 48 horas`, `Pedidos del 15 de octubre`.

Use **Ventas por producto**, then **Actualizar gráfica**, **Recibidos**,
**Confirmados** or **Unidades**. Use **Cambiar periodo** for common intervals.

`Sube 10 % el presupuesto de <ID exacto>` prepares a proposal; it does not execute.
`Baja 10 % el presupuesto de todas las campañas con ROAS inferior a 3 hoy`
retains sample/ROAS conditions. **CONFIRMAR** executes only eligible, revalidated items.
`/estado` shows actual mode and limits; `/historial` and `/reconciliar CÓDIGO`
reuse the existing ledger.

`Dame el informe de ayer en PDF`, `Dame el informe de hoy en imagen`,
`Informe diario a las 23:55 en PDF`, `Desactiva el informe diario`,
`Activa el informe diario`.

## Evidence and limits

- Final Linux Node 22 suite: 312 passed, 0 failed, 1 optional PostgreSQL integration
  excluded from that run. The isolated PostgreSQL 17 integration was run separately:
  1 passed, 0 failed. Windows loopback restrictions were not treated as code failures.
- Current canonical SQL, read-only source permissions, account advisory lock, budget
  usage and actor-scoped audit reads were checked with existing credentials in memory.
  No additional grants, credential dumps or historical importer were introduced.
- Both existing administrators can read LIVE status. Unknown actors and cross-chat
  requests return 403. All nine requested phrase/period examples returned summaries.
- Actual signed API order-query samples took 76–1,120 ms (nine samples); direct SQL
  samples took 89–613 ms. These are measured samples, not a network latency guarantee.
  Cold Meta reads may return a preparing/partial-source result before the shared
  background read completes. Rendering adds processing time.
- Example observations: yesterday 28 received/22 confirmed/5 pending/1 cancelled;
  rolling 30 calendar days 426 received/328 confirmed. These are dated observations,
  not live numbers to hard-code. Historical provider records already persist; the
  existing importer remains their only owner.
- Full pagination/projection coverage was checked; a subsequent sync-in-progress
  report correctly marked coverage unverified. Source freshness was STALE under
  the existing 60-second criterion. Buttons re-read the mirror; they do not promise
  immediate provider re-ingestion. The importer timestamp is always displayed.
- Real aggregate PDF/PNG and product graph were generated and visually checked.
  The example report obtained Meta data without source errors. No real Telegram
  test message or budget mutation was sent. `ads_management`, `ads_read` and
  `business_management` were granted in the existing provider token. This verifies
  permission and wiring, not a completed real financial write.
- Daily scheduling/deduplication was tested with mocked Telegram transport and
  restart cases. First scheduled real delivery is not yet observed.
- All unrelated container IDs remained unchanged. API health is healthy; Telegram
  lock matched its MainPID after switch. Existing secret files remain private.

## Deployment and recovery

API image: `suleia-command-center3-api:8985416`, built as a layer over the previous
API with only `services/command-center` and `services/meta-ads` replaced.
Telegram: `/opt/suleia-telegram-releases/release.command-center3-8985416`.
Renderer: isolated `/opt/suleia-report-runtime`, ReportLab 4.4.9 and Pillow 12.3.0.

Private state backup and non-secret rollback settings:
`/root/suleia-command-center3-8985416/`. The rollback receipt stores only changed
non-secret keys; it does not duplicate credentials. Scripts are retained at
`/root/suleia-command-center3-8985416/settings.py` and `deploy.sh`, with working
copies in `/tmp` and on Juan's workspace.
Do not rerun the activation script: it deliberately rejects an already changed baseline.

To roll back, stop `suleia-telegram`, run
`python3 /root/suleia-command-center3-8985416/settings.py rollback`,
recreate only the API with the same three compose files and `--no-deps --no-build`,
then atomically point `/opt/suleia-telegram` back to
`/opt/suleia-telegram-releases/release.command-center21-ec2ab0a` and start it.
Keep the current offset/state; do not rewind and replay messages. Verify fresh
health, API health and the sole poller lock. Prior API image is
`suleia-command-center21-api:eb510a8`.

To disable budget writes while keeping reads, set API mode `SHADOW` and
`ADS_INTELLIGENCE_WRITES_ENABLED=false` together, recreate only API, then set
`COMMAND_CENTER_BUDGET_WRITES_ENABLED=false` for the bot and restart that single
service. Existing LIVE proposals cannot execute after a mode/policy change.
Legacy `META_WRITES_ENABLED` remains false throughout. To disable default daily
reports set `COMMAND_CENTER_DAILY_REPORT_ENABLED=false`; explicit per-user saved
settings take precedence, so use each user's “Desactiva el informe diario” command.

## Files

`services/command-center/{center,order-summary,periods}.mjs`,
`services/meta-ads/{runtime,intelligence,ledger,intent,executor-transport,command-service}.mjs`,
Telegram config/service/controller/API/gateway/compact reports, new artifact renderer
and daily scheduler, installer/example environment and focused tests.

## Agent Hub handoff

FROM: Codex
STATUS: verified
SCOPE: PR132, existing Telegram Command Center and API budget executor/reporting.
EVIDENCE: Runtime8985416; 312 Linux tests plus isolated PostgreSQL integration;
signed production reads, PDF/PNG visual inspection, single poller and API healthy.
LIMITS: No actual budget write or real scheduled delivery used as a test; provider
mirror freshness and learning guards remain visible. No unrelated workers changed.
NEXT: Observe the first user-confirmed eligible budget operation and first scheduled
report under the existing owners; never retry an uncertain financial/send result.
