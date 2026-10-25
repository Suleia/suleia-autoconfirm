# Suleia agent handoff

## 2026-10-25 · Business Intelligence V2 deployed

Owner requested the existing data section's BI V2 redesign and approved the
fresh reconciled cut instead of freezing screenshot487/373. Runtime debef0f is
live in API/MCP/materializer and the panel, PR149 stacked on PR148. Final isolated
Node22/PostgreSQL17 run:1307passed/0failed/0skipped in144files, archive
bf93172ccb7ebf094e3aa93490ec6d663a494ba248e867acfe8f87f13734cdf3.
The exact MCP image additionally passed6/6 asUID100; all three images import as
UID100.17component overlays verified;19budget files, operational environment,
botPID/config, financial rates and unrelated production containerIDs preserved.
No schema/grant, finance formula, logistics/budget policy or external action.

Applied12:08:31UTC; post-check12:15UTC reconciles493orders,377confirmed/sent,
212delivered,75returned,147incident orders,6732.79EUR realized revenue,
-1225.76EUR exact global recognized net profit; missing costs0, province unknown0,
financial order delta0. Maturity92/228/173. Twelve live read-role MCP contracts
fit50KiB (maximum46583bytes); warm SDK p95ms overview495,geography68,hour92,
patterns160. This measures the read-role SDK path, not an HTTP SLA. Six financial
months reconcile; private fact read and operational/analytics writes remain denied.

Chrome local DEMO1440/820/390 and all six production views checked; BI7KPIs,
52province paths/168heatcells and no raw sample codes/overflow; Finance36SVG,
Ads38SVG/populated, orders18rows, incidents10rows, automation loaded; zeroJS
errors. Personal OAuth completed after a wait. Production screenshot capture
repeatedly timed out; committed screenshots are DEMO only. No auth policy changed.
An initial packaging attempt rolled back safely; final images enforce readable
COPY permissions and pass unprivileged startup checks. The public verifier was
corrected to existing /operations/health and /operations/api/... prefixes;
no production route was changed to satisfy it.

Private captured baselines/compose/env/backups/receipts are under
/root/suleia-business-intelligence-v2-deploy-20261025/debef0f/; historical failed
attempts remain separate. Rollback restores captured V11 API/static and original
MCP/materializer, not historical SHADOW. Materializer4 only transactionally
regroups existing analytics JSON cells/precomputes; source operational tables
unchanged. See BUSINESS_INTELLIGENCE_V2.md and deployment.md/.json.
Do not treat this BI release as a budget/incident automation repair or apply the
separate V6 proposal silently. Preserve canonical denominators, exact finance,
mature comparisons and existing writer/canary controls in subsequent work.


## 2026-10-24 · Ads Intelligence V10 owner-approved deployment

The owner subsequently approved PR147 deployment and a narrow production V10
browser verification. At20:50:15UTC the exact21-file overlay7224c11fad4a5557732da7c935ff3bef5d2c0f35
became healthy, image suleia-ads-growth:7224c11 (a02a3618…), static mount
/opt/suleia-panel-releases/ads-growth-7224c11. The earlier development-only entry
below is historical. All21runtime hashes and9served hashes verified; public
health200, growth/journal/finance/incidents401 without OAuth. Public version URL
is not routed; verifier reads the existing internal /version instead. No auth
policy changes or production code repair was required for that verifier error.

Fresh private backups/authorization/applied/http evidence reside at
/root/suleia-ads-v10-deploy-20261024/7224c11/. Rollback retains finance-f72bf2c
image and finance-cogs-a2f2f4f static, never an older SHADOW runtime. Existing
deployment lock, idle-slot and pending/uncertain-operation gates passed.
All19protected hashes, policy env, botPID/config, unrelated containerIDs, financial
tariffs and unrelated static hashes remained unchanged. Render d175378 healthy;
V5.1 remains owner-authorizedLIVE, OpenAI0USD, one Telegram recipient/scheduler.
Today's report already had4SENT before deployment; no test/replay report sent.
No migration, new SQL grants, customer/provider/Meta writes by this release.

Personal OAuth returned to the loaded panel after the owner's reported wait;
credentials/permissions unchanged. Production overview/goal
and campaign/adset/ad drawers read real data. Meta aggregate purchase-event coverage remains incomplete, with
N/D and evidence/freshness guards visible; do not replace absent events with zero
or claim Pixel/CAPI/order attribution verified. See ADS_INTELLIGENCE_V10.md and
ADS_INTELLIGENCE_V10_QA.md for exact execution/UI scope and limits.

