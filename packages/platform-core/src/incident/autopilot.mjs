import crypto from 'node:crypto';
import {
  INCIDENT_AUTOPILOT_POLICY_NAME,
  INCIDENT_AUTOPILOT_POLICY_VERSION,
  incidentActionMode
} from './autopilot-policy.mjs';

export const AUTOPILOT_STATES = Object.freeze([
  'DETECTED', 'CONTEXT_LOADING', 'READY_FOR_DECISION', 'ACTION_PENDING',
  'ACTION_EXECUTING', 'ACTION_VERIFYING', 'WAITING_CUSTOMER', 'WAITING_TIMER',
  'CUSTOMER_ACTED', 'RECOVERABLE_NOW', 'WAITING_REDELIVERY',
  'WAITING_EXTERNAL_CONFIRMATION', 'RECOVERED', 'RETURN_ELIGIBLE',
  'RETURN_PENDING', 'RETURNED', 'RESOLVED', 'HUMAN_REVIEW', 'BLOCKED', 'ERROR'
]);

export const AUTOPILOT_ACTIONS = Object.freeze([
  'SEND_CHATBY_TEMPLATE', 'SEND_CHATBY_MESSAGE', 'REQUEST_REDELIVERY',
  'UPDATE_DELIVERY_DATA', 'APPLY_DISCOUNT', 'REQUEST_AGENCY_PICKUP',
  'REQUEST_RETURN', 'RESOLVE_INCIDENT'
]);

const TRANSITIONS = Object.freeze({
  DETECTED: ['CONTEXT_LOADING', 'BLOCKED', 'ERROR'],
  CONTEXT_LOADING: ['READY_FOR_DECISION', 'HUMAN_REVIEW', 'BLOCKED', 'ERROR'],
  READY_FOR_DECISION: ['ACTION_PENDING', 'WAITING_CUSTOMER', 'WAITING_TIMER', 'RECOVERABLE_NOW', 'RETURN_ELIGIBLE', 'HUMAN_REVIEW', 'BLOCKED', 'RESOLVED'],
  ACTION_PENDING: ['ACTION_EXECUTING', 'ACTION_VERIFYING', 'WAITING_CUSTOMER', 'WAITING_TIMER', 'HUMAN_REVIEW', 'BLOCKED', 'ERROR'],
  ACTION_EXECUTING: ['ACTION_VERIFYING', 'ERROR'],
  ACTION_VERIFYING: ['WAITING_CUSTOMER', 'WAITING_REDELIVERY', 'WAITING_EXTERNAL_CONFIRMATION', 'RECOVERED', 'RETURNED', 'HUMAN_REVIEW', 'ERROR'],
  WAITING_CUSTOMER: ['CUSTOMER_ACTED', 'READY_FOR_DECISION', 'RETURN_ELIGIBLE', 'RESOLVED', 'HUMAN_REVIEW', 'ERROR'],
  WAITING_TIMER: ['READY_FOR_DECISION', 'CUSTOMER_ACTED', 'RESOLVED', 'ERROR'],
  CUSTOMER_ACTED: ['RECOVERABLE_NOW', 'RETURN_ELIGIBLE', 'WAITING_CUSTOMER', 'HUMAN_REVIEW'],
  RECOVERABLE_NOW: ['ACTION_PENDING', 'HUMAN_REVIEW', 'BLOCKED'],
  WAITING_REDELIVERY: ['RECOVERED', 'RETURNED', 'HUMAN_REVIEW', 'ERROR'],
  WAITING_EXTERNAL_CONFIRMATION: ['RECOVERED', 'RETURNED', 'HUMAN_REVIEW', 'ERROR'],
  RECOVERED: ['RESOLVED', 'WAITING_REDELIVERY', 'RETURNED', 'HUMAN_REVIEW'],
  RETURN_ELIGIBLE: ['RETURN_PENDING', 'HUMAN_REVIEW', 'BLOCKED'],
  RETURN_PENDING: ['ACTION_VERIFYING', 'RETURNED', 'HUMAN_REVIEW', 'ERROR'],
  RETURNED: ['RESOLVED'],
  HUMAN_REVIEW: ['READY_FOR_DECISION', 'ACTION_PENDING', 'BLOCKED', 'RESOLVED'],
  BLOCKED: ['CONTEXT_LOADING', 'READY_FOR_DECISION', 'HUMAN_REVIEW', 'RESOLVED'],
  ERROR: ['CONTEXT_LOADING', 'READY_FOR_DECISION', 'HUMAN_REVIEW', 'BLOCKED'],
  RESOLVED: []
});

