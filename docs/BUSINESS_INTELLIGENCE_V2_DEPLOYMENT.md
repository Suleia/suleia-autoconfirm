# BI V2 production verification

PR149, stacked on V11 PR148. Runtime commit
`debef0f88f0b2f7c889a81155f51be5710efb058` applied25Oct2026 12:08:31UTC.
The private receipts and captured original configuration are at
`/root/suleia-business-intelligence-v2-deploy-20261025/debef0f/`.
The sanitized source/image/hash/test/HTTP record is in the companion JSON.

| Purchase cohort26Sep–25Oct | Initial verified cut | Post-release12:15UTC |
|---|---:|---:|
| Orders |493|493|
| Confirmed / sent |376|377|
| Delivered |212|212|
| Returned |75|75|
| Distinct incident orders |147|147|
| Realized revenue EUR |6732.79|6732.79|
| Exact recognized global net profit EUR |−1200.98|−1225.76|
| Missing costs / unknown provinces / reconciliation delta |0/0/0|0/0/0|

One further confirmation and normal financial-source updates occurred between
cuts. Counts reconcile across facts, cells and finance; the owner authorized
the current verified cut. Original487/373 is retained as a regression fixture.
Final confirmation76.5%, delivery56.2%, return19.9%, incidents29.8%.
These are current outcomes; final-outcome deltas compare mature cohorts only.
Maturity at verification:92mature,228maturing,173recent.

Three images overlay their own captured production bases:

- API `suleia-bi-v2-api:debef0f`, image61e9b2ed…
- MCP `suleia-bi-v2-mcp-server:debef0f`, image402a2c15…
- Materializer `suleia-bi-v2-analytics-materializer:debef0f`, image248272e2…
- Static `/opt/suleia-panel-releases/business-intelligence-v2-debef0f`.

All17component file hashes verified; normal imageUID100 imports pass. The
existing MCP object-sanitizer correction is preserved. Materializer4 rebuilt
existing cells/precomputes transactionally and reports no error. There is no
schema migration or new grant.19protected budget file hashes, all operational
environment values, botPID/config/token/admins, financial rates and unrelated
production compose containerIDs are unchanged. Render was not redeployed.
No customer/provider/Meta action, artificial canary or Telegram report was sent.

Final isolated Node22/PostgreSQL17 suite:1307passed,0failed,0skipped,144files,
sourcearchive`bf93172ccb7ebf094e3aa93490ec6d663a494ba248e867acfe8f87f13734cdf3`;
networknone, no production credentials. Exact MCP image additionally passes6/6
contract tests as its normal user. An initial packaging attempt could not start
the materializer because copied directories were unreadable. The automatic
rollback restored healthy original services. Explicit COPY permissions and
unprivileged startup smoke checks resolved it before final activation. Captured
transient QA containers were excluded from production concurrency checks;
all actual production compose services remain guarded by their IDs. The final
activation waited until the protected financial slot window ended.

Twelve production read-role MCP contracts pass, maximum46583bytes against51200.
Six financial months reconcile. Operational writes, analytics writes and private
fact reads remain denied. Warm20-sample SDK p95ms:

| Read contract | Before | After | Target |
|---|---:|---:|---:|
| Overview |72|495|1000|
| Geography |67|68|1500|
| Hour analysis |not measured|92|1500|
| Patterns |193|160|2000|

This is the SDK/in-memory transport with the production read role and container
limits, not HTTPS end-to-end or a controlled load comparison. SQL batching,
coalescing and caches remain bounded. The overview now carries more partitions.
There is no claim that every cold custom-filter request is below the warm p95.

Public `/operations/health`, panel and three served assets pass200/no-store;
analytics/finance/incidents reject anonymous access with401 at the existing
`/operations/api/operations/...` prefix. An earlier verifier used the wrong
unprefixed route; only the verifier changed. OAuth policy and credentials did
not change. The owner's personal session completed login after waiting and
was used for read-only production checks.

Real Chrome local DEMO checks cover desktop1440+, tablet820 and mobile390 CSS
iframes: no page overflow, horizontal mobile KPIs, table cards, map inset,
heatmap tooltips, filters, bands, crosses, correct denominators, no-data gaps,
and503last-cut retention/recovery. All six production views were also read:
BI7KPIs/52province paths/168heat cells/two649×230charts; Finance36SVG and populated
financial values; Ads38SVG and populated data after its normal read completed;
automation loaded; orders18rows; incidents10rows. Zero JavaScript errors.
Production capture repeatedly timed out in the browser, so committed images
are explicitly DEMO and are not represented as production screenshots.

Rollback uses the captured original compose chain to recreate only API, MCP,
panel and analytics-materializer, then removes only the BI override. It restores
the actual V11 API/static and original MCP/materializer; the old materializer can
rebuild compatible projections. Do not replay business operations or restore an
old SHADOW policy. The release helper and private captured baselines are retained
with the receipts; the final healthy release has not needed rollback.

The private directory also retains a standalone `deploy.py` and its own manifest.
From that directory, `sudo python3 deploy.py rollback` first verifies this release
has not been superseded, checks the quiet/uncertain-operation gates and restores
its captured original chain. Do not run it against a later release. The helper
and original private state never enter Git.
