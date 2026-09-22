import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretAbsentResponse,simulateRecipientAbsent} from '../src/incident/recipient-absent-policy.mjs';
import {classifyAbsenceAttempt,ABSENT_POLICY_HASH} from '../src/incident/absent-evidence.mjs';
import {dashboardProjection,dashboardScope} from '../src/incident/dashboard.mjs';
const now='2026-09-22T12:00:00Z';
const interpret=text=>interpretAbsentResponse({raw_text:text,created_at:now});
for(const [text,window,from,to] of [
 ['mañana por la mañana','MORNING',null,null],['mañana por la tarde','AFTERNOON',null,null],
 ['viernes hasta las 16:00','UNTIL_TIME',null,'16:00'],['viernes antes de las 16:00','UNTIL_TIME',null,'16:00'],
 ['viernes a partir de las 16:00','FROM_TIME','16:00',null],['viernes después de las 16:00','FROM_TIME','16:00',null],
 ['viernes de 10:00 a 14:00','TIME_RANGE','10:00','14:00'],['mañana entre las 10 y las 14','TIME_RANGE','10:00','14:00'],
 ['mañana todo el día','ALL_DAY',null,null],['mañana por la mañana no pero por la tarde sí','AFTERNOON',null,null],
 ['mañana por la mañana no, por la tarde sí','AFTERNOON',null,null],['mañana no puedo por la mañana pero sí después de las 16','FROM_TIME','16:00',null],
 ['solo puedo hasta las 15','UNTIL_TIME',null,'15:00'],['solo puedo después de las 18','FROM_TIME','18:00',null],
 ['entre las 10 y las 14','TIME_RANGE','10:00','14:00']
])test(text,()=>{const r=interpret(text);assert.equal(r.requested_time_window,window);assert.equal(r.time_from,from);assert.equal(r.time_to,to);
 if(!/mañana|viernes/.test(text)){assert.equal(r.requested_date,null);assert.equal(r.customer_intent,'UNCLEAR');assert.equal(r.confidence,0);}else assert.equal(r.customer_intent,'RESCHEDULE_DELIVERY');});
for(const text of ['mañana por la mañana no','mañana no puedo','por la tarde imposible','antes de las 5 no','de 9 a 13 y después de las 18','viernes a las 16:00','viernes hasta las 25:00','viernes de 14:00 a 10:00','viernes todo el día por la tarde'])
 test(`conservative: ${text}`,()=>{const r=interpret(text);assert.notEqual(r.customer_intent,'RESCHEDULE_DELIVERY');assert.equal(r.confidence,0);});

