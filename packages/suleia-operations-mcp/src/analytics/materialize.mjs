import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { FinanceReportClient } from '../../../../apps/api/finance-report-client.mjs';
import { decryptOperationsPrivateJson } from '../operations/private-display.mjs';
import { aggregateFacts, buildFact, refreshFact, hash, iso, localParts, shiftDay, overviewCacheKey, validateFilters } from '../../../platform-core/src/analytics/order-intelligence.mjs';
import { buildAnalyticsReport, detectPatterns, temporalPatterns } from '../../../platform-core/src/analytics/report.mjs';

export async function materialize({source,writer,finance,privateKey,now=new Date()}){
 const started=performance.now();const client=await writer.connect();let lock=false;
 try{
  lock=(await client.query("SELECT pg_try_advisory_lock(73452301) AS locked")).rows[0].locked;if(!lock)return {skipped:'already_running'};
  const prior=(await client.query('SELECT canonical_order_id,business_date::text,source_hash,fact FROM analytics.order_facts')).rows;
  const previousState=(await client.query("SELECT body FROM analytics.runtime_state WHERE state_key='materializer'")).rows[0]?.body||{};
  const full=previousState.version!==2||!prior.length||!previousState.last_full_reconciliation||+now-Date.parse(previousState.last_full_reconciliation)>86400000;
  const watermark=iso(previousState.source_watermark);
  // Read-only transaction ensures one coherent canonical snapshot. No provider
  // endpoint is called; reports come from the existing finance read model.
  const input=await source.connect();let rows;
  try{await input.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');rows=(await input.query('SELECT * FROM read_models.order_intelligence_source '+(full||!watermark?'':'WHERE source_updated_at >= $1::timestamptz - interval \'5 minutes\' ')+'ORDER BY canonical_order_id',full||!watermark?[]:[watermark])).rows;await input.query('COMMIT');}catch(e){await input.query('ROLLBACK');throw e;}finally{input.release();}
  if(full&&!rows.length)throw new Error('canonical_source_empty');
  const months=[...new Set([...prior.map(r=>r.fact.purchase_month),...rows.map(r=>localParts(r.created_at_utc)?.month)].filter(Boolean))].sort();
  const reports=[];for(const month of months)reports.push(await finance.getMonthly(month));
  const financeOrders=new Map();for(const report of reports)for(const order of report.orders)financeOrders.set(String(order.orderId),{...order,generated_at:report.generatedAt});
  const factsById=new Map(full?[]:prior.map(r=>[r.canonical_order_id,refreshFact(r.fact,financeOrders.get(r.fact.provider_order_key),now)]));let excluded=0,missingCreated=0;for(const row of rows){const f=buildFact(row,financeOrders.get(String(row.dropea_order_id).replace(/^ES/,'')),decryptOperationsPrivateJson(row.shipping_address_ciphertext,privateKey)||{},now);if(f)factsById.set(f.canonical_order_id,f);else{factsById.delete(row.canonical_order_id);if(!row.created_at_utc)missingCreated++;else excluded++;}}
  const facts=[...factsById.values()];
  const priorById=new Map(prior.map(r=>[r.canonical_order_id,r]));const currentIds=new Set(facts.map(f=>f.canonical_order_id));const changedDays=new Set();let changed=0;
  await client.query('BEGIN');
  for(const f of facts){const fingerprint=hash(f),old=priorById.get(f.canonical_order_id);if(old?.source_hash===fingerprint)continue;changed++;changedDays.add(f.created_local_date);if(old)changedDays.add(old.business_date);await client.query('INSERT INTO analytics.order_facts(canonical_order_id,business_date,source_hash,fact) VALUES($1,$2,$3,$4) ON CONFLICT(canonical_order_id) DO UPDATE SET business_date=excluded.business_date,source_hash=excluded.source_hash,fact=excluded.fact,materialized_at=now()',[f.canonical_order_id,f.created_local_date,fingerprint,f]);}
  for(const old of prior)if(!currentIds.has(old.canonical_order_id)){changedDays.add(old.business_date);await client.query('DELETE FROM analytics.order_facts WHERE canonical_order_id=$1',[old.canonical_order_id]);}
  const cells=aggregateFacts(facts);
  for(const day of changedDays){await client.query('DELETE FROM analytics.order_cells WHERE business_date=$1',[day]);for(const cell of cells.filter(c=>c.day===day))await client.query('INSERT INTO analytics.order_cells(cell_key,business_date,cell) VALUES($1,$2,$3)',[cell.key,day,cell]);}
  const days=[];for(const report of reports){const safe={period:report.period,totals:report.totals,counts:report.counts,coverage:report.coverage,generated_at:report.generatedAt,source:'EXISTING_FINANCE_PURCHASE_COHORT'};await client.query('INSERT INTO analytics.finance_months(month,body) VALUES($1,$2) ON CONFLICT(month) DO UPDATE SET body=excluded.body,materialized_at=now()',[report.period.month,safe]);for(const day of report.days){if(!/^\d{4}-\d{2}-\d{2}$/.test(day.day))continue;const fields=['created','confirmed','rejected','sent','inTransit','delivered','returned','incidentOrders','incidents','realRevenue','productCost','outboundShippingCost','codCost','outboundFulfillmentCost','returnCost','dropeaAdjustmentsCost','logisticsCost','metaSpend','fixedCosts','oneOffCosts','otherCosts','totalCosts','contributionMargin','netProfit'];const body={day:day.day,...Object.fromEntries(fields.map(k=>[k,typeof day[k]==='number'?day[k]:null])),profit_complete:report.coverage.exactProfitAvailable===true};days.push(body);await client.query('INSERT INTO analytics.finance_days(business_date,body) VALUES($1,$2) ON CONFLICT(business_date) DO UPDATE SET body=excluded.body,materialized_at=now()',[day.day,body]);}}
  const sourceUpdated=rows.map(r=>iso(r.order_observed_at)).filter(Boolean).sort().at(-1)||previousState.source_updated_at,currentReport=reports.at(-1),financeUpdated=iso(currentReport.generatedAt);
  const runtime={source_updated_at:sourceUpdated,finance_updated_at:financeUpdated,finance_age_seconds:financeUpdated?Math.max(0,(+now-Date.parse(financeUpdated))/1000):null,analytics_updated_at:now.toISOString(),last_success:now.toISOString(),last_error:null,duration_ms:Math.round(performance.now()-started),rows:facts.length,rows_changed:changed,affected_days:changedDays.size,backfill:{source_rows:rows.length,processed:facts.length,excluded,missing_created:missingCreated,date_from:facts.map(f=>f.created_local_date).sort()[0],date_to:facts.map(f=>f.created_local_date).sort().at(-1),finance_orders:financeOrders.size,unknown_province:facts.filter(f=>f.province==='UNKNOWN').length,missing_costs:facts.filter(f=>f.cost_status==='MISSING').length},source_age_distribution:{older_than_hour:rows.filter(r=>+now-new Date(r.order_observed_at)>3600000).length}};
  runtime.version=2;runtime.flagged_test_orders=facts.filter(f=>f.test_order).length;runtime.duplicate_candidates=facts.filter(f=>f.duplicate_candidate).length;
  runtime.mode=full?'FULL_RECONCILIATION':'INCREMENTAL';runtime.last_full_reconciliation=full?now.toISOString():previousState.last_full_reconciliation;runtime.source_watermark=rows.map(r=>iso(r.source_updated_at)).filter(Boolean).sort().at(-1)||watermark;runtime.source_rows_read=rows.length;
  if(!full)runtime.backfill=previousState.backfill;
  const filters={date_from:shiftDay(localParts(now).day,-89),date_to:localParts(now).day};const report=buildAnalyticsReport({cells,financeDays:days,runtime,filters,now});const patterns=[...detectPatterns(cells.filter(c=>c.day>=filters.date_from&&c.day<=filters.date_to),filters,now),...temporalPatterns(cells,now)];
  await client.query('DELETE FROM analytics.detected_patterns');for(const p of patterns)await client.query('INSERT INTO analytics.detected_patterns VALUES($1,$2,$3,$4)',[p.pattern_id,p,p.detected_at,p.valid_until]);
  await client.query('DELETE FROM analytics.insights');for(const i of report.data.insights)await client.query('INSERT INTO analytics.insights(insight_id,body) VALUES($1,$2)',[i.insight_id,i]);
  runtime.pattern_count=patterns.length;runtime.insight_count=report.data.insights.length;
  // Common panel ranges are ready before serving the first request, avoiding
  // a cold statistical calculation on the resource-limited MCP container.
  await client.query('DELETE FROM analytics.overview_snapshots');
  for(const span of [1,7,30,90]){const f=validateFilters({date_from:shiftDay(localParts(now).day,1-span),date_to:localParts(now).day},now);const r=buildAnalyticsReport({cells,financeDays:days,runtime,filters:f,now});await client.query('INSERT INTO analytics.overview_snapshots(cache_key,body) VALUES($1,$2)',[overviewCacheKey(f),r]);}
  await client.query('INSERT INTO analytics.daily_summaries(business_date,body) VALUES($1,$2) ON CONFLICT(business_date) DO UPDATE SET body=excluded.body,generated_at=now()',[localParts(now).day,{overview:report.data.overview,insights:report.data.insights,send_automatically:false}]);
  await client.query("INSERT INTO analytics.runtime_state(state_key,body) VALUES('materializer',$1) ON CONFLICT(state_key) DO UPDATE SET body=excluded.body",[runtime]);await client.query('COMMIT');
  return runtime;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});await client.query("INSERT INTO analytics.runtime_state(state_key,body) VALUES('materializer',jsonb_build_object('last_error','MATERIALIZATION_FAILED','last_attempt',now())) ON CONFLICT(state_key) DO UPDATE SET body=analytics.runtime_state.body||excluded.body").catch(()=>{});throw error;
 }finally{if(lock)await client.query('SELECT pg_advisory_unlock(73452301)').catch(()=>{});client.release();}
}
export async function main(){const source=new pg.Pool({connectionString:process.env.OPERATIONS_DATABASE_URL,max:1,statement_timeout:30000,application_name:'suleia-analytics-source-readonly'}),writer=new pg.Pool({connectionString:process.env.ANALYTICS_DATABASE_URL,max:1,statement_timeout:30000,application_name:'suleia-analytics-materializer'});const finance=new FinanceReportClient({baseUrl:process.env.FINANCE_REPORT_BASE_URL,password:process.env.FINANCE_REPORT_PASSWORD});finance.refreshIfStale=async()=>false;
 const cycle=async()=>{try{const r=await materialize({source,writer,finance,privateKey:process.env.OPERATIONS_PRIVATE_DATA_KEY});console.log(JSON.stringify({event:'analytics_materialization',...r}));return true;}catch(e){console.error(JSON.stringify({event:'analytics_materialization_failed',code:/^[A-Z_0-9]+$/.test(e.code||'')?e.code:'SOURCE_OR_PROJECTION_FAILURE'}));return false;}};
 if(process.argv.includes('--once')){const ok=await cycle();await source.end();await writer.end();if(!ok)process.exitCode=1;return;}
 await cycle();setInterval(cycle,Math.max(60000,Number(process.env.ANALYTICS_INTERVAL_MS)||300000));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
