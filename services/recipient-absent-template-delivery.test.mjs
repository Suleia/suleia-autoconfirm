import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAbsentTemplate,approvedAbsentPayload,absentContactInput} from './recipient-absent-template-delivery.mjs';
import {authorizeNativeAbsent,nativeAbsentEligibility} from './recipient-absent-native-gate.mjs';
import {ABSENT_TEMPLATE_BODY,ABSENT_TEMPLATE_BUTTONS} from '../packages/platform-core/src/incident/absent-template.mjs';
const now=new Date('2026-09-29T16:00:00Z');
const template=()=>({id:1552419,name:'dropea_ausente_v3',status:'APPROVED',language:'es_ES',namespace:'synthetic',
  components:[{type:'BODY',text:ABSENT_TEMPLATE_BODY},{type:'BUTTONS',buttons:ABSENT_TEMPLATE_BUTTONS.map(b=>({type:'QUICK_REPLY',text:b.text}))}]});
const control=()=>({status:'LIVE',automation_live:true,native_send_enabled:true,template_sends_enabled:true,
  recipient_absent_template_cutover_at:'2026-09-24T00:00:00Z',evidence:{evidence_id:'synthetic',mapping_snapshot_verified:true,
  rollback_verified:true,render_blocker_verified:true,approved_v3_verified:true,native_route_verified:true,
  notification_canary_verified:true,notification_owner:'CONTROLLER_TEMPLATE_API',notification_recovery_authorized:true}});
const fresh=()=>({issue:{canonical_issue_id:'i',canonical_order_id:'o',dropea_order_id:'123',type:'RECIPIENT_ABSENT',
  raw_type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,delivery_attempt_number:2,created_at:'2026-09-29T12:00:00Z',observed_at:now.toISOString()},
  order:{canonical_order_id:'o',identity_status:'EXACT',canonical_state:'INCIDENCE',observed_at:now.toISOString()},
  chatby:{verified:true,conversation_id:'synthetic',history_complete:true,notification_count:0,order_notification_count:0,
  customer_activity_after_issue:false,observed_at:now.toISOString()},decision_currentness:'CURRENT',return_in_progress:false});
function fixture(){let claimed=false,sends=0,c=control(),f=fresh(),chain=Promise.resolve(),fail=false;const outcomes=[];
  const ledger={transaction:fn=>{const p=chain.then(()=>fn({controlForUpdate:async()=>c,claim:async()=>{
    if(claimed)return false;claimed=true;return true;},reserveCanary:async()=>{}}));chain=p.catch(()=>{});return p;}};
  const args={candidate:{canonical_issue_id:'i',dropea_order_id:'123'},ledger,readFresh:async()=>f,readTemplate:async()=>template(),
    send:async()=>{sends++;if(fail)throw Error('timeout');},persistOutcome:async(id,status)=>outcomes.push(status),now:()=>now};
  return {args,c,f,outcomes,setFail:()=>{fail=true;},sends:()=>sends};}
test('concurrent attempts and restart replay share a consumed claim; native owner is denied',async()=>{
 const x=fixture();await Promise.all(Array.from({length:20},()=>deliverAbsentTemplate(x.args)));assert.equal(x.sends(),1);
 await deliverAbsentTemplate(x.args);assert.equal(x.sends(),1);
 const result=await authorizeNativeAbsent({ledger:x.args.ledger,readFresh:async()=>absentContactInput(x.f),now:()=>now});
 assert.equal(result.reason,'NOTIFICATION_OWNER_MISMATCH');
});
test('timeout never releases claim or automatically repeats POST',async()=>{
 const x=fixture();x.setFail();assert.equal((await deliverAbsentTemplate(x.args)).status,'RECONCILIATION_REQUIRED');
 await deliverAbsentTemplate(x.args);assert.equal(x.sends(),1);assert.deepEqual(x.outcomes,['API_RESULT_UNCERTAIN']);
});
test('order-level history, recent customer response, final order, stale reads and identity block contact',()=>{
 const base=absentContactInput(fresh());
 for(const change of [{order_notification_count:1},{order_notification_count:undefined},{customer_activity_after_issue:true},
 {customer_activity_after_issue:undefined},{order_in_incidence:false},{history_complete:false},{previous_notification_count:1},
 {exact_identity_verified:false},{return_in_progress:true},{status:'RESOLVED'},{decision_currentness:'HISTORICAL'},
 {chatby_read_at:'2026-09-29T15:59:00Z'},{contact_cause:'ADDRESS_INCORRECT'},{absence_classification:'ABSENCE_ATTEMPT_CONFLICT'}])
 assert.ok(nativeAbsentEligibility({...base,...change},control(),now),JSON.stringify(change));
});
test('unknown attempt may contact only under explicit notification-only owner authority',()=>{
 const i={...absentContactInput(fresh()),absence_classification:'ABSENCE_ATTEMPT_UNKNOWN'};
 assert.equal(nativeAbsentEligibility(i,control(),now),null);
 const c=control();c.evidence.notification_recovery_authorized=false;assert.ok(nativeAbsentEligibility(i,c,now));
});
test('canary still excludes another case and each kill switch prevents a POST',async()=>{
 for(const key of ['automation_live','native_send_enabled','template_sends_enabled']){const x=fixture();x.c[key]=false;
 await deliverAbsentTemplate(x.args);assert.equal(x.sends(),0);}
 const x=fixture();x.c.status='CANARY';x.c.canary_issue_id='other';await deliverAbsentTemplate(x.args);assert.equal(x.sends(),0);
});
test('approved exact template, three native reply destinations and current order body are required',()=>{
 const p=approvedAbsentPayload(template(),{conversationId:'synthetic',orderId:'123'});
 assert.equal(p.content.params['BODY_{{2}}'],'ES123');assert.equal(Object.keys(p.content.params).filter(k=>k.startsWith('QUICK_REPLY')).length,3);
 for(const change of [{status:'PENDING'},{id:7},{name:'v2'},{components:[]}])assert.throws(()=>approvedAbsentPayload({...template(),...change},{conversationId:'synthetic',orderId:'123'}));
});
