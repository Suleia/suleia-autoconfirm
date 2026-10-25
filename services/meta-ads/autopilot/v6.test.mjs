import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CONTRACT} from '../metrics.mjs';
import {loadAutopilotConfig} from './policy.mjs';
import {evaluateV6,V6_POLICY,V6_PROFILE,V6_VERSION,rankV6,intradayTrend} from './v6-policy.mjs';
import {instantFor,reviewSlot,nextReview,V6_REVIEW_TIMES,madridTime} from './schedule.mjs';
import {v6BudgetGuards} from './learning.mjs';
import {BudgetAutopilot} from './service.mjs';
import {AdsIntelligence} from '../intelligence.mjs';
import {createMetaBudgetTransport} from '../executor-transport.mjs';
import {createMetaReadScheduler} from '../request-scheduler.mjs';
import {budgetDiagnostic} from './errors.mjs';
import {parseAutopilotQuery,formatAutopilot} from './queries.mjs';
import {adsCommandErrorCode} from '../command-errors.mjs';
const day='2026-10-25',at=t=>instantFor(day,t),type='offsite_conversion.fb_pixel_purchase';
const approved={approvalReference:'test:v6:owner',policyProfile:V6_PROFILE,minimumBudgetCents:1500,globalExposureCents:100000,aggregateIncreaseCents:3000,incrementalPurchases:3,globalSpendLimitMode:'UNLIMITED_AUTHORIZED',roasReductionMode:'ENABLED',reductionMinSpend:15,reductionMinImpressions:1000,attributionMaturityMinutes:120};
const legacy={maxBudgetCents:10000,maxChangePercent:10,minSpend:15,minImpressions:1000,minPurchases:3,maxAgeMs:120000,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000,liveAccountBudgets:true};
const config=()=>({enabled:true,mode:'LIVE',liveCompiled:true,writesEnabled:true,policy:V6_POLICY,approved:{...approved},legacy:{...legacy},verifiedMinimums:[]});
const campaign=(budget=6000,id='11')=>({id,account_id:'9',name:'V6 fixture '+id,status:'ACTIVE',effective_status:'ACTIVE',daily_budget:String(budget)});
const metric=(time='10:00',roas=4.2,purchases=3)=>({campaignId:'11',entityId:'11',level:'campaign',since:day,until:day,observedAt:new Date(at(time)).toISOString(),complete:true,contract:CONTRACT,metaRoas:roas,metaRoasStatus:roas===null?'MISSING':roas===0?'ZERO':'VALID',metaRoasPurchaseType:type,purchaseType:type,purchases,spend:20,impressions:2000,purchaseValue:roas===null?null:20*roas});
function decide({time='10:00',budget=6000,roas=4.2,purchases=3,history=[],...extra}={}){return evaluateV6({campaign:campaign(budget),metric:metric(time,roas,purchases),slot:reviewSlot(at(time),V6_VERSION),now:at(time),config:config(),history,constraints:{verified:true,minimumCents:1500,validUntil:'2026-10-26T00:00Z'},accountSpend:{complete:true,date:day,spendCents:5000,observedAt:new Date(at(time)).toISOString()},baseline:{verified:true,date:day,budgets:{'11':6000}},trend:{verified:true,recovering:false},...extra});}
const operation=(time,before,after,patch={})=>({origin:'AUTOPILOT',mode:'LIVE',accountId:'9',createdAt:at(time),autopilot:{version:V6_VERSION,slot:reviewSlot(at(time),V6_VERSION)},items:[{campaignId:'11',before,after,metric:metric(time),result:{state:'VERIFIED',verifiedAt:at(time)+1000},...patch}]});

