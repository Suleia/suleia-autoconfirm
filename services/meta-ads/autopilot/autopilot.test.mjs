import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTOPILOT_LIVE_COMPILED,loadAutopilotConfig,evaluateAutopilot,nightTarget,manualAutopilotReasons,autopilotMetric} from './policy.mjs';
import {normalizeInsight} from '../metrics.mjs';
import {reviewSlot,instantFor,nextReview,REVIEW_TIMES} from './schedule.mjs';
import {parseAutopilotQuery,formatAutopilot} from './queries.mjs';
import {BudgetAutopilot} from './service.mjs';
import {AdsIntelligence} from '../intelligence.mjs';
import {parseAdsIntent} from '../intent.mjs';
import {createAdsRuntime} from '../runtime.mjs';
const day='2026-10-22',type='offsite_conversion.fb_pixel_purchase';
const at=time=>instantFor(day,time);
// Offline candidate policy, not an approval of different production risk limits.
const approved={approvalReference:'test:offline-only',minimumBudgetCents:1500,globalExposureCents:100000,globalSpendLimitCents:100000,incrementalPurchases:3,reductionMinSpend:15,reductionMinImpressions:1000,attributionMaturityMinutes:120};
const legacy={maxBudgetCents:10000,maxChangePercent:100,minSpend:15,minPurchases:3,minImpressions:1000,maxAgeMs:120000,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000};
function config(){return loadAutopilotConfig({AUTOPILOT_ENABLED:'true',AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify(approved)},legacy);}
const campaign=(budget=2500)=>({id:'11',account_id:'9',name:'NIDA fixture',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:String(budget)});
const metric=(now,roas=4.2,purchases=3)=>({campaignId:'11',entityId:'11',level:'campaign',since:day,until:day,observedAt:new Date(now).toISOString(),complete:true,metaRoas:roas,metaRoasStatus:roas===0?'ZERO':roas===null?'MISSING':'VALID',metaRoasPurchaseType:type,purchaseType:type,purchases,spend:20,impressions:2000,purchaseValue:roas===null?null:roas*20});
function decision({time='10:00',budget=2500,roas=4.2,purchases=3,cfg=config(),history=[],m=null,c=null,constraints={verified:true,minimumCents:1500},accountSpend}={}){const now=at(time);return evaluateAutopilot({campaign:c||campaign(budget),metric:m||metric(now,roas,purchases),slot:reviewSlot(now),now,config:cfg,history,constraints,accountSpend:accountSpend===undefined?{date:day,spendCents:2000,observedAt:new Date(now).toISOString(),complete:true}:accountSpend});}