const FINAL_ORDER_STATES = new Set(['DELIVERED', 'FINISHED', 'RETURNED', 'RETURN_TO_ORIGIN', 'CANCELLED', 'REJECTED']);
const RETURN_INTENTS = new Set(['RETURN_REQUEST', 'FINAL_REJECTION', 'DISCOUNT_REJECTED']);
const AMBIGUOUS_INTENTS = new Set(['UNKNOWN', 'UNCLEAR', 'CONTRADICTORY', 'NOT_VERIFIABLE']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function iso(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function later(left, right) {
  const l = new Date(left).getTime(); const r = new Date(right).getTime();
  return Number.isFinite(l) && Number.isFinite(r) && l > r;
}

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function initialOrderConfirmation(value) {
  return /^CONFIRMAR(?: MI)? PEDIDO[.!]?$/u.test(fold(value));
}

export function customerActionForIncident({ interpretation = {}, evidence = {}, incident = {}, now = new Date() } = {}) {
  const incidentAt = incident.created_at || incident.updated_at;
  const anchor = evidence.notification_at || evidence.incident_notified_at || null;
  const actedAt = interpretation.latest_inbound_message_at || evidence.response_at || null;
  const label = interpretation.latest_relevant_message_sanitized || evidence.message || evidence.action_label || null;
  const contextTemplate = String(evidence.context_template_slug || evidence.template || '');
  const intent = String(interpretation.customer_intent || evidence.intent || evidence.code || 'UNKNOWN').toUpperCase();
  const future = actedAt && new Date(actedAt) > new Date(now);
  const conversationFound = evidence.conversation === 'EXACT' || evidence.conversation_status === 'FOUND';
  const valid = conversationFound
    && Boolean(anchor && later(anchor, incidentAt) || anchor && iso(anchor) === iso(incidentAt))
    && later(actedAt, anchor)
    && !future
    && !initialOrderConfirmation(label)
    && !contextTemplate.toLowerCase().includes('dropea_pedido_')
    && !['ORDER_LIFECYCLE_ONLY', 'BEFORE_INCIDENT', 'BEFORE_NOTIFICATION', 'NOTIFICATION_NOT_OBSERVED'].includes(evidence.incident_relevance)
    && !AMBIGUOUS_INTENTS.has(intent);
  return Object.freeze({
    conversationFound,
    customerInteracted: Boolean(actedAt),
    validIncidentResponse: valid,
    structuredIntent: valid ? intent : null,
    responseConfidence: valid ? Number(interpretation.interpretation_confidence ?? evidence.confidence ?? 1) : 0,
    customerActed: valid,
    customerActedAt: valid ? iso(actedAt) : null,
    customerActionType: valid ? intent : null,
    customerActionLabel: valid ? label : null,
    customerActionEvidence: valid ? interpretation.latest_relevant_message_hash || evidence.message_hash || null : null,
    customerActionSource: valid ? 'CHATBY_EXACT_POST_NOTIFICATION' : null,
    customerActionValidForIncident: valid
  });
}

function canonicalAction(simulatedAction) {
  const raw = String(simulatedAction?.action_type || simulatedAction || '').toUpperCase();
  if (!raw || raw === 'NULL') return null;
  if (raw.includes('SEND') && raw.includes('TEMPLATE')) return 'SEND_CHATBY_TEMPLATE';
  if (raw.includes('SEND') || raw.includes('CONTACT') || raw.includes('REQUEST_CUSTOM')) return 'SEND_CHATBY_MESSAGE';
  if (raw.includes('CHANGE_ADDRESS') || raw.includes('ADDRESS_CHANGE')) return 'UPDATE_DELIVERY_DATA';
  if (raw.includes('PICKUP')) return 'REQUEST_AGENCY_PICKUP';
  if (raw.includes('RETURN')) return 'REQUEST_RETURN';
  if (raw.includes('DISCOUNT')) return 'APPLY_DISCOUNT';
  if (raw.includes('RETRY') || raw.includes('REDELIVER') || raw.includes('NEW_DELIVERY')) return 'REQUEST_REDELIVERY';
  if (raw.includes('RESOLVE') || raw.includes('SOLUTION')) return 'RESOLVE_INCIDENT';
  return null;
}

export function createAutopilotActionIntent({ orderId, incidentId, actionType, payload = {}, provider = null,
  policyName = INCIDENT_AUTOPILOT_POLICY_NAME, policyVersion = INCIDENT_AUTOPILOT_POLICY_VERSION,
  createdAt = new Date(), mode = incidentActionMode(actionType) } = {}) {
  if (!orderId || !incidentId) throw new Error('Autopilot action requires order and incident');
  if (!AUTOPILOT_ACTIONS.includes(actionType)) throw new Error(`Unsupported Autopilot action: ${actionType}`);
  if (!['SIMULATION', 'SHADOW', 'PAUSED'].includes(mode)) throw new Error('New Autopilot actions cannot be LIVE');
  const normalizedPayload = stable(payload);
  const idempotencyKey = hash([orderId, incidentId, actionType, policyVersion, normalizedPayload]);
  return Object.freeze({
    actionId: `action-${idempotencyKey.slice(0, 24)}`,
    orderId: String(orderId), incidentId: String(incidentId), type: actionType,
    payload: normalizedPayload, createdAt: new Date(createdAt).toISOString(), executedAt: null,
    status: mode === 'PAUSED' ? 'BLOCKED' : 'SIMULATED', attempt: 0,
    idempotencyKey, provider: provider || (actionType.startsWith('SEND_CHATBY') ? 'CHATBY' : 'DROPEA'),
    providerResponse: null, verificationStatus: 'NOT_STARTED', mode,
    externalWriteAttempted: false, actionsExecuted: 0, productionWrites: 0,
    policyName, policyVersion
  });
}

export function assertAutopilotTransition(fromState, toState) {
  if (!AUTOPILOT_STATES.includes(fromState) || !AUTOPILOT_STATES.includes(toState)) throw new Error('Unknown Autopilot state');
  if (fromState === toState) return true;
  if (!TRANSITIONS[fromState]?.includes(toState)) throw new Error(`Invalid Autopilot transition: ${fromState} -> ${toState}`);
  return true;
}

export function createAutopilotTransition({ incidentId, fromState, toState, reason, evidence = [], decisionId = null,
  actionId = null, at = new Date(), policyName = INCIDENT_AUTOPILOT_POLICY_NAME,
  policyVersion = INCIDENT_AUTOPILOT_POLICY_VERSION } = {}) {
  assertAutopilotTransition(fromState, toState);
  const timestamp = new Date(at).toISOString();
  const transitionId = hash([incidentId, fromState, toState, reason, decisionId, actionId, timestamp]);
  return Object.freeze({ transitionId, incidentId: String(incidentId), fromState, toState, timestamp,
    reason, policyName, policyVersion, evidence: [...evidence], decisionId, actionId });
}

function transitionPath(fromState, toState) {
  if (fromState === toState) return [fromState];
  const queue = [[fromState]]; const visited = new Set([fromState]);
  while (queue.length) {
    const path = queue.shift(); const current = path.at(-1);
    for (const next of TRANSITIONS[current] || []) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === toState) return candidate;
      visited.add(next); queue.push(candidate);
    }
  }
  throw new Error(`No Autopilot path: ${fromState} -> ${toState}`);
}

