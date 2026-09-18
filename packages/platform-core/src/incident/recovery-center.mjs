// A read-only lens over the existing policies and observed events, not an executor.
export const RECOVERY_KPIS = Object.freeze([
  ['PENDING', 'Pendientes reales', 'package'], ['CUSTOMER_ACTED', 'Cliente actuó', 'message'],
  ['RECOVERABLE_NOW', 'Recuperables ahora', 'retry'], ['WAITING_CUSTOMER', 'Esperando cliente', 'clock'],
  ['WAITING_SULEIA', 'Esperando acción Suleia', 'task'], ['RETURN_RISK', 'Cerca de devolución', 'warning'],
  ['RECOVERED', 'Recuperados', 'check'], ['DELIVERED_AFTER_INCIDENT', 'Entregados tras incidencia', 'truck'],
  ['RETURNED', 'Devueltos', 'return'], ['EVIDENCE_UNCERTAIN', 'Evidencia no concluyente', 'search']
]);
export const RECOVERY_EVENT_ALIASES = Object.freeze({
  INCIDENT_DETECTED: 'INCIDENT_OPENED', RECOVERY_CONTACT_SENT: 'CHATBY_MESSAGE_SENT',
  CUSTOMER_RESPONSE: 'CUSTOMER_REPLIED', RECOVERY_PROPOSED: 'DECISION_PROPOSED',
  RECOVERY_VERIFIED: 'ACTION_VERIFIED', DELIVERED_AFTER_INCIDENT: 'GLS_DELIVERED', RETURNED: 'GLS_RETURNED'
});
const ms = value => value ? new Date(value).getTime() : NaN;
const validTime = (value, now) => Number.isFinite(ms(value)) && ms(value) <= ms(now);
const fold = value => String(value || '').normalize('NFC').toUpperCase().replace(/[\s_]+/g, ' ').trim();
const later = (a, b) => Number.isFinite(ms(a)) && Number.isFinite(ms(b)) && ms(a) > ms(b);
const initialConfirmation = value => /^CONFIRMAR(?: MI)? PEDIDO[.!]?$/u.test(fold(value));
const recoverableTypes = new Set(['RECIPIENT_ABSENT','REFUSED_BY_RECIPIENT','ADDRESS_INCORRECT','PENDING_DATA']);