test('V6 monetary receipt must match the finite aggregate environment; expiration fails closed',()=>{
 const env={AUTOPILOT_ENABLED:'true',ADS_MAX_AGGREGATE_INCREASE_EUR:'30',AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify(approved)};
 assert.equal(loadAutopilotConfig(env).policy.maxBudgetCents,10000);
 for(const patch of [{aggregateIncreaseCents:36000},{aggregateIncreaseCents:null},{minimumBudgetCents:1000},{authorizationExpiresAt:'2020-01-01'}])assert.throws(()=>loadAutopilotConfig({...env,AUTOPILOT_APPROVED_POLICY_JSON:JSON.stringify({...approved,...patch})}));
 const cfg=config();cfg.approved.authorizationExpiresAt='2026-10-25T00:00Z';assert.ok(decide({config:cfg}).reasons.includes('AUTOPILOT_AUTHORIZATION_EXPIRED'));
});
for(const [before,after]of[[10000,7000],[8000,5600],[6000,4200],[4000,2800],[2000,1500],[1500,1500]])test(`V6 night ${before} -> ${after} is independent of advertising metrics`,()=>{
 for(const roas of [0,1,3,7,12,null]){const d=decide({time:'22:30',budget:before,roas,purchases:0,metric:null});assert.equal(d.after,after);assert.deepEqual(d.reasons,[]);assert.equal(d.effectiveReductionBps,Math.round((before-after)*10000/before));}
});
test('night minimum conflict never turns a reduction into an increase; external >100 target stays <=100',()=>{
 assert.equal(decide({time:'22:30',budget:1200}).after,1200);
 assert.equal(decide({time:'22:30',budget:18000}).after,10000);
 assert.equal(decide({time:'22:30',budget:3000,constraints:{verified:true,minimumCents:2500}}).after,2500);
});
for(const budget of [1500,5600,9500,10000])test(`08:00 observes ${budget} without restoration or performance cut`,()=>{const d=decide({time:'08:00',budget,roas:0});assert.equal(d.action,'HOLD');assert.equal(d.after,budget);});
test('V6 calendar is exact, unique, DST aware and has no progressive night or catch-up',()=>{
 assert.deepEqual(V6_REVIEW_TIMES,['08:00','10:00','12:00','16:00','18:00','22:30']);
 for(const date of ['2026-03-29','2026-10-25'])for(const time of V6_REVIEW_TIMES)assert.equal(reviewSlot(instantFor(date,time),V6_VERSION).key,date+':'+time);
 for(const time of ['07:00','11:00','19:00','22:45','23:00','23:59','10:01'])assert.equal(reviewSlot(at(time),V6_VERSION),null);
 assert.equal(madridTime(Date.parse(nextReview(at('22:30'),V6_VERSION))).time,'08:00');
});
test('first intraday raise needs three today, matching ROAS attribution, sample and fresh account read',()=>{
 assert.deepEqual(decide().reasons,[]);assert.equal(decide({budget:9500}).after,10000);assert.equal(decide({budget:10000}).action,'HOLD');
 for(const [patch,reason]of[[{purchases:2},'MIN_THREE_PURCHASES'],[{accountSpend:null},'ACCOUNT_SPEND_UNVERIFIED'],[{metric:{...metric(),until:'2026-10-24'}},'AUTOPILOT_STALE_OR_WRONG_DAY'],[{metric:{...metric(),metaRoasPurchaseType:'purchase'}},'ROAS_SCOPE_MISMATCH']])assert.ok(decide(patch).reasons.includes(reason));
 for(const roas of [2.5,3,3.8])assert.equal(decide({roas}).action,'HOLD');
});
test('late aggregate attribution is not three new purchases; exact post-change events are required',()=>{
 const history=[operation('10:00',5000,6000)];
 assert.ok(decide({time:'12:00',history,purchases:6}).reasons.includes('INCREMENTAL_PURCHASE_PROVENANCE_UNVERIFIED'));
 const proof={verified:true,campaignId:'11',accountId:'9',contract:CONTRACT,purchaseType:type,businessDate:day,observedAt:new Date(at('12:00')).toISOString(),source:'VERIFIED_FIRST_PARTY_ATTRIBUTION',events:[0,1,2].map(i=>({idHash:createHash('sha256').update('fixture:'+i).digest('hex'),conversionAt:new Date(at('11:00')+i*1000).toISOString(),attributionVerified:true}))};
 assert.deepEqual(decide({time:'12:00',history,purchases:6,purchaseProof:proof}).reasons,[]);
 for(const p of [{...proof,source:'META_AGGREGATE_DELTA'},{...proof,events:[proof.events[0],proof.events[0],proof.events[1]]},{...proof,events:proof.events.map(e=>({...e,conversionAt:new Date(at('09:00')).toISOString()}))}])assert.ok(decide({time:'12:00',history,purchases:6,purchaseProof:p}).reasons.includes('INCREMENTAL_PURCHASE_PROVENANCE_UNVERIFIED'));
});
test('four increments, ambiguity and uncertain operations block further increases',()=>{
 const history=['10:00','12:00','16:00','18:00'].map(t=>operation(t,2000,3000));
 assert.ok(decide({time:'18:00',history,purchases:30}).reasons.includes('FOUR_INCREASES_USED'));
 const uncertain=[operation('10:00',5000,6000,{result:{state:'UNKNOWN'}})];assert.ok(decide({time:'12:00',history:uncertain}).reasons.includes('UNRESOLVED_OPERATION'));
 assert.ok(decide({metric:{...metric(),metaRoasStatus:'AMBIGUOUS'}}).reasons.includes('ROAS_AMBIGUOUS'));
});
test('day reductions use the same 08 baseline and stop at 25 percent; missed steps are not compounded',()=>{
 const a=decide({time:'12:00',roas:2});assert.equal(a.after,5400);
 const h1=operation('12:00',6000,5400),b=decide({time:'16:00',budget:5400,roas:2,history:[h1]});assert.equal(b.after,4800);
 const h2=operation('16:00',5400,4800),c=decide({time:'18:00',budget:4800,roas:2,history:[h1,h2]});assert.equal(c.after,4500);
 assert.equal(decide({time:'18:00',budget:6000,roas:2}).after,5700);
 assert.ok(decide({time:'12:00',roas:2,baseline:null}).reasons.includes('DAY_BASELINE_UNVERIFIED'));
 assert.ok(decide({time:'16:00',roas:2,trend:{verified:true,recovering:true}}).reasons.includes('INTRADAY_RECOVERY_PROTECTED'));
 assert.ok(decide({time:'16:00',roas:2,trend:null}).reasons.includes('INTRADAY_TREND_UNVERIFIED'));
 assert.equal(decide({time:'12:00',roas:null}).action,'HOLD');
});
test('trend and normalized ranking distinguish missing history, recovery and weekly context',()=>{
 assert.equal(intradayTrend({...metric('12:00',2.4),spend:40,purchaseValue:96},metric('10:00',1),at('12:00')).recovering,true);
 assert.equal(intradayTrend(metric(),null,at('10:00')).verified,false);
 assert.ok(rankV6({today:1,recent:0,historical:0}).score>rankV6({today:.2,recent:1,historical:1}).score);
 assert.equal(rankV6({today:.7}).score,.7);
 const sources=Object.fromEntries(['account','entities_campaign','entities_adset','activities','currentActivities','rules'].map(k=>[k,{status:'COMPLETE'}]));
 const guarded=v6BudgetGuards({reasons:['INCOMPLETE_EVIDENCE','INSUFFICIENT_MULTIDAY_SAMPLE','CAMPAIGN_AGE_UNKNOWN_OR_YOUNG','LEARNING_ACTIVE','RECENT_SIGNIFICANT_CHANGE'],policy:{}},sources);
 assert.deepEqual(guarded.reasons,['LEARNING_ACTIVE','RECENT_SIGNIFICANT_CHANGE']);
 assert.ok(v6BudgetGuards(guarded,{}).reasons.includes('INCOMPLETE_OPERATIONAL_EVIDENCE'));
});

