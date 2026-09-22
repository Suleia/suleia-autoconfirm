import { absentHash, absentButtonFor, absentFollowUpPreparation, ABSENT_LIVE_FLAGS, ABSENT_TEMPLATE_NAME, ABSENT_TEMPLATE_BODY, ABSENT_TEMPLATE_BUTTONS, ABSENT_BUTTONS } from './absent-template.mjs';
import { interpretAbsentResponse } from './recipient-absent-policy.mjs';
import { classifyAbsenceAttempt, classifyAbsentCause, absentSourceFreshness, validAbsentTimer, ABSENT_POLICY_HASH } from './absent-evidence.mjs';
import { createIncidentTimer } from './incident-timers.mjs';
import { evaluateGlsDeliveryDate } from './gls-calendar.mjs';
import { absentLogisticsExecutionGate } from './absent-live-gates.mjs';
import { absentResolutionPreflight, recipientAbsentResolutionPanel } from './absent-resolution.mjs';

export function validateAbsentLogistics({ issue, order, chatby = {}, gls = {}, response = {}, now, requirement = 'RESCHEDULE' }) {
  const freshness = { dropea: absentSourceFreshness(issue.last_successful_sync_at || issue.observed_at, now, 600),
    chatby: absentSourceFreshness(chatby.observed_at, now, 300), gls: absentSourceFreshness(gls.observed_at, now, 900) };
  const reasons = [];
  if (!chatby.verified) freshness.chatby='UNKNOWN';
  if (freshness.dropea !== 'FRESH') reasons.push('DROPEA_READ_STALE_OR_UNKNOWN');
  if (!chatby.verified || freshness.chatby !== 'FRESH') reasons.push('CHATBY_READ_NOT_VERIFIABLE');
  if (issue.mapping_status !== 'MAPPED' || issue.carrier !== 'GLS') reasons.push('ABSENT_MAPPING_NOT_VERIFIED');
  const terminal = ['DELIVERED','FINISHED','FINISH','PAID','RETURNED','CANCELLED','REJECTED','REFUSED','REFUSED_LOST_DAMAGED','LOST_DAMAGED'].includes(order.canonical_state);
  const retention = issue.carrier_retention_deadline || gls.retention_deadline || null;
  const states = { dropea_resolution_capability: ['VERIFIED','DECLARED'].includes(issue.capability_status) ? 'DECLARED' : 'UNKNOWN',
    carrier_capability: freshness.gls === 'STALE' ? 'STALE' : gls.capability_status === 'VERIFIED' && freshness.gls === 'FRESH' ? 'VERIFIED' : 'UNKNOWN',
    package_operability: terminal || gls.package_operable === false ? 'NOT_OPERABLE' : gls.package_operable === true && freshness.gls === 'FRESH' ? 'OPERABLE' : 'UNKNOWN',
    retention: retention && Number.isFinite(new Date(retention).getTime()) ? new Date(retention) <= new Date(now) ? 'EXPIRED' : 'VERIFIED' : 'UNKNOWN',
    direct_gls_read: gls.observed_at ? 'AVAILABLE_TRACKING_ONLY' : 'GLS_DIRECT_READ_UNAVAILABLE' };
  if (terminal) reasons.push('STATE_CHANGED_ACTION_BLOCKED');
  const operational = ['RESCHEDULE','PICKUP','RETURN','ADDRESS'].includes(requirement);
  if (operational) {
    if (!gls.observed_at) reasons.push('GLS_DIRECT_READ_UNAVAILABLE');
    else if (freshness.gls !== 'FRESH') reasons.push('GLS_READ_STALE_OR_UNKNOWN');
    if (states.carrier_capability !== 'VERIFIED') reasons.push('CARRIER_CAPABILITY_NOT_VERIFIED');
    if (states.package_operability === 'UNKNOWN') reasons.push('PACKAGE_OPERABILITY_UNKNOWN');
    if (states.retention === 'UNKNOWN') reasons.push('RETENTION_NOT_VERIFIED');
    const required = { RESCHEDULE: ['RETRY','PROVIDE_SOLUTION'], PICKUP: ['PICKUP_AT_AGENCY'], RETURN: ['RETURN_REQUESTED'], ADDRESS: ['CHANGE_ADDRESS','PROVIDE_SOLUTION'] }[requirement];
    if (!required.some(o => (issue.allowed_resolution_options || []).includes(o))) reasons.push('RESOLUTION_OPTION_NOT_ALLOWED');
    if (requirement === 'PICKUP' && !(gls.pickup_point_verified && gls.package_available_for_pickup)) reasons.push('PICKUP_POINT_NOT_VERIFIED');
    if (response.requested_date) {
      const calendar = evaluateGlsDeliveryDate({now, requestedDate: response.requested_date, holidays: gls.holidays || []});
      if (!calendar.feasible) reasons.push(...calendar.reason);
      if (gls.calendar_verified !== true) reasons.push('DELIVERY_CALENDAR_NOT_VERIFIED');
      if (retention && response.requested_date > String(new Date(retention).toISOString()).slice(0,10)) reasons.push('REQUESTED_DATE_NOT_VIABLE');
    }
    if (states.package_operability === 'NOT_OPERABLE' || states.retention === 'EXPIRED') reasons.push('PACKAGE_NOT_OPERABLE');
  }
  return { status: terminal || reasons.includes('PACKAGE_NOT_OPERABLE') || reasons.includes('REQUESTED_DATE_NOT_VIABLE') ? 'NOT_FEASIBLE'
    : [freshness.dropea,freshness.chatby,...(operational?[freshness.gls]:[])].includes('STALE') ? 'STALE_DATA' : reasons.length ? 'UNKNOWN' : 'FEASIBLE',
    reasons: [...new Set(reasons)], freshness, requirement, ...states };
}