function deriveState({ issue, order, interpretation, decision, timer, verification, action, now }) {
  const lifecycle = String(order?.canonical_state || order?.lifecycle_status || '').toUpperCase();
  if (['RETURNED', 'RETURN_TO_ORIGIN'].includes(lifecycle)) return ['RETURNED', 'Proveedor confirma devolución'];
  if (['DELIVERED', 'FINISHED'].includes(lifecycle)) return ['RESOLVED', 'Proveedor confirma entrega final'];
  if (FINAL_ORDER_STATES.has(lifecycle)) return ['RESOLVED', `Pedido finalizado: ${lifecycle}`];
  if (issue?.status !== 'PENDING' || issue?.is_active !== true) return ['RESOLVED', 'La incidencia ya no está activa'];
  if (verification?.status === 'PENDING') return ['ACTION_VERIFYING', 'Esperando verificación posterior de la acción'];
  if (verification?.status === 'FAILED') return ['HUMAN_REVIEW', 'La verificación de la acción falló'];
  if (decision?.requires_human_review || decision?.qa_result === 'BLOCKED') return ['HUMAN_REVIEW', decision?.blocking_reasons?.[0] || 'Decisión bloqueada por seguridad'];
  const intent = String(interpretation?.customer_intent || 'NO_RESPONSE').toUpperCase();
  if (interpretation?.has_customer_replied && AMBIGUOUS_INTENTS.has(intent)) return ['HUMAN_REVIEW', 'Respuesta del cliente ambigua o no verificable'];
  if (interpretation?.has_customer_replied && RETURN_INTENTS.has(intent)) return ['RETURN_ELIGIBLE', 'El cliente rechaza recibir el pedido'];
  if (interpretation?.has_customer_replied) return ['RECOVERABLE_NOW', 'Respuesta válida posterior a la incidencia'];
  if (timer?.status === 'ACTIVE' && new Date(timer.due_at) <= new Date(now)) return ['READY_FOR_DECISION', 'Timer vencido: releer fuentes y reevaluar policy'];
  if (timer?.status === 'ACTIVE') return ['WAITING_CUSTOMER', 'Esperando respuesta hasta el deadline gobernado'];
  if (action) return ['ACTION_PENDING', 'Acción preparada en simulación'];
  return ['READY_FOR_DECISION', 'Contexto preparado para Policy Engine'];
}

