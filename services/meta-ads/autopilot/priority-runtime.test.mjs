import test from 'node:test';import assert from 'node:assert/strict';
import {createAdsRuntime} from '../runtime.mjs';
import {adsCommand} from '../command-service.mjs';
const approved={approvalReference:'test:v6:priority',policyProfile:'V6_FIXED_EUR',minimumBudgetCents:1500,globalExposureCents:100000,aggregateIncreaseCents:36000,incrementalPurchases:3,globalSpendLimitMode:'UNLIMITED_AUTHORIZED',roasReductionMode:'ENABLED',reductionMinSpend:15,reductionMinImpressions:1000,attributionMaturityMinutes:120};
function fixture(){
 let reads=0,histories=0,release;
 const campaigns=Array.from({length:9},(_,i)=>({id:String(100+i),account_id:'9',name:'fixture',created_time:'2026-01-01T00:00Z',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'5000'}));
 const env={ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_ALGORITHM_ENABLED:'true',AUTOPILOT_ENABLED:'true',AUTOPILOT_MODE:'SHADOW',ADS_INTELLIGENCE_MODE:'SHADOW',ADS_INTELLIGENCE_WRITES_ENABLED:'false',META_WRITES_ENABLED:'false',ADS_MAX_AGGREGATE_INCREASE_EUR:'360',AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify(approved),META_ACCESS_TOKEN:'fixture',META_AD_ACCOUNT_ID:'9',META_MAX_DAILY_BUDGET_EUR:'100',META_MAX_BUDGET_CHANGE_PERCENT:'10',TELEGRAM_ALLOWED_USER_IDS:'1'};
 const fetchImpl=async url=>{reads++;const p=new URL(url).pathname;if(p.endsWith('/act_9'))return new Response(JSON.stringify({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}));return new Response(JSON.stringify({data:p.endsWith('/campaigns')?campaigns:[]}));};
 const pool={query:async sql=>{assert.match(sql,/FROM economics.ads_proposals/);histories++;if(histories===1)return new Promise(r=>{release=()=>r({rows:[]});});return {rows:[]};}};
 return {runtime:createAdsRuntime({env,pool,fetchImpl}),campaigns,get reads(){return reads;},get histories(){return histories;},release:()=>release?.()};
}
test('reserved financial window blocks the deep algorithm reader through the same queue; critical read still works',async()=>{
 const f=fixture();f.runtime.engine.reader.reserveFinancialWindow(Date.now()+60000);
 await assert.rejects(f.runtime.algorithm(),e=>e.code==='META_FINANCIAL_WINDOW_RESERVED');assert.equal(f.reads,0);
 await f.runtime.engine.reader.readAccount();assert.equal(f.reads,1);assert.ok(f.runtime.engine.reader.requestStats().quotaBlocked>0);
});
test('nine simultaneous learning decisions share one SQL ownership read; next revalidation reads freshly',async()=>{
 const f=fixture(),pending=Promise.all(f.campaigns.map(c=>f.runtime.engine.learningAssessment(c)));
 for(let i=0;i<1000&&f.histories===0;i++)await new Promise(r=>setImmediate(r));
 assert.equal(f.histories,1);f.release();assert.equal((await pending).length,9);
 await f.runtime.engine.learningAssessment(f.campaigns[0]);assert.equal(f.histories,2);
});

test('existing authenticated Autopilot bridge exposes bounded source diagnostics without another reader or writer',async()=>{
 let reads=0;const source={entities_adset:{status:'UNAVAILABLE',code:'META_HTTP_400',diagnostic:{providerCode:100}}};
 const runtime={engine:{authorize(a){if(a.user!=='1'||a.chat!=='1')throw Error('ACTOR_UNAUTHORIZED');}},budgetGuards:async()=>{reads++;return {observedAt:'2026-10-25T15:00Z',sources:source};}};
 const r=await adsCommand(runtime,{action:'autopilot',evidence:true,actor:{user:'1',chat:'1'}});assert.equal(r.budgetEvidence.sources,source);assert.equal(r.budgetEvidence.externalWrites,0);assert.equal(reads,1);
 await assert.rejects(adsCommand(runtime,{action:'autopilot',evidence:true,actor:{user:'2',chat:'2'}}),/UNAUTHORIZED/);assert.equal(reads,1);
});