export function simulateRecipientAbsent(input, { now = new Date() } = {}) {
  const { issue, order, events = [], chatby = {}, gls = {}, history = {}, previousTimer = null, timeline = [], policy = {} } = input;
  if (issue.type !== 'RECIPIENT_ABSENT') throw new Error('ABSENT_POLICY_OUT_OF_SCOPE');
  const cause = classifyAbsentCause(issue), attempt = classifyAbsenceAttempt({issue,timeline});
  const anchor = chatby.incident_notified_at || issue.created_at || issue.updated_at;
  const anchorKind = chatby.incident_notified_at ? 'OBSERVED_NOTIFICATION' : 'SHADOW_ISSUE_CREATED_ONLY';
  const chatbyCurrent = chatby.verified === true && absentSourceFreshness(chatby.observed_at, now, 300) === 'FRESH';
  const candidates = events.filter(e => e.canonical_issue_id === issue.canonical_issue_id && e.canonical_order_id === order.canonical_order_id
    && e.direction === 'INBOUND' && e.relevance_status === 'CURRENT_ORDER_EXACT_MATCH'
    && !['ORDER_LIFECYCLE_ONLY','DISCOUNT_RESPONSE','BEFORE_INCIDENT','BEFORE_NOTIFICATION'].includes(e.incident_relevance)
    && !(chatby.incident_notified_at && e.incident_relevance === 'NOTIFICATION_NOT_OBSERVED')
    && !String(e.context_template_slug || '').startsWith('dropea_pedido_')
    && !/^(?:confirmar (?:mi )?pedido)[.!\s]*$/i.test(String(e.raw_text || '').trim())
    && Number.isFinite(new Date(e.created_at).getTime()) && new Date(e.created_at) > new Date(anchor) && new Date(e.created_at) <= new Date(now))
    .sort((a,b) => new Date(a.created_at)-new Date(b.created_at) || String(a.chatby_message_id).localeCompare(String(b.chatby_message_id)));
  const unique = new Map();
  let eventIdConflict = false;
  for (const e of candidates) {
    const key = e.chatby_message_id || absentHash([e.created_at,e.button_payload,e.raw_text,e.sanitized_text]);
    const previous = unique.get(key);
    if (previous && absentHash([previous.created_at,previous.button_payload,previous.raw_text,previous.sanitized_text]) !== absentHash([e.created_at,e.button_payload,e.raw_text,e.sanitized_text])) eventIdConflict=true;
    else unique.set(key,e);
  }
  const scoped = [...unique.values()];
  const latest = chatbyCurrent ? scoped.at(-1) : null;
  const selection = latest && scoped.slice(0,-1).filter(e=>absentButtonFor(e)).at(-1);
  const flowChoice = selection && absentButtonFor(selection)?.payload;
  const sameConversation = latest && selection && latest.chatby_conversation_id_hash && latest.chatby_contact_id_hash
    && latest.chatby_conversation_id_hash===selection.chatby_conversation_id_hash && latest.chatby_contact_id_hash===selection.chatby_contact_id_hash
    && (!chatby.chatby_conversation_id_hash || latest.chatby_conversation_id_hash===chatby.chatby_conversation_id_hash)
    && (!chatby.chatby_contact_id_hash || latest.chatby_contact_id_hash===chatby.chatby_contact_id_hash);
  const followUp = Boolean(latest && !absentButtonFor(latest) && ['ABSENT_OTHER_DAY','ABSENT_CHANGE_DELIVERY_DATA'].includes(flowChoice));
  const priorRequestedDate=sameConversation && ['ABSENT_TOMORROW_MORNING','ABSENT_TOMORROW_AFTERNOON'].includes(flowChoice)
    ? interpretAbsentResponse(selection).requested_date:null;
  const response = latest ? interpretAbsentResponse({...latest,flow_selection:followUp && sameConversation ? flowChoice:null,correlated_requested_date:priorRequestedDate})
    : {customer_intent: chatbyCurrent ? 'NO_RESPONSE' : 'UNKNOWN', confidence: chatbyCurrent ? 1 : 0};
  let timer = previousTimer;
  let createdTimer = null;
  const terminalOrder=['DELIVERED','FINISHED','FINISH','PAID','RETURNED','CANCELLED','REJECTED','REFUSED','REFUSED_LOST_DAMAGED','LOST_DAMAGED'].includes(order.canonical_state);
  if (!timer && !terminalOrder && ['EXACT','VERIFIED'].includes(order.identity_status)
    && !['ABSENCE_ATTEMPT_UNKNOWN','ABSENCE_ATTEMPT_CONFLICT'].includes(attempt.status)
    && absentSourceFreshness(issue.last_successful_sync_at || issue.observed_at,now,600)==='FRESH'
    && chatby.notification_template_name===ABSENT_TEMPLATE_NAME && chatby.notification_message_id
    && chatby.incident_notified_at && chatbyCurrent && !latest && chatby.template_contact_verified && issue.status === 'PENDING' && issue.is_active === true && cause.interpreted_type === 'RECIPIENT_ABSENT') {
    createdTimer = createIncidentTimer({timerType:'CUSTOMER_INITIAL_RESPONSE_48H',orderId:order.canonical_order_id,issueId:issue.canonical_issue_id,
      issueVersion:issue.created_at || issue.updated_at,relevantEventId:`absent-48h:${issue.canonical_issue_id}:${anchor}`,policyVersion:'RECIPIENT_ABSENT_POLICY_V1',startedAt:anchor,durationHours:48});
    timer = createdTimer;
  }
  const validTimer = validAbsentTimer(timer,now), expired = validTimer && new Date(timer.due_at) <= new Date(now);
  const historyRelevant = history.verified === true && Number(history.previous_absences || 0) > 0;
  const priorSlot = events.filter(e => e.canonical_order_id === order.canonical_order_id && e.direction === 'INBOUND' && e.relevance_status === 'CURRENT_ORDER_EXACT_MATCH'
    && attempt.event_at && new Date(e.created_at) < new Date(attempt.event_at)).some(e => Boolean(interpretAbsentResponse(e).requested_date));
  const afterSlot = attempt.status === 'SECOND_ABSENCE' && priorSlot;
  let action, step, reason, requirement;
  if (latest) {
    step = 'LOGISTICS_VALIDATION_REQUIRED'; action = 'WOULD_VALIDATE_LOGISTICS'; reason = response.reason_code;
    requirement = {RESCHEDULE_DELIVERY:'RESCHEDULE',PICKUP_AT_AGENCY:'PICKUP',RETURN_REQUEST:'RETURN',ADDRESS_CHANGE:'ADDRESS'}[response.customer_intent] || 'INTERPRET_RESPONSE';
    if (['UNCLEAR','CONTRADICTORY'].includes(response.customer_intent)) action = 'HUMAN_REVIEW_REQUIRED';
    if (response.customer_intent === 'CUSTOM_TIME_SLOT') { action='WOULD_REQUEST_CUSTOM_SLOT'; step='CUSTOMER_CONTACT_REQUIRED'; }
    if (response.customer_intent === 'ADDRESS_DATA_REQUEST' || response.customer_intent==='ADDRESS_CHANGE' && response.address_complete===false) { action='WOULD_REQUEST_ADDRESS_DATA'; step='CUSTOMER_CONTACT_REQUIRED'; requirement='INTERPRET_RESPONSE'; }
    if (response.customer_intent === 'RECOVERY_OPTIONS') { action='WOULD_SHOW_RECOVERY_OPTIONS'; step='CUSTOMER_CONTACT_REQUIRED'; }
  } else if (expired) { action='WOULD_RETURN_TO_ORIGIN'; step='LOGISTICS_VALIDATION_REQUIRED'; reason='EXISTING_48H_TIMER_EXPIRED'; requirement='RETURN'; }
  else if (validTimer) { action='HOLD_WAITING_CUSTOMER'; step='WAITING_CUSTOMER_RESPONSE'; reason='WAIT_EXISTING_CUSTOMER_TIMER'; requirement='WAIT'; }
  else if (attempt.status === 'FIRST_ABSENCE' && !chatby.template_contact_verified) { action='WOULD_SEND_ABSENT_TEMPLATE'; step='CUSTOMER_CONTACT_REQUIRED'; reason='FIRST_ABSENCE_CONTACT_REQUIRED'; requirement='CONTACT'; }
  else if (attempt.status === 'SECOND_ABSENCE') { action='WOULD_VALIDATE_LOGISTICS'; step='LOGISTICS_VALIDATION_REQUIRED'; reason=afterSlot?'DELIVERY_FAILED_AFTER_CUSTOMER_SLOT':'SECOND_ABSENCE_AGENCY_PRIORITY'; requirement='PICKUP'; }
  else { action='WOULD_CREATE_OR_REQUIRE_48H_TIMER'; step='CUSTOMER_CONTACT_REQUIRED'; reason='ABSENT_48H_TIMER_MISSING'; requirement='CONTACT'; }
  const logistics = validateAbsentLogistics({issue,order,chatby,gls,response,now,requirement});
  const reasons = [...logistics.reasons];
  if (eventIdConflict) reasons.push('CHATBY_EVENT_ID_CONTENT_CONFLICT');
  if (followUp && !sameConversation) reasons.push('ABSENT_FOLLOWUP_IDENTITY_NOT_VERIFIED');
  if (['ABSENCE_ATTEMPT_UNKNOWN','ABSENCE_ATTEMPT_CONFLICT'].includes(attempt.status)) reasons.push(attempt.status);
  if (!['EXACT','VERIFIED'].includes(order.identity_status)) reasons.push('CURRENT_ORDER_IDENTITY_NOT_VERIFIED');
  if (issue.status !== 'PENDING' || issue.is_active !== true) reasons.push('ISSUE_NOT_ACTIVE_PENDING');
  if (cause.interpreted_type !== 'RECIPIENT_ABSENT') { reasons.push(cause.secondary_reason); action='HUMAN_REVIEW_REQUIRED'; step='HUMAN_REVIEW_REQUIRED'; reason=cause.secondary_reason; }
  if (policy.registry_required && (!policy.policy_id || policy.policy_snapshot_hash !== ABSENT_POLICY_HASH || policy.status !== 'SHADOW')) reasons.push('POLICY_NOT_PERSISTED');
  if (action === 'WOULD_SEND_ABSENT_TEMPLATE' && chatby.template_status !== 'APPROVED') reasons.push('ABSENT_TEMPLATE_APPROVAL_NOT_VERIFIED');
  if (latest && ['UNCLEAR','CONTRADICTORY'].includes(response.customer_intent)) reasons.push(response.reason_code);
  if (latest && scoped.some(e => e !== latest && new Date(e.created_at).getTime() === new Date(latest.created_at).getTime()
    && absentHash([interpretAbsentResponse(e).customer_intent,interpretAbsentResponse(e).requested_date,interpretAbsentResponse(e).requested_time_window,interpretAbsentResponse(e).time_from,interpretAbsentResponse(e).time_to])!==absentHash([response.customer_intent,response.requested_date,response.requested_time_window,response.time_from,response.time_to]))) reasons.push('CONFLICTING_SIMULTANEOUS_RESPONSES');
  const conditionalAction = action;
  if (latest && logistics.status === 'FEASIBLE' && !reasons.length && requirement !== 'INTERPRET_RESPONSE') { action={RESCHEDULE:'WOULD_REQUEST_NEW_DELIVERY',PICKUP:'WOULD_REQUEST_PICKUP_AT_AGENCY',RETURN:'WOULD_RETURN_TO_ORIGIN',ADDRESS:'WOULD_REQUEST_ADDRESS_CHANGE'}[requirement]; step='WAITING_EXECUTION'; }
  if (reasons.length) {
    action='HUMAN_REVIEW_REQUIRED'; step='HUMAN_REVIEW_REQUIRED';
    reason=cause.interpreted_type!=='RECIPIENT_ABSENT'?cause.secondary_reason:reasons[0];
  }
  const waiting = !reasons.length && validTimer && !expired && !latest && chatbyCurrent && step === 'WAITING_CUSTOMER_RESPONSE';
  const responseHash = latest ? absentHash([latest.chatby_message_id,response.raw_customer_text_hash,latest.created_at]) : null;
  const resolution=input.resolutionContext ? absentResolutionPreflight({...input,...input.resolutionContext,
    order:{...order,observed_at:input.resolutionContext.order_observed_at}},now):null;
  const resolutionPanel=resolution?recipientAbsentResolutionPanel(resolution,null,input.resolutionContext.runtime_blockers):null;
  const snapshot = {implementation_version:'ABSENT_RESOLUTION_20260922',resolution:resolutionPanel,issue_id:issue.canonical_issue_id,issue_version:issue.updated_at,order_id:order.canonical_order_id,issue_status:issue.status,is_active:issue.is_active,order_state:order.canonical_state,
    template:{name:ABSENT_TEMPLATE_NAME,body_hash:absentHash(ABSENT_TEMPLATE_BODY),mapping_hash:absentHash([ABSENT_TEMPLATE_BUTTONS,ABSENT_BUTTONS])},
    flow:followUp ? {selection_event_hash:selection.chatby_message_id || null,option:flowChoice,identity_verified:Boolean(sameConversation)} : null,
    response_hash:responseHash,response:{intent:response.customer_intent,date:response.requested_date || null,window:response.requested_time_window || null,time_from:response.time_from || null,time_to:response.time_to || null},
    response_anchor:anchor,response_anchor_kind:anchorKind,attempt,cause,history:{verified:history.verified === true,previous_absences:Number(history.previous_absences || 0),orders_total:Number(history.orders_total || 0),delivered:Number(history.delivered || 0),return_to_origin:Number(history.return_to_origin || 0),pickup_at_agency:Number(history.pickup_at_agency || 0),recovery_success:Number(history.recovery_success || 0)},
    freshness:logistics.freshness,logistics,allowed_resolution_options:[...(issue.allowed_resolution_options || [])].sort(),retention_deadline:issue.carrier_retention_deadline || gls.retention_deadline || null,
    timer:timer?{timer_id:timer.timer_id,due_at:timer.due_at,status:timer.status,expired}:null,policy_version:'RECIPIENT_ABSENT_POLICY_V1',policy_snapshot_hash:policy.policy_snapshot_hash || ABSENT_POLICY_HASH,current_step:step,simulation_action:action};
  const snapshotHash=absentHash(snapshot),decisionId=absentHash([issue.canonical_issue_id,'RECIPIENT_ABSENT_POLICY_V1',snapshotHash]);
  const solution = response.customer_intent==='RESCHEDULE_DELIVERY'
    ? `Proponer nuevo intento ${response.requested_date} ${response.requested_time_window==='MORNING'?'por la mañana':response.requested_time_window==='AFTERNOON'?'por la tarde':'en la disponibilidad indicada'}; pendiente de validación logística.`
    : response.customer_intent==='CUSTOM_TIME_SLOT' ? 'Esperando selección de fecha del cliente.'
      : response.customer_intent==='ADDRESS_DATA_REQUEST' || response.address_complete===false ? 'Esperando nuevos datos de entrega.'
        : response.customer_intent==='RECOVERY_OPTIONS' ? 'Esperando elección: otro día, datos de entrega o recogida en agencia.' : null;
  const preparedFlow = absentFollowUpPreparation(response.button_pressed || (followUp && (response.customer_intent==='ADDRESS_DATA_REQUEST' || response.address_complete===false) ? flowChoice : null), latest ? {
    order_id:order.canonical_order_id,issue_id:issue.canonical_issue_id,conversation_hash:latest.chatby_conversation_id_hash || null,
    customer_hash:latest.chatby_contact_id_hash || null,selection_event_hash:(followUp?selection:latest).chatby_message_id || null,
    selected_at:(followUp?selection:latest).created_at,notification_at:chatby.incident_notified_at || null
  } : {});
  const requiredFreshness=[logistics.freshness.dropea,logistics.freshness.chatby,...(['RESCHEDULE','PICKUP','RETURN','ADDRESS'].includes(requirement)?[logistics.freshness.gls]:[])];
  const shadow = {decision_id:decisionId,policy_id:policy.policy_id || null,policy_version:'RECIPIENT_ABSENT_POLICY_V1',policy_snapshot_hash:policy.policy_snapshot_hash || ABSENT_POLICY_HASH,snapshot_status:policy.policy_id?'PERSISTED':'NOT_PERSISTED',
    current_step:step,next_action:action,trace:['ABSENT_DETECTED',...(latest?['CUSTOMER_RESPONSE_RECEIVED','RESPONSE_INTERPRETED']:['CUSTOMER_CONTACT_REQUIRED']),...(step==='WAITING_CUSTOMER_RESPONSE'?['WAITING_CUSTOMER_RESPONSE']:[]),...(['LOGISTICS_VALIDATION_REQUIRED','WAITING_EXECUTION'].includes(step)?['LOGISTICS_VALIDATION_REQUIRED']:[]),...(step==='WAITING_EXECUTION'?['RESOLUTION_PROPOSED','WAITING_EXECUTION']:[]),...(step==='HUMAN_REVIEW_REQUIRED'?['HUMAN_REVIEW_REQUIRED']:[])],
    reason_code:reason,reason_text:reasons.length?[...new Set(reasons)].join(' · '):reason,blocking_reasons:[...new Set(reasons)],waiting_customer:waiting,
    customer_response_status:chatbyCurrent?latest?'RESPONDED':'NO_RESPONSE':'NOT_VERIFIABLE',customer_intent:response.customer_intent,requested_date:response.requested_date || null,requested_time_window:response.requested_time_window || null,time_from:response.time_from || null,time_to:response.time_to || null,all_day:response.all_day || false,pickup_requested:response.pickup_requested || false,button_pressed:response.button_pressed || null,
    absence_attempt:attempt.status,delivery_attempt_number:attempt.number,...cause,history_relevant:historyRelevant,customer_operational_history:snapshot.history,delivery_failed_after_customer_slot:afterSlot,logistics_preference:attempt.status==='SECOND_ABSENCE'||historyRelevant?'AGENCY_PICKUP_PREFERRED':null,
    logistics_feasibility:logistics.status,logistics_capabilities:logistics,decision_confidence:reasons.length?0:response.confidence,simulation_action:action,conditional_proposal:conditionalAction,simulation_status:action==='HUMAN_REVIEW_REQUIRED'?'HUMAN_REVIEW_REQUIRED':'SIMULATION_READY',
    existing_timer:timer,due_at:timer?.due_at || null,data_freshness:logistics.freshness,effective_freshness_status:requiredFreshness.includes('STALE')?'STALE':requiredFreshness.includes('UNKNOWN')?'UNKNOWN':'FRESH',
    input_snapshot:snapshot,input_snapshot_hash:snapshotHash,scoped_customer_message_hash:latest?.chatby_message_id || null,scoped_customer_activity_at:latest?.created_at || null,response_anchor_kind:anchorKind,
    source_observed_at:{dropea:issue.last_successful_sync_at || issue.observed_at || null,chatby:chatby.observed_at || null,gls:gls.observed_at || null},
    concrete_solution:solution,prepared_subflow:preparedFlow,resolution:resolutionPanel,
    recovery_flow_status:response.customer_intent==='CUSTOM_TIME_SLOT'?'WAITING_DATE':response.customer_intent==='ADDRESS_DATA_REQUEST'||response.address_complete===false?'WAITING_DELIVERY_DATA':response.customer_intent==='RECOVERY_OPTIONS'?'WAITING_RECOVERY_CHOICE':null,
    prepared_response:preparedFlow?.text || null,prepared_response_action:preparedFlow?'WOULD_SEND_RESPONSE':null,template_name:ABSENT_TEMPLATE_NAME,
    notification_event_key:absentHash([issue.canonical_issue_id,ABSENT_TEMPLATE_NAME,issue.created_at]),live_flags:ABSENT_LIVE_FLAGS,executed:false,external_action:false,production_write:false};
  shadow.logistics_execution=absentLogisticsExecutionGate({shadow,previousExecution:input.previousExecution});
  const previousIntents=latest?scoped.slice(0,-1).map(e=>({intent:interpretAbsentResponse(e).customer_intent,button:absentButtonFor(e)?.payload || null,event_hash:e.chatby_message_id || null,at:e.created_at})):[];
  const interpretation={canonical_issue_id:issue.canonical_issue_id,canonical_order_id:order.canonical_order_id,issue_version:issue.updated_at,has_customer_replied:Boolean(latest),latest_inbound_message_at:latest?.created_at || null,latest_relevant_message_hash:responseHash,customer_intent:response.customer_intent,previous_intents:previousIntents,intent_changed:previousIntents.some(e=>e.intent!==response.customer_intent || e.button && response.button_pressed && e.button!==response.button_pressed),contradiction:response.customer_intent==='CONTRADICTORY',requested_date:shadow.requested_date,requested_time_window:shadow.requested_time_window,requested_detail:null,requested_address_present:response.customer_intent==='ADDRESS_CHANGE',pickup_requested:shadow.pickup_requested,return_requested:response.customer_intent==='RETURN_REQUEST',discount_accepted:false,discount_rejected:false,conversation_quality:chatbyCurrent?'SUPPORTED':'SOURCE_UNAVAILABLE',interpretation_confidence:shadow.decision_confidence,interpretation_summary:shadow.reason_text,messages_used:latest?scoped.length:0,messages_ignored:events.length-(latest?scoped.length:0),missing_information:shadow.blocking_reasons,freshness:logistics.freshness.chatby,interpreted_at:new Date(now).toISOString()};
  const decision={decision_id:decisionId,policy_version:shadow.policy_version,policy_ids:[shadow.policy_version],process_status:shadow.simulation_status,simulated_decision:shadow.simulation_status,simulated_action:{action_type:action,...shadow},proposed_resolution:null,proposed_resolution_allowed:logistics.status==='FEASIBLE',gls_feasibility:{...logistics,feasible:logistics.status==='FEASIBLE'},blocking_reasons:shadow.blocking_reasons,risk:reasons.length?'HIGH':'MEDIUM',qa_result:reasons.length?'BLOCKED':'PASS',requires_human_review:reasons.length>0,timer:createdTimer,discount:null,absent_shadow:shadow,execution_available:false,external_write_attempted:false,mode:'SIMULATION_ONLY',run_mode:'SHADOW_READ_ONLY',actions_executed:0,production_writes:0,messages_sent:0,dropea_write_requests:0,chatby_write_requests:0,gls_write_requests:0,issues_resolved:0};
  return {interpretation,decision,shadow};
}
