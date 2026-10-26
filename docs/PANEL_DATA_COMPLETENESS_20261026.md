# Ads data completeness and Results reconciliation

Owner request: repair missing daily points, unavailable analyses and slow reads;
show add-to-cart events globally and per campaign, and audit Results. Reporting
changes only. No campaign mutation, financial policy change, message or new timer.

## Findings and correction

- The 19–25 October source contains traffic on all seven days. Some campaign
  rows omit purchase events on 19, 22 and 23 October. Requiring every campaign to
  have every event suppressed whole daily conversion totals and comparisons.
- Reporting now requests account totals, prior totals and both daily series
  through the existing GET client, attribution contract, bounded cache and quota
  queue. Native account reach/frequency are used only for the whole campaign
  population, never summed across campaigns/days or reused for a filtered scope.
- A missing campaign event is zero only if an independent nonnegative account
  total exhausts every known campaign event in the same date/traffic population.
  Count and value must reconcile together, with the same purchase scope and no
  ambiguity. The reporting projection retains the proof; original persisted
  facts and financial guards are unchanged. Otherwise the gap remains unknown.
- Add-to-cart events are visible in the twelve-card overview, campaign table by
  default, sort control and detailed period comparison. They count attributed
  events, not unique people, SKUs or product units.
- A partial campaign inventory cannot replace verified native account totals in
  the KPI renderer. This preserves native reach and current/prior comparisons;
  genuinely partial filtered populations retain their subtotal and unknown reach.
  The drawer explicitly labels today's partial cut rather than calling it simply
  “Period”, avoiding confusion with the chosen historical range.
- The default docked analysis no longer prevents periodic data refresh. Modal
  analysis, expanded evidence and active filter editing still defer refresh.
- Successful stale previews now continue their existing refresh. Polls remove
  force/retry, so completing a job cannot create an endless forced-refresh loop.
- Optional history waits for its existing coalesced preparation, including
  successful historical previews beyond the original eight-second cutoff, publishes the
  summary before children finish, and retains partial results. Metadata reads
  are limited to the needed levels. Algorithm reads reuse reporting GETs and
  return a bounded preparation diagnostic; optional failures do not erase all
  completed sources. Financial-window reservation still rejects the deep read.

## Financial evidence, 26 October 16:40 UTC

Read-only SQL and the existing finance connection; no contacts or secrets in
artifacts. Current October cut: 481 source orders with unique IDs, 197 delivered,
69 returned, 368 sent. 266 settled orders expose final Dropea breakdowns; 215 are
not settled. Source daily/per-order controls and panel totals reconcile.

| Component | EUR |
| --- | ---: |
| Delivered revenue | 6,277.94 |
| Product | 441.90 |
| Outbound shipping | 1,521.61 |
| Fulfilment | 368.00 |
| COD | 236.40 |
| Returns | 352.38 |
| Dropea adjustments, including applicable taxes | 356.33 |
| Recognized order costs, summed independently | 3,276.62 |
| Meta spend | 4,281.09 |
| Fixed accrual | 176.39 |
| Total costs | 7,734.10 |
| Provisional net profit | -1,456.16 |

ROI -18.83%, margin -23.19%, realized-revenue/Meta ROAS 1.47. This financial ROAS
has a different numerator from Ads' attributed purchase value. Transit can incur
costs before delivered revenue is recognized. Neither final costs on settled
orders nor a reconciled provisional total proves bank settlement or final monthly
profit. The zero incident count supplied by finance is not evidence of zero
operational incidents; operational current states include incidences. No finance
formula, tariff or operational filtering was changed to force agreement.

## Verification and release

Focused synthetic tests cover native account identity, scope, daily/prior
coverage, strict zero deductions and ambiguity, shared query count, fresh versus
stale polling, and financial reservation. The complete isolated Node22/PG17 run
and final runtime/static receipt are recorded separately. Initial regression
failures were investigated: financial reservation rejection was retained; the
load test now distinguishes three campaign queries and four shared native
account queries instead of assuming that no account query exists.

Deployment must overlay only these reviewed read/presentation files on the
actual API image (including the other PC's Telegram alert changes) and actual
static directory. Check hashes before switching, preserve environment, bot,
ledgers and unrelated container IDs, avoid financial review windows, and retain
a code-only rollback. Never restore financial/incident state during rollback.

Final deployment and independent public-file checks passed. Runtime141283d and
static dc714f6 are recorded in `PANEL_DATA_DEPLOYMENT_20261026.json`, including
1418 isolated runtime tests,85 final presentation tests (overlapping) and19 local
desktop/mobile checks. The unchanged financial benchmark required a rerun with
two test CPUs; neither its threshold nor production CPU allocation was changed.

The later source cut18:09:26UTC has485unique orders,198delivered and69returned.
Independent order cost sum3279.96 plus Meta4303.57 and fixed176.39 reconciles to
7759.92 costs. Delivered revenue6302.93 yields provisional profit-1456.99.
This replaces the earlier snapshot only as a newer cut, not a formula change.
Actual authenticated Results shows the same figures and its charts/table.
