import test from 'node:test';
import assert from 'node:assert/strict';
import {ownBudgetGuardAssessment} from './learning.mjs';
import {captureAlgorithmEvidence} from '../algorithm-reader.mjs';
import {AdsLedger} from '../ledger.mjs';
const now=Date.parse('2026-10-22T10:00:00Z'),at=now-60000;
function fixture(){return {assessment:{reasons:['RECENT_SIGNIFICANT_CHANGE','DAILY_CHANGE_LIMIT','EXTERNAL_BUDGET_NOT_RECONCILED','LEARNING_ACTIVE'],policy:{cooldownHours:72}},campaign:{id:'11',account_id:'9',daily_budget:'3000'},events:[{campaignId:'11',objectId:'11',type:'update_campaign_budget',at:new Date(at).toISOString(),isBudget:true,level:'campaign',beforeCents:2000,afterCents:3000}],history:[{id:'proof',accountId:'9',mode:'LIVE',createdAt:at-5000,items:[{campaignId:'11',before:2000,after:3000,result:{state:'VERIFIED',verifiedAt:at+1000}}]}],config:{approved:{policyProfile:'V5_1_FIXED_EUR'}},now};}
test('exact own verified event can retire frequency guards but cannot retire active learning',()=>{
 const f=fixture(),r=ownBudgetGuardAssessment(f);assert.deepEqual(r.reasons,['LEARNING_ACTIVE']);assert.equal(r.ownGuardExemptions.length,3);
 assert.deepEqual(f.assessment.reasons,['RECENT_SIGNIFICANT_CHANGE','DAILY_CHANGE_LIMIT','EXTERNAL_BUDGET_NOT_RECONCILED','LEARNING_ACTIVE']);
});
test('wrong account, incomplete amount, uncertain operation, stale timing and missing events retain guards',()=>{
 const fixtures=[f=>f.history[0].accountId='8',f=>f.events[0].beforeCents=null,f=>f.history[0].items[0].result.state='UNKNOWN',f=>f.events[0].at=new Date(at-20000).toISOString(),f=>f.events=[]];
 for(const mutate of fixtures){const f=fixture();mutate(f);assert.deepEqual(ownBudgetGuardAssessment(f).reasons,f.assessment.reasons);}
});
test('an external creative change or another budget event prevents the applicable exemption',()=>{
 const f=fixture();f.events.push({...f.events[0],type:'update_ad_creative',objectId:'ad22',isBudget:false,level:'ad',beforeCents:null,afterCents:null});
 assert.ok(ownBudgetGuardAssessment(f).reasons.includes('RECENT_SIGNIFICANT_CHANGE'));
 const g=fixture();g.events.push({...g.events[0],at:new Date(at+15000).toISOString(),beforeCents:3000,afterCents:3500});
 assert.ok(ownBudgetGuardAssessment(g).reasons.includes('DAILY_CHANGE_LIMIT'));assert.ok(ownBudgetGuardAssessment(g).reasons.includes('EXTERNAL_BUDGET_NOT_RECONCILED'));
});
test('duplicate collection does not create a second proof; two independent provider events need two proofs',()=>{
 const f=fixture();f.events.push({...f.events[0]});assert.deepEqual(ownBudgetGuardAssessment(f).reasons,['LEARNING_ACTIVE']);
 f.events.push({...f.events[0],at:new Date(at+1000).toISOString()});assert.ok(ownBudgetGuardAssessment(f).reasons.includes('DAILY_CHANGE_LIMIT'));
});
test('budget guard collection shares canonical readers without fetching ads, hourly traffic or logistics',async()=>{
 const calls=[],reader={readAccount:async()=>({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}),readInsights:async q=>{calls.push(['insights',q]);return [];},readAuditDetails:async level=>{calls.push(['entities',level]);return [];},readActivityHistory:async q=>{calls.push(['activities',q]);return [];},readAuditRules:async()=>[]};
 const e=await captureAlgorithmEvidence({reader,scope:'BUDGET_GUARDS',now,readOrders:()=>{throw Error('must not read orders');},readOperations:()=>{throw Error('must not read operations');}});
 assert.equal(e.scope,'BUDGET_GUARDS');assert.equal(e.range.since,'2026-10-15');assert.equal(e.range.until,'2026-10-21');assert.equal(e.sources.currentActivities.status,'COMPLETE');assert.equal(e.sources.daily_campaign.status,'COMPLETE');assert.deepEqual(calls.filter(c=>c[0]==='entities').map(c=>c[1]),['campaign','adset']);assert.equal(e.orders,null);
});
test('ownership history can include 72 hours and rejects an unbounded lookback',async()=>{
 const queries=[],ledger=new AdsLedger({query:async(sql,args)=>{queries.push(args);return {rows:[]};}});
 await ledger.autopilotHistory('9',now,72*3600000);assert.equal(queries[0][1],now-72*3600000);
 await assert.rejects(ledger.autopilotHistory('9',now,73*3600000),/RANGE_INVALID/);
});

test('failed operational source retains exact numeric provider diagnostics without raw text',async()=>{
 const error=Object.assign(Error('https://private/?token=secret'),{code:'META_HTTP_400',status:400,providerCode:100,providerSubcode:999});
 const reader={readAccount:async()=>({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}),readInsights:async()=>[],readAuditDetails:async l=>{if(l==='adset')throw error;return [];},readActivityHistory:async()=>[],readAuditRules:async()=>[]};
 const e=await captureAlgorithmEvidence({reader,scope:'BUDGET_GUARDS',now});
 assert.equal(e.sources.entities_adset.status,'UNAVAILABLE');assert.equal(e.entities.adset,null);assert.equal(e.sources.entities_adset.diagnostic.providerCode,100);assert.equal(e.sources.entities_adset.diagnostic.requestPhase,'EVIDENCE_ENTITIES_ADSET');assert.doesNotMatch(JSON.stringify(e.sources),/private|token|secret/);
});
