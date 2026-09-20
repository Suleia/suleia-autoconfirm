// Offline reconciliation. Input is an approved aggregate snapshot, never orders.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildResultsFinanceReport as current } from '../packages/platform-core/src/finance/results-report.mjs';

const [input, output, baseline='6391dee8d421294a681648a3faf96fa586d31a31'] = process.argv.slice(2);
if(!input || !output) throw new Error('Usage: node scripts/verify-results-redesign.mjs snapshot.json report.json [baseline]');
const modulePath='packages/platform-core/src/finance/results-report.mjs';
const original=execFileSync('git',['show',`${baseline}:${modulePath}`],{encoding:'utf8'}).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(path.resolve(path.dirname(modulePath),p)).href}'`);
const {buildResultsFinanceReport:previous}=await import(`data:text/javascript;base64,${Buffer.from(original).toString('base64')}`);
const reports=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''));
const fields=['exactNetProfit','realRevenue','totalCosts','roiPercent','roas','marginPercent','confirmationRatePercent','deliveryRatePercent','rejectionRatePercent','delivered','returned','inTransit'];
const stripDailyRates=value=>Array.isArray(value)?value.map(stripDailyRates):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!(value.day&&['confirmationRatePercent','deliveryRatePercent'].includes(k))).map(([k,v])=>[k,stripDailyRates(v)])):value;
const results=[];
for(const report of reports){
  const args={month:report.period.month,supplementalReports:reports,now:new Date('2026-09-20T18:35:00Z'),dropeaLastSyncAt:report.freshness?.sources?.dropea?.lastSyncAt};
  const before=previous(args),after=current(args);
  assert.deepEqual(stripDailyRates(after),stripDailyRates(before),`${args.month}: existing report contract changed`);
  for(const metric of fields){const oldValue=before.totals[metric]??before.counts[metric]??null,newValue=after.totals[metric]??after.counts[metric]??null;
    assert.equal(newValue,oldValue,`${args.month}: ${metric}`);results.push({month:args.month,metric,before:oldValue,after:newValue,difference:0});}
}
fs.writeFileSync(output,JSON.stringify({baseline,method:'Same frozen aggregate input, fixed clock; full report equality excluding two additive daily rate fields.',months:reports.length,checks:results.length,changedExistingFields:0,results},null,2));
console.log(`RESULTS_RECONCILIATION|months=${reports.length}|headline_checks=${results.length}|existing_field_differences=0`);
