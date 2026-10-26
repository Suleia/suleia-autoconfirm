import test from 'node:test';import assert from 'node:assert/strict';
import {repeatedAbsenceNoticeEvidence} from './second-absence-notice.mjs';
import {absentContactInput,deliverAbsentTemplate} from './recipient-absent-template-delivery.mjs';
import {nativeAbsentEligibility} from './recipient-absent-native-gate.mjs';
import {verifyNativeAbsentNotice} from './recipient-absent-native-verification.mjs';
import {ABSENT_TEMPLATE_BODY,ABSENT_TEMPLATE_BUTTONS} from '../packages/platform-core/src/incident/absent-template.mjs';
const now=new Date('2026-10-26T16:00:00Z');
export function repeatedFresh(count=2){
 const notices=Array.from({length:count},(_,i)=>({claim_id:'claim-'+i,canonical_issue_id:'old-'+i,canonical_order_id:'order',conversation_id:'conversation',status:'VERIFIED',
  notification_at:`2026-10-${20+i}T10:00:00Z`,message_id:'message-'+i,outcome:{provider_message_id:'wamid.'+i,
   ...(i?{notice_stage:i===1?'SECOND_ABSENCE':'REPEATED_ABSENCE',notice_sequence:i+1,previous_claim_id:'claim-'+(i-1)}:{})}}));
 return {issue:{canonical_issue_id:'new',canonical_order_id:'order',dropea_order_id:'123',type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',delivery_attempt_number:2,
  created_at:'2026-10-26T12:00:00Z',observed_at:now.toISOString(),status:'PENDING',is_active:true},
  order:{canonical_order_id:'order',identity_status:'EXACT',canonical_state:'INCIDENCE',observed_at:now.toISOString()},
  chatby:{conversation_id:'conversation',verified:true,history_complete:true,notification_count:0,order_notification_count:count,unverifiable_customer_activity:false,
   order_recovery_offer_count:0,customer_activity_after_issue:false,observed_at:now.toISOString(),
   order_absent_notices:notices.map(n=>({message_id:n.message_id,provider_message_id:n.outcome.provider_message_id,at:n.notification_at,template_name:'dropea_ausente_v3'}))},
  notification_history:notices,decision_currentness:'CURRENT',return_in_progress:false};
}
const control=()=>({status:'LIVE',automation_live:true,native_send_enabled:true,template_sends_enabled:true,recipient_absent_template_cutover_at:'2026-09-24T00:00:00Z',
 evidence:{evidence_id:'synthetic',mapping_snapshot_verified:true,rollback_verified:true,render_blocker_verified:true,approved_v3_verified:true,native_route_verified:true,
 notification_canary_verified:true,notification_owner:'CONTROLLER_TEMPLATE_API',notification_recovery_authorized:true,repeated_absence_notice_authorized:true}});

test('a later distinct verified absence advances one coherent receipt chain, including the next later failure',()=>{
 for(const count of [2,3,4]){const f=repeatedFresh(count),proof=repeatedAbsenceNoticeEvidence(f);assert.equal(proof.previous_claim_id,'claim-'+(count-1));
  assert.equal(proof.notice_sequence,count+1);const input=absentContactInput(f);assert.equal(input.notice_stage,'REPEATED_ABSENCE');assert.equal(nativeAbsentEligibility(input,control(),now),null);}
 const f=repeatedFresh();f.notification_history.push({canonical_issue_id:'new',status:'CLAIMED'});assert.ok(repeatedAbsenceNoticeEvidence(f),'own newly reserved row does not replace the verified predecessor');
});

test('unverified, disconnected, duplicate, mismatched or non-later evidence cannot authorize a follow-up',()=>{
 const mutations=[f=>f.issue.delivery_attempt_number=1,f=>f.issue.delivery_attempt_number=3,f=>f.issue.created_at='invalid',
  f=>f.issue.created_at='2026-10-21T10:00:00Z',f=>f.chatby.order_notification_count=3,f=>f.chatby.notification_count=1,
  f=>f.chatby.unverifiable_customer_activity=true,f=>f.chatby.order_recovery_offer_count=1,
  f=>f.notification_history[1].status='CLAIMED',f=>f.notification_history[1].outcome.previous_claim_id='wrong',
  f=>f.notification_history[1].conversation_id='wrong',f=>f.notification_history[1].canonical_order_id='wrong',
  f=>f.notification_history[1].canonical_issue_id=f.notification_history[0].canonical_issue_id,
  f=>f.notification_history[1].outcome.provider_message_id=f.notification_history[0].outcome.provider_message_id,
  f=>f.chatby.order_absent_notices[1].at='2026-10-22T11:00:00Z',f=>f.chatby.order_absent_notices[1].provider_message_id='wamid.wrong',
  f=>f.chatby.order_absent_notices.push({...f.chatby.order_absent_notices[0]}),f=>f.notification_history[1].outcome.notice_stage='INITIAL'];
 for(const change of mutations){const f=repeatedFresh();change(f);assert.equal(repeatedAbsenceNoticeEvidence(f),null,change.toString());}
 const f=repeatedFresh(3);f.notification_history[2].outcome.notice_sequence=7;assert.equal(repeatedAbsenceNoticeEvidence(f),null);
});