for(const[before,after]of[[2000,3000],[2500,3500],[3000,4000],[4500,5500],[6000,7000],[6500,7000]])test(`fixed EUR increase ${before/100} -> ${after/100}`,()=>{const d=decision({budget:before});assert.equal(d.after,after);assert.equal(d.state,'VALIDATED');});
test('70 EUR is maintained; above-cap budgets are never raised',()=>{assert.equal(decision({budget:7000}).action,'HOLD');assert.equal(decision({budget:8000}).after,8000);});
for(const[before,after]of[[7000,6000],[6000,5000],[5000,4000],[4000,3000],[3000,2000],[2000,1500]])test(`special fixed reduction ${before/100} -> ${after/100}`,()=>{const d=decision({time:'12:00',budget:before,roas:3.7});assert.equal(d.after,after);assert.equal(d.action,'DECREASE');});
for(const time of ['07:00','08:00','11:00','13:00','18:00','20:00','21:00','22:00'])test(`ordinary ${time} does not reduce low ROAS`,()=>assert.equal(decision({time,roas:3.7}).action,'HOLD'));
for(const time of ['12:00','19:00'])test(`special ${time} replaces ordinary slot`,()=>{assert.equal(REVIEW_TIMES.filter(t=>t===time).length,1);assert.equal(decision({time,roas:3.7}).action,'DECREASE');assert.equal(decision({time,roas:4.2}).action,'INCREASE');});
for(const roas of [3.8,0,null])test(`ROAS ${roas} ordinary hold and correct distinction`,()=>{const d=decision({roas});assert.equal(d.action,'HOLD');if(roas===null)assert.ok(d.reasons.includes('ROAS_MISSING'));else assert.ok(!d.reasons.includes('ROAS_MISSING'));});
test('zero ROAS is a real reduction candidate, missing/ambiguous never substitutes zero',()=>{
 assert.equal(decision({time:'19:00',roas:0,purchases:0}).action,'DECREASE');
 assert.equal(decision({time:'19:00',roas:null,purchases:0}).action,'HOLD');
 assert.ok(decision({m:{...metric(at('19:00')),metaRoasStatus:'AMBIGUOUS'},time:'19:00'}).reasons.includes('ROAS_AMBIGUOUS'));
});
test('three purchases minimum, one high-ROAS purchase and zero spend cannot scale',()=>{
 assert.ok(decision({purchases:1,roas:20}).reasons.includes('MIN_THREE_PURCHASES'));
 assert.ok(decision({m:{...metric(at('10:00')),spend:0}}).reasons.includes('ROAS_ZERO_SPEND'));
 assert.ok(decision({m:{...metric(at('10:00')),metaRoasPurchaseType:'omni_purchase'}}).reasons.includes('ROAS_SCOPE_MISMATCH'));
 assert.ok(decision({purchases:3.5}).reasons.includes('MIN_THREE_PURCHASES'));
 assert.equal(nightTarget({...metric(at('23:59')),spend:0}).cents,2000);
});
test('fresh intraday Madrid facts are mandatory; yesterday and future/stale rows block',()=>{
 for(const patch of [{since:'2026-10-21',until:'2026-10-21'},{observedAt:new Date(at('10:00')-120001).toISOString()},{observedAt:new Date(at('10:00')+6000).toISOString()},{complete:false}])assert.ok(decision({m:{...metric(at('10:00')),...patch}}).reasons.includes('AUTOPILOT_STALE_OR_WRONG_DAY'));
});
test('paused and ABO campaigns do not become eligible; adset fallback is absent',()=>{
 assert.ok(decision({c:{...campaign(),status:'PAUSED'}}).reasons.includes('CAMPAIGN_INACTIVE'));
 assert.ok(decision({c:{...campaign(),daily_budget:null,lifetime_budget:'10000'}}).reasons.includes('CAMPAIGN_DAILY_BUDGET_REQUIRED'));
});
test('existing 10 percent, five purchase and 24h safeguards remain blockers',()=>{
 const cfg=config();cfg.legacy={...legacy,maxChangePercent:10,minPurchases:5};
 const d=decision({cfg});assert.ok(d.reasons.includes('MAX_CHANGE_PERCENT'));assert.ok(d.reasons.includes('LEGACY_SAMPLE_MINIMUM'));
 const history=[{origin:'MANUAL',createdAt:at('07:00'),items:[{campaignId:'11',before:2400,after:2500,result:{state:'VERIFIED'}}]}];
 assert.ok(decision({cfg,history}).reasons.includes('CAMPAIGN_COOLDOWN'));assert.ok(decision({cfg,history}).reasons.includes('MANUAL_HOLD_UNTIL_NIGHT'));
});
test('no invented operating minimum, incremental or global exposure approvals',()=>{
 const cfg=loadAutopilotConfig({AUTOPILOT_ENABLED:'true'},legacy);
 assert.ok(decision({cfg}).reasons.includes('OPERATING_MINIMUM_NOT_APPROVED'));
 assert.ok(decision({cfg}).reasons.includes('GLOBAL_EXPOSURE_POLICY_NOT_APPROVED'));
 assert.ok(decision({cfg,time:'12:00',roas:3.7}).reasons.includes('REDUCTION_SAMPLE_POLICY_NOT_APPROVED'));
 assert.ok(decision({constraints:null}).reasons.includes('META_MINIMUM_NOT_VERIFIED'));
 assert.ok(decision({time:'12:00',roas:3.7,constraints:{verified:true,minimumCents:2400}}).reasons.includes('META_MINIMUM_CONFLICT'));
});
test('conversion evidence is consumed once, incremental threshold cannot be inferred',()=>{
 const prior={origin:'AUTOPILOT',mode:'SHADOW',createdAt:at('07:00'),items:[{campaignId:'11',before:2000,after:3000,metric:metric(at('07:00')),result:{state:'SIMULATED'}}]};
 assert.ok(decision({history:[prior]}).reasons.includes('CONVERSIONS_ALREADY_USED'));
 const cfg=config();delete cfg.approved.incrementalPurchases;
 assert.ok(decision({cfg,history:[prior],purchases:6}).reasons.includes('INCREMENTAL_POLICY_NOT_APPROVED'));
 const second=decision({history:[prior],purchases:6});assert.ok(!second.reasons.includes('CONVERSIONS_ALREADY_USED'));assert.ok(second.reasons.includes('CAMPAIGN_COOLDOWN'));
});
test('night reduction is monotonic with changing ROAS and reaches its final target',()=>{
 let budget=7000;
 for(const time of ['22:30','22:45','23:00','23:15','23:30','23:45','23:59']){const d=decision({time,budget,roas:time<'23:00'?4.2:3.7});assert.ok(d.after<=budget);budget=d.after;}
 assert.equal(budget,2000);
 for(const roas of [4.2,3.8,3.7,null]){const d=decision({time:'23:59',budget:6000,roas});assert.equal(d.after,roas!==null&&roas>=3.8?2500:2000);}
 assert.equal(decision({time:'23:59',budget:1200,roas:4.2}).after,1200);
 const unknown=decision({time:'23:59',roas:null});assert.ok(unknown.warnings.includes('NIGHT_UNKNOWN_ROAS_CONSERVATIVE_CAP'));
 assert.equal(nightTarget(metric(at('23:59'),3.8)).cents,2500);
});
test('external night increases are recalculated; safer lower budgets never increase',()=>{
 assert.equal(decision({time:'23:59',budget:9000,roas:4.2}).after,2500);
 assert.equal(decision({time:'23:30',budget:1800,roas:4.2}).after,1800);
 assert.ok(manualAutopilotReasons({before:2000,after:2500,metric:metric(at('23:00')),now:at('23:00'),config:config()}).includes('NIGHT_INCREASE_BLOCKED'));
 assert.ok(manualAutopilotReasons({before:3000,after:2900,metric:metric(at('23:00'),null),now:at('23:00'),config:config()}).includes('NIGHT_CAP'));
});
test('Madrid scheduler handles DST, exact slot uniqueness and no catch-up',()=>{
 assert.equal(REVIEW_TIMES.length,23);assert.equal(reviewSlot(at('10:01')),null);
 for(const date of ['2026-03-29','2026-10-25']){assert.equal(reviewSlot(instantFor(date,'07:00')).key,date+':07:00');assert.equal(reviewSlot(instantFor(date,'23:59')).key,date+':23:59');}
 assert.equal(new Date(instantFor('2026-03-29','07:00')).getUTCHours(),5);
 assert.equal(new Date(instantFor('2026-10-25','07:00')).getUTCHours(),6);
 assert.equal(nextReview(at('10:02')),new Date(at('11:00')).toISOString());
 assert.equal(reviewSlot(at('23:59')).kind,'NIGHT');
});
test('LIVE and write flag attempts fail before any transport; explicit approval reference required',()=>{
 assert.equal(AUTOPILOT_LIVE_COMPILED,true);
 for(const env of [{AUTOPILOT_MODE:'LIVE'},{AUTOPILOT_ENABLED:'true',META_WRITES_ENABLED:'true'},{AUTOPILOT_ENABLED:'true',ADS_INTELLIGENCE_WRITES_ENABLED:'true'},{AUTOPILOT_ENABLED:'true',ADS_INTELLIGENCE_MODE:'LIVE'}])assert.throws(()=>loadAutopilotConfig(env),/AUTOPILOT/);
 assert.throws(()=>loadAutopilotConfig({AUTOPILOT_APPROVED_POLICY_JSON:'{"minimumBudgetCents":100}'}),/APPROVAL/);
 assert.throws(()=>createAdsRuntime({env:{ADS_INTELLIGENCE_READ_ENABLED:'true',AUTOPILOT_ENABLED:'true',ADS_INTELLIGENCE_MODE:'LIVE'},fetchImpl:()=>{throw Error('must not fetch');}}),/AUTOPILOT/);
});

