import test from 'node:test';
import assert from 'node:assert/strict';
import {executeRecipientAbsentResolution} from './recipient-absent-resolution-executor.mjs';
import {fixture,now} from '../packages/platform-core/test/fixtures/absent-resolution.mjs';
const flags={AUSENTE_AUTOMATION_LIVE:true,AUSENTE_LOGISTICS_WRITES_ENABLED:true};
const control=()=>({status:'LIVE',activation_at:'2026-09-22T08:00:00Z',evidence:{canary_verified:true,template_mapping_verified:true,approved_v3_verified:true,single_sender_verified:true,callback_contract_verified:true,notification_timer_verified:true,evidence_id:'synthetic-gates'}});
function memoryLedger(){let record=null,busy=false;return {get record(){return record;},async withIssueLock(id,fn){if(busy)return {status:'IN_PROGRESS',writes:0};busy=true;try{return await fn({control:async()=>control(),get:async()=>record,claim:async a=>{if(record)return false;record={...a,status:'CLAIMED'};return true;},finish:async(_,outcome)=>{record={...record,...outcome};}});}finally{busy=false;}}};}
function setup(){const ledger=memoryLedger(),sent=[];let reads=0;const input=fixture();const args={issueId:'issue-a',flags,ledger,now:()=>new Date(now),
 readFresh:async()=>{reads++;return structuredClone(input);},readProviderIssue:async()=>({id:123,order_id:321,status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_changed_at:now}),
 writer:{provideSolution:async request=>{sent.push(request);return {confirmed:true,issue_id:'123',order_id:'321',status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_changed_at:now,http_status:200};}}};return {args,ledger,sent,input,get reads(){return reads;}};}