test('earlier cancellations or address/pickup requests survive a later courtesy; old slots permit a new failed-attempt notice',()=>{
 for(const [raw_text,allowed]of [['Mañana por la tarde',true],['No quiero el pedido',false],['Quiero recoger en la agencia',false],['Quiero cambiar la direccion',false]]){
  const f=repeatedFresh();f.events=[{canonical_order_id:'order',direction:'INBOUND',created_at:'2026-10-20T11:00:00Z',raw_text},
   {canonical_order_id:'order',direction:'INBOUND',created_at:'2026-10-22T11:00:00Z',raw_text:'Gracias'}];assert.equal(Boolean(repeatedAbsenceNoticeEvidence(f)),allowed,raw_text);
 }
});

test('new explicit repeat authority, exact identity and every original stop/freshness/current-reply guard remain mandatory',()=>{
 const base=absentContactInput(repeatedFresh()),c=control();delete c.evidence.repeated_absence_notice_authorized;assert.ok(nativeAbsentEligibility(base,c,now));
 for(const change of [{exact_identity_verified:false},{customer_activity_after_issue:true},{order_in_incidence:false},{return_in_progress:true},
  {history_complete:false},{status:'RESOLVED'},{is_active:false},{decision_currentness:'HISTORICAL'},{contact_cause:'ADDRESS_INCORRECT'},
  {absence_classification:'ABSENCE_ATTEMPT_UNKNOWN'},{absence_classification:'ABSENCE_ATTEMPT_CONFLICT'},
  {notice_sequence:2},{order_notification_count:3},{chatby_read_at:'2026-10-26T15:59:00Z'}])assert.ok(nativeAbsentEligibility({...base,...change},control(),now),JSON.stringify(change));
 for(const key of ['automation_live','native_send_enabled','template_sends_enabled'])assert.ok(nativeAbsentEligibility(base,{...control(),[key]:false},now));
});

test('follow-up final reread blocks intervening replies, delivery or changed proof and an uncertain send is never replayed',async()=>{
 const template={id:1552419,name:'dropea_ausente_v3',status:'APPROVED',language:'es_ES',namespace:'synthetic',components:[{type:'BODY',text:ABSENT_TEMPLATE_BODY},
  {type:'BUTTONS',buttons:ABSENT_TEMPLATE_BUTTONS.map(b=>({type:'QUICK_REPLY',text:b.text}))}]};
 for(const change of [null,f=>f.chatby.customer_activity_after_issue=true,f=>f.order.canonical_state='DELIVERED',f=>f.notification_history[1].status='CLAIMED']){
  let used=false,sends=0,reads=0;const f=repeatedFresh(),outcomes=[];
  const ledger={transaction:async fn=>fn({controlForUpdate:async()=>control(),claim:async()=>{if(used)return false;used=true;return true;}})};
  const args={candidate:{canonical_issue_id:'new',dropea_order_id:'123'},ledger,readTemplate:async()=>template,now:()=>now,
   readFresh:async()=>{if(++reads===2)change?.(f);return f;},send:async()=>{sends++;throw Error('timeout');},persistOutcome:async(_id,status)=>outcomes.push(status)};
  const result=await deliverAbsentTemplate(args);await deliverAbsentTemplate(args);
  assert.equal(sends,change?0:1);assert.equal(result.status,change?'BLOCKED':'RECONCILIATION_REQUIRED');
  assert.deepEqual(outcomes,[change?'BLOCKED_BEFORE_POST':'API_RESULT_UNCERTAIN']);
 }
});

test('every repeated notice requires a definitive WAMID and starts no new response timer',()=>{
 const claim={conversation_id:'conversation',claimed_at:'2026-10-26T12:00:00Z',outcome:{notice_stage:'REPEATED_ABSENCE'}};
 const m={direction:'OUTBOUND',at:'2026-10-26T12:01:00Z',message_id:'fresh',provider_message_id:'wamid.fresh',template_name:'dropea_ausente_v3',template_id:'1552419'};
 const history={complete:true,conversation_id:'conversation',messages:[m]};assert.equal(verifyNativeAbsentNotice(claim,history,now).timer,null);
 assert.equal(verifyNativeAbsentNotice(claim,{...history,messages:[{...m,provider_message_id:null}]},now).verified,false);
 assert.equal(verifyNativeAbsentNotice(claim,{...history,messages:[m,{...m,message_id:'duplicate'}]},now).reason,'DUPLICATE_V3_NOTICE');
});