const input=()=>({issue:{canonical_issue_id:'i',canonical_order_id:'o',type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',carrier:'GLS',market:'ES',mapping_status:'MAPPED',status:'PENDING',is_active:true,delivery_attempt_number:'1',created_at:'2026-09-22T09:00:00Z',updated_at:'2026-09-22T09:00:00Z',observed_at:now},order:{canonical_order_id:'o',identity_status:'EXACT',canonical_state:'IN_TRANSIT'},chatby:{verified:true,observed_at:now,template_status:'APPROVED',template_contact_verified:true,incident_notified_at:'2026-09-22T10:00:00Z',chatby_conversation_id_hash:'c',chatby_contact_id_hash:'u'},policy:{policy_id:'p',policy_snapshot_hash:ABSENT_POLICY_HASH,status:'SHADOW',registry_required:true},events:[]});
const event=(payload,index=0)=>({canonical_issue_id:'i',canonical_order_id:'o',direction:'INBOUND',relevance_status:'CURRENT_ORDER_EXACT_MATCH',chatby_conversation_id_hash:'c',chatby_contact_id_hash:'u',chatby_message_id:`m${index}`,created_at:`2026-09-22T11:${index?'30':'00'}:00Z`,button_payload:payload});
for(const [button,window,opposite] of [['ABSENT_TOMORROW_AM','MORNING','AFTERNOON'],['ABSENT_TOMORROW_PM','AFTERNOON','MORNING']])test(`AM/PM complete shadow path ${button}`,()=>{
 const x=input();x.events=[event(button)];const r=simulateRecipientAbsent(x,{now});const again=simulateRecipientAbsent({...x,events:[...x.events,...x.events]},{now});
 assert.equal(r.shadow.customer_intent,'RESCHEDULE_DELIVERY');assert.equal(r.shadow.requested_date,'2026-09-23');assert.equal(r.shadow.requested_time_window,window);assert.notEqual(r.shadow.requested_time_window,opposite);
 assert.equal(r.decision.decision_id,again.decision.decision_id);assert.equal(r.shadow.policy_snapshot_hash,ABSENT_POLICY_HASH);assert.equal(r.shadow.logistics_feasibility,'UNKNOWN');assert.equal(r.shadow.executed,false);assert.equal(r.decision.execution_available,false);assert.equal(r.decision.proposed_resolution,null);
});
test('later same-case alternative supersedes unexecuted AM without guessing another date',()=>{
 const x=input();x.events=[event('ABSENT_TOMORROW_AM')];const a=simulateRecipientAbsent(x,{now});
 x.events.push({...event(null,1),raw_text:'mejor por la tarde'});const b=simulateRecipientAbsent(x,{now});
 assert.equal(b.shadow.requested_date,a.shadow.requested_date);assert.equal(b.shadow.requested_time_window,'AFTERNOON');assert.notEqual(a.decision.decision_id,b.decision.decision_id);
 x.events[1].chatby_conversation_id_hash='other';assert.notEqual(simulateRecipientAbsent(x,{now}).shadow.customer_intent,'RESCHEDULE_DELIVERY');
});
test('conflicting upper/lower limits at the same timestamp are human review',()=>{
 const x=input();x.events=[{...event(null),raw_text:'viernes hasta las 16:00'},{...event(null),chatby_message_id:'m2',raw_text:'viernes hasta las 18:00'}];
 assert.ok(simulateRecipientAbsent(x,{now}).shadow.blocking_reasons.includes('CONFLICTING_SIMULTANEOUS_RESPONSES'));
});
test('policy/panel queue agree on corroborated second even with provider first hint',()=>{
 const x=input();delete x.issue.delivery_attempt_number;Object.assign(x.issue,{initial_carrier_code:'-30',initial_carrier_substatus_code:'15',initial_carrier_description_sanitized:'AUSENTE SEGUNDA VEZ',dashboard_source_context:{is_first_absent:true,absence_count:1}});
 const r=simulateRecipientAbsent(x,{now}),row={...x.issue,interpreted_type:'RECIPIENT_ABSENT',absent_shadow:r.shadow};
 assert.equal(r.shadow.absence_attempt,'SECOND_ABSENCE');assert.equal(dashboardScope(row),'ACTIVE');assert.equal(dashboardProjection(row,{now}).dashboard.attempt,'SECOND_ABSENCE');
 x.issue.delivery_attempt_number='1';assert.equal(classifyAbsenceAttempt(x).status,'ABSENCE_ATTEMPT_CONFLICT');assert.ok(simulateRecipientAbsent(x,{now}).shadow.blocking_reasons.includes('ABSENCE_ATTEMPT_CONFLICT'));
});
test('queue hints alone never become first-attempt evidence',()=>{
 const x=input();delete x.issue.delivery_attempt_number;x.issue.dashboard_source_context={is_first_absent:true,absence_count:1};const s=simulateRecipientAbsent(x,{now}).shadow;
 assert.equal(s.absence_attempt,'ABSENCE_ATTEMPT_UNKNOWN');assert.equal(dashboardScope({...x.issue,absent_shadow:s}),'ACTIVE');
});
for(const [at,date] of [['2026-09-22T21:30:00Z','2026-09-23'],['2026-09-22T22:30:00Z','2026-09-24'],['2026-10-24T23:30:00Z','2026-10-26'],['2026-03-28T23:30:00Z','2026-03-30']])test(`Madrid date ${at}`,()=>{
 assert.equal(interpretAbsentResponse({button_payload:'ABSENT_TOMORROW_AM',created_at:at}).requested_date,date);
});
