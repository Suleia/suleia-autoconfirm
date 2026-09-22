import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRecipientAbsent } from '../src/incident/recipient-absent-policy.mjs';
import { ABSENT_BUTTONS, ABSENT_TEMPLATE_NAME, ABSENT_TEMPLATE_BUTTONS, ABSENT_LEGACY_BUTTONS, absentTemplatePayload, absentTemplateSelection, absentButtonFor, validateAbsentTemplate } from '../src/incident/absent-template.mjs';
import { ABSENT_POLICY_HASH } from '../src/incident/absent-evidence.mjs';
import { incidentNotificationBoundary } from '../src/incident/notification-evidence.mjs';
import { incidentInsight } from '../../suleia-operations-mcp/src/operations/incident-insight.mjs';

const now='2026-09-17T14:00:00Z';
const fixture=()=>({issue:{canonical_issue_id:'safe-issue',canonical_order_id:'safe-order',type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,carrier:'GLS',mapping_status:'MAPPED',delivery_attempt_number:'1',created_at:'2026-09-17T10:00:00Z',updated_at:'2026-09-17T10:00:00Z',observed_at:now,allowed_resolution_options:['RETRY','CHANGE_ADDRESS','RETURN_REQUESTED'],carrier_retention_deadline:'2026-09-25T18:00:00Z'},order:{canonical_order_id:'safe-order',canonical_state:'IN_TRANSIT',identity_status:'EXACT'},chatby:{verified:true,observed_at:now,incident_notified_at:'2026-09-17T11:00:00Z',template_status:'APPROVED',template_contact_verified:true,notification_template_name:'dropea_ausente_v3',notification_message_id:'wamid.synthetic',chatby_conversation_id_hash:'safe-chat',chatby_contact_id_hash:'safe-customer'},gls:{observed_at:now,capability_status:'VERIFIED',package_operable:true,calendar_verified:true},policy:{policy_id:'safe-policy',policy_snapshot_hash:ABSENT_POLICY_HASH,status:'SHADOW',registry_required:true},events:[]});
const event=(button,index=0)=>({canonical_issue_id:'safe-issue',canonical_order_id:'safe-order',chatby_conversation_id_hash:'safe-chat',chatby_contact_id_hash:'safe-customer',direction:'INBOUND',message_type:'BUTTON',relevance_status:'CURRENT_ORDER_EXACT_MATCH',incident_relevance:'INCIDENT_RELEVANT',context_template_slug:ABSENT_TEMPLATE_NAME,created_at:`2026-09-17T1${2+index}:00:00Z`,chatby_message_id:`safe-event-${index}`,button_payload:button?.payload,raw_text:button?.text || ''});
const run=x=>simulateRecipientAbsent(x,{now});
const show=(x,result)=>incidentInsight({normalized_type:'RECIPIENT_ABSENT',interpreted_type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,chatby_sync_current:true,dropea_sync_current:true,conversation_status:'FOUND',incident_notified_at:x.chatby.incident_notified_at,latest_private_customer_message_at:result.shadow.scoped_customer_activity_at,latest_customer_message:x.events.at(-1)?.raw_text,latest_customer_message_relation:'AFTER_INCIDENT',latest_customer_incident_relevance:'INCIDENT_RELEVANT',latest_customer_context_template:ABSENT_TEMPLATE_NAME,notification_decision_current:true,snapshot_status:'PERSISTED',policy_id:result.shadow.policy_id,input_snapshot_hash:result.shadow.input_snapshot_hash,absent_shadow:result.shadow});