export function recoveryProjection(item, { now = new Date(), nearReturnSeconds = 10800 } = {}) {
  const clock = new Date(now).toISOString(), c = item.customer_evidence || {}, s = item.absent_shadow;
  const created = item.created_at, notified = item.incident_notified_at;
  const active = item.status === 'PENDING' && item.is_active === true;
  const exact = item.conversation_status === 'FOUND';
  const lifecycle = String(item.recovery_order_state || item.lifecycle_status || item.order_status || '').toUpperCase();
  const template = item.latest_customer_context_template || '';
  const messageBound = Boolean(item.scoped_customer_message_hash && item.latest_private_customer_message_hash
    && item.scoped_customer_message_hash === item.latest_private_customer_message_hash);
  const scoped = exact && messageBound && validTime(notified, clock) && ms(notified) >= ms(created)
    && later(c.at, notified) && validTime(c.at, clock) && item.chatby_sync_current === true
    && item.scoped_response_status !== 'NOT_VERIFIABLE'
    && ['AFTER_NOTIFICATION','AFTER_INCIDENT'].includes(c.relation)
    && !template.startsWith('dropea_pedido_') && !initialConfirmation(c.latest_message)
    && !['ORDER_LIFECYCLE_ONLY','BEFORE_INCIDENT','BEFORE_NOTIFICATION','NOTIFICATION_NOT_OBSERVED'].includes(item.latest_customer_incident_relevance);
  const nonAction = ['UNKNOWN','UNCLEAR','CONTRADICTORY','NO_RESPONSE','NO_VALID_RESPONSE','NOT_VERIFIABLE','NO_CONVERSATION','SHADOW_RESPONSE','SHADOW_NO_RESPONSE'];
  const customerActed = scoped && !nonAction.includes(String(c.code || 'UNKNOWN'));
  // Observing a reply/button and understanding its business intent are separate.
  // An ambiguous reply must be visible, but must not authorize a recovery action.
  const interactionObserved = scoped && Boolean(c.latest_message);
  const noActionVerified = exact && item.chatby_sync_current === true
    && validTime(notified, clock) && ms(notified) >= ms(created)
    && item.scoped_response_status === 'NO_VALID_RESPONSE'
    && c.code === 'NO_VALID_RESPONSE' && !interactionObserved;
  const d = item.discount_recovery || {};
  const offerVerified = d.delivery_verified === true && item.discount_signal_quality === 'VERIFIED'
    && validTime(d.sent_at, clock) && ms(d.sent_at) >= ms(created);
  const discountReplyVerified = offerVerified && later(d.responded_at, d.sent_at) && validTime(d.responded_at, clock);
  const superseded = scoped && later(c.at, d.responded_at)
    && !['DISCOUNT_ACCEPTED','DELIVERY_RETRY','CONFIRM'].includes(c.code);
  const discountAccepted = discountReplyVerified && d.status === 'DISCOUNT_ACCEPTED' && !superseded;
  const discountRejected = discountReplyVerified && d.status === 'DISCOUNT_REJECTED';
  // The real signal is independently exact-order/issue-bound at the SQL join.
  const discountActed = discountReplyVerified && exact && item.chatby_sync_current === true
    && validTime(notified, clock) && ms(notified)>=ms(created) && later(d.responded_at, notified)
    && (['DISCOUNT_ACCEPTED','DISCOUNT_REJECTED'].includes(d.status)
      || customerActed && later(c.at,d.sent_at));
  const acted = customerActed || discountActed;
  const deliveredAt = item.recovery_delivered_at, returnedAt = item.recovery_returned_at;
  // Reuse the canonical Dropea outcome timestamps, as the existing finance
  // projection does. Raw FINISHED/REJECTED labels are preserved, not redefined.
  const returned = validTime(returnedAt, clock) && ms(returnedAt) >= ms(created);
  const delivered = !returned && validTime(deliveredAt, clock) && ms(deliveredAt) >= ms(created);
  const returnedUnknownDate = ['RETURNED','RETURN_TO_ORIGIN'].includes(lifecycle) && !returned;
  const requestedReturn = item.resolution_status === 'RETURN_REQUESTED';
  const officialRecovery = recoverableTypes.has(item.interpreted_type) && item.status === 'RESOLVED'
    && ['RETRY','CHANGE_ADDRESS','PROVIDE_SOLUTION','PICKUP_AT_AGENCY'].includes(item.resolution_status);
  const recovered = officialRecovery && !requestedReturn && !returned && !['RETURNED','RETURN_TO_ORIGIN','REJECTED','CANCELLED'].includes(lifecycle);
  const redelivery = officialRecovery && item.resolution_status === 'RETRY';
  const intent = s?.customer_intent || c.intent || c.code;
  const address = c.address_instruction || item.tailored_recommendation?.prepared_dropea_solution?.address;
  const completeAddress = acted && ['ADDRESS_CHANGE','CHANGE_ADDRESS','PROVIDE_MISSING_DATA'].includes(intent)
    && (address?.complete === true || address?.actionable_correction === true);
  const collectingData = acted && (['CUSTOM_TIME_SLOT','ADDRESS_DATA_REQUEST','RECOVERY_OPTIONS'].includes(intent)
    || Boolean(s?.recovery_flow_status) || address?.has_address_data===true && !completeAddress);
  const preference = acted && intent === 'RESCHEDULE_DELIVERY' && Boolean(s?.requested_date)
    || acted && c.code === 'DELIVERY_RETRY' && Boolean(c.delivery_instruction?.requested_day);
  const recoveryEvidence = !collectingData && (preference || completeAddress || discountAccepted && discountActed);
  const sourceCurrent = item.dropea_sync_current === true && item.chatby_sync_current === true;
  const gls = String(item.carrier || '').toUpperCase() === 'GLS';
  const allowed = item.allowed_resolution_options || [];
  const capability = completeAddress ? allowed.some(v=>['CHANGE_ADDRESS','PROVIDE_SOLUTION'].includes(v))
    : allowed.some(v => ['RETRY','PROVIDE_SOLUTION'].includes(v));
  const policyReady = s ? item.notification_decision_current===true && s.simulation_status === 'SIMULATION_READY' && s.logistics_feasibility === 'FEASIBLE'
    : ['PASS','READY'].includes(item.effective_qa_status) && item.currently_blocked !== true;
  const returnIntent = customerActed && ['REJECT','RETURN_REQUEST','FINAL_REJECTION'].includes(c.code)
    && (!discountAccepted || later(c.at,d.responded_at));
  const recoverable = active && recoveryEvidence && sourceCurrent && gls && capability && policyReady && !returnIntent && !requestedReturn
    && !delivered && !returned && !['DELIVERED','FINISHED','RETURNED','RETURN_TO_ORIGIN','REJECTED','CANCELLED'].includes(lifecycle) && item.contradiction!==true;
  const waitingSuleia = active && acted && !collectingData && !requestedReturn && !returnIntent;
  const contacted = validTime(notified, clock) && ms(notified) >= ms(created) || offerVerified;
  const noReplyVerified = item.scoped_response_status === 'NO_VALID_RESPONSE' && item.chatby_sync_current === true && exact;
  const waiting = active && (collectingData || contacted && !acted && (noReplyVerified || offerVerified && d.status === 'NO_RESPONSE'));
  // discount_due_at is offer eligibility, NEVER the response/return deadline.
  const deadline = item.interpreted_type === 'REFUSED_BY_RECIPIENT' && offerVerified
    ? item.discount_response_deadline || null : s?.due_at || item.timer_due_at || null;
  const deadlineValid = validTime(deadline, '9999-12-31T00:00:00Z') && ms(deadline) >= ms(created);
  const remaining = deadlineValid ? Math.max(0, Math.floor((ms(deadline)-ms(clock))/1000)) : null;
  const timerLive = item.interpreted_type === 'REFUSED_BY_RECIPIENT' && offerVerified
    ? Boolean(item.discount_response_deadline) : (s?.existing_timer?.status || item.timer_status) === 'ACTIVE';
  const risk = active && !acted && waiting && deadlineValid && timerLive && remaining <= nearReturnSeconds;
  const uncertain = !sourceCurrent || !exact || !notified || !acted && !noReplyVerified && !offerVerified || returnedUnknownDate;
  const flags = { PENDING:active, CUSTOMER_ACTED:interactionObserved || discountActed, RECOVERABLE_NOW:recoverable, WAITING_CUSTOMER:waiting,
    WAITING_SULEIA:waitingSuleia, RETURN_RISK:risk, RECOVERED:recovered,
    DELIVERED_AFTER_INCIDENT:delivered, RETURNED:returned, CONTACTED:contacted,
    REDELIVERY:redelivery && recovered, EVIDENCE_UNCERTAIN:Boolean(uncertain) };
  const status = returned ? 'RETURNED' : delivered ? 'DELIVERED_AFTER_INCIDENT' : recovered ? 'RECOVERED'
    : requestedReturn ? 'RETURN_REQUESTED' : recoverable ? 'RECOVERABLE_NOW' : collectingData && active ? 'WAITING_CUSTOMER'
      : waitingSuleia ? 'WAITING_SULEIA' : risk ? 'RETURN_RISK' : waiting ? 'WAITING_CUSTOMER'
        : uncertain ? 'EVIDENCE_UNCERTAIN' : active && !contacted ? 'CONTACT_PENDING' : 'UNRESOLVED';
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { score += points; reasons.push({points,reason}); };
  if (acted) add(35,'Respuesta válida posterior a esta incidencia');
  if (recoveryEvidence) add(25,'Información útil para recuperar el pedido');
  if (recoverable) add(20,'Fuentes, capacidad y decisión vigente permiten propuesta');
  if (discountAccepted && discountActed) add(10,'Aceptación del descuento posterior a la oferta');
  if (acted && ms(clock)-Math.max(ms(c.at)||0,ms(d.responded_at)||0)<3600000) add(5,'Respuesta observada hace menos de una hora');
  if (deadlineValid && remaining>nearReturnSeconds) add(5,'Margen de tiempo antes del deadline real');
  if (s?.absence_attempt === 'SECOND_ABSENCE') add(-10,'Segunda ausencia: requiere mayor cautela');
  if (uncertain) add(-20,'Fuentes o relación temporal no verificadas');
  if (!active || requestedReturn || returnIntent) add(-score,'Sin oportunidad comercial activa: cierre, devolución solicitada o intención explícita');
  let solution = item.tailored_recommendation || {};
  if (!acted && (initialConfirmation(c.latest_message) || template.startsWith('dropea_pedido_')
    || c.at && !scoped && !['SHADOW_RESPONSE','SHADOW_NO_RESPONSE'].includes(c.code))) {
    solution={code:'VERIFY_CURRENT_INCIDENT_EVIDENCE',title:'Validar la respuesta de ESTA incidencia antes de proponer recuperación',
      summary:'El mensaje observado no está vinculado inequívocamente al aviso actual. No se utiliza la confirmación inicial ni un mensaje de otro contexto.',
      resolution_option:null,prepared_dropea_solution:null,execution_status:'NOT_EXECUTED',
      steps:['Comprobar pedido, incidencia y conversación exactos','Localizar la notificación real y un mensaje posterior válido','Reevaluar la propuesta con la política vigente'],
      reasoning:'FOUND no demuestra respuesta; faltan las condiciones canónicas de evidencia.',guardrail:'No trasladar una instrucción sin vinculación ni ejecutar desde la vista.'};
  }
  if (item.interpreted_type === 'REFUSED_BY_RECIPIENT' && active) {
    const code = returnIntent ? 'REVIEW_EXPLICIT_RETURN_POLICY' : discountAccepted ? 'VERIFY_DISCOUNT_AND_REDELIVERY'
      : discountRejected ? 'REEVALUATE_RETURN_POLICY' : offerVerified && d.status === 'NO_RESPONSE' ? 'WAIT_DISCOUNT_POLICY_TIMER'
        : offerVerified ? 'REVIEW_DISCOUNT_RESPONSE' : 'CHECK_REJECTION_RECOVERY';
    const title = returnIntent ? 'Reevaluar devolución explícita según la política vigente'
      : discountAccepted ? 'Verificar importe/etiqueta con descuento y preparar nueva entrega'
        : discountRejected ? 'Reevaluar devolución tras rechazo expreso del descuento'
          : offerVerified && d.status === 'NO_RESPONSE' ? 'Esperar el deadline real del descuento; revalidar al vencer'
            : offerVerified ? 'Revisar respuesta no concluyente a la oferta' : 'Comprobar elegibilidad y contacto antes de ofrecer 5 €';
    solution={code,title,summary:title,resolution_option:null,prepared_dropea_solution:null,execution_status:'NOT_EXECUTED',
      steps:discountAccepted?['Revalidar aceptación posterior al descuento y ausencia de cancelación posterior','Comprobar importe/etiqueta con descuento y opciones reales de GLS/Dropea','Proponer reintento únicamente según la política vigente']
        :returnIntent || discountRejected?['Revalidar la intención explícita posterior y el estado actual del pedido','Evaluar la devolución únicamente en el ejecutor gobernado con la política vigente']
          :offerVerified?['Esperar respuesta y consultar el deadline real del ejecutor','Al vencer, releer conversación, pedido e incidencia antes de reevaluar']
            :['Comprobar elegibilidad real, contacto de rechazo y ausencia de respuesta válida','Comprobar que no se envió ya la oferta','Dejar el envío al automatismo gobernado vigente'],
      reasoning:`Oferta verificada: ${offerVerified?'sí':'no'}; respuesta posterior a la oferta: ${discountReplyVerified?'sí':'no'}; devolución solicitada: ${requestedReturn?'sí':'no'}. La política de Render es la autoridad, no el timer shadow antiguo.`,
      guardrail:'La vista no ejecuta nada. Render conserva la política real; una oferta sin respuesta no equivale a rechazo.'};
  }
  const discountStatus = !offerVerified ? d.status === 'NOT_SENT' ? 'NOT_OFFERED' : 'EVIDENCE_UNCERTAIN'
    : discountAccepted ? recovered ? 'RECOVERED' : 'ACCEPTED' : discountRejected ? 'REJECTED'
      : d.status === 'OTHER_RESPONSE' ? 'INCONCLUSIVE_RESPONSE'
        : deadlineValid && remaining===0 ? 'EXPIRED' : 'WAITING_RESPONSE';
  return {...item, tailored_recommendation:solution,recovery:{status,flags,score:Math.max(0,Math.min(100,score)),score_reasons:reasons,
    priority:waitingSuleia?1:recoverable && deadlineValid && remaining<=nearReturnSeconds?2:risk?4:waiting?5:6,
    eligible_type:recoverableTypes.has(item.interpreted_type),contacted,contact_at:notified || (offerVerified?d.sent_at:null),
    recovered_at:recovered?item.recovery_verified_at || null:null,delivered_at:delivered?deliveredAt:null,returned_at:returned?returnedAt:null,
    redelivery_verified:redelivery,return_requested:requestedReturn,source_current:sourceCurrent,
    measurement:{template_name:item.incident_notification_template || null,
      template_version:(item.incident_notification_template || '').match(/_v(\d+)$/)?.[1] || null,
      sent_at:validTime(notified,clock)?notified:null,customer_response:acted,
      response_at:customerActed?c.at:discountActed?d.responded_at:null,
      recovered,delivered,returned},
    evidence:{conversation:exact?'EXACT':item.conversation_status || 'UNKNOWN',validity:acted?'VALID':interactionObserved?'INCONCLUSIVE':noActionVerified?'VERIFIED_NO_ACTION':'NOT_VERIFIABLE',
      customer_acted:interactionObserved || discountActed,valid_response:acted,no_action_verified:noActionVerified && !discountActed,
      display_status:interactionObserved || discountActed?'ACTION_OBSERVED':noActionVerified?'NO_ACTION':'NOT_VERIFIABLE',
      message:scoped?c.latest_message || null:null,response_at:interactionObserved?c.at:discountActed?d.responded_at:null,
      message_type:interactionObserved?item.latest_private_customer_message_type || item.scoped_customer_message_type || null:null,
      action_label:interactionObserved?c.title || null:discountActed?d.status==='DISCOUNT_ACCEPTED'?'Descuento aceptado':'Descuento rechazado':null,
      read_at:item.incident_conversation_read_at || null,
      template:template || item.incident_notification_template || null,notification_at:notified || null,
      reason:initialConfirmation(c.latest_message)?'INITIAL_ORDER_CONFIRMATION_NOT_INCIDENT_RESPONSE':interactionObserved || discountActed?'EXACT_POST_NOTIFICATION_RESPONSE':noActionVerified?'NO_CUSTOMER_INPUT_AFTER_OBSERVED_NOTIFICATION':item.scoped_response_reason || 'NO_VERIFIED_INCIDENT_RESPONSE'},
    discount:{status:discountStatus,sent_at:offerVerified?d.sent_at:null,responded_at:discountReplyVerified?d.responded_at:null,amount_eur:offerVerified?item.discount_amount_eur:null,
      next_step:discountAccepted && !recovered?'REDELIVERY_PENDING':null},
    timer:{deadline:deadlineValid?deadline:null,state:deadlineValid?timerLive?remaining===0?'EXPIRED':'ACTIVE':'INACTIVE':'UNAVAILABLE',remaining_seconds:remaining,
      policy_reason:item.interpreted_type==='REFUSED_BY_RECIPIENT' && offerVerified?'REAL_RENDER_DISCOUNT_RESPONSE_DEADLINE_REQUIRED':s?.policy_version || item.policy_version || 'POLICY_NOT_AVAILABLE',
      near_threshold_seconds:nearReturnSeconds},execution_enabled:false,derived_at:clock}};
}