POST-DEPLOY LIMIT:23:00Madrid slot FAILED at21:00:18UTC before proposal. Zero new
proposals/operations since deployment, zero UNKNOWN/EXECUTING. A sequentialGET-only
diagnostic of the existing client found account/campaign metadata working but
readDelivery rejected by MetaHTTP400/code17/subcode2446079 META_RATE_LIMITED;
diagnostic stopped before Insights. Budget view cannot verify current data.
Do not claim continuous Autopilot success from enabledLIVE or healthyAPI. Rate
limit contribution by this deployment versus other consumers is not established.
No slot replay, claim reset, policy relaxation or token/consumer replacement.

Next: reconcile the next normal scheduled slot with fresh provider evidence after
the rate limit clears; preserve the failed23:00claim and all V5.1 protections.

STATIC FOLLOW-UP:b048ad5 fixes legacy #ads-view svg overriding V10 chart/sparkline
dimensions to19px.62/62existing panel tests passed; published21:13:24UTC at
/opt/suleia-panel-releases/ads-growth-svg-b048ad5, CSS normalized SHA2566baf7481…19073.
Only review-panel recreated; APIcontainer/revision/env, bot,19protected hashes,
other containers/static files unchanged. Private scoped backup/receipt is in
static-b048ad5/ under the V10 directory. Roll back only that static mount if
needed; do not restart the API or replay a financial slot for CSS.

Visual readback confirms567.56×186.69 chart (previously19×19), six actual paths,
visible sparklines/funnel and zeroJSconsole errors. Private screenshots retained.
At21:15:59UTC API/bot/Render remained healthy and8SENT unchanged, but the next
normal23:15Madrid slot also FAILED. V10 deployment/UI are verified; continuous
budget automation is not. Preserve this unresolved provider-limit finding.

## 2026-10-24 · Ads Intelligence V10 development candidate

Owner requested development, testing and a reviewable release candidate only;
deployment requires separate approval. V9-only diff is reconciled on compatible
finance base4d16c9f; V10 reuses V8 review, the canonical reader/cache, journal,
OAuth, V9 decision function and existing four-part Telegram report. No second
consumer/scheduler or paid OpenAI activation. Live API remains f72bf2c, panel
finance-cogs-a2f2f4f, Render d175378;19 protected budget hashes match both runtime
and candidate. V5.1 remains the separately authorized LIVE policy. Do not deploy
this branch wholesale to Render or switch that executor to SHADOW.

Final isolated Linux Node22/PostgreSQL17 run passed1264/1264 tests in137 files,
zero skips, with no network or production credentials. Three-level drawer,
KPI/funnel/decisions, private cohort aggregates, immutable observations/outcomes,
responsive local screenshots and release/rollback gates are documented in
`ADS_INTELLIGENCE_V10.md` and `ADS_INTELLIGENCE_V10_QA.md`. Screenshots are clearly
synthetic; real cohort duplicate assessment is NOT_ASSESSED. Pixel/CAPI/EMQ,
campaign-to-confirmed-order attribution and sustainable CPA remain unverified.
Next: owner reviews the candidate PR and artifacts before any production action.

Updated: 2026-07-25

## Purpose

This document lets Codex and the ChatGPT confirmation agent work from the same
repository context without sharing hidden memory, browser sessions or secrets.

GitHub is the durable coordination layer:

- repository files hold stable rules and implementation;
- the Agent Hub issue holds current work, findings and next actions;
- commits and pull requests hold proposed or implemented changes;
- Render and Supabase remain runtime systems, not agent-to-agent chat channels.

## Repository

- Name: `Suleia/suleia-autoconfirm`
- Default branch: `main`
- Production service: Suleia AutoConfirm on Render
- Runtime state: Supabase plus the service operational cache

Never place credentials or customer personal data in this document, issues,
commits or pull requests.

## Budget Autopilot V5.1 SHADOW deployment (2026-10-22)

### Later state / V6 development (2026-10-23)

The owner subsequently approved guarded V5.1 LIVE; the captured production API
revision is e4d3b9d and the current development base is b9e8e4b (PR134). Preserve
that existing policy and executor. See `ADS_INTELLIGENCE_V6.md` and
`ADS_INTELLIGENCE_V6_AUDIT.md` for the V6 development implementation, aggregate
read-only audit, 298-test Node22/PostgreSQL validation, local fixture screenshots,
and release/rollback plan. V6 is not merged/deployed; its flag defaults off, and
its review service has no budget writer, message sender or scheduler. No new
production tasks or notifications are authorized. The SHADOW paragraph below
describes the earlier historical deployment, not the current LIVE state.