test('v3 metadata, exact WhatsApp bold/UTF8/emojis, limits and old retirement',()=>{
 const p=absentTemplatePayload();assert.equal(p.name,'dropea_ausente_v3');assert.equal(p.category,'UTILITY');assert.equal(p.language,'es_ES');assert.equal(validateAbsentTemplate(p).character_validation,'PASS');
 for(const emoji of ['👋','📦','💚','✨'])assert.ok(p.components[0].text.includes(emoji));
 for(const b of ABSENT_TEMPLATE_BUTTONS)assert.ok(b.text.length<=25);
 assert.equal(p.components[1].buttons.length,3);assert.ok('🏠 Cambiar datos de entrega'.length>25);
 assert.deepEqual(p.components[1].buttons.map(b=>b.text),['Mañana por la mañana','Mañana por la tarde','Otro día o datos']);assert.equal(validateAbsentTemplate(p).button_emojis_supported,false);
 assert.equal(absentTemplateSelection('dropea_ausente_v1').retired,true);assert.equal(absentTemplateSelection('dropea_ausente_v1').selected,false);assert.equal(absentTemplateSelection().customer_send_enabled,false);
 assert.throws(()=>absentTemplatePayload('dropea_ausente_v1'));
});
test('real provider button labels produce exact plain-text evidence without invented emojis',()=>{
 const x=fixture();x.events=[event(ABSENT_TEMPLATE_BUTTONS[0])];const r=run(x);assert.equal(r.shadow.button_pressed,'ABSENT_TOMORROW_MORNING');assert.equal(show(x,r).customer_evidence.latest_message,'Mañana por la mañana');
});
for(const [index,window] of [[0,'MORNING'],[1,'AFTERNOON']])test(`scenario ${index+1}: slot, exact evidence, concrete solution`,()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[index])];const r=run(x);assert.equal(r.shadow.requested_date,'2026-09-18');assert.equal(r.shadow.requested_time_window,window);assert.equal(r.shadow.next_action,'WOULD_REQUEST_NEW_DELIVERY');
 const panel=show(x,r);assert.equal(panel.customer_evidence.title,'Cliente actuó');assert.equal(panel.customer_evidence.latest_message,ABSENT_BUTTONS[index].text);assert.match(panel.tailored_recommendation.title,/2026-09-18/);
});
test('scenario 3: other day prepares exactly bound date request',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[2])];const r=run(x);assert.equal(r.shadow.recovery_flow_status,'WAITING_DATE');assert.equal(r.shadow.next_action,'WOULD_REQUEST_CUSTOM_SLOT');assert.match(show(x,r).tailored_recommendation.title,/Esperando selección de fecha/);
 assert.deepEqual(r.shadow.prepared_subflow.binding,{order_id:'safe-order',issue_id:'safe-issue',conversation_hash:'safe-chat',customer_hash:'safe-customer',selection_event_hash:'safe-event-0',selected_at:x.events[0].created_at,notification_at:x.chatby.incident_notified_at});
});
test('scenario 4: change data waits, never submits an empty address',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[3])];const r=run(x);assert.equal(r.shadow.recovery_flow_status,'WAITING_DELIVERY_DATA');assert.equal(r.shadow.next_action,'WOULD_REQUEST_ADDRESS_DATA');assert.match(show(x,r).tailored_recommendation.title,/Esperando nuevos datos/);
});
test('scenario 5: silence preserves sole 48h shadow timer',()=>{
 const r=run(fixture());assert.equal(r.shadow.customer_response_status,'NO_RESPONSE');assert.equal(r.shadow.waiting_customer,true);assert.equal(new Date(r.decision.timer.due_at)-new Date(r.decision.timer.started_at),48*3600000);
});