// This exact selector is consumed by BOTH counters and filtered rows.
export function recoverySelector(item, key) { return item.recovery?.flags?.[key] === true; }
const day = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function recoveryBaseSelector(item, filters = {}) {
  const scope = filters.scope || 'ACTIVE';
  if (scope==='ACTIVE' && !recoverySelector(item,'PENDING') || scope==='HISTORICAL' && recoverySelector(item,'PENDING')) return false;
  for(const [key,field] of [['type','interpreted_type'],['risk','effective_risk'],['response','operational_response_status'],['discount_response','discount_recovery_response_status'],['status','status'],['mapping','mapping_status'],['freshness','operational_freshness_status']])
    if(filters[key] && item[field]!==filters[key]) return false;
  if(filters.active && item.is_active!==(filters.active==='true'))return false;
  if(filters.month && day(item.created_at).slice(0,7)!==filters.month)return false;
  if(filters.from && day(item.created_at)<filters.from || filters.to && day(item.created_at)>filters.to)return false;
  if(filters.q && ![item.canonical_issue_id,item.dropea_issue_id,item.canonical_order_id,item.dropea_order_id].includes(filters.q))return false;
  if(filters.template && item.recovery.evidence.template!==filters.template && item.incident_notification_template!==filters.template)return false;
  if(filters.recovery_status && item.recovery.status!==filters.recovery_status)return false;
  if(filters.priority && item.recovery.priority!==Number(filters.priority))return false;
  if(filters.timer && item.recovery.timer.state!==filters.timer)return false;
  if(filters.client_acted && recoverySelector(item,'CUSTOMER_ACTED')!==(filters.client_acted==='true'))return false;
  if(filters.recoverable && recoverySelector(item,'RECOVERABLE_NOW')!==(filters.recoverable==='true'))return false;
  if(filters.absent){
    if(item.normalized_type!=='RECIPIENT_ABSENT')return false;
    const s=item.absent_shadow || {};
    const mapping={FIRST_ABSENCE:s.absence_attempt==='FIRST_ABSENCE',SECOND_ABSENCE:s.absence_attempt==='SECOND_ABSENCE',ABSENCE_ATTEMPT_UNKNOWN:s.absence_attempt==='ABSENCE_ATTEMPT_UNKNOWN',STALE:item.effective_freshness_status==='STALE',WAITING_CUSTOMER:s.waiting_customer===true,CUSTOMER_RESPONDED:recoverySelector(item,'CUSTOMER_ACTED'),RESCHEDULE_REQUESTED:s.customer_intent==='RESCHEDULE_DELIVERY',PICKUP_REQUESTED:s.customer_intent==='PICKUP_AT_AGENCY',LOGISTICS_VALIDATION_REQUIRED:s.current_step==='LOGISTICS_VALIDATION_REQUIRED',HUMAN_REVIEW_REQUIRED:s.simulation_status==='HUMAN_REVIEW_REQUIRED',SIMULATION_READY:s.simulation_status==='SIMULATION_READY',AUSENTE:true};
    if(!mapping[filters.absent])return false;
  }
  return true;
}
function rate(numerator, denominator) { return denominator ? numerator/denominator*100 : null; }
function unique(items, predicate) { return new Set(items.filter(predicate).map(i=>i.canonical_order_id)).size; }
export function recoveryMetrics(items) {
  const incidents=items.length,orders=unique(items,()=>true),contacted=unique(items,i=>i.recovery.contacted);
  const replied=unique(items,i=>i.recovery.contacted && recoverySelector(i,'CUSTOMER_ACTED'));
  const eligible=unique(items,i=>i.recovery.eligible_type), recovered=unique(items,i=>recoverySelector(i,'RECOVERED'));
  const delivered=unique(items,i=>recoverySelector(i,'DELIVERED_AFTER_INCIDENT')),returned=unique(items,i=>recoverySelector(i,'RETURNED'));
  const redelivery=unique(items,i=>recoverySelector(i,'REDELIVERY'));
  const verifiedResponseOrders=unique(items,i=>i.recovery.contacted && (recoverySelector(i,'CUSTOMER_ACTED')
    || i.chatby_sync_current===true && i.conversation_status==='FOUND' && i.scoped_response_status==='NO_VALID_RESPONSE'));
  const responses=items.filter(i=>recoverySelector(i,'CUSTOMER_ACTED') && validTime(i.first_valid_response_at,i.recovery.derived_at)
    && later(i.first_valid_response_at,i.recovery.contact_at));
  const recoveries=items.filter(i=>recoverySelector(i,'RECOVERED') && validTime(i.recovery.recovered_at,i.recovery.derived_at) && later(i.recovery.recovered_at,i.created_at));
  const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {incidents,orders,contacted,replied,eligible,recovered,redelivery,delivered,returned,
    response_rate:verifiedResponseOrders===contacted?rate(replied,contacted):null,
    response_observed_rate:rate(replied,contacted),response_evidence_coverage:verifiedResponseOrders,response_evidence_total:contacted,
    recovery_rate:recovered?rate(recovered,eligible):null,delivery_rate:rate(delivered,orders),return_rate:rate(returned,orders),
    mean_response_seconds:average(responses.map(i=>(ms(i.first_valid_response_at)-ms(i.recovery.contact_at))/1000)),
    mean_recovery_seconds:average(recoveries.map(i=>(ms(i.recovery.recovered_at)-ms(i.created_at))/1000)),
    response_duration_coverage:responses.length,recovery_duration_coverage:recoveries.length,
    uncertain_incidents:items.filter(i=>recoverySelector(i,'EVIDENCE_UNCERTAIN')).length,
    contact_missing_event:contacted===0 && incidents>0?'N/D — falta contacto observado':null,
    response_missing_event:replied===0 && verifiedResponseOrders<contacted?'N/D — falta evidencia de respuesta/silencio verificado':null,
    recovery_missing_event:recovered===0?'N/D — falta evento de recuperación verificada':null,
    redelivery_missing_event:redelivery===0?'N/D — falta evento de nueva entrega verificada':null,
    denominator_definition:'KPIs: incidencias únicas. Tasas: pedidos únicos en cohorte de creación de incidencia (Europe/Madrid), resultado observado hasta la lectura; elegibles por tipología de recuperación, no permiso de ejecución. Respuesta: respondieron y contactados / contactados. Entrega/devolución: hitos posteriores con fecha real / pedidos con incidencia. Duraciones: solo primeras respuestas y recuperaciones con timestamp real; cobertura explícita.'};
}
export function buildRecoveryOverview(items, {filters={},now=new Date(),limit=25,offset=0,availableMonths=[]}={}) {
  const scope=String(filters.scope || 'ACTIVE').toUpperCase();
  filters={...filters,scope:['ACTIVE','HISTORICAL','ALL'].includes(scope)?scope:'ACTIVE'};
  const hours=Number(filters.near_return_hours || 3),nearReturnSeconds=Number.isFinite(hours)&&hours>=0.25&&hours<=72?Math.round(hours*3600):10800;
  const projected=items.map(i=>recoveryProjection(i,{now,nearReturnSeconds}));
  const base=projected.filter(i=>recoveryBaseSelector(i,filters));
  const selected=base.filter(i=>!filters.recovery || recoverySelector(i,filters.recovery));
  selected.sort((a,b)=>a.recovery.priority-b.recovery.priority || b.recovery.score-a.recovery.score || ms(b.updated_at)-ms(a.updated_at) || String(a.canonical_issue_id).localeCompare(String(b.canonical_issue_id)));
  const kpis=RECOVERY_KPIS.map(([key,label,icon])=>({key,label,icon,count:base.filter(i=>recoverySelector(i,key)).length}));
  const group=(field)=>[...new Set(base.map(field))].filter(Boolean).map(key=>({key,...recoveryMetrics(base.filter(i=>field(i)===key))}));
  return {items:selected.slice(offset,offset+limit),total:selected.length,limit,offset,summary:{scope:filters.scope,universe_count:base.length,
    kpis,metrics:recoveryMetrics(base),by_type:group(i=>i.interpreted_type),by_template:group(i=>i.incident_notification_template || null),
    absent_filters:Object.fromEntries(['AUSENTE','FIRST_ABSENCE','SECOND_ABSENCE','ABSENCE_ATTEMPT_UNKNOWN','STALE','WAITING_CUSTOMER','CUSTOMER_RESPONDED','RESCHEDULE_REQUESTED','PICKUP_REQUESTED','LOGISTICS_VALIDATION_REQUIRED','HUMAN_REVIEW_REQUIRED','SIMULATION_READY'].map(key=>[key,base.filter(i=>recoveryBaseSelector(i,{scope:'ALL',absent:key})).length])),
    available_months:availableMonths,selected_recovery:filters.recovery || null,near_threshold_seconds:nearReturnSeconds,
    last_sync_at:base.map(i=>i.panel_updated_at || i.updated_at).filter(Boolean).sort((a,b)=>ms(b)-ms(a))[0] || null,
    denominator_definition:recoveryMetrics(base).denominator_definition},actions_executed:0,production_writes:0,customer_messages_sent:0};
}

