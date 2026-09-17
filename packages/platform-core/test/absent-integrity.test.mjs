import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyAbsenceAttempt,classifyAbsentCause,ABSENT_POLICY_HASH,ABSENT_POLICY_DOCUMENT} from '../src/incident/absent-evidence.mjs';
import {simulateRecipientAbsent,interpretAbsentResponse} from '../src/incident/recipient-absent-policy.mjs';
import {absentHash,ABSENT_BUTTONS} from '../src/incident/absent-template.mjs';
import {maskPii} from '../../suleia-operations-mcp/src/security/pii.mjs';
const now='2026-09-17T15:00:00Z';
const fixture=()=>({issue:{canonical_issue_id:'fixture-issue',canonical_order_id:'fixture-order',market:'ES',type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',carrier:'GLS',initial_carrier_code:'-30',initial_carrier_substatus_code:'15',initial_carrier_description_sanitized:'AUSENTE SEGUNDA VEZ',mapping_status:'MAPPED',created_at:'2026-09-17T12:00:00Z',updated_at:'2026-09-17T12:30:00Z',observed_at:now,status:'PENDING',is_active:true,capability_status:'DECLARED',allowed_resolution_options:['PROVIDE_SOLUTION','RETURN_REQUESTED','PICKUP_AT_AGENCY']},order:{canonical_order_id:'fixture-order',canonical_state:'INCIDENCE',identity_status:'EXACT'},chatby:{verified:true,observed_at:now,template_status:'APPROVED'},policy:{policy_id:'00000000-0000-4000-8000-000000000001',policy_snapshot_hash:ABSENT_POLICY_HASH,status:'SHADOW',registry_required:true}});
const simulate=x=>simulateRecipientAbsent(x,{now});
const message=(text,at='2026-09-17T13:00:00Z')=>({canonical_issue_id:'fixture-issue',canonical_order_id:'fixture-order',direction:'INBOUND',relevance_status:'CURRENT_ORDER_EXACT_MATCH',created_at:at,raw_text:text,chatby_message_id:absentHash([text,at])});
test('a timer without a verified start or exact 48h never implies waiting',()=>{
 for(const timer of [{timer_id:'t',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',due_at:'2026-09-19T12:00:00Z',status:'ACTIVE'},
 {timer_id:'t',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',started_at:'2026-09-17T12:00:00Z',due_at:'2026-09-18T12:00:00Z',status:'ACTIVE'}]){
 const x=fixture();x.previousTimer=timer;assert.equal(simulate(x).shadow.waiting_customer,false);assert.notEqual(simulate(x).shadow.reason_code,'WAIT_EXISTING_CUSTOMER_TIMER');}
});
for(const caseLabel of ['A','B']) test(`sanitized real case ${caseLabel}: corroborated second absence, no null-timer wait`,()=>{
  const x=fixture(),s=simulate(x).shadow;assert.equal(s.absence_attempt,'SECOND_ABSENCE');assert.equal(s.logistics_preference,'AGENCY_PICKUP_PREFERRED');assert.notEqual(s.reason_code,'WAIT_EXISTING_CUSTOMER_TIMER');assert.equal(s.waiting_customer,false);
});
test('sanitized real case C: GPS-not-located never prepares normal absence message',()=>{
  const x=fixture();x.issue.initial_carrier_substatus_code='9';x.issue.initial_carrier_description_sanitized='AUSENTE no me aparece la direccion en el gps';
  const s=simulate(x).shadow;assert.equal(s.interpreted_type,'ADDRESS_NOT_LOCATED');assert.equal(s.routing_policy,'ADDRESS_RESOLUTION');assert.equal(s.next_action,'HUMAN_REVIEW_REQUIRED');
});
test('carrier substatus mapping is conditional, not text-only or universal',()=>{
  for(const change of [x=>x.issue.carrier='OTHER',x=>x.issue.market='PT',x=>x.issue.initial_carrier_code='OTHER',x=>x.issue.initial_carrier_substatus_code='9',x=>x.issue.initial_carrier_description_sanitized='AUSENTE']) {
    const x=fixture();change(x);assert.equal(classifyAbsenceAttempt(x).status,'ABSENCE_ATTEMPT_UNKNOWN');
  }
  const x=fixture();x.issue.delivery_attempt_number='1';assert.equal(classifyAbsenceAttempt(x).status,'FIRST_ABSENCE');
});
test('same-order distinct primary incidents classify second, duplicate polls never do',()=>{
  const x=fixture();x.issue.initial_carrier_substatus_code='UNKNOWN';const a={event_id:'a',canonical_order_id:'fixture-order',event_at:'2026-09-16T12:00:00Z',verified:true,normalized_type:'RECIPIENT_ABSENT'};
  assert.equal(classifyAbsenceAttempt({...x,timeline:[a,a]}).status,'ABSENCE_ATTEMPT_UNKNOWN');
  assert.equal(classifyAbsenceAttempt({...x,timeline:[a,{...a,event_id:'b',event_at:x.issue.created_at}]}).status,'SECOND_ABSENCE');
});
test('contact and waiting do not require agency point, retention or direct GLS capabilities',()=>{
  const x=fixture();x.issue.delivery_attempt_number='1';let s=simulate(x).shadow;assert.equal(s.next_action,'WOULD_SEND_ABSENT_TEMPLATE');assert.equal(s.current_step,'CUSTOMER_CONTACT_REQUIRED');
  x.previousTimer={timer_id:'fixture-timer',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',started_at:'2026-09-17T12:00:00Z',due_at:'2026-09-19T12:00:00Z',status:'ACTIVE'};
  s=simulate(x).shadow;assert.equal(s.next_action,'HOLD_WAITING_CUSTOMER');assert.equal(s.current_step,'WAITING_CUSTOMER_RESPONSE');assert.equal(s.waiting_customer,true);assert.equal(s.trace.at(-1),s.current_step);
});
test('missing timer after known contact is explicit and does not invent a productive timer',()=>{
  const x=fixture();x.issue.delivery_attempt_number='1';x.chatby.verified=false;x.chatby.template_contact_verified=true;
  const s=simulate(x).shadow;assert.notEqual(s.reason_code,'WAIT_EXISTING_CUSTOMER_TIMER');assert.equal(s.waiting_customer,false);assert.equal(s.existing_timer,null);
});

test('blocked or inactive cases cannot retain a waiting step/reason from a valid historical timer',()=>{
  for(const change of [x=>x.issue.is_active=false,x=>x.order.identity_status='AMBIGUOUS',x=>x.chatby.verified=false]){
    const x=fixture();x.previousTimer={timer_id:'fixture-timer',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',started_at:'2026-09-17T12:00:00Z',due_at:'2026-09-19T12:00:00Z',status:'ACTIVE'};change(x);
    const s=simulate(x).shadow;assert.equal(s.waiting_customer,false);assert.equal(s.current_step,'HUMAN_REVIEW_REQUIRED');assert.equal(s.trace.at(-1),'HUMAN_REVIEW_REQUIRED');assert.notEqual(s.reason_code,'WAIT_EXISTING_CUSTOMER_TIMER');assert.deepEqual(s.existing_timer,x.previousTimer);
  }
});
test('shadow timer owner creates only stable 48h timer from observed notification',()=>{
  const x=fixture();x.issue.delivery_attempt_number='1';x.chatby.template_contact_verified=true;x.chatby.incident_notified_at='2026-09-17T12:05:00Z';const d=simulate(x).decision;
  assert.equal(new Date(d.timer.due_at)-new Date(d.timer.started_at),48*3600000);assert.equal(d.timer.policy_version,'RECIPIENT_ABSENT_POLICY_V1');
  x.previousTimer=d.timer;assert.equal(simulate(x).decision.timer,null);assert.equal(simulate(x).decision.decision_id,d.decision_id);
});
test('issue-created simulation anchor never counts old order confirmation as response',()=>{
  const x=fixture();x.events=[message('mañana por la tarde','2026-09-16T13:00:00Z'),{...message('Confirmar mi pedido'),incident_relevance:'ORDER_LIFECYCLE_ONLY'},message('mañana por la tarde')];
  const r=simulate(x);assert.equal(r.shadow.customer_intent,'RESCHEDULE_DELIVERY');assert.equal(r.interpretation.messages_ignored,2);assert.equal(r.shadow.response_anchor_kind,'SHADOW_ISSUE_CREATED_ONLY');
  x.chatby.incident_notified_at='2026-09-17T14:00:00Z';assert.equal(simulate(x).shadow.customer_intent,'NO_RESPONSE');
});
test('latest ambiguous/corrected response supersedes earlier recognized request',()=>{
  const x=fixture();x.events=[message('mañana por la tarde'),message('no estoy seguro','2026-09-17T14:00:00Z')];assert.equal(simulate(x).shadow.customer_intent,'UNCLEAR');assert.equal(simulate(x).shadow.next_action,'HUMAN_REVIEW_REQUIRED');
});
test('Dropea declaration is never carrier verification and PROVIDE_SOLUTION is not slot acceptance',()=>{
  const x=fixture();x.events=[message('mañana por la tarde')];const s=simulate(x).shadow;
  assert.equal(s.conditional_proposal,'WOULD_VALIDATE_LOGISTICS');assert.equal(s.logistics_capabilities.dropea_resolution_capability,'DECLARED');assert.equal(s.logistics_capabilities.carrier_capability,'UNKNOWN');assert.ok(s.blocking_reasons.includes('GLS_DIRECT_READ_UNAVAILABLE'));assert.notEqual(s.next_action,'WOULD_REQUEST_NEW_DELIVERY');
});
test('required stale sources block; CONTACT ignores unknown GLS and never relaxes thresholds',()=>{
  for(const change of [x=>x.issue.observed_at='2026-09-17T14:49:59Z',x=>x.chatby.observed_at='2026-09-17T14:54:59Z']) {const x=fixture();x.issue.delivery_attempt_number='1';change(x);assert.equal(simulate(x).shadow.next_action,'HUMAN_REVIEW_REQUIRED');}
});
test('new policy snapshots contain real registry id/checksum and stable logical input hashes',()=>{
  const x=fixture(),a=simulate(x);assert.equal(a.shadow.policy_snapshot_hash,ABSENT_POLICY_HASH);assert.equal(a.shadow.snapshot_status,'PERSISTED');assert.ok(a.shadow.policy_id);assert.ok(a.shadow.input_snapshot_hash);
  x.chatby.observed_at='2026-09-17T14:59:59Z';assert.equal(simulate(x).decision.decision_id,a.decision.decision_id);
  x.events=[message('devuélvelo')];assert.notEqual(simulate(x).decision.decision_id,a.decision.decision_id);
  x.policy.policy_id=null;assert.ok(simulate(x).shadow.blocking_reasons.includes('POLICY_NOT_PERSISTED'));
});
test('policy registry migration exactly matches canonical document and checksum',()=>{
  const sql=readFileSync(new URL('../../../migrations/037_recipient_absent_shadow_integrity.sql',import.meta.url),'utf8');const document=JSON.parse(sql.match(/'({"version".*?})'::jsonb/s)[1]);assert.deepEqual(document,ABSENT_POLICY_DOCUMENT);assert.equal(absentHash(document),ABSENT_POLICY_HASH);assert.ok(sql.includes(ABSENT_POLICY_HASH));
});
test('security masking preserves only technical template names and nested false flags',()=>{
  const x=maskPii({template_name:'dropea_ausente_v1',customer_name:'Synthetic customer',live_flags:{AUSENTE_AUTOMATION_LIVE:false},input_snapshot:{issue_id:'fixture'},template_phone:'+34612345678'});
  assert.equal(x.template_name,'dropea_ausente_v1');assert.equal(x.customer_name,'Cliente enmascarado');assert.deepEqual(x.live_flags,{AUSENTE_AUTOMATION_LIVE:false});assert.doesNotMatch(JSON.stringify(x),/612345678/);
});
test('buttons exact payloads and requested free text preserve governed interpretation',()=>{
  for(const b of ABSENT_BUTTONS) assert.notEqual(interpretAbsentResponse({...message(''),button_payload:b.payload}).customer_intent,'UNCLEAR');
  assert.equal(interpretAbsentResponse(message('lo recojo en agencia')).customer_intent,'PICKUP_AT_AGENCY');
  assert.equal(interpretAbsentResponse(message('viernes a partir de las 16')).time_from,'16:00');
});
test('delivered order blocks proposals without closing incidence or cancelling the original timer',()=>{
  const x=fixture();x.order.canonical_state='DELIVERED';x.previousTimer={timer_id:'fixture-timer',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',started_at:'2026-09-17T12:00:00Z',due_at:'2026-09-19T12:00:00Z',status:'ACTIVE'};
  const r=simulate(x);assert.ok(r.shadow.blocking_reasons.includes('STATE_CHANGED_ACTION_BLOCKED'));assert.deepEqual(r.shadow.existing_timer,x.previousTimer);assert.equal(r.decision.timer,null);assert.equal(x.issue.status,'PENDING');
});
test('every shadow route has zero external side effects, including after approved status',()=>{
  for(const text of ['', 'mañana por la tarde','lo recojo en agencia','devuélvelo','cambia la dirección']) {const x=fixture();x.events=text?[message(text)]:[];const r=simulate(x);for(const k of ['actions_executed','production_writes','messages_sent','dropea_write_requests','chatby_write_requests','gls_write_requests','issues_resolved'])assert.equal(r.decision[k],0);assert.equal(r.shadow.executed,false);assert.equal(r.shadow.external_action,false);assert.equal(r.shadow.production_write,false);assert.ok(Object.values(r.shadow.live_flags).every(v=>v===false));}
});
