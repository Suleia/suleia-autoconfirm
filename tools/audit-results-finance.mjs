// Read-only aggregate audit. No customer identifiers, messages or credentials.
import { loadOperationsConfig } from '../apps/api/server.mjs';
import { createFinanceReportClient } from '../apps/api/finance-report-client.mjs';
import { OperationsRepository } from '../packages/suleia-operations-mcp/src/operations/repository.mjs';

const config = loadOperationsConfig();
const repo = await OperationsRepository.connect(config.databaseUrl, { privateDataKey: config.privateDataKey });
const client = createFinanceReportClient(config);
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const sum = (rows, field) => Math.round(rows.reduce((n, r) => n + Number(r[field] || 0), 0) * 100) / 100;
try {
  const sources = client ? await client.getMonthlyBundle(months.at(-1)) : [];
  const metaSource=client ? await client.request('/api/finance-meta-source?since=2026-05-01&until='+new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date())) : null;
  const metaByDay=new Map((metaSource?.source?.rows || []).map(r=>[r.dateStart,r.spend]));
  const snapshot = await repo.pool.query(`SELECT
    to_char(created_at_utc AT TIME ZONE 'Europe/Madrid','YYYY-MM') AS month,
    coalesce(lifecycle_status,status) AS status, count(*)::int AS orders,
    count(*) FILTER (WHERE confirmed_at_utc IS NOT NULL)::int AS confirmed,
    count(*) FILTER (WHERE delivered_at_utc IS NOT NULL)::int AS with_delivery_date,
    count(*) FILTER (WHERE returned_at_utc IS NOT NULL)::int AS with_return_date
    FROM read_models.operations_finance_order_inputs
    WHERE created_at_utc >= '2026-05-01' AND NOT coalesce(test_order,false)
    AND coalesce(duplicate_status,'') <> 'DUPLICATE_ACTIVE_ORDER'
    GROUP BY 1,2 ORDER BY 1,2`);
  for (const month of months) {
    const source = sources.find(r => r.period.month === month);
    const report = await repo.financialSummary(new URLSearchParams({ month }), sources);
    const orderRows = source?.orders || [];
    const fields = ['realRevenue','productCost','outboundShippingCost','outboundFulfillmentCost','codCost','returnCost','dropeaAdjustmentsCost','metaSpend','fixedCosts','oneOffCosts','otherCosts','totalCosts','exactNetProfit'];
    const categories = {};
    for (const issue of report.quality.issues || []) { const key = String(issue).split(':')[0]; categories[key] = (categories[key] || 0) + 1; }
    const byStatus = {};
    for (const row of orderRows) { const key = row.status || 'UNKNOWN'; byStatus[key] = (byStatus[key] || 0) + 1; }
    const settled = orderRows.filter(r => ['DELIVERED','FINISHED','RETURNED'].includes(r.status));
    const costFields = ['productCost','outboundShippingCost','outboundFulfillmentCost','codCost','returnCost','dropeaAdjustmentsCost'];
    const orderAudit = { settled:settled.length, missingDates:0, missingComponents:0, costMismatches:0, profitMismatches:0, nonFinal:0 };
    for (const row of settled) {
      if (!row.settlementDay) orderAudit.missingDates++;
      if (row.breakdownStatus !== 'DROPEA_FINAL') orderAudit.nonFinal++;
      if (costFields.some(k=>row[k]===null||row[k]===undefined)) { orderAudit.missingComponents++; continue; }
      const costs=costFields.reduce((n,k)=>n+Number(row[k]),0);
      if (Math.abs(costs-Number(row.recognizedCost))>.011) orderAudit.costMismatches++;
      const revenue=row.status==='RETURNED'?0:Number(row.realizedRevenue);
      if (row.contributionAfterProduct===null||Math.abs(revenue-costs-Number(row.contributionAfterProduct))>.011) orderAudit.profitMismatches++;
    }
    const last = report.days.at(-1);
    console.log(JSON.stringify({month, model:report.temporalModels, generatedAt:report.generatedAt,
      counts:report.counts, totals:Object.fromEntries(fields.map(k=>[k,report.totals[k]])),
      dailyRows:report.days.length, failedControls:Object.entries(report.controls).filter(([,v])=>v!==true).map(([k])=>k),
      qualityCategories:categories, coverage:report.coverage, sourceStatusCounts:byStatus,
      canonicalStatusCounts:snapshot.rows.filter(r=>r.month===month),
      fixedLedger:(source?.expenseLedger || []).map(e=>({type:e.type,amount:e.amount,applied:e.appliedAmount,start:e.startDate,end:e.endDate})),
      dailyFixedTotal:sum(report.days,'fixedCosts'),
      sourceOrderFields:orderRows.length ? Object.keys(orderRows[0]) : [],
      perOrderAudit:orderAudit,
      actualDropeaSettledExpenses:sum(settled,'dropeaExpenses'),
      settledShipping:sum(settled,'outboundShippingCost'),settledFulfillment:sum(settled,'outboundFulfillmentCost'),
      metaAudit:{storedDays:[...metaByDay.keys()].filter(d=>d.startsWith(month)).length,
        missingDays:(source?.days || []).filter(d=>!metaByDay.has(d.day)).length,
        mismatchedDays:(source?.days || []).filter(d=>metaByDay.has(d.day)&&Math.abs(Number(d.metaSpend)-Number(metaByDay.get(d.day)))>.011).length,
        sourceLastSync:metaSource?.source?.lastSyncAt},
      settledToday:orderRows.filter(r=>['DELIVERED','FINISHED','RETURNED'].includes(r.status)&&r.settlementDay==='2026-09-16').reduce((a,r)=>({orders:a.orders+1,revenue:a.revenue+Number(r.realizedRevenue||0),cost:a.cost+Number(r.recognizedCost||0)}),{orders:0,revenue:0,cost:0}),
      lastDay:last ? Object.fromEntries(['day','created','delivered','returned','inTransit','realRevenue','totalCosts','metaSpend','fixedCosts','oneOffCosts','netProfit','quality','closeStatus'].map(k=>[k,last[k]])) : null,
      writes:report.productionWrites,actions:report.actions_executed
    }));
  }
} finally { await repo.close(); }