See `META_BUDGET_AUTOPILOT_V5_1.md`. This branch implements fixed EUR 10 candidates,
EUR 70 cap, Madrid slots and progressive night caps through the existing executor.
The owner separately approved SHADOW deployment, migration 058 and scheduled SHADOW
reviews, including simulation of previously LIVE confirmed manual budget orders.
API code 5177e53 is healthy; the panel and existing single bot are deployed. Limited
SQL grants and both actors' signed access are verified. Automatic LIVE remains
compiled false, all Meta writes and new Autopilot reports are off. The cold learning
read is bounded and pending evidence blocks changes. Final Node 22 suite passed 360
tests; the unchanged migration passed its isolated PostgreSQL integration.
At 12:09 Madrid the next slot is 13:00; none had yet been due since activation.
Do not claim that first cycle completed or replay 12:00. Keep legacy risk limits
blocking until consolidated policy approval; do not invent minima, global limits
or incremental evidence. The report contains actual deployment and rollback paths.

## Handoff format

```text
FROM: Codex | ChatGPT confirmation agent
STATUS: analysis | proposed | implemented | verified | blocked
SCOPE: <subsystem, files and anonymized order references>
SUMMARY: <what was learned or changed>
EVIDENCE: <tests, logs or links without secrets or personal data>
RISKS: <known risks or "none">
NEXT: <one concrete next action>
```

## Ownership rules

- An agent may analyze any repository code it can read.
- Only one agent should implement a given change at a time.
- Before editing, claim the work in the Agent Hub issue with `STATUS: proposed`.
- After publishing, post the commit or pull request and focused test result.
- The other agent reviews the evidence before starting overlapping work.
- User instructions always override an agent proposal.

## Production boundaries

- Reading production health and logs is allowed when authorized credentials are
  available.
- Real confirmation, cancellation, messaging and incident resolution are
  customer-impacting actions.
- Do not execute a customer-impacting action merely because another agent
  proposed it. Require the user's explicit authorization or an already-approved
  production automation rule.
- Do not alter Chatby templates or flows while investigating an unrelated
  problem.

## Instructions for the ChatGPT project

Add the GitHub app to the ChatGPT project and select
`Suleia/suleia-autoconfirm`. Start confirmation-agent tasks with:

```text
Use the connected GitHub repository Suleia/suleia-autoconfirm.
Read AGENTS.md, docs/AGENT_HANDOFF.md and the open Agent Hub issue first.
Follow their safety and handoff protocol. Do not expose secrets or customer
personal data. Do not modify production unless I explicitly authorize it.
```

When the ChatGPT agent finishes a task, it should write a handoff comment in
the Agent Hub issue. If its GitHub connection is read-only, it should return
the handoff block to the user for posting.

## Instructions for Codex

At the beginning of a coordinated task, read the latest Agent Hub comments.
At the end, post the implementation or verification result there. Keep detailed
customer data only in approved production systems and summarize evidence in
GitHub using anonymized references.

## 2026-09-23 — Incident customer activity display

Incident evidence must distinguish an exact-order inbound event after issue creation from a notification-bound actionable response. The private display query now selects the latest post-opening inbound message for the exact issue and order. Unverified notification anchoring keeps automatic decisions blocked, but no longer hides the observed text/button or its timestamp. The dashboard customer-response flow includes observed interactions. Incident history reads include bot messages and use the provider timestamp cursor for all incident types; order confirmation readers are unchanged.

Regression coverage includes missing notification, text/button observations, prior/future/lifecycle messages, missing identity, stale reads, retained action guards, history pagination and safe DOM rendering. Production verification must check the two reported orders through the same repository projection as the panel without logging customer content.

## 2026-09-26 — ADDRESS canonical integrity

Governed normalization is scoped to GLS ES, code -30, substatus 13, raw ADDRESS_INCORRECT and corroborating description. The generic -30 registry is not an address mapping. Migration 050 registers both address policies, retains invalid legacy timer history and materializes immutable owner-evidence snapshots. The canonical response timer uses issue + notification message hash + response policy; provider updates never renew it. The current-context view verifies issue version, owner evidence, policy and freshness; historical decisions cannot be current.