class MemoryLedger {
 constructor(){this.proposals=new Map();this.operations=new Map();this.slots=new Map();this.accountLocked=false;}
 async byRequest(key){const p=[...this.proposals.values()].find(p=>p.requestKey===key);return p?this.get(p.id):null;}
 async createProposal(p){if(await this.byRequest(p.requestKey))return this.byRequest(p.requestKey);this.proposals.set(p.id,p);return this.get(p.id);}
 async get(id){const p=this.proposals.get(id);return p?{...p,items:p.items.map(i=>({...i,result:this.operations.get(id+':'+i.campaignId)||null}))}:null;}
 async claimProposal(id){const p=this.proposals.get(id);if(p.state!=='PENDING')return false;p.state='RUNNING';return true;}
 async finish(id,state){this.proposals.get(id).state=state;return this.get(id);}
 async cancel(id){return this.finish(id,'CANCELLED');}
 async record(id,campaignId,result){this.operations.set(id+':'+campaignId,result);}
 async budgetUsage(){return {increaseCents:0,changedCampaignIds:[]};}
 async liveActivation(account,reference){const rows=[...this.proposals.values()].filter(p=>p.accountId===account&&p.authorizationReference===reference&&p.mode==='LIVE').flatMap(p=>p.items.map(i=>this.operations.get(p.id+':'+i.campaignId)).filter(Boolean));return {stage:rows.some(r=>['FAILED','UNKNOWN','EXECUTING','RECONCILED'].includes(r.state))?'REVIEW_REQUIRED':rows.some(r=>r.state==='VERIFIED'&&r.externalWrites===1&&r.response?.success===true)?'CANARY_VERIFIED':'CANARY_PENDING'};}
 async withAccountBudgetLock(_account,fn){if(this.accountLocked)throw Error('ACCOUNT_BUDGET_BUSY');this.accountLocked=true;try{return await fn();}finally{this.accountLocked=false;}}
 async withCampaignLock(_key,fn){return fn({unresolved:async()=>false,circuitOpen:async()=>false,record:(...a)=>this.record(...a),claimOperation:async()=>true,openCircuit:async()=>{}});}
 async autopilotHistory(){return Promise.all([...this.proposals.keys()].map(id=>this.get(id)));}
 async claimAutopilotSlot(account,slot,at){const key=account+':'+slot.key;if(this.slots.has(key))return false;this.slots.set(key,{slot_key:slot.key,state:'EXECUTING',created_at:new Date(at).toISOString()});return true;}
 async finishAutopilotSlot(account,key,state,body){Object.assign(this.slots.get(account+':'+key),{state,body,completed_at:new Date().toISOString()});}
 async autopilotSlots(){return [...this.slots.values()].reverse();}
}
function fixture({time='10:00',budget=2500,roas=4.2,purchases=3,ledger=new MemoryLedger()}={}) {
 let now=at(time),calls=0,c=campaign(budget),rules=[];
 const reader={readAccount:async()=>({id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}),readCampaigns:async()=>[c],readDelivery:async()=>[{campaign_id:'11',status:'ACTIVE',effective_status:'ACTIVE'}],readRules:async()=>rules,readCampaign:async()=>c,readAccountDaySpend:async()=>({date:day,spendCents:2000,observedAt:new Date(now).toISOString(),complete:true}),
 readInsights:async()=>[{campaign_id:'11',campaign_name:c.name,date_start:day,date_stop:day,spend:'20',impressions:'2000',actions:[{action_type:type,value:String(purchases)}],action_values:[{action_type:type,value:String(roas*20)}],purchase_roas:[{action_type:type,value:String(roas)}]}]};
 const cfg=config(),engine=new AdsIntelligence({reader,ledger,policy:{...legacy},allowedActors:['1','2'],accountId:'9',mode:'SHADOW',now:()=>now,writer:{setDailyBudget:async()=>{calls++;throw Error('must not write');}}});
 const service=new BudgetAutopilot({engine,ledger,config:cfg,now:()=>now,readConstraints:async()=>({verified:true,minimumCents:1500})});
 return {service,engine,ledger,c,cfg,reader,rules,setTime:t=>now=at(t),calls:()=>calls};
}
test('scheduled SHADOW decision reuses existing executor, claims once and never writes Meta',async()=>{
 const f=fixture(),r=await f.service.tick();assert.equal(r.state,'SIMULATED');assert.equal(f.calls(),0);
 assert.equal((await f.ledger.get(r.proposalId)).items[0].result.state,'SIMULATED');
 assert.equal((await f.service.tick()).state,'ALREADY_CLAIMED');assert.equal(f.ledger.proposals.size,1);
 const recreated=new BudgetAutopilot({engine:f.engine,ledger:f.ledger,config:f.cfg,now:()=>at('10:00')});
 assert.equal((await recreated.tick()).state,'ALREADY_CLAIMED');
});
test('slow or unavailable learning evidence cannot delay a slot or permit a change',async()=>{
 for(const read of [()=>new Promise(()=>{}),async()=>{throw Error('unavailable');}]){
  const f=fixture();f.service.learningWaitMs=1;f.engine.learningAssessment=read;
  const report=await f.service.overview();
  assert.ok(report.campaigns[0].reasons.includes('LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE'));
  const result=await f.service.tick();
  assert.equal(result.externalWrites,0);assert.equal(f.calls(),0);
  const proposal=await f.ledger.get(result.proposalId);
  assert.equal(proposal.items[0].result.state,'BLOCKED');
  assert.ok(proposal.items[0].result.reasons.includes('LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE'));
 }
});

