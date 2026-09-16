import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRecipientAbsent, interpretAbsentResponse, classifyAbsenceAttempt } from '../src/incident/recipient-absent-policy.mjs';
import { absentTemplatePayload, validateAbsentTemplate, ABSENT_TEMPLATE_BODY, ABSENT_BUTTONS } from '../src/incident/absent-template.mjs';
import { containsDirectPii } from '../../suleia-operations-mcp/src/shadow/masking.mjs';

const now = '2026-09-16T12:00:00Z';
const input = () => ({ issue: { canonical_issue_id: 'i', canonical_order_id: 'o', type: 'RECIPIENT_ABSENT', raw_type: 'RECIPIENT_ABSENT',
  status: 'PENDING', is_active: true, carrier: 'GLS', mapping_status: 'MAPPED', delivery_attempt_number: '1',
  created_at: '2026-09-16T09:00:00Z', updated_at: '2026-09-16T10:00:00Z', observed_at: now,
  carrier_retention_deadline: '2026-09-25T18:00:00Z', capability_status: 'VERIFIED',
  allowed_resolution_options: ['RETRY','RETURN_REQUESTED','CHANGE_ADDRESS','PICKUP_AT_AGENCY'] },
  order: { canonical_order_id: 'o', identity_status: 'EXACT', canonical_state: 'IN_TRANSIT' },
  chatby: { verified: true, observed_at: now }, gls: { observed_at: now, capability_status: 'VERIFIED', calendar_verified:true, package_operable: true,
    pickup_point_verified: true, package_available_for_pickup: true }, events: [] });
const event = raw_text => ({ canonical_issue_id: 'i', canonical_order_id: 'o', direction: 'INBOUND',
  relevance_status: 'CURRENT_ORDER_EXACT_MATCH', created_at: '2026-09-16T11:00:00Z', chatby_message_id: 'm', raw_text });
const simulate = x => simulateRecipientAbsent(x, { now });

