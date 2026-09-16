import { absentHash, ABSENT_BUTTONS, ABSENT_FUTURE_RESPONSES, ABSENT_LIVE_FLAGS, ABSENT_TEMPLATE_NAME } from './absent-template.mjs';
import { createIncidentTimer, INCIDENT_RESPONSE_HOURS } from './incident-timers.mjs';
import { GLS_POLICY_VERSION } from './gls-policies.mjs';
import { evaluateGlsDeliveryDate } from './gls-calendar.mjs';

export const RECIPIENT_ABSENT_POLICY_V1 = 'RECIPIENT_ABSENT_POLICY_V1';
export const ABSENT_STEPS = Object.freeze(['ABSENT_DETECTED', 'CUSTOMER_CONTACT_REQUIRED',
  'WAITING_CUSTOMER_RESPONSE', 'CUSTOMER_RESPONSE_RECEIVED', 'RESPONSE_INTERPRETED',
  'LOGISTICS_VALIDATION_REQUIRED', 'RESOLUTION_PROPOSED', 'WAITING_EXECUTION']);
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const DAY = 86_400_000;
function madridDay(at) {
  if (at instanceof Date) at = at.toISOString();
  if (!at || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(String(at)) || !Number.isFinite(new Date(at).getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(day, days) { return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10); }
function buttonFor(event) {
  const payload = event.button_payload || event.payload?.payload || event.payload?.button_reply?.id || event.interactive?.button_reply?.id;
  const exact = ABSENT_BUTTONS.find(b => b.payload === payload);
  if (exact) return exact;
  // Text-only providers require an exact approved label, never fuzzy matching.
  return ABSENT_BUTTONS.find(b => fold(b.text) === fold(event.raw_text || event.button_text || event.payload?.title));
}
export function interpretAbsentResponse(event = {}) {
  const button = buttonFor(event);
  const text = fold(event.raw_text || event.sanitized_text);
  const base = { customer_intent: 'UNCLEAR', requested_date: null, requested_time_window: null,
    time_from: null, time_to: null, all_day: false, pickup_requested: false, button_pressed: button?.payload || null,
    raw_customer_text_hash: absentHash(event.raw_text || event.sanitized_text || ''), confidence: 0, reason_code: 'AMBIGUOUS_CUSTOMER_RESPONSE' };
  const day = madridDay(event.created_at);
  let intent = null;
  const returnIntent = /\b(devuelvelo|quiero devolverlo|quiero devolver|no lo quiero|no quiero (?:el |este |mi )?pedido|cancelalo)\b/.test(text);
  const addressIntent = /\b(cambia|cambiar|cambio)\b.*\b(direccion|domicilio)\b/.test(text);
  const pickupIntent = button?.payload === 'ABSENT_PICKUP_AGENCY' || /\b(recoger|recogida)\b.*\b(agencia|oficina)\b/.test(text);
  const receiveIntent = button && ['ABSENT_TOMORROW_AM','ABSENT_TOMORROW_PM'].includes(button.payload)
    || /\b(manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|esta tarde|recibir|reparto)\b/.test(text);
  if (/\bno (?:estoy|estare|puedo|podre|hay|habra|quiero recoger|quiero cambiar|cambies|vengas|entregues|quiero recibir)\b/.test(text)) return {...base,reason_code:'NEGATED_OR_CORRECTED_CUSTOMER_REQUEST'};
  if ([returnIntent, addressIntent, pickupIntent, Boolean(receiveIntent)].filter(Boolean).length > 1) return { ...base, customer_intent: 'CONTRADICTORY', reason_code: 'CONTRADICTORY_CUSTOMER_RESPONSE' };
  if (returnIntent) intent = 'RETURN_REQUEST';
  else if (addressIntent) intent = 'ADDRESS_CHANGE';
  else if (pickupIntent) intent = 'PICKUP_AT_AGENCY';
  else if (button?.payload === 'ABSENT_OTHER_SLOT') intent = 'CUSTOM_TIME_SLOT';
  if (intent) return { ...base, customer_intent: intent, pickup_requested: intent === 'PICKUP_AT_AGENCY', confidence: 1, reason_code: 'EXPLICIT_CUSTOMER_INTENT' };
  if (!day) return { ...base, reason_code: 'CUSTOMER_MESSAGE_TIMESTAMP_NOT_VERIFIED' };
  const weekdays = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  const selected = weekdays.filter(w => new RegExp(`\\b${w}\\b`).test(text));
  if (selected.length > 1 || /\b(o|quizas|tal vez|puede que)\b/.test(text)) return base;
  let date = null;
  if (button?.payload?.startsWith('ABSENT_TOMORROW') || /\bmanana\b/.test(text.replace(/por la manana/g, ''))) date = addDays(day, 1);
  if (selected.length === 1) {
    if (date) return base;
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    date = addDays(day, (weekdays.indexOf(selected[0]) - weekday + 7) % 7 || 7);
  }
  if (text.includes('esta tarde')) date = day;
  const clocks = [...text.matchAll(/(?:las?\s+|\b)(\d{1,2}):(\d{2})\b/g)];
  const bare = !clocks.length ? text.match(/a partir de las?\s+(\d{1,2})\b/) : null;
  if (clocks.length > 1 || (bare && Number(bare[1]) < 13)) return base;
  const from = clocks[0] ? `${clocks[0][1].padStart(2,'0')}:${clocks[0][2]}` : bare ? `${bare[1].padStart(2,'0')}:00` : null;
  if (from && (Number(from.slice(0,2)) > 23 || Number(from.slice(3)) > 59)) return base;
  const morning = button?.payload === 'ABSENT_TOMORROW_AM' || /por la manana/.test(text);
  const afternoon = button?.payload === 'ABSENT_TOMORROW_PM' || /por la tarde|esta tarde/.test(text);
  if (morning && afternoon) return base;
  const allDay = text.includes('todo el dia');
  const window = allDay ? 'ALL_DAY' : morning ? 'MORNING' : afternoon ? 'AFTERNOON' : from ? 'FROM_TIME' : null;
  if (!date || !window) return base;
  return { ...base, customer_intent: 'RESCHEDULE_DELIVERY', requested_date: date, requested_time_window: window,
    time_from: from, all_day: allDay, confidence: 1, reason_code: 'EXACT_CUSTOMER_SLOT' };
}
export function classifyAbsenceAttempt({ issue = {}, timeline = [] }) {
  const number = String(issue.delivery_attempt_number || '').toUpperCase();
  if (['1','FIRST','FIRST_ATTEMPT'].includes(number)) return { status: 'FIRST_ABSENCE', source: 'DROPEA_EXPLICIT_ATTEMPT', event_at: issue.created_at };
  if (['2','SECOND','SECOND_ATTEMPT'].includes(number)) return { status: 'SECOND_ABSENCE', source: 'DROPEA_EXPLICIT_ATTEMPT', event_at: issue.created_at };
  const verified = timeline.filter(e => e.normalized_type === 'RECIPIENT_ABSENT' && e.verified === true && e.event_id && madridDay(e.event_at));
  const events = [...new Map(verified.map(e => [e.event_id, e])).values()].sort((a,b) => new Date(a.event_at)-new Date(b.event_at));
  if (events.length === 2) return { status: 'SECOND_ABSENCE', source: 'VERIFIED_ORDER_TIMELINE', event_at: events.at(-1).event_at };
  // A single observed event does not prove the history is complete.
  return { status: 'ABSENCE_ATTEMPT_UNKNOWN', source: 'INSUFFICIENT_ATTEMPT_EVIDENCE', event_at: null };
}
export function validateAbsentLogistics({ issue, order, chatby, gls = {}, response, now }) {
  const reasons = [];
  const nowMs = new Date(now).getTime();
  const fresh = at => at && Number.isFinite(new Date(at).getTime()) && nowMs-new Date(at).getTime() >= 0 && nowMs-new Date(at).getTime() <= 900_000;
  if (!fresh(issue.last_successful_sync_at || issue.observed_at)) reasons.push('DROPEA_READ_STALE_OR_UNKNOWN');
  if (!chatby.verified || !fresh(chatby.observed_at)) reasons.push('CHATBY_READ_NOT_VERIFIABLE');
  if (!fresh(gls.observed_at)) reasons.push('GLS_READ_STALE_OR_UNKNOWN');
  if (issue.mapping_status !== 'MAPPED' || (issue.initial_carrier_code === 'NAM' && issue.raw_type !== 'RECIPIENT_ABSENT')) reasons.push('ABSENT_MAPPING_NOT_VERIFIED');
  if (issue.carrier !== 'GLS') reasons.push('CARRIER_POLICY_NOT_GLS');
  const retention = issue.carrier_retention_deadline || gls.retention_deadline;
  if (!retention || !Number.isFinite(new Date(retention).getTime())) reasons.push('RETENTION_NOT_VERIFIED');
  if (!['VERIFIED','DECLARED'].includes(issue.capability_status) || gls.capability_status !== 'VERIFIED') reasons.push('CARRIER_CAPABILITY_NOT_VERIFIED');
  const terminal = ['DELIVERED','FINISHED','FINISH','PAID','RETURNED','CANCELLED','REJECTED','REFUSED','REFUSED_LOST_DAMAGED','LOST_DAMAGED','ERROR'].includes(order.canonical_state);
  if (terminal || gls.package_operable === false || retention && new Date(retention).getTime() <= nowMs) return { status: 'NOT_FEASIBLE', reasons: [...reasons, 'PACKAGE_NOT_OPERABLE'] };
  if (gls.package_operable !== true) reasons.push('PACKAGE_OPERABILITY_UNKNOWN');
  const option = { RESCHEDULE_DELIVERY: 'RETRY', PICKUP_AT_AGENCY: 'PICKUP_AT_AGENCY', RETURN_REQUEST: 'RETURN_REQUESTED', ADDRESS_CHANGE: 'CHANGE_ADDRESS' }[response.customer_intent];
  if (option && !(issue.allowed_resolution_options || []).includes(option)) reasons.push('RESOLUTION_OPTION_NOT_ALLOWED');
  if (response.pickup_requested && !(gls.pickup_point_verified && gls.package_available_for_pickup)) reasons.push('PICKUP_POINT_NOT_VERIFIED');
  if (response.requested_date) {
    const today = madridDay(new Date(now).toISOString());
    if (response.requested_date < today || retention && response.requested_date > madridDay(new Date(retention).toISOString())) return { status: 'NOT_FEASIBLE', reasons: [...reasons, 'REQUESTED_DATE_NOT_VIABLE'] };
    // Reuse the existing governed calendar without changing the requested date.
    const calendar=evaluateGlsDeliveryDate({now,requestedDate:response.requested_date,holidays:gls.holidays || []});
    if (!calendar.feasible) return {status:'NOT_FEASIBLE',reasons:[...reasons,...calendar.reason]};
    if (gls.calendar_verified!==true) reasons.push('DELIVERY_CALENDAR_NOT_VERIFIED');
  }
  return { status: reasons.length ? reasons.some(r => r.includes('STALE')) ? 'STALE_DATA' : 'UNKNOWN' : 'FEASIBLE', reasons };
}
export function simulateRecipientAbsent(input, { now = new Date() } = {}) {
  const { issue, order, events = [], chatby = {}, gls = {}, history = {}, previousTimer = null, timeline = [] } = input;
  if (issue.type !== 'RECIPIENT_ABSENT') throw new Error('ABSENT_POLICY_OUT_OF_SCOPE');
  const scoped = events.filter(e => e.canonical_issue_id === issue.canonical_issue_id
    && (!e.canonical_order_id || e.canonical_order_id === order.canonical_order_id)
    && !['ORDER_LIFECYCLE_ONLY','DISCOUNT_RESPONSE','BEFORE_INCIDENT'].includes(e.incident_relevance)
    && e.relevance_status === 'CURRENT_ORDER_EXACT_MATCH' && e.direction === 'INBOUND'
    && Number.isFinite(new Date(e.created_at).getTime()) && new Date(e.created_at) >= new Date(issue.created_at || issue.updated_at)
    && new Date(e.created_at) <= new Date(now)).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
  const latest = scoped.at(-1);
  const response = latest ? interpretAbsentResponse(latest) : { customer_intent: 'NO_RESPONSE', confidence: 1 };
  const attempt = classifyAbsenceAttempt({ issue, timeline });
  const historyRelevant = history.verified === true && Number(history.previous_absences || 0) > 0;
  let timer = previousTimer;
  if (!timer && chatby.verified && !latest && issue.status === 'PENDING' && issue.is_active) timer = createIncidentTimer({
    timerType: 'CUSTOMER_INITIAL_RESPONSE_48H', orderId: order.canonical_order_id,
    issueId: issue.canonical_issue_id, issueVersion: issue.updated_at,
    relevantEventId: issue.source_event_id || `poll:${issue.canonical_issue_id}:${issue.updated_at}`,
    policyVersion: GLS_POLICY_VERSION, startedAt: issue.updated_at, durationHours: INCIDENT_RESPONSE_HOURS });
  const expired = timer?.status === 'ACTIVE' && new Date(timer.due_at) <= new Date(now);
  const effectiveResponse = expired && !latest ? { customer_intent: 'RETURN_REQUEST' } : response;
  const logistics = validateAbsentLogistics({ issue, order, chatby, gls, response: effectiveResponse, now });
  const reasons = [...logistics.reasons];
  if (latest && scoped.filter(e => new Date(e.created_at).getTime() === new Date(latest.created_at).getTime())
    .some(e => interpretAbsentResponse(e).customer_intent !== response.customer_intent)) reasons.push('CONFLICTING_SIMULTANEOUS_RESPONSES');
  let action = 'HOLD_WAITING_CUSTOMER';
  let step = 'WAITING_CUSTOMER_RESPONSE';
  let reason = 'WAIT_EXISTING_CUSTOMER_TIMER';
  let preference = attempt.status === 'SECOND_ABSENCE' || historyRelevant ? 'AGENCY_PICKUP_PREFERRED' : null;
  const priorSlot = events.filter(e => e.canonical_order_id === order.canonical_order_id && e.relevance_status === 'CURRENT_ORDER_EXACT_MATCH' && e.direction === 'INBOUND')
    .map(e => ({ e, r: interpretAbsentResponse(e) })).find(x => x.r.requested_date && attempt.event_at && new Date(x.e.created_at)<new Date(attempt.event_at));
  const afterSlot = attempt.status === 'SECOND_ABSENCE' && Boolean(priorSlot);
  if (afterSlot) preference = 'AGENCY_PICKUP_PREFERRED';
  if (latest) {
    step = 'LOGISTICS_VALIDATION_REQUIRED';
    action = 'WOULD_VALIDATE_LOGISTICS'; reason = response.reason_code;
    if (['UNCLEAR','CONTRADICTORY'].includes(response.customer_intent)) { action = 'HUMAN_REVIEW_REQUIRED'; reasons.push(response.reason_code); }
    else if (response.customer_intent === 'CUSTOM_TIME_SLOT') action = 'WOULD_REQUEST_CUSTOM_SLOT';
    else if (logistics.status === 'FEASIBLE') {
      action = { RESCHEDULE_DELIVERY: 'WOULD_REQUEST_NEW_DELIVERY', PICKUP_AT_AGENCY: 'WOULD_REQUEST_PICKUP_AT_AGENCY', RETURN_REQUEST: 'WOULD_RETURN_TO_ORIGIN', ADDRESS_CHANGE: 'WOULD_REQUEST_ADDRESS_CHANGE' }[response.customer_intent] || 'HUMAN_REVIEW_REQUIRED';
      step = 'WAITING_EXECUTION';
    }
  } else if (expired) { action = 'WOULD_RETURN_TO_ORIGIN'; step = 'LOGISTICS_VALIDATION_REQUIRED'; reason = 'EXISTING_48H_TIMER_EXPIRED'; }
  else if (attempt.status === 'FIRST_ABSENCE' && !chatby.template_contact_verified) { action = 'WOULD_SEND_ABSENT_TEMPLATE'; step = 'CUSTOMER_CONTACT_REQUIRED'; reason = 'FIRST_ABSENCE_CONTACT_REQUIRED'; }
  else if (attempt.status === 'SECOND_ABSENCE') { action = 'WOULD_VALIDATE_LOGISTICS'; step = 'LOGISTICS_VALIDATION_REQUIRED'; reason = afterSlot ? 'DELIVERY_FAILED_AFTER_CUSTOMER_SLOT' : 'SECOND_ABSENCE_AGENCY_PRIORITY'; }
  if (attempt.status === 'ABSENCE_ATTEMPT_UNKNOWN') reasons.push('ABSENCE_ATTEMPT_UNKNOWN');
  if (!['EXACT','VERIFIED'].includes(order.identity_status)) reasons.push('CURRENT_ORDER_IDENTITY_NOT_VERIFIED');
  if (issue.status !== 'PENDING' || issue.is_active !== true) reasons.push('ISSUE_NOT_ACTIVE_PENDING');
  // No slot or route is invented. Even waiting/contact proposals are blocked if
  // source evidence is unavailable. The conditional intention remains visible.
  const conditionalAction = action;
  if (reasons.length || logistics.status !== 'FEASIBLE') { action = 'HUMAN_REVIEW_REQUIRED'; step = 'LOGISTICS_VALIDATION_REQUIRED'; }
  const snapshot = { issue_id: issue.canonical_issue_id, issue_version: issue.updated_at, order_id: order.canonical_order_id,
    issue_status: issue.status, is_active: issue.is_active, order_state: order.canonical_state,
    response_hash: latest ? absentHash([latest.chatby_message_id, response.raw_customer_text_hash, latest.created_at]) : null,
    response: { intent: response.customer_intent, date: response.requested_date || null, window: response.requested_time_window || null, time_from: response.time_from || null },
    attempt, history: { verified: history.verified === true, previous_absences: Number(history.previous_absences || 0), return_to_origin: Number(history.return_to_origin || 0), pickup_at_agency: Number(history.pickup_at_agency || 0), recovery_success: Number(history.recovery_success || 0), orders_total: Number(history.orders_total || 0), delivered: Number(history.delivered || 0) },
    freshness: { dropea: logistics.reasons.includes('DROPEA_READ_STALE_OR_UNKNOWN') ? 'STALE_DATA' : 'FRESH', chatby: logistics.reasons.includes('CHATBY_READ_NOT_VERIFIABLE') ? 'UNKNOWN' : 'FRESH', gls: logistics.reasons.includes('GLS_READ_STALE_OR_UNKNOWN') ? 'STALE_DATA' : 'FRESH' },
    logistics, allowed_resolution_options: [...(issue.allowed_resolution_options || [])].sort(),
    capability_status: issue.capability_status || 'UNKNOWN', retention_deadline: issue.carrier_retention_deadline || gls.retention_deadline || null,
    timer: timer ? { timer_id: timer.timer_id, due_at: timer.due_at, status: timer.status, expired } : null,
    policy_version: RECIPIENT_ABSENT_POLICY_V1, current_step: step, simulation_action: action };
  const snapshotHash = absentHash(snapshot);
  const decisionId=absentHash([issue.canonical_issue_id, RECIPIENT_ABSENT_POLICY_V1, snapshotHash]);
  const shadow = Object.freeze({ decision_id:decisionId, policy_version: RECIPIENT_ABSENT_POLICY_V1, current_step: step, next_action: action,
    trace: ['ABSENT_DETECTED', ...(latest ? ['CUSTOMER_RESPONSE_RECEIVED','RESPONSE_INTERPRETED','LOGISTICS_VALIDATION_REQUIRED'] : ['CUSTOMER_CONTACT_REQUIRED','WAITING_CUSTOMER_RESPONSE']),
      ...(step === 'WAITING_EXECUTION' ? ['RESOLUTION_PROPOSED','WAITING_EXECUTION'] : [])],
    reason_code: reason, reason_text: reasons.length ? reasons.join(' · ') : reason,
    blocking_reasons: [...new Set(reasons)], waiting_customer: !latest && !expired || response.customer_intent==='CUSTOM_TIME_SLOT',
    customer_response_status: chatby.verified ? latest ? 'RESPONDED' : 'NO_RESPONSE' : 'NOT_VERIFIABLE',
    customer_intent: response.customer_intent, requested_date: response.requested_date || null,
    requested_time_window: response.requested_time_window || null, time_from: response.time_from || null,
    time_to: response.time_to || null, all_day: response.all_day || false, pickup_requested: response.pickup_requested || false,
    button_pressed: response.button_pressed || null, absence_attempt: attempt.status,
    history_relevant: historyRelevant, customer_operational_history: snapshot.history,
    delivery_failed_after_customer_slot: afterSlot, logistics_preference: preference, logistics_feasibility: logistics.status,
    decision_confidence: reasons.length ? 0 : response.confidence, simulation_action: action,
    conditional_proposal: conditionalAction, simulation_status: action === 'HUMAN_REVIEW_REQUIRED' ? 'HUMAN_REVIEW_REQUIRED' : 'SIMULATION_READY',
    existing_timer: timer, due_at: timer?.due_at || null, data_freshness: snapshot.freshness,
    input_snapshot: snapshot, input_snapshot_hash: snapshotHash,
    prepared_response: response.button_pressed ? ABSENT_FUTURE_RESPONSES[response.button_pressed] : null,
    prepared_response_action: response.button_pressed ? 'WOULD_SEND_RESPONSE' : null,
    template_name: ABSENT_TEMPLATE_NAME, live_flags: ABSENT_LIVE_FLAGS,
    executed: false, external_action: false, production_write: false });
  const interpretation = { canonical_issue_id: issue.canonical_issue_id, canonical_order_id: order.canonical_order_id,
    issue_version: issue.updated_at, has_customer_replied: Boolean(latest), latest_inbound_message_at: latest?.created_at || null,
    latest_relevant_message_hash: snapshot.response_hash, customer_intent: response.customer_intent, previous_intents: [],
    intent_changed: false, contradiction: response.customer_intent === 'CONTRADICTORY', requested_date: shadow.requested_date,
    requested_time_window: shadow.requested_time_window, requested_detail: null, requested_address_present: response.customer_intent === 'ADDRESS_CHANGE',
    pickup_requested: shadow.pickup_requested, return_requested: response.customer_intent === 'RETURN_REQUEST', discount_accepted: false, discount_rejected: false,
    conversation_quality: chatby.verified ? 'SUPPORTED' : 'SOURCE_UNAVAILABLE', interpretation_confidence: shadow.decision_confidence,
    interpretation_summary: shadow.reason_text, messages_used: scoped.length, messages_ignored: events.length-scoped.length,
    missing_information: shadow.blocking_reasons, freshness: shadow.data_freshness.chatby, interpreted_at: new Date(now).toISOString() };
  const decision = { decision_id: decisionId,
    policy_version: RECIPIENT_ABSENT_POLICY_V1, policy_ids: [RECIPIENT_ABSENT_POLICY_V1],
    process_status: shadow.simulation_status, simulated_decision: shadow.simulation_status,
    simulated_action: { action_type: action, ...shadow }, proposed_resolution: null,
    proposed_resolution_allowed: logistics.status === 'FEASIBLE', gls_feasibility: { ...logistics, feasible: logistics.status === 'FEASIBLE' },
    blocking_reasons: shadow.blocking_reasons, risk: reasons.length ? 'HIGH' : 'MEDIUM', qa_result: reasons.length ? 'BLOCKED' : 'PASS',
    requires_human_review: reasons.length > 0, timer: previousTimer ? null : timer, discount: null, absent_shadow: shadow,
    execution_available: false, external_write_attempted: false, mode: 'SIMULATION_ONLY', run_mode: 'SHADOW_READ_ONLY',
    actions_executed: 0, production_writes: 0, messages_sent: 0, dropea_write_requests: 0, chatby_write_requests: 0, gls_write_requests: 0, issues_resolved: 0 };
  return { interpretation, decision, shadow };
}
