# Panel data repair — 23 October 2026

Owner scope: restore the established panel format and correct available data in
Results, Ads Intelligence and Incidents; audit every existing section. OpenAI
Command Center 3.0 remains pending and its approved daily API cap is USD 0.

## Reproduced causes

- The October Render finance source has a verified purchase cohort, 23 daily
  rows and six months of history, but explicitly withholds exact profit because
  four delivered units lack a verified product cost. The Operations adapter
  required a numeric exact profit to accept the entire source. It switched to
  an event-date calculation; the purchase-cohort UI correctly refused to display
  that incompatible basis, hiding valid revenue, graphs and history as well.
- An expired access token froze automatic refresh. A later unauthorized read
  showed a login screen without preparing its PKCE link. A forbidden resource
  also incorrectly signed out the whole panel. Both were reproduced separately.
- The executive report tab initially loaded history without opening its report.
  Its ordinary refresh discarded the selected report.
- A minimum 250px human-review card overflowed the narrow Incident result cell.
  The generic execution label did not identify whether a verified action was a
  notice, message or actual resolution.

## Repair boundaries

Keep a partial purchase-cohort source only with explicit incomplete coverage,
observed revenue and exact dated order membership. An explicit event-date source
cannot be relabelled. Preserve known revenue, counts, complete days and history;
unknown product/return/revenue inputs leave their affected amounts null. A gap
also invalidates subsequent cumulative profit. Quality warnings are readable,
and the missing-cost notice is visible above the original KPI/chart layout.
No cost, zero, tariff or financial outcome is invented.

The immutable-release preflight detected a newer published incident JS baseline
(normalized SHA256 f0f69d3232b3b3ccae8b442ec6dccc2e695e76c4067465e147ba024b8e47f3d2).
Preserve and incorporate its reopened-discount reconciliation notices and actual
before/after-opening response timestamps; do not overwrite them with the older
V8 branch file. Added regressions cover both existing production corrections.

Use the existing OAuth refresh grant when the existing login supplies a refresh
token. Keep and rotate it only in sessionStorage, coalesce concurrent refreshes,
and clear it on logout/failure. No new scopes, offline access, credentials,
roles, authentication bypass or server expiry changes. A failed/absent refresh
prepares normal PKCE login; 403 preserves the authenticated session.

Opening Reports reads the latest or selected persisted report automatically;
it never generates, sends or changes it. Human-review text stays fully visible
inside the table, and execution labels name the particular action.

## Validation and deployment

Regression cases first failed for partial-source basis, event-date rejection,
expired-session login, silent expiry and automatic report opening. Focused
financial and panel suites pass locally. The broad Windows test run encountered
loopback EACCES, so it is not release acceptance evidence. The exact artifact
must pass isolated Linux tests and real read-only view checks before deployment
is declared verified.

Deploy only the finance read adapter and static panel assets over API867b3e0 /
panel e231c06, retaining immutable prior artifacts for rollback. No schema,
bot/poller, provider automation, messages, budget executor/policy, schedule,
recipient or Meta settings are changed. Preserve all existing credentials and
effective runtime flags. Deployment and final evidence are recorded below only
after verification.

Four missing product-cost units are source-data incompleteness, not a reason to
show fabricated exact profit. This repair does not claim that incident
automation blocks, provider coverage or Budget Autopilot eligibility are solved.

## Release acceptance and current status

Runtime candidate: e767d13ec3d691ca4a5aa084010e92b56dc3c501, image
`suleia-panel-data-repair:e767d13`, immutable ID
`sha256:f37d27aac887de428440809be24d05c597d1d26afa2023216d0eb0c9c72ee741`.
Eight runtime files: seven static panel assets and one finance read adapter.
All 1,129 tests in 110 files passed on Linux Node22 with isolated PostgreSQL17,
zero skips, network none, read-only fixture mounts and no production credentials.
Initial isolated harness omissions were repaired before this complete result;
they were not application failures or production changes.

