import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { incidentNotificationBoundary, INCIDENT_NOTIFICATION_TEMPLATES, projectNotificationScopedIncident } from '../src/incident/notification-evidence.mjs';
import { chatbyReadOnlyInternals as parser } from '../../../services/integrations/chatby/readonly-sync.mjs';
import { interpretIncidentConversation } from '../src/incident/conversation-intelligence.mjs';
import { incidentInsight } from '../../suleia-operations-mcp/src/operations/incident-insight.mjs';

const at = '2026-09-15T10:00:00Z';
const issue = { issueId: 'i',orderId: 'o',issueType: 'RECIPIENT_ABSENT',createdAt: at,now: '2026-09-16T10:00:00Z' };
const outgoing = (time,slug='dropea_incidencia_ausente_v2',extra={}) => ({ canonical_issue_id: 'i',canonical_order_id: 'o',direction: 'OUTBOUND',message_type: 'TEMPLATE',created_at: time,context_template_slug: slug,...extra });
const msg = (type,time,text='',payload={}) => ({ type,msg_type:type==='in'?'postback':'template',ts: Date.parse(time)/1000,content: text,payload });
const base = { status:'PENDING',is_active:true,dropea_sync_current:true,chatby_sync_current:true,
  conversation_status:'FOUND',interpreted_type:'REFUSED_BY_RECIPIENT',operational_response_status:'VALID_RESPONSE',
  incident_notified_at:at,latest_private_customer_message_at:'2026-09-15T11:00:00Z',
  latest_customer_message_relation:'AFTER_INCIDENT',latest_customer_incident_relevance:'INCIDENT_RELEVANT',
  messages_used:1,allowed_resolution_options:['RETURN_REQUESTED','PROVIDE_SOLUTION'] };

