import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeNativeAbsent,nativeAbsentEligibility} from './recipient-absent-native-gate.mjs';
const now=new Date('2026-09-23T12:00:00Z');
const control=()=>({status:'CANARY',automation_live:true,native_send_enabled:true,template_sends_enabled:true,
 recipient_absent_template_cutover_at:'2026-09-23T11:00:00Z',evidence:{evidence_id:'synthetic-only',mapping_snapshot_verified:true,
 rollback_verified:true,render_blocker_verified:true,approved_v3_verified:true,native_route_verified:true}});
const input=()=>({canonical_issue_id:'test-issue',canonical_order_id:'test-order',conversation_id:'test-conversation',
 exact_identity_verified:true,type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,decision_currentness:'CURRENT',return_in_progress:false,
 absence_classification:'FIRST_ABSENCE',issue_created_at:'2026-09-23T11:30:00Z',history_complete:true,previous_notification_count:0,
 issue_read_at:now.toISOString(),order_read_at:now.toISOString(),chatby_read_at:now.toISOString()});
test('native and master kills each deny authorization',()=>{
 for(const key of ['automation_live','native_send_enabled','template_sends_enabled'])assert.equal(nativeAbsentEligibility(input(),{...control(),[key]:false},now),'NATIVE_SEND_DISABLED');
 assert.equal(nativeAbsentEligibility(input(),control(),now),null);
});
test('fresh direct reads, exact identity, post-cutover and no notice are mandatory',()=>{
 for(const change of [{exact_identity_verified:false},{previous_notification_count:1},{history_complete:false},{issue_created_at:'2026-09-23T10:00:00Z'},
 {chatby_read_at:'2026-09-23T11:59:00Z'},{return_in_progress:true},{decision_currentness:'SUPERSEDED'},{absence_classification:'SECOND_ABSENCE'},
 {status:'RESOLVED'},{is_active:false},{type:'REJECTED'}])assert.ok(nativeAbsentEligibility({...input(),...change},control(),now));
});
test('all mapping gates and completed canary for LIVE are required',()=>{
 for(const key of Object.keys(control().evidence))assert.ok(nativeAbsentEligibility(input(),{...control(),evidence:{...control().evidence,[key]:false}},now));
 assert.ok(nativeAbsentEligibility(input(),{...control(),status:'LIVE'},now));
 assert.equal(nativeAbsentEligibility(input(),{...control(),status:'LIVE',evidence:{...control().evidence,notification_canary_verified:true}},now),null);
});
test('retry/restart cannot release a claimed notice and canary reserves one issue',async()=>{
 const claims=new Set(),c=control();let chain=Promise.resolve();
 const ledger={transaction:fn=>{const run=chain.then(()=>fn({controlForUpdate:async()=>c,
  claim:async a=>{if(claims.has(a.canonical_issue_id))return false;claims.add(a.canonical_issue_id);return true;},
  reserveCanary:async id=>{c.canary_issue_id=id;}}));chain=run.catch(()=>{});return run;}};
 const run=(data=input())=>authorizeNativeAbsent({ledger,readFresh:async()=>data,now:()=>now});
 const attempts=await Promise.all(Array.from({length:20},()=>run()));
 assert.equal(attempts.filter(x=>x.allow).length,1);
 assert.equal((await run()).allow,false);
 assert.equal((await run({...input(),canonical_issue_id:'other-issue'})).reason,'CANARY_SLOT_RESERVED');
});

test('explicit second-absence exception applies only to the exact selected canary and retains every other gate',()=>{
 const i={...input(),absence_classification:'SECOND_ABSENCE'},c={...control(),canary_issue_id:i.canonical_issue_id,
   evidence:{...control().evidence,second_absence_canary_authorized:true,second_absence_canary_issue_id:i.canonical_issue_id}};
 assert.equal(nativeAbsentEligibility(i,c,now),null);
 for(const change of [{absence_classification:'ABSENCE_ATTEMPT_UNKNOWN'},{absence_classification:'ABSENCE_ATTEMPT_CONFLICT'},
   {canonical_issue_id:'other'},{previous_notification_count:1},{history_complete:false},{exact_identity_verified:false},
   {status:'RESOLVED'},{return_in_progress:true},{chatby_read_at:'2026-09-23T11:59:00Z'}])assert.ok(nativeAbsentEligibility({...i,...change},c,now));
 assert.ok(nativeAbsentEligibility(i,{...c,status:'LIVE',evidence:{...c.evidence,notification_canary_verified:true}},now));
 assert.ok(nativeAbsentEligibility(i,{...c,canary_issue_id:null},now));
 assert.ok(nativeAbsentEligibility(i,{...c,evidence:{...c.evidence,second_absence_canary_authorized:false}},now));
 assert.equal(nativeAbsentEligibility(i,{...c,automation_live:false},now),'NATIVE_SEND_DISABLED');
});