Read-only production audit: Orders shows its actual 12 pending rows and current
summary; Automation loads persisted workflow stages and recent verified notice
actions; Analytics shows its 449-order 30-day cohort, geography, hourly charts,
funnel and tables with explicit unknown net-profit coverage. Ads overview
completed a real fresh canonical Meta read with campaign table and graph after
ordinary OAuth renewal. These are pre-release observations, not proof that the
repair is deployed or that every autonomous business action is working.

HTML, JS and config responses are HTTP200 with Cache-Control:no-store. The
existing issue and finance report contracts were inspected directly without
logging customer information. No provider actions or test messages were sent.

Automatic approval review initially rejected application and requested separate
post-test owner approval, citing the Command Center 3.0 approval condition. No
workaround was used. The owner then explicitly answered **“Sí, desplegar la
reparación de la PR #143”**, excluding OpenAI activation. The exact accepted
e767d13 artifact was applied on 2026-10-23 at18:32:29UTC /20:32Madrid.

API is healthy on the immutable image above; panel mount is
`/opt/suleia-panel-releases/panel-repair-e767d13`. Every effective environment
variable is unchanged except build revision. Bot PID/config, permissions,
recipients, schedules and unrelated container identities are preserved.
Independent18:37UTC verification matched all seven served asset hashes and all
19 protected budget source hashes; six unauthorized routes still reject401.
OpenAI is not configured in production. No schema or provider changes.

The real finance read now uses `ORDER_CREATION_COHORT_FINAL_BREAKDOWN`, revenue
6063.01EUR,23dailyrows,21complete-profitdays,twoexplicitgaps and six historical
months. Four unknown product-cost units still prevent exact monthly profit.
An already-queued source refresh completed at18:37:43UTC; independent18:40:32UTC
read confirmed refreshingfalse,stalefalse,pendingfalse. No duplicate worker was
started. Incidents returned13currentrows with three observed customer responses
and two human-owned response reviews. GET-only canonical Ads reads completed
with32campaignrows and zero external writes:7d source18:38:05UTC,131purchases,
ROAS3.3360753. Today's incomplete purchase/ROAS aggregate stays unavailable;
freshness alone never invents a missing metric.

After the owner's personal login, read-only production browser checks at
20:59–21:14 Madrid verified the repaired Resultados layout, six chart cards,
23 October daily rows and six history months. September selection separately
loaded 30 daily rows and its complete reconciled figures (887.57EUR profit,
9187.15EUR revenue); October was restored. Ads completed a current Meta read
at21:09:27, showing 32 campaign entities, comparison, metrics and evolution.
Reports automatically opened the latest persisted manual report with its full
content and delivery history; no report was generated or sent. Incidents showed
13 active cases, three observed replies and readable human-review cards inside
their result cells. The page had no outer horizontal overflow at1521px.
Automation loaded persisted stages and action evidence; Analytics loaded its
453-order cohort, map, hourly chart, funnel and tables. Missing coverage remains
explicit and is not proof of autonomous resolution. Navigation and reads stayed
authenticated beyond the ordinary five-minute access lifetime, without another
login; token contents were not inspected.

This final audit reproduced an additional Orders navigation defect: entering
from another section without a cached global summary showed real rows but zero
counters until manual refresh. The queue loader now reads summary and rows
together, with the same abort/request/view guard; refresh uses that same path
instead of a second unguarded summary request. A failed read preserves the prior
consistent display and exposes the error. Incidents retains its own scoped
summary. Four behavioral regressions were added; the original code failed two,
and all36 affected panel tests pass after the correction. This follow-up only
changes app.js and requires a static-panel-only release; API, bot and workers
must not be restarted. Final follow-up deployment evidence is recorded below.

The owner explicitly chose to leave OpenAI pending with a0USD allowance.
No OpenAI key is installed in production, and no OpenAI calls were made.

Private VPS preparation and test evidence:
`/root/suleia-panel-repair-20261023/e767d13/`.
The deployment script checks an idle safe budget window, no uncertain/executing
operations and unchanged runtime, then compares the entire effective API
environment (only build revision may differ), bot PID/config and every unrelated
container identity. The prior runtime override and immutable images/panel paths
are retained for guarded rollback; no SQL rollback is necessary.