test('exact NFC template, placeholders, four quick replies and safe JSON/persisted roundtrip', () => {
  const payload = absentTemplatePayload();
  assert.equal(payload.components[0].text, ABSENT_TEMPLATE_BODY);
  assert.deepEqual(payload.components[0].text.match(/\{\{\d\}\}/g), ['{{1}}','{{2}}']);
  assert.deepEqual(payload.components[1].buttons.map(b=>b.text), ['Mañana por la mañana','Mañana por la tarde','Otra fecha u horario','Recoger en agencia']);
  assert.equal(validateAbsentTemplate(JSON.parse(JSON.stringify(payload))).call_buttons, 0);
  assert.doesNotMatch(JSON.stringify(payload), /PHONE_NUMBER|CALL|Necesito que me llamen|\u200b|\u200c|\u200d|\ufeff|\ufffd|\u00a0/);
  assert.deepEqual(validateAbsentTemplate(payload), validateAbsentTemplate(JSON.parse(JSON.stringify(payload))));
  for (const character of ['\u200b','\ufeff','\u00a0','\ufffd']) {
    const bad = structuredClone(payload); bad.components[0].text += character;
    assert.throws(()=>validateAbsentTemplate(bad));
  }
});
for (const [index,intent,window,action] of [[0,'RESCHEDULE_DELIVERY','MORNING','WOULD_REQUEST_NEW_DELIVERY'],[1,'RESCHEDULE_DELIVERY','AFTERNOON','WOULD_REQUEST_NEW_DELIVERY'],[2,'CUSTOM_TIME_SLOT',null,'WOULD_REQUEST_CUSTOM_SLOT'],[3,'PICKUP_AT_AGENCY',null,'WOULD_REQUEST_PICKUP_AT_AGENCY']]) {
  test(`exact button ${ABSENT_BUTTONS[index].payload}`, () => {
    const x = input(); x.events = [{ ...event(''), button_payload: ABSENT_BUTTONS[index].payload }];
    const result = simulate(x);
    assert.equal(result.shadow.customer_intent,intent); assert.equal(result.shadow.requested_time_window,window);
    assert.equal(result.shadow.simulation_action,action);
    if (index<2) assert.equal(result.shadow.requested_date,'2026-09-17');
    assert.equal(result.shadow.prepared_response_action,'WOULD_SEND_RESPONSE');
  });
  test(`text-only exact approved label ${index}`, () => assert.equal(interpretAbsentResponse(event(ABSENT_BUTTONS[index].text)).customer_intent,intent));
}
for (const [text,date,window,from,intent] of [
  ['viernes a partir de las 16:00','2026-09-18','FROM_TIME','16:00','RESCHEDULE_DELIVERY'],
  ['mañana todo el día','2026-09-17','ALL_DAY',null,'RESCHEDULE_DELIVERY'],
  ['el jueves por la tarde','2026-09-17','AFTERNOON',null,'RESCHEDULE_DELIVERY'],
  ['el viernes por la mañana','2026-09-18','MORNING',null,'RESCHEDULE_DELIVERY'],
  ['devuélvelo',null,null,null,'RETURN_REQUEST'], ['no lo quiero',null,null,null,'RETURN_REQUEST'],
  ['cambia la dirección',null,null,null,'ADDRESS_CHANGE']]) {
  test(`free text: ${text}`, () => {
    const r=interpretAbsentResponse(event(text)); assert.equal(r.customer_intent,intent);
    assert.equal(r.requested_date,date); assert.equal(r.requested_time_window,window); assert.equal(r.time_from,from);
  });
}
test('relative date uses Madrid midnight and message time, not processing time, including DST', () => {
  assert.equal(interpretAbsentResponse({...event('mañana todo el día'),created_at:'2026-09-16T23:30:00Z'}).requested_date,'2026-09-18');
  assert.equal(interpretAbsentResponse({...event('mañana todo el día'),created_at:'2026-10-24T23:30:00Z'}).requested_date,'2026-10-26');
  assert.equal(interpretAbsentResponse({...event('mañana todo el día'),created_at:'2026-09-16 23:30:00'}).customer_intent,'UNCLEAR');
});
test('ambiguous dates, clock, fuzzy button and contradictory response require human review', () => {
  for (const text of ['viernes o jueves por la tarde','viernes a partir de las 3','Mañana tarde creo','devuélvelo pero mañana por la tarde']) {
    const x=input(); x.events=[event(text)]; assert.equal(simulate(x).shadow.simulation_action,'HUMAN_REVIEW_REQUIRED');
  }
});
test('first absence contact; no return as first option', () => assert.equal(simulate(input()).shadow.simulation_action,'WOULD_SEND_ABSENT_TEMPLATE'));
test('negative availability or pickup is never interpreted as a positive delivery request',()=>{
  for(const text of ['mañana por la tarde no estoy','no quiero recoger en agencia','no puedo recibirlo el viernes por la tarde']){
    const x=input();x.events=[event(text)];assert.equal(simulate(x).shadow.simulation_action,'HUMAN_REVIEW_REQUIRED');
  }
});
test('a stored generic intent label cannot override current original text',()=>{
  const x=input();x.events=[{...event('mañana por la tarde'),intent:'RETURN_REQUEST'}];
  assert.equal(simulate(x).shadow.customer_intent,'RESCHEDULE_DELIVERY');
});
test('second absence prefers agency and does not repeat first contact', () => {
  const x=input(); x.issue.delivery_attempt_number='2';
  assert.equal(simulate(x).shadow.logistics_preference,'AGENCY_PICKUP_PREFERRED');
  assert.notEqual(simulate(x).shadow.simulation_action,'WOULD_SEND_ABSENT_TEMPLATE');
});
test('second after verified current-order slot is a logistics recovery, not customer blame', () => {
  const x=input(); x.issue.delivery_attempt_number='2'; x.events=[{...event('mañana por la tarde'),created_at:'2026-09-15T11:00:00Z'}];
  assert.equal(simulate(x).shadow.delivery_failed_after_customer_slot,true);
});
test('ambiguous attempt never becomes second from duplicate or partial events', () => {
  assert.equal(classifyAbsenceAttempt({issue:{},timeline:[]}).status,'ABSENCE_ATTEMPT_UNKNOWN');
  assert.equal(classifyAbsenceAttempt({issue:{},timeline:[{event_id:'a',verified:true,normalized_type:'RECIPIENT_ABSENT',event_at:now}]}).status,'ABSENCE_ATTEMPT_UNKNOWN');
});
test('verified history influences pickup preference without blocking purchase/cancelling', () => {
  const x=input(); x.history={verified:true,previous_absences:2}; const s=simulate(x).shadow;
  assert.equal(s.history_relevant,true); assert.equal(s.logistics_preference,'AGENCY_PICKUP_PREFERRED'); assert.equal(s.executed,false);
});
test('latest cancellation supersedes a slot; stale/current-order mismatches never reused', () => {
  const x=input(); x.events=[event('mañana por la tarde'),{...event('devuélvelo'),created_at:'2026-09-16T11:30:00Z',chatby_message_id:'later'}];
  assert.equal(simulate(x).shadow.simulation_action,'WOULD_RETURN_TO_ORIGIN');
  x.events=[{...event('devuélvelo'),canonical_issue_id:'old'}]; assert.equal(simulate(x).shadow.customer_intent,'NO_RESPONSE');
});
test('inactive/terminal blocks proposals but never closes issue or cancels timer', () => {
  const x=input(); x.order.canonical_state='DELIVERED'; x.previousTimer={timer_id:'t',due_at:'2026-09-18T11:00:00Z',status:'ACTIVE'};
  const result=simulate(x); assert.equal(result.shadow.logistics_feasibility,'NOT_FEASIBLE');
  assert.deepEqual(result.shadow.existing_timer,x.previousTimer); assert.equal(result.decision.issues_resolved,0);
});
test('unknown/stale capability, retention, GLS and Chatby fail closed', () => {
  for (const change of [x=>x.gls.capability_status='UNKNOWN',x=>delete x.issue.carrier_retention_deadline,
    x=>x.gls.observed_at='2026-09-15T12:00:00Z',x=>x.chatby.verified=false,x=>x.issue.mapping_status='UNMAPPED',
    x=>x.issue.allowed_resolution_options=[]]) {
    const x=input(); x.events=[event('mañana por la tarde')]; change(x);
    assert.equal(simulate(x).shadow.simulation_action,'HUMAN_REVIEW_REQUIRED');
  }
});
test('requested date outside verified retention is not feasible', () => {
  const x=input(); x.events=[event('viernes por la tarde')]; x.issue.carrier_retention_deadline='2026-09-17T18:00:00Z';
  assert.equal(simulate(x).shadow.logistics_feasibility,'NOT_FEASIBLE');
});
test('existing 48h timer deadline is immutable; expiry only proposes shadow return', () => {
  const x=input(); x.previousTimer={timer_id:'t',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',due_at:'2026-09-16T10:00:00Z',status:'ACTIVE'};
  const r=simulate(x); assert.equal(r.shadow.simulation_action,'WOULD_RETURN_TO_ORIGIN'); assert.deepEqual(r.shadow.existing_timer,x.previousTimer);
  assert.equal(r.decision.timer,null);
});
test('unchanged evidence/state yields same decision; response changes produce new hash without PII', () => {
  const x=input(); const a=simulate(x); assert.equal(a.decision.decision_id,simulate(x).decision.decision_id);
  x.events=[event('mañana por la tarde')]; const b=simulate(x); assert.notEqual(a.decision.decision_id,b.decision.decision_id);
  assert.equal(containsDirectPii(b.decision),false); assert.doesNotMatch(JSON.stringify(b.shadow.input_snapshot),/mañana por la tarde/);
});
test('all paths have zero operational side effects; approval/env cannot activate new lane', () => {
  process.env.AUSENTE_AUTOMATION_LIVE='true';
  for (const text of ['', 'mañana por la tarde','devuélvelo','recoger en agencia','cambia la dirección']) {
    const x=input(); x.events=text?[event(text)]:[]; const r=simulate(x);
    for (const field of ['actions_executed','production_writes','messages_sent','dropea_write_requests','chatby_write_requests','gls_write_requests','issues_resolved']) assert.equal(r.decision[field],0);
    assert.equal(r.shadow.executed,false); assert.equal(r.shadow.external_action,false); assert.equal(r.shadow.production_write,false);
    assert.equal(r.shadow.live_flags.AUSENTE_AUTOMATION_LIVE,false);
  }
  delete process.env.AUSENTE_AUTOMATION_LIVE;
  const x=input(); x.issue.type='REFUSED_BY_RECIPIENT'; assert.throws(()=>simulate(x),/OUT_OF_SCOPE/);
});