export function recoveryMessageValidity(message) {
  return initialConfirmation(message.text) || String(message.context_template_slug || '').startsWith('dropea_pedido_')
    ? 'ORDER_LIFECYCLE_ONLY' : message.relation_to_notification || 'NOT_VERIFIABLE';
}
export function recoveryTimeline(item, events=[], messages=[]) {
  const order=item.canonical_order_id,issue=item.canonical_issue_id,now=item.recovery?.derived_at || new Date().toISOString();
  const entries=events.filter(e=>e.canonical_order_id===order && (!e.canonical_issue_id || e.canonical_issue_id===issue)
    && validTime(e.occurred_at,now)).map(e=>({...e,source:e.event_source || e.source || 'UNKNOWN',label:e.event_type,observed:true}));
  if(validTime(item.created_at,now))entries.push({timeline_event_id:`incident:${issue}`,occurred_at:item.created_at,source:'DROPEA',label:'Incidencia detectada',event_type:'INCIDENT_OPENED',observed:true});
  for(const m of messages){if(!validTime(m.occurred_at,now))continue;
    entries.push({timeline_event_id:m.chatby_message_id_hash || `${m.direction}:${m.occurred_at}:${m.message_type}`,occurred_at:m.occurred_at,source:m.direction==='OUTBOUND'?'SULEIA / CHATBY':'CLIENTE',label:m.text,event_type:m.message_type,
      template:m.context_template_slug || null,validity:recoveryMessageValidity(m),observed:true});
  }
  if(validTime(item.recovery?.delivered_at,now))entries.push({timeline_event_id:`delivered:${order}`,occurred_at:item.recovery.delivered_at,source:'DROPEA',label:'Entregado después de la incidencia',event_type:'GLS_DELIVERED',observed:true});
  if(validTime(item.recovery?.returned_at,now))entries.push({timeline_event_id:`returned:${order}`,occurred_at:item.recovery.returned_at,source:'DROPEA',label:'Pedido devuelto',event_type:'GLS_RETURNED',observed:true});
  return [...new Map(entries.map(e=>[e.timeline_event_id,e])).values()].sort((a,b)=>ms(a.occurred_at)-ms(b.occurred_at));
}