test('scheduled proposals reuse the captured learning decision without starting another read',async()=>{
 const f=fixture();let reads=0;
 f.engine.learningAssessment=async()=>{reads++;return {reasons:[],policy:{version:'fixture'}};};
 const evidence=await f.service.capture();
 assert.equal(reads,1);
 await f.engine.proposeScheduled({slot:reviewSlot(at('10:00')),decisions:f.service.decisions(evidence,reviewSlot(at('10:00'))),evidence,config:f.cfg});
 assert.equal(reads,1);
});

test('two schedulers share a durable slot; interrupted claims are never replayed',async()=>{
 const ledger=new MemoryLedger(),a=fixture({ledger}),b=fixture({ledger});
 const results=await Promise.all([a.service.tick(),b.service.tick()]);assert.equal(results.filter(r=>r.state==='SIMULATED').length,1);assert.equal(ledger.proposals.size,1);
 const f=fixture();await f.ledger.claimAutopilotSlot('9',reviewSlot(at('10:00')),at('10:00'));
 assert.equal((await f.service.tick()).state,'ALREADY_CLAIMED');assert.equal(f.ledger.proposals.size,0);
 f.setTime('10:03');assert.equal((await f.service.tick()).state,'NO_CURRENT_SLOT');
});
test('second hourly increase consumes prior evidence and 24h cooldown',async()=>{
 const f=fixture();await f.service.tick();f.setTime('11:00');const r=await f.service.tick();
 const p=await f.ledger.get(r.proposalId);assert.equal(p.items[0].result.state,'BLOCKED');assert.ok(p.items[0].reasons.includes('CONVERSIONS_ALREADY_USED'));assert.equal(f.calls(),0);
});
test('native rule conflict and stale external budget revalidation stop execution',async()=>{
 const f=fixture();f.rules.push({status:'ENABLED'});const r=await f.service.tick();assert.ok((await f.ledger.get(r.proposalId)).items[0].reasons.includes('AUTOMATION_CONFLICT'));
 const g=fixture(),e=await g.service.capture(),slot=reviewSlot(at('10:00')),p=await g.engine.proposeScheduled({slot,decisions:g.service.decisions(e,slot),evidence:e,config:g.cfg});
 g.c.daily_budget='3000';const out=await g.engine.confirmScheduled(p.id);assert.equal(out.items[0].result.state,'STALE');assert.equal(g.calls(),0);
});
test('manual natural EUR orders remain actor-bound, capped and idempotent',async()=>{
 assert.equal(parseAdsIntent('Baja 10 € a todas las campañas activas').selector,'ALL_ACTIVE');
 assert.equal(parseAdsIntent('Pon CollaGum a 50 € diarios').value,'50');
 const f=fixture(),actor={user:'1',chat:'1'};
 const p=await f.engine.propose({actor,requestKey:'telegram:one',text:'Pon NIDA fixture a 50 € diarios'});
 assert.equal((await f.engine.propose({actor,requestKey:'telegram:one',text:'Pon NIDA fixture a 50 € diarios'})).id,p.id);
 await assert.rejects(f.engine.confirm({id:p.id,actor:{user:'2',chat:'2'}}),/AUTHORIZED/);
 await assert.rejects(f.engine.propose({actor:{user:'7',chat:'7'},requestKey:'x',text:'Sube 10 € a NIDA'}),/AUTHORIZED/);
 const above=await f.engine.propose({actor,requestKey:'telegram:above',text:'Pon NIDA fixture a 75 € diarios'});assert.ok(above.items[0].reasons.includes('MAX_BUDGET'));
 const percentage=await f.engine.propose({actor,requestKey:'telegram:pct',text:'Sube 10 % a NIDA fixture'});assert.equal(percentage.state,'CLARIFICATION');
 const confirmed=await f.engine.confirm({id:p.id,actor});assert.equal((await f.engine.confirm({id:p.id,actor})).state,confirmed.state);assert.equal(f.calls(),0);
});
test('final SHADOW reconciliation exposes observed budget; no fabricated VERIFIED success',async()=>{
 const f=fixture({time:'23:59',budget:7000}),r=await f.service.tick();assert.equal(r.finalCheck.state,'NOT_ENFORCED_SHADOW');assert.equal(r.finalCheck.observedBudgets[0].actualCents,7000);assert.equal(r.finalCheck.observedBudgets[0].withinTarget,false);assert.equal(f.calls(),0);
});
test('Spanish requested monitoring questions select the correct view without writes',()=>{
 for(const text of ['¿Qué presupuestos tenemos ahora?','¿Qué campañas han subido hoy de presupuesto?','¿Qué campañas están cerca de los 70 €?','¿Por qué no has aumentado Seoul 1988?','¿Cuánto presupuesto hemos reducido hoy?','Muéstrame el historial de modificaciones de NIDA'])assert.ok(parseAutopilotQuery(text),text);
 assert.equal(parseAutopilotQuery('Sube 10 € a NIDA'),null);
 const text=formatAutopilot({mode:'SHADOW',enabled:true,date:day,observedAt:new Date(at('10:00')).toISOString(),nextReviewAt:new Date(at('11:00')).toISOString(),campaigns:[],timeline:[{state:'SIMULATED',after:3500,before:2500,campaignId:'11'}]}, {kind:'increases'});
 assert.match(text,/No hay modificaciones propias verificadas/);
});
test('a minimum above the current budget never turns a reduction into an increase',()=>{
 const cfg=config();cfg.approved.minimumBudgetCents=3000;
 const d=decision({time:'12:00',budget:2000,roas:3.7,cfg});assert.equal(d.after,2000);assert.equal(d.action,'HOLD');
});
test('new-day purchases do not reuse or subtract yesterday conversion evidence',()=>{
 const prior={origin:'AUTOPILOT',mode:'SHADOW',createdAt:instantFor('2026-10-21','10:00'),items:[{campaignId:'11',before:2000,after:3000,metric:{...metric(at('10:00')),purchases:30},result:{state:'SIMULATED'}}]};
 const d=decision({history:[prior]});assert.ok(!d.reasons.includes('CONVERSIONS_ALREADY_USED'));assert.equal(d.shadowChangesToday,0);
});
test('manual proposal expiry and changed policy cannot become a new execution',async()=>{
 const f=fixture(),actor={user:'1',chat:'1'},p=await f.engine.propose({actor,requestKey:'expiring',text:'Pon NIDA fixture a 30 €'});
 f.setTime('10:06');assert.equal((await f.engine.confirm({id:p.id,actor})).state,'EXPIRED');
 const g=fixture(),other=await g.engine.propose({actor,requestKey:'changing',text:'Pon NIDA fixture a 30 €'});g.cfg.approved.minimumBudgetCents=1700;
 assert.equal((await g.engine.confirm({id:other.id,actor})).state,'STALE_POLICY_OR_MODE');
});
function offlineLiveFixture(){
 const f=fixture({time:'23:59',budget:2550});
 // Explicit dependency injection is test-only. The runtime factory never
 // accepts a compiled override and its production AUTOPILOT gate stays false.
 f.cfg.mode='LIVE';f.cfg.liveCompiled=true;f.cfg.writesEnabled=true;f.engine.mode='LIVE';f.engine.policy.liveAccountBudgets=true;f.engine.policy.maxChangePercent=10;
 let writes=0;f.engine.writer={setDailyBudget:async(_id,cents)=>{writes++;f.c.daily_budget=String(cents);return {success:true};}};
 return {...f,writes:()=>writes};
}
test('offline future LIVE harness uses the same writer and fresh final readback',async()=>{
 const f=offlineLiveFixture(),r=await f.service.tick();assert.equal(f.writes(),1);assert.equal(r.executionState,'VERIFIED');assert.equal(r.finalCheck.state,'VERIFIED_WITHIN_CAP');assert.equal(r.finalCheck.observedBudgets[0].actualCents,2500);
 assert.equal((await f.service.tick()).state,'ALREADY_CLAIMED');assert.equal(f.writes(),1);
});
test('offline unknown financial result raises critical cap alert and is never resent',async()=>{
 const f=offlineLiveFixture();let attempts=0;f.engine.writer={setDailyBudget:async()=>{attempts++;throw Error('unknown fixture');}};
 const r=await f.service.tick();assert.equal(r.executionState,'UNKNOWN_RESULT');assert.equal(r.externalWrites,null);assert.equal(r.finalCheck.state,'CRITICAL_UNVERIFIED_CAP');
 assert.equal((await f.service.tick()).state,'ALREADY_CLAIMED');assert.equal(attempts,1);
 assert.ok((await f.service.overview()).alerts.some(a=>a.code==='CRITICAL_UNVERIFIED_CAP'));
});
test('offline definite rejection stays FAILED, never VERIFIED or automatically retried',async()=>{
 const f=offlineLiveFixture();let attempts=0;f.engine.writer={setDailyBudget:async()=>{attempts++;throw Object.assign(Error('reject fixture'),{definitiveRejection:true,status:400});}};
 const r=await f.service.tick(),p=await f.ledger.get(r.proposalId);assert.equal(p.items[0].result.state,'FAILED');assert.equal(r.finalCheck.state,'CRITICAL_UNVERIFIED_CAP');await f.service.tick();assert.equal(attempts,1);
});
test('runtime factory cannot activate LIVE through flags without the complete approved policy',()=>{
 assert.throws(()=>createAdsRuntime({env:{ADS_INTELLIGENCE_READ_ENABLED:'true',AUTOPILOT_ENABLED:'true',AUTOPILOT_MODE:'LIVE',AUTOPILOT_LIVE_AUTHORIZED:'true',ADS_INTELLIGENCE_MODE:'LIVE',ADS_INTELLIGENCE_WRITES_ENABLED:'true',META_WRITES_ENABLED:'false',LIVE_COMPILED:'true',AUTOPILOT_LIVE_COMPILED:'true'},fetchImpl:()=>{throw Error('must not fetch');}}),/AUTOPILOT_LIVE_POLICY_INCOMPLETE/);
});
test('account spending guard distinguishes missing, stale and reached limits',()=>{
 assert.ok(decision({accountSpend:null}).reasons.includes('ACCOUNT_SPEND_UNVERIFIED'));
 assert.ok(decision({accountSpend:{date:day,spendCents:100001,observedAt:new Date(at('10:00')).toISOString(),complete:true}}).reasons.includes('ACCOUNT_SPEND_LIMIT_REACHED'));
 const cfg=config();delete cfg.approved.globalSpendLimitCents;assert.ok(decision({cfg}).reasons.includes('GLOBAL_SPEND_LIMIT_NOT_APPROVED'));
});
test('confirmed manual SHADOW order models its priority over the scheduled simulation',async()=>{
 const f=fixture(),actor={user:'1',chat:'1'},p=await f.engine.propose({actor,requestKey:'manual-priority',text:'Pon NIDA fixture a 30 €'});await f.engine.confirm({id:p.id,actor});
 const r=await f.service.tick(),scheduled=await f.ledger.get(r.proposalId);assert.ok(scheduled.items[0].reasons.includes('MANUAL_HOLD_UNTIL_NIGHT'));assert.equal(f.calls(),0);
 const g=fixture(),second={user:'2',chat:'2'},q=await g.engine.propose({actor:second,requestKey:'second-admin',text:'Pon NIDA fixture a 30 €'});assert.equal((await g.engine.confirm({id:q.id,actor:second})).items[0].result.state,'SIMULATED');
});
test('offline partial provider failure remains partial and final cap is not falsely verified',async()=>{
 const f=offlineLiveFixture(),second={...f.c,id:'12',name:'Second fixture'},originalInsights=f.reader.readInsights;
 f.reader.readCampaigns=async()=>[f.c,second];f.reader.readDelivery=async()=>['11','12'].map(id=>({campaign_id:id,status:'ACTIVE',effective_status:'ACTIVE'}));
 f.reader.readInsights=async()=>{const row=(await originalInsights())[0];return [row,{...row,campaign_id:'12',campaign_name:second.name}];};
 f.reader.readCampaign=async id=>id==='11'?f.c:second;
 f.engine.writer={setDailyBudget:async(id,cents)=>{if(id==='12')throw Object.assign(Error('definitive fixture'),{definitiveRejection:true,status:400});f.c.daily_budget=String(cents);return {success:true};}};
 const r=await f.service.tick();assert.equal(r.executionState,'PARTIAL_FAILURE');assert.equal(r.finalCheck.state,'CRITICAL_UNVERIFIED_CAP');
 const p=await f.ledger.get(r.proposalId);assert.equal(p.items[0].result.state,'VERIFIED');assert.equal(p.items[1].result.state,'FAILED');
});
test('native campaign ROAS uses matching purchase count/value without adding event aliases',()=>{
 const raw=normalizeInsight({campaign_id:'11',spend:'20',actions:[{action_type:type,value:'2'},{action_type:'omni_purchase',value:'4'}],action_values:[{action_type:type,value:'60'},{action_type:'omni_purchase',value:'84'}],purchase_roas:[{action_type:'omni_purchase',value:'4.2'}]}, {level:'campaign'});
 assert.equal(raw.purchases,2);const financial=autopilotMetric(raw);assert.equal(financial.purchases,4);assert.equal(financial.purchaseValue,84);assert.equal(financial.purchaseType,'omni_purchase');assert.equal(financial.metaRoas,4.2);assert.equal(raw.purchases,2);
 const missing=autopilotMetric({...raw,metaPurchases:null,metaPurchaseStatus:'MISSING'});assert.equal(missing.metaRoasStatus,'MISSING');assert.equal(missing.purchases,null);
});
test('overview previews the actual next slot, never another noon cut or tomorrow increase',async()=>{
 const f=fixture({time:'12:02',roas:3.7}),report=await f.service.overview();assert.equal(report.campaigns[0].action,'HOLD');assert.equal(report.nextReviewAt,new Date(at('13:00')).toISOString());
 const night=fixture({time:'23:59'}),next=await night.service.overview();assert.equal(next.campaigns[0].action,'HOLD');assert.ok(next.campaigns[0].reasons.includes('FUTURE_DAY_METRICS_REQUIRED'));
});
test('no active campaigns cannot produce a fabricated VERIFIED operation',async()=>{const f=fixture();f.reader.readCampaigns=async()=>[];const r=await f.service.tick();assert.equal(r.decisions.length,0);assert.notEqual(r.executionState,'VERIFIED');assert.equal(f.calls(),0);});