class Ledger {
 constructor(){this.ps=new Map();this.ops=new Map();this.slots=new Map();this.nights=new Map();this.locked=false;}
 async byRequest(k){return [...this.ps.values()].find(p=>p.requestKey===k)||null;}
 async createProposal(p){this.ps.set(p.id,p);return this.get(p.id);}
 async get(id){const p=this.ps.get(id);return p?{...p,items:p.items.map(i=>({...i,result:this.ops.get(id+':'+i.campaignId)||null}))}:null;}
 async claimProposal(id){const p=this.ps.get(id);if(p.state!=='PENDING')return false;p.state='RUNNING';return true;}
 async finish(id,s){this.ps.get(id).state=s;return this.get(id);}
 async record(id,c,r){this.ops.set(id+':'+c,{...this.ops.get(id+':'+c),...r});}
 async budgetUsage(){return {increaseCents:0,changedCampaignIds:[]};}
 async autopilotHistory(){return Promise.all([...this.ps.keys()].map(id=>this.get(id)));}
 async autopilotSlots(){return [...this.slots.values()].reverse();}
 async autopilotBaseline(){return null;}
 async nightReservations(){return [...this.nights.values()];}
 async claimAutopilotSlot(a,s,n){if(this.slots.has(s.key))return false;this.slots.set(s.key,{slot_key:s.key,state:'EXECUTING',created_at:new Date(n).toISOString()});return true;}
 async finishAutopilotSlot(a,k,s,b){Object.assign(this.slots.get(k),{state:s,body:b});}
 async liveActivation(){const r=[...this.ops.values()];return {stage:r.some(x=>['UNKNOWN','EXECUTING','FAILED'].includes(x.state))?'REVIEW_REQUIRED':r.some(x=>x.state==='VERIFIED')?'CANARY_VERIFIED':'CANARY_PENDING'};}
 async withAccountBudgetLock(a,fn){if(this.locked)throw Error('ACCOUNT_BUDGET_BUSY');this.locked=true;try{return await fn();}finally{this.locked=false;}}
 async withCampaignLock(k,fn){return fn({unresolved:async(a,c)=>[...this.ops].some(([k,r])=>k.endsWith(':'+c)&&['UNKNOWN','EXECUTING'].includes(r.state)),circuitOpen:async()=>false,openCircuit:async()=>{},record:(...a)=>this.record(...a),claimOperation:async(id,c,a,body={})=>{const key=a+':'+c+':'+body.nightBusinessDate;if(body.operationKind&&this.nights.has(key))return false;if(body.operationKind)this.nights.set(key,{campaign_id:c,state:'EXECUTING',body});await this.record(id,c,{...body,state:'EXECUTING'});return true;}});}
}
function fixture({time='22:30',unknown=false}={}){
 let now=at(time),calls=0,insights=0;const rows=[campaign(8000),campaign(6000,'12')],ledger=new Ledger(),cfg=config();
 const reader={readCampaigns:async()=>rows,readCampaign:async id=>rows.find(r=>r.id===id),readDelivery:async()=>rows.map(r=>({campaign_id:r.id,status:'ACTIVE',effective_status:'ACTIVE'})),readRules:async()=>[],readAccount:async()=>({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}),readInsights:async()=>{insights++;throw Error('PERFORMANCE_UNAVAILABLE');}};
 const engine=new AdsIntelligence({reader,ledger,accountId:'9',allowedActors:['1'],mode:'LIVE',now:()=>now,policy:{...legacy},writer:{setDailyBudget:async(id,cents)=>{calls++;if(unknown)throw Error('timeout');rows.find(r=>r.id===id).daily_budget=String(cents);return {success:true};}}});
 engine.learningAssessment=async()=>({reasons:['LEARNING_ACTIVE'],policy:{}});
 const service=new BudgetAutopilot({engine,ledger,config:cfg,now:()=>now,readConstraints:async()=>({verified:true,minimumCents:1500})});
 return {service,engine,ledger,cfg,rows,calls:()=>calls,insights:()=>insights,setTime:t=>now=at(t)};
}
test('night uses the real executor with no ROAS read, verifies the canary before the second assignment and survives restart',async()=>{
 const f=fixture(),r=await f.service.tick();assert.equal(r.externalWrites,2);assert.equal(f.calls(),2);assert.equal(f.insights(),0);
 assert.deepEqual(f.rows.map(r=>r.daily_budget),['5600','4200']);
 assert.equal((await f.ledger.get(r.proposalId)).items[0].result.readback.dailyBudgetCents,5600);
 assert.equal((await f.service.tick()).state,'ALREADY_CLAIMED');
 const restarted=new BudgetAutopilot({engine:f.engine,ledger:f.ledger,config:f.cfg,now:()=>at('22:30')});assert.equal((await restarted.tick()).state,'ALREADY_CLAIMED');assert.equal(f.calls(),2);
 const evidence=await restarted.capture({slot:reviewSlot(at('22:30'),V6_VERSION)});assert.ok(restarted.decisions(evidence,reviewSlot(at('22:30'),V6_VERSION)).every(d=>d.reasons.includes('NIGHT_ALREADY_CLAIMED')));
});
test('unknown first canary leaves a reservation and blocks the second write without retry',async()=>{
 const f=fixture({unknown:true}),r=await f.service.tick();assert.equal(r.externalWrites,null);assert.equal(f.calls(),1);await f.service.tick();assert.equal(f.calls(),1);assert.equal((await f.ledger.liveActivation()).stage,'REVIEW_REQUIRED');
});
test('cold performance failure is recorded with safe diagnosis rather than generic FAILED alone',async()=>{
 const f=fixture({time:'10:00'}),r=await f.service.tick();assert.equal(r.state,'FAILED');assert.equal(r.diagnostic.code,'PERFORMANCE_UNAVAILABLE');assert.equal(f.calls(),0);
});
test('a held financial window rejects optional work and retains priority for verification',async()=>{
 let now=1000;const q=createMetaReadScheduler({now:()=>now});q.reserveFinancialWindow(now+10000);await assert.rejects(q.schedule(()=>{}, {priority:10}),e=>e.code==='META_FINANCIAL_WINDOW_RESERVED');
 assert.equal(await q.schedule(()=>42,{priority:-20}),42);now+=11000;assert.equal(await q.schedule(()=>43,{priority:10}),43);
});
test('cap is independent of environment, including validate_only and every assignment path',async()=>{
 let calls=0;const row=campaign(9500),reader={readCampaign:async()=>row,readAccount:async()=>({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1})};
 const writer=createMetaBudgetTransport({reader,accountId:'9',accessToken:'fixture',apiVersion:'v25.0',allowedCampaignIds:[],accountBudgetsAuthorized:true,mode:'LIVE',writesEnabled:true,fetchImpl:async()=>{calls++;return new Response('{"success":true}');}});
 for(const cents of [10001,11000,-1,Infinity,NaN,10000.5]){await assert.rejects(writer.setDailyBudget('11',cents,{expectedBefore:9500}),e=>e.notSent===true);await assert.rejects(writer.validateDailyBudget('11',cents,{expectedBefore:9500}));}assert.equal(calls,0);
 await writer.setDailyBudget('11',10000,{expectedBefore:9500});assert.equal(calls,1);
});
test('provider quota code/subcode and phase are preserved without raw secret text',()=>{
 const e=Object.assign(Error('token=private'),{code:'META_RATE_LIMITED',status:400,providerCode:17,providerSubcode:2446079,phase:'VALIDATE',notSent:true});
 const d=budgetDiagnostic(e,{stage:'EXECUTION'});assert.equal(d.providerSubcode,2446079);assert.equal(d.verification,'NOT_SENT');assert.doesNotMatch(JSON.stringify(d),/private/);assert.equal(adsCommandErrorCode(e),'META_RATE_LIMITED');
});
test('V6 bot queries are ledger-backed and never turn monitoring into a budget instruction',()=>{
 for(const [q,kind]of[['Campañas cerca de 100','near'],['Cuántos cambios verificados hoy','count'],['Cómo va el recorte nocturno','night'],['Campañas con ROAS superior a 3,8','roas']])assert.equal(parseAutopilotQuery(q).kind,kind);
 assert.equal(parseAutopilotQuery('Sube 10 € a NIDA'),null);
 const s=formatAutopilot({version:V6_VERSION,mode:'LIVE',enabled:true,policy:V6_POLICY,date:day,observedAt:new Date(at('10:00')).toISOString(),nextReviewAt:new Date(at('12:00')).toISOString(),campaigns:[],timeline:[],slots:[],alerts:[]},{kind:'count'});assert.match(s,/0 cambios propios VERIFIED/);assert.match(s,/100/);assert.doesNotMatch(s,/máximo 70/);
});