export function buildIncidentAutopilotProjection({ issue, order, interpretation = {}, decision = {}, timer = null,
  verification = null, previousState = 'DETECTED', now = new Date() } = {}) {
  if (!issue?.canonical_issue_id || !order?.canonical_order_id) throw new Error('Autopilot projection requires canonical identities');
  const actionType = canonicalAction(decision.simulated_action);
  const action = actionType ? createAutopilotActionIntent({
    orderId: order.canonical_order_id, incidentId: issue.canonical_issue_id, actionType,
    payload: { decision_id: decision.decision_id || null, proposal: decision.proposed_resolution || null },
    policyVersion: decision.policy_version || INCIDENT_AUTOPILOT_POLICY_VERSION, createdAt: now
  }) : null;
  const [state, reason] = deriveState({ issue, order, interpretation, decision, timer: timer || decision.timer, verification, action, now });
  const safePrevious = AUTOPILOT_STATES.includes(previousState) ? previousState : 'DETECTED';
  const path = transitionPath(safePrevious, state);
  const transitions = path.slice(1).map((toState, index) => createAutopilotTransition({
    incidentId: issue.canonical_issue_id, fromState: path[index], toState,
    reason: index === path.length - 2 ? reason : `Transición interna hacia ${state}`,
    evidence: [issue.source_event_id, interpretation.latest_relevant_message_hash].filter(Boolean),
    decisionId: decision.decision_id || null, actionId: index === path.length - 2 ? action?.actionId || null : null, at: now,
    policyVersion: decision.policy_version || INCIDENT_AUTOPILOT_POLICY_VERSION
  }));
  const transition = transitions.at(-1) || null;
  const effectiveState = state;
  const snapshotHash = hash({ issue: issue.updated_at, order: order.canonical_state || order.lifecycle_status,
    interpretation: interpretation.latest_relevant_message_hash, decision: decision.decision_id, timer: timer?.timer_id || decision.timer?.timer_id });
  return Object.freeze({
    incidentId: String(issue.canonical_issue_id), orderId: String(order.canonical_order_id),
    state: effectiveState, mode: 'SHADOW_READ_ONLY', policyName: INCIDENT_AUTOPILOT_POLICY_NAME,
    policyVersion: decision.policy_version || INCIDENT_AUTOPILOT_POLICY_VERSION,
    decisionId: decision.decision_id || null, reason, nextAction: action?.type || null,
    waitingFor: effectiveState === 'WAITING_CUSTOMER' ? 'CUSTOMER' : effectiveState === 'ACTION_VERIFYING' ? 'PROVIDER_VERIFICATION' : null,
    dueAt: (timer || decision.timer)?.due_at || null,
    humanReview: effectiveState === 'HUMAN_REVIEW', errorCode: effectiveState === 'ERROR' ? reason : null,
    sourceSnapshotHash: snapshotHash, transition, transitions, action,
    updatedAt: new Date(now).toISOString(), actionsExecuted: 0, productionWrites: 0
  });
}

export function expiredTimerReevaluation(timer, { now = new Date() } = {}) {
  if (!timer || timer.status !== 'ACTIVE' || new Date(timer.due_at) > new Date(now)) return null;
  return Object.freeze({ type: 'TIMER_EXPIRED', timerId: timer.timer_id, incidentId: timer.issue_id,
    nextState: 'READY_FOR_DECISION', command: 'REFRESH_CONTEXT_AND_REEVALUATE', directAction: null,
    occurredAt: new Date(now).toISOString(), actionsExecuted: 0, productionWrites: 0 });
}