test('explicit fixed-EUR consolidation replaces old percentage/five-purchase/cooldown bounds only in that profile',()=>{
 const cfg=config();Object.assign(cfg.approved,{policyProfile:'V5_1_FIXED_EUR',globalSpendLimitMode:'UNLIMITED_AUTHORIZED'});delete cfg.approved.globalSpendLimitCents;
 cfg.legacy={...legacy,maxChangePercent:10,minPurchases:5};
 const d=decision({cfg,purchases:3});assert.equal(d.state,'VALIDATED');
 const history=[{id:'own',accountId:'9',origin:'AUTOPILOT',mode:'LIVE',createdAt:at('09:00'),items:[{campaignId:'11',before:2000,after:2500,metric:metric(at('09:00'),4.2,3),result:{state:'VERIFIED',verifiedAt:at('09:00')}}]}];
 const second=decision({cfg,purchases:6,history});assert.equal(second.state,'VALIDATED');
 assert.ok(decision({cfg,purchases:3,history}).reasons.includes('CONVERSIONS_ALREADY_USED'));
 assert.ok(decision({cfg,accountSpend:null}).reasons.includes('ACCOUNT_SPEND_UNVERIFIED'));
 assert.ok(!decision({cfg,accountSpend:{date:day,complete:true,observedAt:new Date(at('10:00')).toISOString(),spendCents:999999999}}).reasons.includes('ACCOUNT_SPEND_LIMIT_REACHED'));
 assert.throws(()=>loadAutopilotConfig({AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify({...cfg.approved,globalSpendLimitCents:10})}),/POLICY_INVALID/);
});

