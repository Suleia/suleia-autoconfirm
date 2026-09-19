import test from 'node:test';
import assert from 'node:assert/strict';
import {autopilotSelector,buildRecoveryOverview,recoveryProjection,recoverySelector,recoveryTimeline,recoveryMetrics} from '../src/incident/recovery-center.mjs';
const now='2026-09-18T14:00:00Z';
function issue(patch={}) {
  return {canonical_issue_id:'i',canonical_order_id:'o',dropea_issue_id:'1',dropea_order_id:'2',
    interpreted_type:'RECIPIENT_ABSENT',normalized_type:'RECIPIENT_ABSENT',carrier:'GLS',status:'PENDING',is_active:true,
    created_at:'2026-09-18T10:00:00Z',updated_at:'2026-09-18T13:00:00Z',incident_notified_at:'2026-09-18T10:10:00Z',
    incident_notification_template:'dropea_ausente_v3',conversation_status:'FOUND',chatby_sync_current:true,dropea_sync_current:true,
    scoped_customer_message_hash:'message-a',latest_private_customer_message_hash:'message-a',scoped_response_status:'VALID_RESPONSE',
    latest_customer_context_template:'dropea_ausente_v3',effective_qa_status:'PASS',allowed_resolution_options:['RETRY'],
    notification_decision_current:true,recovery_order_state:'SHIPPING',
    customer_evidence:{code:'RESCHEDULE_DELIVERY',intent:'RESCHEDULE_DELIVERY',latest_message:'Mañana por la mañana',at:'2026-09-18T13:50:00Z',relation:'AFTER_NOTIFICATION'},
    absent_shadow:{customer_intent:'RESCHEDULE_DELIVERY',requested_date:'2026-09-19',simulation_status:'SIMULATION_READY',logistics_feasibility:'FEASIBLE'},...patch};
}
const project=i=>recoveryProjection(i,{now});
test('absent valid preference is acted/recoverable, needs Suleia, and never enables writes',()=>{
  const item=project(issue());for(const key of ['CUSTOMER_ACTED','RECOVERABLE_NOW','WAITING_SULEIA'])assert.equal(recoverySelector(item,key),true);
  assert.equal(item.recovery.status,'RECOVERABLE_NOW');assert.equal(item.recovery.execution_enabled,false);
  assert.equal(item.recovery.priority,1);assert.ok(item.recovery.score>50);
});
for(const [label,patch] of [
  ['initial confirmation',{customer_evidence:{code:'CONFIRM',latest_message:'CONFIRMAR MI PEDIDO',at:'2026-09-18T13:50:00Z',relation:'AFTER_NOTIFICATION'}}],
  ['initial template',{latest_customer_context_template:'dropea_pedido_nuevo_v1'}],
  ['different message',{latest_private_customer_message_hash:'message-other'}],
  ['missing message binding',{latest_private_customer_message_hash:null}],
  ['stale read',{chatby_sync_current:false}],
  ['unmatched conversation',{conversation_status:'NONE'}],
  ['shadow creation only',{incident_notified_at:null}],
  ['pre notification',{customer_evidence:{code:'CONFIRM',at:'2026-09-18T10:05:00Z',relation:'BEFORE_NOTIFICATION'}}],
  ['future response',{customer_evidence:{code:'CONFIRM',at:'2026-09-19T10:00:00Z',relation:'AFTER_NOTIFICATION'}}]
])test(`${label} cannot activate incident response or commercial recovery`,()=>{
  const row=project(issue(patch));assert.equal(recoverySelector(row,'CUSTOMER_ACTED'),false);assert.equal(recoverySelector(row,'RECOVERABLE_NOW'),false);
  assert.equal(row.recovery.evidence.message,null);
  if(label==='initial confirmation' || label==='initial template'){
    assert.equal(row.tailored_recommendation.code,'VERIFY_CURRENT_INCIDENT_EVIDENCE');
    assert.equal(row.tailored_recommendation.prepared_dropea_solution,null);
  }
});
test('FOUND and stale sources are not silence; fresh observed silence waits on real deadline',()=>{
  const c={code:'NO_VALID_RESPONSE',at:null,relation:null};
  const row=project(issue({customer_evidence:c,scoped_response_status:'NO_VALID_RESPONSE',timer_status:'ACTIVE',timer_due_at:'2026-09-18T15:00:00Z',absent_shadow:null}));
  assert.equal(recoverySelector(row,'WAITING_CUSTOMER'),true);assert.equal(recoverySelector(row,'RETURN_RISK'),true);
  assert.equal(row.recovery.timer.remaining_seconds,3600);
  const uncertain=project(issue({customer_evidence:c,chatby_sync_current:false}));assert.equal(recoverySelector(uncertain,'WAITING_CUSTOMER'),false);
});
for(const intent of ['CUSTOM_TIME_SLOT','ADDRESS_DATA_REQUEST','RECOVERY_OPTIONS'])test(`absent ${intent} collects data instead of proposing execution`,()=>{
  const row=project(issue({customer_evidence:{code:intent,intent,latest_message:'Elegir otro día',at:'2026-09-18T13:50:00Z',relation:'AFTER_NOTIFICATION'},absent_shadow:{customer_intent:intent}}));
  assert.equal(recoverySelector(row,'CUSTOMER_ACTED'),true);assert.equal(recoverySelector(row,'WAITING_CUSTOMER'),true);
  assert.equal(recoverySelector(row,'RECOVERABLE_NOW'),false);assert.equal(recoverySelector(row,'WAITING_SULEIA'),false);
});
test('valid address uses existing parser result and official capabilities; incomplete remains waiting',()=>{
  const input=issue({interpreted_type:'ADDRESS_INCORRECT',normalized_type:'ADDRESS_INCORRECT',absent_shadow:null,allowed_resolution_options:['CHANGE_ADDRESS'],
    customer_evidence:{code:'ADDRESS_CHANGE',intent:'ADDRESS_CHANGE',at:'2026-09-18T13:50:00Z',relation:'AFTER_INCIDENT',latest_message:'Datos de prueba',address_instruction:{has_address_data:true,complete:true}}});
  assert.equal(recoverySelector(project(input),'RECOVERABLE_NOW'),true);
  input.customer_evidence.address_instruction.complete=false;
  assert.equal(recoverySelector(project(input),'WAITING_CUSTOMER'),true);assert.equal(recoverySelector(project(input),'RECOVERABLE_NOW'),false);
});
function refusal(patch={}){return issue({interpreted_type:'REFUSED_BY_RECIPIENT',normalized_type:'REFUSED_BY_RECIPIENT',absent_shadow:null,
  customer_evidence:{code:'NO_VALID_RESPONSE'},scoped_response_status:'NO_VALID_RESPONSE',discount_signal_quality:'VERIFIED',discount_amount_eur:5,
  discount_recovery:{delivery_verified:true,status:'DISCOUNT_ACCEPTED',sent_at:'2026-09-18T11:00:00Z',responded_at:'2026-09-18T12:00:00Z'},...patch});}
