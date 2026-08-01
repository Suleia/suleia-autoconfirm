import crypto from 'node:crypto';
import { evaluateGlsDeliveryDate } from './gls-calendar.mjs';
import { GLS_POLICY_IDS, GLS_POLICY_VERSION } from './gls-policies.mjs';
import { createIncidentTimer, INCIDENT_RESPONSE_HOURS } from './incident-timers.mjs';
import { prepareDiscountOffer } from './discount-workflow.mjs';
import { maskText } from '../masking.mjs';

const RESOLUTION_OPTION = Object.freeze({
  RETRY: 'RETRY', CHANGE_ADDRESS: 'CHANGE_ADDRESS', PICKUP_AT_AGENCY: 'PICKUP_AT_AGENCY',
  RETURN_REQUESTED: 'RETURN_REQUESTED', SOLUTION_PROVIDED: 'PROVIDE_SOLUTION',
  MANAGING_WITH_CLIENT: 'MANAGED_BY_CLIENT'
});

function stableKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function proposal(resolution, resolutionData = null, note = null) {
  if (!resolution) return null;
  const output = { status: 'RESOLVED', resolution_status: resolution };
  if (resolutionData?.address) {
    output.resolution_data = {
      address: Object.fromEntries(Object.keys(resolutionData.address).map((key) => [key, '[ADDRESS REDACTED]']))
    };
    output.ephemeral_rebuild_required = true;
  } else if (resolutionData) output.resolution_data = resolutionData;
  if (note) output.resolution_note_sanitized = maskText(String(note).slice(0, 500));
  return output;
}

function inferProposal(input, calendar) {
  const { issue, chatby = {}, gls = {} } = input;
  const intent = chatby.intent || 'UNKNOWN';
  if (['ADMINISTRATIVE_ISSUE', 'CUSTOMS_ISSUE'].includes(issue.type) && gls.carrier_managing === true) {
    return { state: 'CARRIER_MANAGING', resolution: null, contact_customer: false, risk: 'LOW' };
  }
  if (intent === 'RETURN' || (issue.type === 'REFUSED_BY_RECIPIENT' && chatby.rejection_explicit === true)) {
    return { state: 'SOLUTION_READY', resolution: 'RETURN_REQUESTED', risk: 'MEDIUM' };
  }
  if (issue.type === 'RECIPIENT_ABSENT') {
    if (intent === 'RECEIVE' && chatby.fresh === true) {
      return {
        state: 'SOLUTION_READY', resolution: 'RETRY', risk: gls.delivery_attempt_number >= 2 || gls.delivery_attempt_number === 'UNKNOWN' ? 'HIGH' : 'MEDIUM',
        data: { date: chatby.requested_date || calendar.earliest_operational_date, time_window: chatby.requested_time_window || 'afternoon' }
      };
    }
    return { state: 'WAITING_CUSTOMER_RESPONSE', resolution: null, risk: 'LOW', start_timer: true };
  }
  if (issue.type === 'ADDRESS_INCORRECT' && chatby.intent === 'CHANGE_ADDRESS' && chatby.address_validated === true) {
    return { state: 'SOLUTION_READY', resolution: 'CHANGE_ADDRESS', risk: 'HIGH', data: { address: chatby.supplied_address } };
  }
  if (issue.type === 'PENDING_DATA' && chatby.required_data_validated === true) {
    return { state: 'SOLUTION_READY', resolution: 'SOLUTION_PROVIDED', risk: 'HIGH', note: chatby.solution_note_sanitized, runtime_status: 'RUNTIME_UNVERIFIED_FOR_GLS_ES' };
  }
  if (issue.type === 'REFUSED_BY_RECIPIENT' && intent === 'RECEIVE' && chatby.fresh === true) {
    return {
      state: 'SOLUTION_READY', resolution: 'RETRY', risk: 'HIGH',
      data: { date: chatby.requested_date || calendar.earliest_operational_date, time_window: chatby.requested_time_window || 'afternoon' }
    };
  }
  if (issue.type === 'REFUSED_BY_RECIPIENT' && chatby.customer_response_status === 'NO_RESPONSE') {
    return { state: 'WAITING_CUSTOMER_RESPONSE', resolution: null, risk: 'MEDIUM', start_timer: true, prepare_discount: true };
  }
  if (chatby.intent === 'PICKUP_AT_AGENCY' && gls.pickup_point_verified && gls.package_available_for_pickup) {
    return { state: 'SOLUTION_READY', resolution: 'PICKUP_AT_AGENCY', risk: 'MEDIUM' };
  }
  return { state: 'WAITING_CUSTOMER_RESPONSE', resolution: null, risk: 'HIGH', start_timer: true };
}

