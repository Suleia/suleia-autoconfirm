import test from 'node:test';import assert from 'node:assert/strict';
import {CONTRACT} from '../metrics.mjs';
import {reconcileReportingEvents,readAccountEvidence} from './account-evidence.mjs';
import {analyzeReview} from './analyze.mjs';
import {buildGrowthTrend} from './growth-trend.mjs';
import {growthFixtureDataset,GROWTH_FIXTURE_NOW} from './growth-fixtures.mjs';
const fact=(id,extra={})=>({entityId:id,contract:CONTRACT,since:'2026-10-22',until:'2026-10-22',spend:10,impressions:100,linkClicks:10,purchases:null,purchaseValue:null,purchaseType:null,addToCart:2,...extra});
const account=fact('999',{spend:20,impressions:200,linkClicks:20,purchases:2,purchaseValue:60,purchaseType:'offsite_conversion.fb_pixel_purchase',addToCart:4});
test('an independent matching account population proves omitted events zero without modifying original financial facts',()=>{
 const rows=[fact('1',{purchases:2,purchaseValue:60,purchaseType:account.purchaseType}),fact('2')];
 const out=reconcileReportingEvents(rows,account);assert.equal(out[1].purchases,0);assert.equal(out[1].purchaseValue,0);assert.equal(out[1].roas,0);assert.equal(out[1].purchaseType,account.purchaseType);assert.equal(out[1].reportingZeroProof.method,'EXHAUSTED_ACCOUNT_NONNEGATIVE_TOTAL');assert.equal(rows[1].purchases,null);
});
for(const [label,patch]of [['unaccounted conversion',{purchases:3}],['different purchase scope',{purchaseType:'omni_purchase'}],['traffic mismatch',{spend:21}],['missing provider count',{purchases:null}],['different date',{since:'2026-10-23'}]])test('never infer zero from '+label,()=>{
 const rows=[fact('1',{purchases:2,purchaseValue:60,purchaseType:account.purchaseType}),fact('2')];assert.equal(reconcileReportingEvents(rows,{...account,...patch})[1].purchases,null);
});
test('native account reach is used only for the whole campaign population; filtered reach remains scoped',()=>{
 const dataset=growthFixtureDataset({since:'2026-10-19',until:'2026-10-25',partial:false});const native={...account,since:dataset.range.since,until:dataset.range.until,reach:17000,frequency:2,addToCart:88};
 dataset.accountEvidence={state:'AVAILABLE',current:native,previous:{...native,reach:14000},daily:[],priorDaily:[]};
 const all=analyzeReview({dataset,now:GROWTH_FIXTURE_NOW});assert.equal(all.totals.reach,17000);assert.equal(all.totals.addToCart,88);assert.equal(all.totals.scope,'PROVIDER_ACCOUNT');
 const filtered=analyzeReview({dataset,query:{campaignId:'101'},now:GROWTH_FIXTURE_NOW});assert.notEqual(filtered.totals.reach,17000);assert.equal(filtered.accountSeries,undefined);
});
test('native daily facts retain every calendar day and prior series without a 30-day analysis',()=>{
 const facts=Array.from({length:7},(_,i)=>({...account,since:'2026-10-'+(19+i),until:'2026-10-'+(19+i),purchases:i+1}));
 const selected={range:{since:'2026-10-19',until:'2026-10-25'},baselineRange:{since:'2026-10-12',until:'2026-10-18'},rows:[],totals:account,previous:account,comparison:{comparable:true},accountSeries:{current:facts,previous:facts.map((r,i)=>({...r,since:'2026-10-'+(12+i)}))}};
 const trend=buildGrowthTrend(selected,null);assert.equal(trend.current.length,7);assert.ok(trend.current.every(p=>p.complete));assert.equal(trend.current[3].metrics.purchases,4);assert.equal(trend.previous.length,7);assert.equal(trend.comparable,true);
 selected.accountSeries.current.splice(3,1);const gap=buildGrowthTrend(selected,null);assert.equal(gap.current.length,7);assert.equal(gap.current[3].metrics,null);assert.equal(gap.current[3].complete,false);
});
test('account read validates exact identity and ranges and makes failed optional sources explicit',async()=>{
 const r={since:'2026-10-22',until:'2026-10-22'};const reader={readAccountInsights:async q=>[{account_id:'999',date_start:q.since,date_stop:q.until,spend:'20'}]};
 const ok=await readAccountEvidence(reader,{accountId:'999',range:r,comparison:r,extended:true,now:GROWTH_FIXTURE_NOW});assert.equal(ok.state,'AVAILABLE');
 const bad=await readAccountEvidence(reader,{accountId:'998',range:r,comparison:r,extended:true,now:GROWTH_FIXTURE_NOW});assert.equal(bad.state,'UNAVAILABLE');assert.equal(bad.code,'ACCOUNT_REPORT_IDENTITY_INVALID');
});

test('ambiguous provider events never become an inferred zero',()=>{const rows=[fact('1',{purchases:2,purchaseValue:60,purchaseType:account.purchaseType}),fact('2',{roasStatus:'AMBIGUOUS',quality:{purchase:'AMBIGUOUS'}})];assert.equal(reconcileReportingEvents(rows,account)[1].purchases,null);});

test('a custom comparison uses its own native account range, never the default previous period',()=>{
 const dataset=growthFixtureDataset({since:'2026-10-19',until:'2026-10-25',partial:false}),baseline=growthFixtureDataset({since:'2026-10-05',until:'2026-10-11',partial:false});
 const native={...account,since:dataset.range.since,until:dataset.range.until,addToCart:88};
 dataset.accountEvidence={state:'AVAILABLE',current:native,previous:{...native,addToCart:300},daily:[],priorDaily:[]};
 baseline.accountEvidence={state:'AVAILABLE',current:{...native,since:baseline.range.since,until:baseline.range.until,addToCart:33},daily:[],priorDaily:[]};
 const out=analyzeReview({dataset,baseline,now:GROWTH_FIXTURE_NOW});assert.equal(out.previous.addToCart,33);assert.equal(out.baselineRange.since,'2026-10-05');assert.equal(out.changes.addToCart,(88-33)/33*100);
 baseline.accountEvidence={state:'UNAVAILABLE'};const missing=analyzeReview({dataset,baseline,now:GROWTH_FIXTURE_NOW});assert.notEqual(missing.previous.addToCart,300);assert.equal(missing.accountSeries.previous,null);
});