test('discount acceptance must follow verified offer, and superseded rejection cannot authorize recovery',()=>{
  assert.equal(recoverySelector(project(refusal()),'RECOVERABLE_NOW'),true);
  assert.equal(project(refusal()).recovery.evidence.no_action_verified,false);
  const previous=refusal();previous.discount_recovery.responded_at='2026-09-18T10:30:00Z';assert.equal(recoverySelector(project(previous),'RECOVERABLE_NOW'),false);
  const laterCancel=refusal({customer_evidence:{code:'REJECT',latest_message:'Quiero devolver',at:'2026-09-18T13:00:00Z',relation:'AFTER_NOTIFICATION'}});
  assert.equal(recoverySelector(project(laterCancel),'RECOVERABLE_NOW'),false);assert.equal(project(laterCancel).recovery.score,0);
  const oldReject=refusal({customer_evidence:{code:'REJECT',latest_message:'No lo quiero',at:'2026-09-18T10:30:00Z',relation:'AFTER_NOTIFICATION'}});
  assert.equal(recoverySelector(project(oldReject),'RECOVERABLE_NOW'),true);
});
test('discount OTHER_RESPONSE cannot convert initial order confirmation into incident response',()=>{
  const row=refusal({customer_evidence:{code:'CONFIRM',latest_message:'CONFIRMAR MI PEDIDO',at:'2026-09-18T12:00:00Z',relation:'AFTER_NOTIFICATION'}});
  row.discount_recovery.status='OTHER_RESPONSE';assert.equal(recoverySelector(project(row),'CUSTOMER_ACTED'),false);
});
test('discount due_at offer eligibility is not a return deadline; current rejection policy stays external',()=>{
  const row=refusal({discount_due_at:'2026-09-18T13:00:00Z',timer_status:'ACTIVE',timer_due_at:'2026-09-18T13:00:00Z'});
  row.discount_recovery.status='NO_RESPONSE';row.discount_recovery.responded_at=null;
  const p=project(row);assert.equal(p.recovery.timer.deadline,null);assert.equal(recoverySelector(p,'RETURN_RISK'),false);
  assert.equal(p.tailored_recommendation.code,'WAIT_DISCOUNT_POLICY_TIMER');assert.equal(p.tailored_recommendation.resolution_option,null);
  assert.ok(p.tailored_recommendation.steps.every(step=>!step.includes('Solicitar devolución')));
  assert.equal(p.tailored_recommendation.prepared_dropea_solution,null);
  row.discount_response_deadline='2026-09-18T15:00:00Z';assert.equal(recoverySelector(project(row),'RETURN_RISK'),true);
});
test('requested return, resolved recovery, and physically returned/delivered are separate facts',()=>{
  const requested=project(issue({resolution_status:'RETURN_REQUESTED'}));assert.equal(requested.recovery.status,'RETURN_REQUESTED');assert.equal(recoverySelector(requested,'RETURNED'),false);
  const recovered=project(issue({status:'RESOLVED',is_active:false,resolution_status:'RETRY'}));assert.equal(recoverySelector(recovered,'RECOVERED'),true);assert.equal(recovered.recovery.recovered_at,null);
  assert.equal(recoverySelector(recovered,'DELIVERED_AFTER_INCIDENT'),false);assert.equal(recoverySelector(recovered,'REDELIVERY'),true);
  const returned=project(issue({recovery_order_state:'RETURNED',recovery_returned_at:'2026-09-18T13:00:00Z'}));assert.equal(recoverySelector(returned,'RETURNED'),true);
  assert.equal(recoverySelector(project(issue({recovery_order_state:'REJECTED',recovery_returned_at:'2026-09-18T13:00:00Z'})),'RETURNED'),true);
  assert.equal(recoverySelector(project(issue({recovery_order_state:'RETURNED'})),'RETURNED'),false);
  const delivered=project(issue({recovery_order_state:'DELIVERED',recovery_delivered_at:'2026-09-18T13:00:00Z'}));assert.equal(recoverySelector(delivered,'DELIVERED_AFTER_INCIDENT'),true);
  assert.equal(recoverySelector(project(issue({recovery_order_state:'FINISHED',recovery_delivered_at:'2026-09-18T13:00:00Z'})),'DELIVERED_AFTER_INCIDENT'),true);
  assert.equal(recoverySelector(project(issue({recovery_order_state:'DELIVERED',recovery_delivered_at:'2026-09-17T13:00:00Z'})),'DELIVERED_AFTER_INCIDENT'),false);
});
test('every KPI shares the exact selector with rows; filtering precedes pagination for all 10 KPIs',()=>{
  const raw=[issue(),refusal(),issue({canonical_issue_id:'i3',status:'RESOLVED',is_active:false,resolution_status:'RETRY'}),issue({canonical_issue_id:'i4',recovery_order_state:'RETURNED',recovery_returned_at:'2026-09-18T13:00:00Z'}),issue({canonical_issue_id:'i5',chatby_sync_current:false})];
  const overview=buildRecoveryOverview(raw,{now,filters:{scope:'ALL'}});assert.equal(overview.summary.kpis.length,10);
  for(const kpi of overview.summary.kpis){const a=buildRecoveryOverview(raw,{now,filters:{scope:'ALL',recovery:kpi.key},limit:1});
    assert.equal(kpi.count,a.total);assert.equal(kpi.count,overview.items.filter(i=>recoverySelector(i,kpi.key)).length);
    assert.ok(a.items.every(i=>recoverySelector(i,kpi.key)));assert.ok(a.items.length<=1);
  }
  const all=buildRecoveryOverview(raw,{now,filters:{recovery:'PENDING'},limit:1,offset:1});assert.equal(all.items.length,1);assert.equal(all.total,4);
});
test('every Autopilot KPI shares the exact selector with its filtered queue',()=>{
  const raw=[issue(),refusal(),issue({canonical_issue_id:'i3',chatby_sync_current:false}),issue({canonical_issue_id:'i4',status:'RESOLVED',is_active:false,resolution_status:'RETRY'})];
  const overview=buildRecoveryOverview(raw,{now,filters:{scope:'ALL'},connectorHealth:[{connector:'dropea',freshness_status:'FRESH'}]});
  assert.equal(overview.summary.autopilot.mode,'SIMULATION / SHADOW');
  assert.equal(overview.summary.autopilot.connectors.length,1);
  for(const kpi of overview.summary.autopilot.kpis){
    const filtered=buildRecoveryOverview(raw,{now,filters:{scope:'ALL',autopilot:kpi.key},limit:1});
    assert.equal(kpi.count,filtered.total);
    assert.ok(filtered.items.every(item=>autopilotSelector(item,kpi.key)));
  }
  assert.equal(overview.summary.autopilot.actions.production_writes,0);
});
test('default and invalid scope show only current PENDING/active issues across all months; history requires explicit scope',()=>{
  const pending=issue({canonical_issue_id:'old-pending',created_at:'2026-05-01T10:00:00Z'});
  const inactive=issue({canonical_issue_id:'inactive',is_active:false});
  const closed=issue({canonical_issue_id:'closed',status:'RESOLVED',is_active:false});
  const managing=issue({canonical_issue_id:'managed',status:'MANAGING_WITH_CLIENT'});
  for(const filters of [{},{scope:'INVALID'},{scope:'active'}]){
    const result=buildRecoveryOverview([pending,inactive,closed,managing],{now,filters});
    assert.equal(result.summary.scope,'ACTIVE');assert.equal(result.total,1);assert.equal(result.items[0].canonical_issue_id,'old-pending');
  }
  assert.equal(buildRecoveryOverview([pending,inactive,closed,managing],{now,filters:{scope:'HISTORICAL'}}).total,3);
  assert.equal(buildRecoveryOverview([pending,inactive,closed,managing],{now,filters:{scope:'HISTORICAL'}}).summary.absent_filters.AUSENTE,3);
  assert.equal(buildRecoveryOverview([pending,inactive,closed,managing],{now,filters:{scope:'ALL'}}).total,4);
});
test('verified silence uses exact phrase semantics; stale, missing notification and SHADOW creation are not silence',()=>{
  const silent=issue({customer_evidence:{code:'NO_VALID_RESPONSE'},scoped_response_status:'NO_VALID_RESPONSE',incident_conversation_read_at:now});
  assert.equal(project(silent).recovery.evidence.no_action_verified,true);
  assert.equal(project(silent).recovery.evidence.display_status,'NO_ACTION');
  for(const patch of [{chatby_sync_current:false},{conversation_status:'NONE'},{incident_notified_at:null},{scoped_response_status:'NOT_VERIFIABLE'},{customer_evidence:{code:'SHADOW_NO_RESPONSE'}}]){
    const e=project({...silent,...patch}).recovery.evidence;assert.equal(e.no_action_verified,false);assert.equal(e.display_status,'NOT_VERIFIABLE');
  }
});
test('ambiguous post-notification reply is visible but never counted as a valid customer action',()=>{
  const input=issue({absent_shadow:null,customer_evidence:{code:'UNKNOWN',title:'Cliente respondió',latest_message:'Tengo una duda',at:'2026-09-18T13:00:00Z',relation:'AFTER_NOTIFICATION'},latest_private_customer_message_type:'BUTTON'});
  const row=project(input);assert.equal(recoverySelector(row,'CUSTOMER_ACTED'),false);
  assert.equal(row.recovery.evidence.message,'Tengo una duda');assert.equal(row.recovery.evidence.message_type,'BUTTON');
  assert.equal(row.recovery.evidence.customer_interacted,true);
  assert.equal(row.recovery.evidence.valid_response,false);assert.equal(row.recovery.evidence.no_action_verified,false);
  assert.equal(recoverySelector(row,'RECOVERABLE_NOW'),false);assert.equal(recoverySelector(row,'WAITING_SULEIA'),false);
});
test('combinable monthly, type, active, template and priority filters define one universe',()=>{
  const raw=[issue(),refusal(),issue({canonical_issue_id:'old',created_at:'2026-08-31T21:59:00Z'})];
  const result=buildRecoveryOverview(raw,{now,filters:{month:'2026-09',scope:'ACTIVE',type:'RECIPIENT_ABSENT',template:'dropea_ausente_v3',priority:'1',client_acted:'true',recoverable:'true'}});
  assert.equal(result.total,1);assert.equal(result.summary.universe_count,1);
  assert.equal(result.summary.absent_filters.AUSENTE,1);assert.equal(result.summary.metrics.orders,1);
});
test('business metrics count distinct orders and never invent first response/recovery times or uncovered zero rates',()=>{
  const items=[project(issue()),project(issue({canonical_issue_id:'second'}))];const m=recoveryMetrics(items);
  assert.equal(m.incidents,2);assert.equal(m.orders,1);assert.equal(m.response_rate,100);
  assert.equal(m.mean_response_seconds,null);assert.equal(m.mean_recovery_seconds,null);assert.equal(m.recovery_rate,null);
  const unknown=project(issue({chatby_sync_current:false}));assert.equal(recoveryMetrics([unknown]).response_rate,null);
  assert.equal(items[0].recovery.measurement.template_version,'3');
});
test('timeline uses exact identity, actual timestamps and excludes initial confirmations as incident evidence',()=>{
  const item=project(issue());
  const events=[{canonical_order_id:'o',canonical_issue_id:'i',timeline_event_id:'a',occurred_at:'2026-09-18T12:00:00Z',event_type:'DECISION_SIMULATED',event_source:'SULEIA'},
    {canonical_order_id:'other',timeline_event_id:'b',occurred_at:'2026-09-18T11:00:00Z',event_type:'ACTION_EXECUTED'},
    {canonical_order_id:'o',canonical_issue_id:'other',timeline_event_id:'c',occurred_at:'2026-09-18T11:00:00Z',event_type:'ACTION_EXECUTED'}];
  const messages=[{chatby_message_id_hash:'m',occurred_at:'2026-09-18T10:30:00Z',direction:'INBOUND',text:'CONFIRMAR MI PEDIDO',relation_to_notification:'AFTER_NOTIFICATION'}];
  const timeline=recoveryTimeline(item,events,messages);assert.equal(timeline.length,3);
  assert.equal(timeline[1].validity,'ORDER_LIFECYCLE_ONLY');assert.equal(timeline.at(-1).event_type,'DECISION_SIMULATED');
  assert.ok(timeline.every(e=>e.event_type!=='ACTION_EXECUTED'));assert.equal(item.updated_at,'2026-09-18T13:00:00Z');
});