test('LIVE requires every approved control and campaign-bound minimum receipts',()=>{
 const approved={approvalReference:'chat:fixture:live-v51',policyProfile:'V5_1_FIXED_EUR',minimumBudgetCents:1500,globalExposureCents:100000,globalSpendLimitMode:'UNLIMITED_AUTHORIZED',incrementalPurchases:3,roasReductionMode:'ENABLED',reductionMinSpend:15,reductionMinImpressions:1000,attributionMaturityMinutes:120};
 const env={AUTOPILOT_ENABLED:'true',AUTOPILOT_MODE:'LIVE',AUTOPILOT_LIVE_AUTHORIZED:'true',ADS_INTELLIGENCE_MODE:'LIVE',ADS_INTELLIGENCE_WRITES_ENABLED:'true',META_WRITES_ENABLED:'false',AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify(approved),AUTOPILOT_VERIFIED_MINIMUMS_JSON:JSON.stringify([{campaignId:'11',accountId:'9',currency:'EUR',minimumCents:1500,verifiedAt:'2026-10-22T10:00Z',validUntil:'2026-10-23T10:00Z',reference:approved.approvalReference}])};
 assert.equal(loadAutopilotConfig(env).mode,'LIVE');
 for(const key of ['policyProfile','minimumBudgetCents','globalExposureCents','globalSpendLimitMode','incrementalPurchases','roasReductionMode','reductionMinSpend','reductionMinImpressions','attributionMaturityMinutes']){const missing={...approved};delete missing[key];assert.throws(()=>loadAutopilotConfig({...env,AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify(missing)}),/POLICY_INCOMPLETE/);}
 assert.throws(()=>loadAutopilotConfig({...env,AUTOPILOT_VERIFIED_MINIMUMS_JSON:'[]'}),/POLICY_INCOMPLETE/);
 assert.throws(()=>loadAutopilotConfig({...env,AUTOPILOT_LIVE_AUTHORIZED:'false'}),/LIVE_NOT_AUTHORIZED/);
});

