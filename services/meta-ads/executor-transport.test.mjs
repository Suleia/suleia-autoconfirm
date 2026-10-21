import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaBudgetTransport} from './executor-transport.mjs';
import {createAdsRuntime} from './runtime.mjs';
function setup(){const calls=[],row={account_id:'9',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'10000'},config={reader:{readCampaign:async()=>row},accountId:'9',accessToken:'fixture-token',apiVersion:'v25.0',allowedCampaignIds:['11'],mode:'LIVE',writesEnabled:true,liveCompiled:true,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({success:true}),{status:200});}};return {config,calls,row};}
test('real runtime and transport fail closed before HTTP for every write flag in this release',()=>{
 const f=setup();for(const mode of ['SIMULATION','SHADOW','LIVE'])assert.throws(()=>createMetaBudgetTransport({...f.config,mode,liveCompiled:false}),/LIVE_NOT_AUTHORIZED/);
 assert.throws(()=>createAdsRuntime({env:{ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_INTELLIGENCE_MODE:'LIVE',ADS_INTELLIGENCE_WRITES_ENABLED:'true'},pool:{}}),/LIVE_NOT_AUTHORIZED/);assert.equal(f.calls.length,0);
});
test('offline permitted harness sends one absolute EUR cent assignment with Bearer header',async()=>{
 const f=setup(),writer=createMetaBudgetTransport(f.config);assert.deepEqual(await writer.setDailyBudget('11',11000,{expectedBefore:10000}),{success:true});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.body,'daily_budget=11000');assert.equal(f.calls[0].options.redirect,'error');assert.ok(!f.calls[0].url.includes('fixture-token'));
});
test('last moment external budget change or wrong campaign sends nothing',async()=>{
 const f=setup(),writer=createMetaBudgetTransport(f.config);f.row.daily_budget='10001';await assert.rejects(writer.setDailyBudget('11',11000,{expectedBefore:10000}),e=>e.notSent===true);await assert.rejects(writer.setDailyBudget('12',11000,{expectedBefore:10000}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
test('authorized account scope still rejects another account and never bypasses prewrite budget comparison',async()=>{
 const f=setup(),writer=createMetaBudgetTransport({...f.config,allowedCampaignIds:[],accountBudgetsAuthorized:true});
 await writer.setDailyBudget('12',10500,{expectedBefore:10000});assert.equal(f.calls.length,1);
 f.row.account_id='8';await assert.rejects(writer.setDailyBudget('13',10500,{expectedBefore:10000}),e=>e.notSent===true);assert.equal(f.calls.length,1);
});
test('live activation requires every approved sample and accumulation limit',()=>{
 const env={ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_INTELLIGENCE_MODE:'LIVE',ADS_INTELLIGENCE_WRITES_ENABLED:'true',ADS_LIVE_BUDGETS_AUTHORIZED:'true',ADS_LIVE_ACCOUNT_BUDGETS_ENABLED:'true',ADS_MAX_AGGREGATE_INCREASE_EUR:'30',ADS_CAMPAIGN_COOLDOWN_HOURS:'24',ADS_MIN_SPEND_EUR:'15',ADS_MIN_PURCHASES:'5',ADS_MIN_IMPRESSIONS:'1000',META_MAX_DAILY_BUDGET_EUR:'100',META_MAX_BUDGET_CHANGE_PERCENT:'10',META_ACCESS_TOKEN:'fixture',META_AD_ACCOUNT_ID:'9'};
 for(const key of ['ADS_LIVE_BUDGETS_AUTHORIZED','ADS_MAX_AGGREGATE_INCREASE_EUR','ADS_CAMPAIGN_COOLDOWN_HOURS','ADS_MIN_SPEND_EUR','ADS_MIN_PURCHASES','ADS_MIN_IMPRESSIONS']){const incomplete={...env};delete incomplete[key];assert.throws(()=>createAdsRuntime({env:incomplete,pool:{}}),/LIVE_NOT_AUTHORIZED/);}
 const runtime=createAdsRuntime({env,pool:{}});assert.equal(runtime.engine.mode,'LIVE');assert.equal(runtime.engine.policy.maxAggregateIncreaseCents,3000);
});
test('Meta timeout/429/5xx has no retry and response bodies cannot leak credentials',async()=>{
 for(const status of [429,500]){const f=setup();let calls=0;f.config.fetchImpl=async()=>{calls++;return new Response(JSON.stringify({error:{code:status===429?4:1,message:'fixture-token'}}),{status});};const writer=createMetaBudgetTransport(f.config);await assert.rejects(writer.setDailyBudget('11',11000,{expectedBefore:10000}),e=>!e.message.includes('fixture-token')&&e.definitiveRejection===(status===429));assert.equal(calls,1);}
 const f=setup();let calls=0;f.config.fetchImpl=async()=>{calls++;throw Error('fixture-token');};await assert.rejects(createMetaBudgetTransport(f.config).setDailyBudget('11',11000,{expectedBefore:10000}),e=>e.definitiveRejection===false&&!e.message.includes('fixture-token'));assert.equal(calls,1);
});
