import test from'node:test';import assert from'node:assert/strict';
import{preSaveRecoveryProof,recoverPreSaveClaim}from'./pre-save-claim-recovery.mjs';
const now=Date.parse('2026-10-26T15:00:00Z');
function fixture(){
 const plan={kind:'SOLUTION',orderId:'900001',issueId:'800001',date:'2026-10-27',time_window:'morning'};
 const row={template_key:'fixture-key',store_id:'suleia',provider:'dropea',order_id:'900001',template_name:'incident_resolution_v1:800001',status:'applied_unverified',sent_at:null,attempted_at:'2026-10-26T08:36:00Z',
  raw:{owner:'vps_retry_evidence',status:'applied_unverified',reason:'EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT',orderId:'900001',issueId:'800001',date:plan.date,time_window:plan.time_window}};
 const event={at:'2026-10-26T08:37:00Z',orderId:'900001',issueId:'800001',status:'FAILED_PRE_SAVE',reason:'PREPARATION_FAILED_CLAIM_RETAINED'};
 const cycle={startedAt:'2026-10-26T08:35:00Z',completedAt:'2026-10-26T08:38:00Z',results:[{...event,saveAttempted:false}]};
 const evidence={events:[event],cycles:[cycle],journalPresent:false,now};return{plan,row,event,cycle,evidence};
}
test('two durable positive records establish that the existing retry reservation never reached Save',()=>{
 const f=fixture(),p=preSaveRecoveryProof(f.plan,f.row,f.evidence);assert.equal(p.saveAttempted,false);assert.equal(p.previousAttemptAt,f.row.attempted_at);
});
test('unknown writes, other owners, missing/incomplete records and live journals can never recycle a reservation',()=>{
 const mutations=[f=>f.row.status='unknown',f=>f.row.raw.owner='other',f=>f.row.sent_at='2026-10-26T08:36:00Z',f=>f.row.order_id='900002',
  f=>f.row.provider='other',f=>f.row.raw.issueId='800002',f=>f.row.template_name='accepted_discount_support_v1',
  f=>f.row.raw.date='2026-10-28',f=>f.plan.time_window='afternoon',f=>f.evidence.journalPresent=true,
  f=>f.evidence.events=[],f=>f.evidence.cycles=[],f=>f.event.status='RECONCILE',f=>f.event.saveAttempted=true,
  f=>f.cycle.results[0].saveAttempted=true,f=>delete f.cycle.completedAt,f=>f.event.at='invalid',f=>f.row.attempted_at='invalid',
  f=>f.evidence.events.push({...f.event,status:'ATTEMPTING'}),f=>f.evidence.events.push({...f.event}),
  f=>f.evidence.cycles.push({...f.cycle})];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(preSaveRecoveryProof(f.plan,f.row,f.evidence),null);}
});
test('conditional update retains the same key and fences the original owner/status/timestamp',async()=>{
 const f=fixture();let seen;
 const r=await recoverPreSaveClaim(f.plan,f.row,{now,readEvidence:async()=>f.evidence,compareAndSet:async(values,query)=>{seen={values,query};return[{...values,template_key:f.row.template_key}];}});
 assert.equal(r.acquired,true);assert.equal(r.recovered,true);assert.equal(seen.query.template_key,'eq.fixture-key');assert.equal(seen.query.attempted_at,'eq.'+f.row.attempted_at);
 assert.equal(seen.query['raw->>owner'],'eq.vps_retry_evidence');assert.equal(seen.query.status,'eq.applied_unverified');assert.equal(seen.values.raw.preSaveRecovery.saveAttempted,false);
});
test('two contenders can advance the original reservation only once',async()=>{
 const f=fixture();let state='applied_unverified',writes=0;
 const deps={now,readEvidence:async()=>f.evidence,compareAndSet:async values=>{if(state!=='applied_unverified')return[];state=values.status;writes++;return[{...values,template_key:f.row.template_key}];}};
 const results=await Promise.all([recoverPreSaveClaim(f.plan,f.row,deps),recoverPreSaveClaim(f.plan,f.row,deps)]);
 assert.equal(results.filter(r=>r.acquired).length,1);assert.equal(writes,1);
});
test('unavailable proof, failed persistence or an uncertain update cannot admit a provider action',async()=>{
 const f=fixture();let writes=0;
 const noProof=await recoverPreSaveClaim(f.plan,f.row,{now,readEvidence:async()=>{throw Error('private');},compareAndSet:async()=>writes++});assert.equal(noProof.acquired,false);assert.equal(writes,0);
 for(const compareAndSet of [async()=>[],async()=>null,async()=>{throw Error('timeout');}])assert.equal((await recoverPreSaveClaim(f.plan,f.row,{now,readEvidence:async()=>f.evidence,compareAndSet})).acquired,false);
});