test('fixed profile reduction maturity starts again after the last own budget change, with a separate blocked mode',()=>{
 const cfg=config();Object.assign(cfg.approved,{policyProfile:'V5_1_FIXED_EUR',roasReductionMode:'ENABLED'});
 const history=[{origin:'AUTOPILOT',mode:'LIVE',createdAt:at('11:00'),items:[{campaignId:'11',before:2000,after:2500,result:{state:'VERIFIED',verifiedAt:at('11:00')}}]}];
 assert.ok(decision({cfg,time:'12:00',roas:3.7,history}).reasons.includes('REDUCTION_SAMPLE_INSUFFICIENT'));
 history[0].createdAt=at('09:00');history[0].items[0].result.verifiedAt=at('09:00');assert.ok(!decision({cfg,time:'12:00',roas:3.7,history}).reasons.includes('REDUCTION_SAMPLE_INSUFFICIENT'));
 cfg.approved.roasReductionMode='BLOCKED';assert.ok(decision({cfg,time:'12:00',roas:3.7}).reasons.includes('ROAS_REDUCTIONS_NOT_AUTHORIZED'));
});

test('first eligible LIVE batch changes only one campaign; verified proof enables later batches',async()=>{
 const f=offlineLiveFixture(),second={...f.c,id:'12',name:'Second fixture'},baseInsights=f.reader.readInsights;
 f.cfg.approved.policyProfile='V5_1_FIXED_EUR';
 f.reader.readCampaigns=async()=>[f.c,second];f.reader.readDelivery=async()=>['11','12'].map(id=>({campaign_id:id,status:'ACTIVE',effective_status:'ACTIVE'}));
 f.reader.readInsights=async()=>{const row=(await baseInsights())[0];return [row,{...row,campaign_id:'12',campaign_name:second.name}];};
 f.reader.readCampaign=async id=>id==='11'?f.c:second;
 const writes=[];f.engine.writer={setDailyBudget:async(id,cents)=>{writes.push(id);(id==='11'?f.c:second).daily_budget=String(cents);return {success:true};}};
 const result=await f.service.tick(),p=await f.ledger.get(result.proposalId);assert.deepEqual(writes,['11']);assert.equal(p.items[1].result.state,'BLOCKED');assert.ok(p.items[1].result.reasons.includes('CANARY_VERIFICATION_PENDING'));
 assert.equal((await f.ledger.liveActivation('9',f.cfg.approved.approvalReference)).stage,'CANARY_VERIFIED');
 const actor={user:'2',chat:'2'},next=await f.engine.propose({actor,requestKey:'after-canary',text:'Pon Second fixture a 24 €'});await f.engine.confirm({id:next.id,actor});assert.deepEqual(writes,['11','12']);
});

test('an uncertain first real result blocks all further LIVE batches under the same approval',async()=>{
 const f=offlineLiveFixture();f.cfg.approved.policyProfile='V5_1_FIXED_EUR';let writes=0;
 f.engine.writer={setDailyBudget:async()=>{writes++;throw Error('uncertain fixture');}};
 const result=await f.service.tick();assert.equal((await f.ledger.get(result.proposalId)).items[0].result.state,'UNKNOWN');
 assert.equal((await f.ledger.liveActivation('9',f.cfg.approved.approvalReference)).stage,'REVIEW_REQUIRED');
 const actor={user:'1',chat:'1'},next=await f.engine.propose({actor,requestKey:'after-uncertain',text:'Pon NIDA fixture a 24 €'});const outcome=await f.engine.confirm({id:next.id,actor});assert.equal(writes,1);assert.ok(outcome.items[0].result.reasons.includes('LIVE_REVIEW_REQUIRED'));
});