test('48h starts only at observed v3 with message ID, never legacy notice or issue creation',()=>{
 const x=fixture();const timer=run(x).decision.timer;
 assert.equal(new Date(timer.started_at).getTime(),new Date(x.chatby.incident_notified_at).getTime());
 assert.notEqual(timer.started_at,x.issue.created_at);
 for(const change of [c=>delete c.notification_message_id,c=>c.notification_template_name='dropea_incidencia_ausente_v2',c=>delete c.incident_notified_at]){
  const y=fixture();change(y.chatby);assert.equal(run(y).decision.timer,null);
 }
});
test('scenario 6: repeated webhook creates same decision/snapshot and one used event',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[0])];const a=run(x);x.events.push(structuredClone(x.events[0]));const b=run(x);assert.equal(a.decision.decision_id,b.decision.decision_id);assert.equal(b.interpretation.messages_used,1);
});
test('scenario 7: later choice supersedes, with safe history preserved',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[0]),event(ABSENT_BUTTONS[1],1)];const r=run(x);assert.equal(r.shadow.requested_time_window,'AFTERNOON');assert.equal(r.interpretation.intent_changed,true);assert.equal(r.interpretation.previous_intents[0].button,ABSENT_BUTTONS[0].payload);
});
test('scenario 8: initial confirmation cannot be an absence reply, before OR after notice',()=>{
 for(const created_at of ['2026-09-17T09:00:00Z','2026-09-17T12:00:00Z']){const x=fixture();x.events=[{...event(null),created_at,raw_text:'CONFIRMAR MI PEDIDO',context_template_slug:'dropea_pedido_nuevo_v1'}];assert.equal(run(x).interpretation.has_customer_replied,false);x.events[0].context_template_slug=null;assert.equal(run(x).interpretation.has_customer_replied,false);}
});
test('scenario 9: old issue, other order, old/pre-notice/future events excluded',()=>{
 for(const change of [e=>e.created_at='2026-09-17T10:30:00Z',e=>e.created_at='2026-09-17T16:00:00Z',e=>e.canonical_issue_id='older-issue',e=>e.canonical_order_id='another-order']){const x=fixture(),e=event(ABSENT_BUTTONS[0]);change(e);x.events=[e];assert.equal(run(x).interpretation.has_customer_replied,false);}
});
test('scenario 10: new notification is recognized without altering rejection boundary',()=>{
 const e={...event(null),direction:'OUTBOUND',message_type:'TEMPLATE'};assert.equal(incidentNotificationBoundary([e],{issueId:'safe-issue',orderId:'safe-order',issueType:'RECIPIENT_ABSENT',createdAt:'2026-09-17T10:00:00Z',now}),e.created_at);
 assert.equal(incidentNotificationBoundary([e],{issueId:'safe-issue',orderId:'safe-order',issueType:'REFUSED_BY_RECIPIENT',createdAt:'2026-09-17T10:00:00Z',now}),null);
});
test('minimum-click alternative prepares date, address and agency session choices within 20 characters',()=>{
 const x=fixture();x.events=[event(ABSENT_TEMPLATE_BUTTONS[2])];const r=run(x);assert.equal(r.shadow.next_action,'WOULD_SHOW_RECOVERY_OPTIONS');const buttons=r.shadow.prepared_subflow.interactive.action.buttons;assert.equal(buttons.length,3);assert.ok(buttons.some(b=>b.reply.id==='ABSENT_PICKUP_AGENCY'));for(const b of buttons)assert.ok(b.reply.title.length<=20);
});
test('follow-up date requires same conversation/customer and only then permits a date without guessed time',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[2]),{...event(null,1),message_type:'TEXT',raw_text:'2026-09-21'}];let r=run(x);assert.equal(r.shadow.requested_date,'2026-09-21');assert.equal(r.shadow.requested_time_window,'DATE_ONLY');assert.equal(r.shadow.all_day,false);assert.equal(r.shadow.prepared_subflow,null);assert.equal(r.shadow.input_snapshot.flow.identity_verified,true);
 x.events[1].chatby_contact_id_hash='wrong-customer';r=run(x);assert.ok(r.shadow.blocking_reasons.includes('ABSENT_FOLLOWUP_IDENTITY_NOT_VERIFIED'));assert.equal(r.shadow.next_action,'HUMAN_REVIEW_REQUIRED');
});
test('follow-up address reuses existing address parser, incomplete fields stay waiting and no raw data leaks',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[3]),{...event(null,1),message_type:'TEXT',raw_text:'Calle Ejemplo 12'}];const r=run(x);assert.equal(r.shadow.recovery_flow_status,'WAITING_DELIVERY_DATA');assert.equal(r.shadow.next_action,'WOULD_REQUEST_ADDRESS_DATA');assert.doesNotMatch(JSON.stringify(r.shadow),/Calle Ejemplo/);
});
test('historical button aliases retain meaning; unknown ABSENT id cannot be disguised by a known label',()=>{
 for(const b of ABSENT_LEGACY_BUTTONS){const x=fixture();x.events=[event(b)];assert.notEqual(run(x).shadow.customer_intent,'UNCLEAR');}
 assert.equal(absentButtonFor({...event(ABSENT_BUTTONS[0]),button_payload:'ABSENT_UNKNOWN'}),null);
 const x=fixture();x.events=[{...event(ABSENT_BUTTONS[0]),button_payload:'ABSENT_UNKNOWN'}];assert.equal(run(x).shadow.customer_intent,'UNCLEAR');
});
test('conflicting event ID or simultaneous different slots fail closed',()=>{
 const x=fixture();x.events=[event(ABSENT_BUTTONS[0]),event(ABSENT_BUTTONS[1])];assert.ok(run(x).shadow.blocking_reasons.includes('CHATBY_EVENT_ID_CONTENT_CONFLICT'));
 x.events[1].chatby_message_id='different-event';assert.ok(run(x).shadow.blocking_reasons.includes('CONFLICTING_SIMULTANEOUS_RESPONSES'));
});
test('all scenarios remain SHADOW even if environmental live switches are true',()=>{
 process.env.AUSENTE_AUTOMATION_LIVE='true';try{for(const b of [...ABSENT_BUTTONS,...ABSENT_TEMPLATE_BUTTONS]){const x=fixture();x.events=[event(b)];const r=run(x);for(const k of ['actions_executed','production_writes','messages_sent','dropea_write_requests','chatby_write_requests','gls_write_requests','issues_resolved'])assert.equal(r.decision[k],0);assert.ok(Object.values(r.shadow.live_flags).every(v=>v===false));assert.equal(r.shadow.prepared_subflow.messages_sent,0);}}finally{delete process.env.AUSENTE_AUTOMATION_LIVE;}
});