export function simulateIncidentProcess(input, { now = new Date(), holidays = [] } = {}) {
  const { issue, order, identity, chatby = {}, gls = {}, sourceEventId } = input;
  const trace = [
    'ISSUE_RECEIVED', 'AUTHENTICITY_VALIDATED', 'EVENT_DEDUPLICATED', 'FULL_ISSUE_READ'
  ];
  if (issue.status !== 'PENDING' || issue.is_active !== true) {
    return Object.freeze({
      process_status: 'RECORDED_CLOSED', trace: [...trace, 'NOT_ACTIONABLE'], proposed_resolution: null,
      blocking_reasons: [], risk: 'LOW', qa_result: 'PASS', actions_executed: 0,
      production_writes: 0, messages_sent: 0, emails_sent: 0, discounts_applied: 0, run_mode: 'SIMULATION'
    });
  }
  trace.push('ISSUE_CLASSIFIED', 'GLS_CONTEXT_INTERPRETED', 'ALLOWED_RESOLUTIONS_READ', 'CHATBY_READ');
  const calendar = evaluateGlsDeliveryDate({ now, requestedDate: chatby.requested_date || null, holidays });
  const inferred = inferProposal(input, calendar);
  trace.push(chatby.customer_response_status === 'RESPONDED' ? 'CUSTOMER_RESPONSE_VALID' : 'CUSTOMER_RESPONSE_NOT_AVAILABLE');
  trace.push('SULEIA_POLICY_APPLIED', 'GLS_FEASIBILITY_VALIDATED', 'ALLOWED_RESOLUTION_VALIDATED', 'RISK_QA_VALIDATED');
  const option = inferred.resolution ? RESOLUTION_OPTION[inferred.resolution] : null;
  const allowed = !option || (issue.allowed_resolution_options || []).includes(option);
  const blockers = [];
  if (!['EXACT', 'VERIFIED'].includes(identity?.status)) blockers.push('IDENTITY_NOT_EXACT_OR_VERIFIED');
  if (String(issue.carrier).toUpperCase() !== 'GLS') blockers.push('CARRIER_POLICY_NOT_GLS');
  if (!allowed) blockers.push('PROPOSED_RESOLUTION_NOT_ALLOWED');
  if (inferred.resolution === 'RETRY' && !calendar.feasible) blockers.push('GLS_REQUESTED_DATE_NOT_FEASIBLE');
  if (inferred.resolution === 'RETRY' && issue.type === 'REFUSED_BY_RECIPIENT' && !(chatby.intent === 'RECEIVE' && chatby.fresh === true)) blockers.push('CURRENT_RECEIVE_EVIDENCE_REQUIRED_AFTER_REFUSAL');
  if (inferred.resolution === 'PICKUP_AT_AGENCY' && !(gls.pickup_point_verified && gls.package_available_for_pickup)) blockers.push('PICKUP_EVIDENCE_NOT_VERIFIED');
  if (inferred.runtime_status === 'RUNTIME_UNVERIFIED_FOR_GLS_ES') blockers.push('RUNTIME_UNVERIFIED_FOR_GLS_ES');
  if (chatby.contradiction_status && chatby.contradiction_status !== 'NONE') blockers.push('CHATBY_CONTRADICTION');
  if (chatby.fresh === false && inferred.resolution) blockers.push('CHATBY_EVIDENCE_STALE');

  const timer = inferred.start_timer ? createIncidentTimer({
    orderId: order.canonical_order_id,
    issueId: issue.canonical_issue_id,
    issueVersion: issue.updated_at,
    relevantEventId: sourceEventId,
    policyVersion: GLS_POLICY_VERSION,
    startedAt: issue.updated_at,
    durationHours: INCIDENT_RESPONSE_HOURS,
    previousTimer: input.previousTimer || null
  }) : null;
  const discount = inferred.prepare_discount ? prepareDiscountOffer({
    orderId: order.canonical_order_id,
    originalAmount: order.total_amount,
    reason: 'REFUSED_NO_RESPONSE',
    createdAt: now
  }) : null;
  const blocked = blockers.length > 0;
  const decisionId = stableKey([GLS_POLICY_VERSION, issue.canonical_issue_id, issue.updated_at, inferred.resolution || inferred.state]);
  const proposedPayload = blocked ? null : proposal(inferred.resolution, inferred.data, inferred.note);
  return Object.freeze({
    process_status: blocked ? 'HUMAN_REVIEW' : inferred.state,
    decision_id: decisionId,
    issue_id: issue.canonical_issue_id,
    order_id: order.canonical_order_id,
    trace,
    proposed_resolution: blocked ? null : inferred.resolution,
    proposed_payload: proposedPayload,
    proposed_resolution_allowed: allowed,
    contact_customer: inferred.contact_customer !== false,
    timer,
    discount,
    calendar,
    delivery_attempt_number: gls.delivery_attempt_number ?? 'UNKNOWN',
    policy_version: GLS_POLICY_VERSION,
    policy_ids: GLS_POLICY_IDS,
    risk: blocked ? 'HIGH' : inferred.risk,
    qa_result: blocked ? 'BLOCKED' : inferred.risk === 'HIGH' ? 'REVIEW' : 'PASS',
    blocking_reasons: blockers,
    requires_human_review: blocked || inferred.risk === 'HIGH',
    idempotency_key_preview: stableKey(['dropea-public-v0.1.0', String(input.market || 'ES'), inferred.resolution || 'NO_ACTION', issue.canonical_issue_id, decisionId, GLS_POLICY_VERSION]),
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0,
    emails_sent: 0,
    discounts_applied: 0,
    orders_confirmed: 0,
    orders_cancelled: 0,
    issues_resolved: 0,
    run_mode: 'SIMULATION'
  });
}