test('one solution, persistent claim, independent provider read and no duplicate on replay',async()=>{const x=setup();assert.equal((await executeRecipientAbsentResolution(x.args)).status,'APPLIED');assert.equal(x.reads,2);assert.equal(x.ledger.record.status,'APPLIED');const again=await executeRecipientAbsentResolution(x.args);assert.equal(again.status,'ALREADY_RESOLVED_WITH_SAME_EVIDENCE');assert.equal(x.sent.length,1);assert.ok(!JSON.stringify(x.ledger.record).includes(x.input.verified_phone.value));});
test('concurrent execution cannot send twice',async()=>{const x=setup();const r=await Promise.all([executeRecipientAbsentResolution(x.args),executeRecipientAbsentResolution(x.args)]);assert.equal(x.sent.length,1);assert.equal(r.filter(v=>v.status==='APPLIED').length,1);});
test('last re-read supersedes AM with PM before sending',async()=>{const x=setup();x.input.events[0].raw_text='Mañana por la mañana';let calls=0;x.args.readFresh=async()=>{const value=structuredClone(x.input);if(++calls===2)value.events.push({...value.events[0],raw_text:'Mejor por la tarde',chatby_message_id:'message-2',created_at:'2026-09-22T11:30:00Z'});return value;};await executeRecipientAbsentResolution(x.args);assert.match(x.sent[0].resolution.resolution_text,/por la tarde/);assert.doesNotMatch(x.sent[0].resolution.resolution_text,/por la mañana/);assert.equal(x.ledger.record.structured.supersedes_response_id,'message-1');});
for(const change of [x=>x.events.push({...x.events[0],raw_text:'no lo quiero',chatby_message_id:'later',created_at:'2026-09-22T11:30:00Z'}),x=>x.issue.status='RESOLVED',x=>x.verified_phone.canonical_order_id='other',x=>x.logistics_capability.verified=false])test('last read blocks changed customer/order/capability before claim',async()=>{const x=setup();let calls=0;x.args.readFresh=async()=>{const value=structuredClone(x.input);if(++calls===2)change(value);return value;};assert.equal((await executeRecipientAbsentResolution(x.args)).status,'HUMAN_REVIEW_REQUIRED');assert.equal(x.sent.length,0);assert.equal(x.ledger.record,null);});
test('timeout/unknown response leaves durable claim, no automatic retry',async()=>{const x=setup();x.args.writer.provideSolution=async()=>{x.sent.push('attempt');throw new Error('synthetic provider timeout');};assert.equal((await executeRecipientAbsentResolution(x.args)).status,'UNVERIFIED');await executeRecipientAbsentResolution(x.args);assert.equal(x.sent.length,1);assert.equal(x.ledger.record.status,'UNVERIFIED');});
test('HTTP success without matching independent verification is not applied',async()=>{const x=setup();x.args.readProviderIssue=async()=>({id:123,order_id:321,status:'PENDING'});assert.equal((await executeRecipientAbsentResolution(x.args)).status,'UNVERIFIED');assert.equal(x.ledger.record.status,'UNVERIFIED');});
test('flags and credential gates precede reads or writes',async()=>{const x=setup();assert.equal((await executeRecipientAbsentResolution({...x.args,flags:{}})).writes,0);assert.equal((await executeRecipientAbsentResolution({...x.args,writer:null})).reason,'WRITE_PERMISSION_NOT_AVAILABLE');assert.equal(x.reads,0);});
test('slow claim persistence expires final freshness, no send',async()=>{const x=setup();let time=now;const original=x.ledger.withIssueLock;x.ledger.withIssueLock=(id,fn)=>original(id,store=>fn({...store,claim:async a=>{const r=await store.claim(a);time='2026-09-22T12:00:16Z';return r;}}));x.args.now=()=>new Date(time);assert.equal((await executeRecipientAbsentResolution(x.args)).writes,0);assert.equal(x.sent.length,0);assert.equal(x.ledger.record.status,'ABORTED');});
test('owner activation gates and new-case restriction are never bypassed',async()=>{
 for(const missing of ['template_mapping_verified','approved_v3_verified','single_sender_verified','callback_contract_verified','notification_timer_verified']){
  const x=setup(),original=x.ledger.withIssueLock;x.ledger.withIssueLock=(id,fn)=>original(id,store=>fn({...store,control:async()=>{const c=control();c.evidence[missing]=false;return c;}}));
  assert.equal((await executeRecipientAbsentResolution(x.args)).reason,'ABSENT_ACTIVATION_GATES_NOT_VERIFIED');assert.equal(x.sent.length,0);
 }
 const x=setup();x.input.issue.created_at='2026-09-21T09:00:00Z';assert.equal((await executeRecipientAbsentResolution(x.args)).reason,'HISTORICAL_CASE_NOT_ELIGIBLE');assert.equal(x.sent.length,0);
});
test('persistent kill switch is rechecked after claim, before POST',async()=>{
 const x=setup(),original=x.ledger.withIssueLock;let count=0;x.ledger.withIssueLock=(id,fn)=>original(id,store=>fn({...store,control:async()=>++count>1?{status:'DISABLED'}:control()}));
 assert.equal((await executeRecipientAbsentResolution(x.args)).writes,0);assert.equal(x.sent.length,0);
});

test('first real canary requires a verified AM/PM callback rather than a matching text',async()=>{
 const x=setup(),original=x.ledger.withIssueLock;x.ledger.withIssueLock=(id,fn)=>original(id,store=>fn({...store,control:async()=>({...control(),status:'CANARY'})}));
 assert.equal((await executeRecipientAbsentResolution(x.args)).reason,'CANARY_VERIFIED_AM_PM_REQUIRED');assert.equal(x.sent.length,0);
 x.input.events[0].message_type='BUTTON';x.input.events[0].button_verified=true;x.input.events[0].button_payload='ABSENT_TOMORROW_PM';
 assert.equal((await executeRecipientAbsentResolution(x.args)).status,'APPLIED');assert.equal(x.sent.length,1);
});
test('uncertain provider outcome trips only the absent resolution circuit',async()=>{
 const x=setup(),original=x.ledger.withIssueLock;let tripped=null;x.ledger.withIssueLock=(id,fn)=>original(id,store=>fn({...store,trip:async reason=>{tripped=reason;},control:async()=>({...control(),circuit_breaker_reason:tripped})}));
 x.args.readProviderIssue=async()=>({status:'PENDING'});assert.equal((await executeRecipientAbsentResolution(x.args)).status,'UNVERIFIED');assert.equal(tripped,'PROVIDER_RESULT_UNVERIFIED');
 assert.equal((await executeRecipientAbsentResolution({...x.args,issueId:'different'})).writes,0);assert.equal(x.sent.length,1);
});
