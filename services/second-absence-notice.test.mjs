import test from 'node:test';import assert from 'node:assert/strict';
import {secondAbsenceNoticeEvidence} from './second-absence-notice.mjs';
const fixture=()=>({issue:{canonical_issue_id:'second',canonical_order_id:'order',delivery_attempt_number:2,created_at:'2026-10-22T10:00:00Z'},
 chatby:{conversation_id:'conversation',order_notification_count:1,notification_count:0,unverifiable_customer_activity:false,order_recovery_offer_count:0,
  order_absent_notices:[{message_id:'message',provider_message_id:'wamid.first',at:'2026-10-21T10:00:00Z',template_name:'dropea_ausente_v3'}]},
 notification_history:[{claim_id:'prior',canonical_issue_id:'first',canonical_order_id:'order',conversation_id:'conversation',status:'VERIFIED',
  notification_at:'2026-10-21T10:00:00Z',message_id:'message',outcome:{provider_message_id:'wamid.first'},prior_issue:{delivery_attempt_number:1}}]});
test('verified predecessor notice and new primary second-attempt issue establish a separate stage',()=>{
 assert.equal(secondAbsenceNoticeEvidence(fixture()).previous_claim_id,'prior');
 const f=fixture();f.notification_history.push({canonical_issue_id:'second',status:'CLAIMED'});
 assert.equal(secondAbsenceNoticeEvidence(f).previous_claim_id,'prior');
});
test('provider numeric row IDs match their durable text receipt without weakening the WAMID binding',()=>{
 const f=fixture();f.chatby.order_absent_notices[0].message_id=123;f.notification_history[0].message_id='123';
 assert.ok(secondAbsenceNoticeEvidence(f));f.chatby.order_absent_notices[0].provider_message_id='wamid.other';
 assert.equal(secondAbsenceNoticeEvidence(f),null);
});
test('no count, hint, old incident, third attempt, uncertain claim or unrelated receipt authorizes another notice',()=>{
 const changes=[f=>f.issue.delivery_attempt_number=1,f=>f.issue.delivery_attempt_number=3,
 f=>f.chatby.order_notification_count=2,f=>f.chatby.notification_count=1,f=>delete f.chatby.unverifiable_customer_activity,
 f=>f.chatby.unverifiable_customer_activity=true,f=>f.chatby.order_recovery_offer_count=1,f=>f.issue.created_at='2026-10-20T10:00:00Z',
 f=>f.notification_history[0].status='CLAIMED',f=>f.notification_history[0].outcome.notice_stage='SECOND_ABSENCE',
 f=>f.notification_history[0].prior_issue.delivery_attempt_number=2,f=>f.notification_history[0].conversation_id='other',
 f=>f.notification_history[0].canonical_order_id='other',f=>f.notification_history[0].message_id='other',
 f=>f.chatby.order_absent_notices[0].provider_message_id='wamid.wrong',f=>f.chatby.order_absent_notices[0].at='2026-10-21T09:00:00Z',
 f=>f.notification_history.push({...f.notification_history[0],canonical_issue_id:'third'})];
 for(const change of changes){const f=fixture();change(f);assert.equal(secondAbsenceNoticeEvidence(f),null,change.toString());}
});
test('previous scheduling replies do not suppress new failure; cancellation, pickup and address requests retain their owner',()=>{
 for(const [text,allowed] of [['Mañana por la tarde',true],['No quiero el pedido',false],['Quiero recoger en la agencia',false],['Quiero cambiar la direccion',false]]){
  const f=fixture();f.events=[{canonical_order_id:'order',direction:'INBOUND',created_at:'2026-10-21T11:00:00Z',raw_text:text}];
  assert.equal(Boolean(secondAbsenceNoticeEvidence(f)),allowed,text);
  if(!allowed){f.events.push({...f.events[0],created_at:'2026-10-21T12:00:00Z',raw_text:'Gracias'});
   assert.equal(secondAbsenceNoticeEvidence(f),null,'a later courtesy does not revoke an explicit protected request');}
 }
});