test('notification aliases cover existing incident types, not order lifecycle templates',()=>{
  for (const [type,slugs] of Object.entries(INCIDENT_NOTIFICATION_TEMPLATES)) {
    for (const slug of slugs) assert.equal(incidentNotificationBoundary([outgoing(at,slug)],{...issue,issueType:type}),at);
  }
  assert.equal(incidentNotificationBoundary([outgoing(at,'dropea_pedido_nuevo_v1')],issue),null);
});
test('boundary requires exact issue/order, current type, actual timestamp and first notification',()=>{
  const first='2026-09-15T10:10:00Z';
  const events=[outgoing('2026-09-14T10:00:00Z'),outgoing(at,undefined,{canonical_order_id:'old'}),
    outgoing(at,undefined,{canonical_issue_id:'other'}),outgoing(at,'dropea_incidencia_mercancia_v1'),
    outgoing('2026-09-15T10:20:00Z'),outgoing(first)];
  assert.equal(incidentNotificationBoundary(events,issue),first);
});
test('actual Chatby payload.name supplies template context and excludes initial confirmation',()=>{
  assert.equal(parser.templateSlug(msg('out',at,'',{name:'es_ES dropea_incidencia_ausente_v2'})),'dropea_incidencia_ausente_v2');
  const metrics=parser.conversationMetrics([
    msg('out',at,'',{name:'dropea_pedido_nuevo_v1'}),msg('in','2026-09-15T10:01:00Z','Confirmar mi pedido'),
    msg('out','2026-09-15T10:05:00Z','',{name:'dropea_incidencia_ausente_v2'}),
    msg('in','2026-09-15T10:05:00Z','No quiero el pedido'),
    msg('in','2026-09-15T10:06:00Z','Mañana por mañana / tarde')
  ],at,new Date(issue.now),{issueType:'RECIPIENT_ABSENT'});
  assert.equal(metrics.incident_notified_at,'2026-09-15T10:05:00.000Z');
  assert.equal(metrics.customer_replied,true);
  assert.equal(metrics.last_customer_message_at,'2026-09-15T10:06:00.000Z');
  assert.equal(metrics.customer_messages[0].incident_relevance,'ORDER_LIFECYCLE_ONLY');
  assert.equal(metrics.customer_messages[1].incident_relevance,'BEFORE_NOTIFICATION');
  assert.equal(metrics.current_messages.filter(m=>m.type==='in').length,1);
});
test('missing notification and short history never establish incident silence or customer action',()=>{
  const metrics=parser.conversationMetrics([msg('in','2026-09-15T11:00:00Z','Confirmar mi pedido')],at,new Date(issue.now),{issueType:'REFUSED_BY_RECIPIENT'});
  assert.equal(metrics.customer_replied,false);
  assert.equal(metrics.last_button,null);
  const shown=incidentInsight({...base,incident_notified_at:null,latest_customer_message:'Confirmar mi pedido'});
  assert.equal(shown.customer_evidence.code,'NOT_VERIFIABLE');
  assert.equal(shown.customer_evidence.latest_message,null);
  assert.equal(shown.tailored_recommendation.resolution_option,null);
});
test('old projected VALID_RESPONSE cannot make before-notification or lifecycle text current',()=>{
  for(const changes of [{latest_customer_message_relation:'BEFORE_INCIDENT'},
    {latest_private_customer_message_at:at},{latest_customer_incident_relevance:'ORDER_LIFECYCLE_ONLY'},
    {latest_customer_context_template:'dropea_pedido_nuevo_v1'}]){
    const shown=incidentInsight({...base,latest_customer_message:'Confirmar mi pedido',customer_intent:'CUSTOMER_STILL_WANTS_ORDER',...changes});
    assert.notEqual(shown.customer_evidence.code,'CONFIRM');
    assert.equal(shown.customer_evidence.latest_message,null);
  }
});
test('newer ambiguous message and cancellation beat old discount acceptance',()=>{
  const old={discount_recovery_response_status:'DISCOUNT_ACCEPTED',discount_delivery_verified:true,
    discount_signal_quality:'VERIFIED',discount_sent_at:'2026-09-15T10:10:00Z',discount_responded_at:'2026-09-15T10:20:00Z'};
  const ambiguous=incidentInsight({...base,...old,latest_customer_message:'Tengo una duda',customer_intent:'DISCOUNT_ACCEPTED'});
  assert.equal(ambiguous.customer_evidence.code,'UNKNOWN');
  assert.equal(ambiguous.tailored_recommendation.code,'VERIFY_INCIDENT_RESPONSE');
  const rejected=incidentInsight({...base,...old,latest_customer_message:'No quiero el pedido'});
  assert.equal(rejected.customer_evidence.code,'REJECT');
  assert.notEqual(rejected.tailored_recommendation.code,'APPLY_ACCEPTED_DISCOUNT_AND_REDELIVER');
});
test('case Chatby freshness, Dropea freshness and inactive state gate discount proposals first',()=>{
  const accepted={...base,latest_customer_message:'Quiero el descuento',discount_recovery_response_status:'DISCOUNT_ACCEPTED',discount_delivery_verified:true,
    discount_signal_quality:'VERIFIED',discount_sent_at:at,discount_responded_at:base.latest_private_customer_message_at};
  assert.equal(incidentInsight({...accepted,dropea_sync_current:false}).tailored_recommendation.code,'REFRESH_DROPEA_SOURCE');
  assert.equal(incidentInsight({...accepted,chatby_sync_current:false}).tailored_recommendation.code,'VERIFY_INCIDENT_RESPONSE');
  assert.equal(incidentInsight({...accepted,is_active:false}).tailored_recommendation.code,'INCIDENT_NO_LONGER_PENDING');
  assert.equal(incidentInsight({...base,conversation_status:'UNKNOWN'}).tailored_recommendation.resolution_option,null);
});
test('outbound/system buttons, future dates and marked lifecycle events are not customer evidence',()=>{
  const events=[{direction:'OUTBOUND'},{direction:'SYSTEM'},{direction:'INBOUND',incident_relevance:'ORDER_LIFECYCLE_ONLY'},
    {direction:'INBOUND',created_at:'2026-09-17T10:00:00Z'}].map(e=>({canonical_issue_id:'i',incident_version:'v',message_type:'BUTTON',intent:'FINAL_REJECTION',created_at:at,...e}));
  const result=interpretIncidentConversation({events,issueId:'i',issueVersion:'v',now:issue.now});
  assert.equal(result.has_customer_replied,false);
  assert.equal(result.messages_used,0);
});
test('unverified scoped evidence invalidates old absence shadow proposal without changing stored timer',()=>{
  const input={...base,scoped_response_status:'NOT_VERIFIABLE',scoped_response_reason:'INCIDENT_NOTIFICATION_NOT_OBSERVED',
    timer_status:'ACTIVE',timer_due_at:'2026-09-17T10:00:00Z',absent_shadow:{customer_intent:'CONFIRM'}};
  const output=projectNotificationScopedIncident(input);
  assert.equal(output.absent_shadow,null);
  assert.equal(output.effective_decision_status,'REVIEW');
  assert.equal(output.timer_due_at,input.timer_due_at);
});
test('valid scoped cancellation invalidates a real absence shadow before projection',()=>{
  const item={...base,interpreted_type:'RECIPIENT_ABSENT',scoped_response_status:'VALID_RESPONSE',
    scoped_response_reason:'CUSTOMER_INPUT_AFTER_INCIDENT_NOTIFICATION',scoped_customer_intent:'FINAL_REJECTION',
    scoped_customer_activity_at:base.latest_private_customer_message_at,latest_customer_message:'No quiero el pedido',
    absent_shadow:{policy_version:'RECIPIENT_ABSENT_POLICY_V1',customer_intent:'RESCHEDULE_DELIVERY',simulation_action:'WOULD_REQUEST_NEW_DELIVERY',
      next_action:'WOULD_REQUEST_NEW_DELIVERY',input_snapshot:{response_hash:'old'}},decided_at:at};
  const shown=incidentInsight(item);
  assert.equal(shown.customer_evidence.code,'REJECT');
  assert.equal(shown.absent_shadow,null);
  assert.notEqual(shown.tailored_recommendation.code,'WOULD_REQUEST_NEW_DELIVERY');
  assert.equal(shown.effective_simulated_action_type,null);
  assert.equal(shown.tailored_recommendation.code,'RECOMPUTE_RECIPIENT_ABSENT_SHADOW');
  assert.equal(shown.tailored_recommendation.resolution_option,null);
  assert.equal(shown.tailored_recommendation.confidence,'REVIEW');
  assert.equal(shown.tailored_recommendation.policy_version,'RECIPIENT_ABSENT_POLICY_V1');
});
test('same-intent new delivery slot cannot inherit an old shadow decision',()=>{
  const shown=incidentInsight({...base,interpreted_type:'RECIPIENT_ABSENT',scoped_response_status:'VALID_RESPONSE',
    scoped_response_reason:'CUSTOMER_INPUT_AFTER_INCIDENT_NOTIFICATION',scoped_customer_intent:'DELIVERY_RETRY',
    scoped_customer_activity_at:base.latest_private_customer_message_at,latest_customer_message:'Mañana por mañana / tarde',
    absent_shadow:{policy_version:'RECIPIENT_ABSENT_POLICY_V1',customer_intent:'DELIVERY_RETRY',simulation_action:'WOULD_REQUEST_NEW_DELIVERY',
      input_snapshot:{response_hash:'old'}},decided_at:at,stored_interpretation_intent:'DELIVERY_RETRY',stored_interpretation_message_at:at});
  assert.equal(shown.absent_shadow,null);
  assert.equal(shown.decision_record_status,'HISTORICAL');
  assert.equal(shown.tailored_recommendation.resolution_option,null);
});
test('persisted notification does not establish coverage of a new truncated read',()=>{
  const shown=incidentInsight({...base,scoped_response_status:'NOT_VERIFIABLE',
    scoped_response_reason:'NOTIFICATION_TO_READ_HISTORY_NOT_COVERED',incident_notified_at:at,
    latest_customer_message:'Confirmar mi pedido',customer_intent:'CUSTOMER_STILL_WANTS_ORDER'});
  assert.equal(shown.customer_evidence.code,'NOT_VERIFIABLE');
  assert.equal(shown.customer_evidence.latest_message,null);
  assert.equal(shown.tailored_recommendation.resolution_option,null);
  assert.equal(shown.customer_replied_after_issue,false);
});
test('excluded initial confirmation invalidates an old response-based decision, not a real silence decision',()=>{
  const item={scoped_response_status:'NO_VALID_RESPONSE',stored_interpretation_message_at:at,
    effective_decision_status:'READY',effective_qa_status:'PASS',effective_human_review:false,
    effective_simulated_action_type:'PROVIDE_SOLUTION',timer_due_at:at};
  const shown=projectNotificationScopedIncident(item);
  assert.equal(shown.effective_decision_status,'REVIEW');
  assert.equal(shown.effective_qa_status,'REVIEW');
  assert.equal(shown.effective_human_review,true);
  assert.equal(shown.effective_simulated_action_type,null);
  assert.equal(shown.timer_due_at,at);
  assert.equal(projectNotificationScopedIncident({...item,stored_interpretation_message_at:null}).effective_decision_status,'READY');
});
test('read projection revalidates persisted evidence; no order actions, credentials or customer text',()=>{
  const sql=fs.readFileSync(new URL('../../../migrations/036_incident_notification_evidence.sql',import.meta.url),'utf8');
  assert.match(sql,/m\.canonical_issue_id=p\.canonical_issue_id AND m\.canonical_order_id=p\.canonical_order_id/);
  assert.match(sql,/m\.occurred_at>n\.occurred_at/);
  assert.match(sql,/ORDER BY m\.occurred_at DESC,m\.chatby_message_id_hash DESC/);
  assert.doesNotMatch(sql,/message_text_ciphertext|UPDATE |DELETE |INSERT |incident_timers/);
  assert.match(sql,/history_covered_from>n\.occurred_at/);
  assert.match(sql,/NOTIFICATION_TO_READ_HISTORY_NOT_COVERED/);
  assert.match(sql,/WHEN 'effective_decision_status' THEN 'CASE WHEN b.stale_decision/);
  assert.match(sql,/WHEN 'effective_human_review' THEN 'CASE WHEN b.stale_decision/);
  assert.match(sql,/WHEN 'effective_qa_status' THEN 'CASE WHEN b.stale_decision/);
  const repo=fs.readFileSync(new URL('../../suleia-operations-mcp/src/operations/repository.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(repo,/ORDER BY \(m\.relation_to_issue|m\.intent<>'UNKNOWN'/);
  assert.match(repo,/m\.chatby_message_id_hash=p\.scoped_customer_message_hash/);
});