The provider conflict remains manual and excluded from canaries. RETURN remains SHADOW with breaker OPEN; no new provider actions, messages or emails are authorized by this correction. Accepted discounts remain manual. Backend evidence metadata is deployed independently from the VPS read-side; do not deploy the monorepo's older autoconfirm tree to Render.

## 2026-10-25 — Operations Center V11 candidate (not deployed)

Owner requested the full V11 repair/design candidate, with browser permission for local DEMO QA and read-only production inspection. One canonical Meta client now shares bounded priority scheduling, provider-aware quota cooldown and report-only GET coalescing. Scoped progressive reads, last-valid restoration from existing ads_insights, independent optional blocks and seeded exact-period drawers preserve evidence instead of empty PREPARING loops. All six modules share the premium AppShell. No business finance/logistics/RBAC, V5.1 policy/writer, recipient/schedule or OpenAI spending changes.

Final isolated regression: 1,291 passed, zero failed/skipped, 142 test files; archive bf256b01b13169032b8f19a673e8c92552f0848c64dd48e48af5e348cee74542. Controlled synthetic Graph sequence reduced 40 GET/28 Insights to 19/12; not production latency or quota proof. Real Chrome local screenshots are DEMO only. Production six views were read-only; finance had 33/33 controls, Ads remained historical. API7224c11/staticb048ad5,108/108 source files and19 protected hashes matched. Today's audited slots had zero verified mutations and CANARY_PENDING; no replay, canary forcing or weakened gates. Other agent's LIVE reliability proposal is coordinated evidence, not a new deployment authorization.

NEXT: Review docs/OPERATIONS_CENTER_V11.md, QA and RELEASE. Publish the stacked V11 PR against codex/ads-intelligence-v10; obtain the separate V11 deployment authorization required by the owner before switching API/static. Reaudit current base and protected sources immediately before any approved deployment. Preserve Render and existing ledgers/flags/Telegram deliveries; do not deploy the historical monorepo worker.

Final evidence: runtime commit3333429, package manifest/docs and immutable candidate image built successfully; import and30hashes pass without network/production credentials. Post-build read10:19UTC confirms API/static stillV10 and108/108base hashes. New11:00Madrid slotFAILED withAUTOPILOT_REVIEW_FAILED andexternalWrites:null; generic existingcatch doesnot preserveorigin code.0VERIFIED/0UNKNOWN-EXECUTING/canarypending remains. Do not attribute thisnewfailuretocode17withoutfresh evidence ordeclareAutopilotrepaired.

## 2026-10-25 — V11 owner-approved deployment verified

The owner specifically approved the PR148 API/static candidate 3333429 (call_7e923c9e840e495a84338378c337e0ab). Applied 25 October at 10:27:44 UTC: healthy API image c7b5dcab…, static mount /opt/suleia-panel-releases/operations-v11-3333429. Nine HTTP assets/no-store, OAuth 401 boundaries and internal version pass; 111/111 source hashes and 19 protected budget hashes match. Private backup/intents/receipts: /root/suleia-operations-v11-deploy-20261025/3333429/. Actual rollback retains LIVE 7224c11/static b048ad5; no schema or ledger rollback.

Production Chrome verification: six populated sections; finance 33/33 controls, 36 SVG, six months and final Dropea/Meta/report sources synchronized; analytics nine SVG; incidents ten visible rows; automation six flows. Ads has 18 KPIs, a current verified Meta cut, correctly sized charts and campaign/adset/ad identity, metrics and history. Final reader diagnosis: 78 GET, 27 reused, zero jobs/queue, CLOSED with no last failure, last success 10:41:09 UTC. Zero JS errors. Render d175378, bot PID/config/token/admins, one recipient/22:30 schedule, V5.1 policy/limits/protected sources, finance rates and unrelated container IDs stayed unchanged. No test sends or paid OpenAI. All 1,291 tests cover the exact runtime 3333429; later commits document only.

Budget execution is not proven: the latest pre-deploy 11:00 Madrid slot is FAILED/AUTOPILOT_REVIEW_FAILED with externalWrites:null; zero VERIFIED events, zero UNKNOWN/EXECUTING, canary pending at 10:39 UTC. No replay or forced canary; observe the next natural slot under existing guards. The next Telegram daily delivery also awaits its natural schedule. New strategic policy proposal 6396418109 was read but not applied; it is separate from this release. Docs/OPERATIONS_CENTER_V11_DEPLOYMENT.md and JSON hold sanitized evidence; production screenshots stay private and the repository gallery remains DEMO.
