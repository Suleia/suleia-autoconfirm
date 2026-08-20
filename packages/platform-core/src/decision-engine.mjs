import crypto from 'node:crypto';
import { ROUTES, RUN_MODE, assertSimulationSafety } from './contracts.mjs';

const DEFAULT_POLICY = Object.freeze({
  version: 'vps-staging-v1',
  deterministicConfidence: 0.95,
  aiReviewMinConfidence: 0.60,
  incidentTimeoutHours: 48,
  legacyCancellationHours: 36,
  unknownCancellationHours: 72
});

function activeTimer(twin, workflow) {
  return twin.timers.find((timer) => timer.workflow === workflow && ['ACTIVE', 'EXPIRED'].includes(timer.status));
}

function hasExpired(twin, workflow) {
  const timer = activeTimer(twin, workflow);
  return Boolean(timer && (timer.status === 'EXPIRED' || timer.remaining_hours === 0));
}

const AGENCY_PICKUP_MESSAGE = 'Tu pedido está disponible para recogida en la agencia indicada por el transportista. Revisa el aviso logístico antes de desplazarte.';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function policyInputHash(policy) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(policy))).digest('hex');
}

function decisionTwinInput(twin) {
  const { built_at: _observationTime, ...decisionFields } = twin;
  return decisionFields;
}

export function decisionInputHash(twin, policy = DEFAULT_POLICY) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    twin: decisionTwinInput(twin),
    policy
  }))).digest('hex');
}

export function isDecisionCurrent(decision, twin, { policy } = {}) {
  if (!policy) return false;
  return Boolean(
    decision
    && twin
    && String(decision.order_id) === String(twin.order_id)
    && Number(decision.state_version) === Number(twin.state_version)
    && decision.policy_hash === policyInputHash(policy)
    && decision.input_hash === decisionInputHash(twin, policy)
  );
}

function incidentEvidenceProposal(twin) {
  const carrierState = twin.logistics.carrier_state;
  const customerIntent = twin.customer_intent;
  const conflicts = twin.conflicting_evidence || [];

  if (conflicts.includes('AGENCY_PICKUP_SUPERSEDED_BY_RETURN')) {
    return {
      action: 'NO_ACTION',
      confidence: 0.99,
      reason: 'Una devolución posterior invalida la evidencia anterior de recogida en agencia.',
      reasonCode: 'AGENCY_PICKUP_EVIDENCE_SUPERSEDED',
      risk: 'HIGH',
      route: ROUTES.HUMAN_REVIEW,
      workflow: 'INCIDENT_AGENCY_PICKUP',
      customerMessageRequired: false,
      conflictingEvidence: conflicts
    };
  }

  if (carrierState === 'AGENCY_PICKUP_CONFIRMED') {
    return {
      action: 'MARK_AGENCY_PICKUP',
      confidence: 0.99,
      reason: 'El transportista confirma de forma explícita y vigente la recogida en agencia.',
      reasonCode: 'CARRIER_AGENCY_PICKUP_CONFIRMED',
      risk: 'MEDIUM',
      route: ROUTES.DETERMINISTIC,
      workflow: 'INCIDENT_AGENCY_PICKUP',
      customerMessageRequired: true,
      customerMessageProposed: true,
      customerMessageTemplate: AGENCY_PICKUP_MESSAGE,
      discountOfferAllowed: false,
      commercialRecoveryAllowed: false
    };
  }

  if (customerIntent === 'AGENCY_PICKUP') {
    return {
      action: 'VERIFY_AGENCY_PICKUP',
      confidence: 0.90,
      reason: 'La preferencia del cliente no sustituye la confirmación vigente del transportista.',
      reasonCode: 'AGENCY_PICKUP_CARRIER_EVIDENCE_REQUIRED',
      risk: 'HIGH',
      route: ROUTES.HUMAN_REVIEW,
      workflow: 'INCIDENT_AGENCY_PICKUP',
      customerMessageRequired: false,
      discountOfferAllowed: false,
      commercialRecoveryAllowed: false
    };
  }

  if (carrierState === 'SHIPMENT_NOT_ACCEPTED') {
    if (conflicts.includes('CUSTOMER_RETURN_REVOKED') || customerIntent === 'RECEIVE') {
      return {
        action: 'NO_ACTION',
        confidence: 0.99,
        reason: 'Una intención posterior de recibir el pedido revoca la solicitud anterior de devolución.',
        reasonCode: 'CUSTOMER_RETURN_REVOKED',
        risk: 'HIGH',
        route: ROUTES.HUMAN_REVIEW,
        workflow: 'INCIDENT_RETURN_TO_ORIGIN',
        discountOfferAllowed: false,
        commercialRecoveryAllowed: false,
        conflictingEvidence: conflicts
      };
    }
    if (customerIntent === 'RETURN') {
      return {
        action: 'RETURN_TO_ORIGIN',
        confidence: 0.99,
        reason: 'La incidencia logística y la última intención explícita del cliente coinciden en devolver el envío.',
        reasonCode: 'RETURN_INTENT_AND_CARRIER_ALIGNED',
        risk: 'MEDIUM',
        route: ROUTES.DETERMINISTIC,
        workflow: 'INCIDENT_RETURN_TO_ORIGIN',
        discountOfferAllowed: false,
        commercialRecoveryAllowed: false,
        customerMessageRequired: false
      };
    }
  }

  if (customerIntent === 'RETURN') {
    return {
      action: 'NO_ACTION',
      confidence: 0.90,
      reason: 'La devolución explícita bloquea descuentos, pero falta evidencia logística vigente para actuar.',
      reasonCode: 'RETURN_INTENT_BLOCKS_DISCOUNT_PENDING_CARRIER',
      risk: 'HIGH',
      route: ROUTES.HUMAN_REVIEW,
      workflow: 'INCIDENT_RETURN_TO_ORIGIN',
      discountOfferAllowed: false,
      commercialRecoveryAllowed: false,
      customerMessageRequired: false
    };
  }
  return null;
}

function propose(twin, policy) {
  if (twin.logistics.delivered || twin.status === 'DELIVERED') {
    return { action: 'NO_ACTION', confidence: 1, reason: 'El pedido ya está entregado.', reasonCode: 'ORDER_ALREADY_DELIVERED', risk: 'LOW' };
  }
  const evidenceProposal = incidentEvidenceProposal(twin);
  if (evidenceProposal) return evidenceProposal;
  if (twin.customer_intent === 'CANCEL') {
    return { action: 'PROPOSE_CANCEL', confidence: 0.99, reason: 'La última intención explícita del cliente es cancelar.', reasonCode: 'CUSTOMER_EXPLICIT_CANCEL', risk: 'MEDIUM' };
  }
  if (twin.incident.active) {
    if (hasExpired(twin, 'INCIDENT_RESPONSE_48H')) {
      return { action: 'PROPOSE_INCIDENT_POLICY_REVIEW', confidence: 0.92, reason: 'La incidencia agotó su plazo de 48 horas.', reasonCode: 'INCIDENT_REVIEW_DEADLINE_EXPIRED', risk: 'HIGH' };
    }
    return { action: 'WAIT_INCIDENT_WORKFLOW', confidence: 0.98, reason: 'La incidencia activa pausa la cancelación genérica.', reasonCode: 'INCIDENT_WORKFLOW_ACTIVE', risk: 'LOW' };
  }
  if (twin.customer_intent === 'CONFIRM') {
    if (!hasExpired(twin, 'CONFIRMATION_WAIT_1H')) {
      return { action: 'WAIT_CONFIRMATION_WINDOW', confidence: 0.99, reason: 'Debe completarse la espera de una hora.', reasonCode: 'CONFIRMATION_WAIT_ACTIVE', risk: 'LOW' };
    }
    return { action: 'PROPOSE_CONFIRM', confidence: 0.99, reason: 'Confirmación vigente tras la espera de una hora.', reasonCode: 'CONFIRMATION_WAIT_COMPLETED', risk: 'MEDIUM' };
  }
  if (hasExpired(twin, 'LEGACY_UNANSWERED_36H')) {
    return { action: 'COMPARE_LEGACY_36H_ONLY', confidence: 0.96, reason: 'La regla de 36 horas está deprecada y solo se compara.', reasonCode: 'LEGACY_36H_COMPARISON_ONLY', risk: 'LOW' };
  }
  if (hasExpired(twin, 'UNKNOWN_72H')) {
    return {
      action: 'NO_ACTION',
      confidence: 0.90,
      reason: 'El caso mantiene estado UNKNOWN tras 72 horas. Se genera una alerta administrativa y se deriva a revisión humana sin ejecutar ninguna acción.',
      reasonCode: 'UNKNOWN_72H_ADMIN_ALERT',
      policyState: 'UNKNOWN',
      administrativeAlert: {
        required: true,
        type: 'UNKNOWN_72H_REVIEW'
      },
      risk: 'HIGH'
    };
  }
  return { action: 'WAIT_FOR_EVIDENCE', confidence: 0.70, reason: 'No existe evidencia suficiente para una acción determinista.', reasonCode: 'INSUFFICIENT_EVIDENCE', risk: 'LOW' };
}

export function classifyDecisionRoute(twin, proposal, policy = DEFAULT_POLICY) {
  if (twin.source_quality.freshness === 'STALE') return ROUTES.BLOCKED;
  if (
    twin.contradictions.length
    || twin.warnings.includes('NO_EVENTS')
    || twin.warnings.includes('DUPLICATE_ACTION_PROPOSAL')
  ) return ROUTES.BLOCKED;
  if (proposal.risk === 'CRITICAL') return ROUTES.BLOCKED;
  if (proposal.route) return proposal.route;
  if (proposal.risk === 'HIGH') return ROUTES.HUMAN_REVIEW;
  if (proposal.confidence >= policy.deterministicConfidence) return ROUTES.DETERMINISTIC;
  if (proposal.confidence >= policy.aiReviewMinConfidence) return ROUTES.AI_REVIEW;
  return ROUTES.HUMAN_REVIEW;
}

export class DeterministicDecisionEngine {
  constructor({ policy = DEFAULT_POLICY, clock = () => new Date() } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.clock = clock;
  }

  simulate(twin) {
    const policySnapshot = deepFreeze(canonical(this.policy));
    const proposal = propose(twin, this.policy);
    const route = classifyDecisionRoute(twin, proposal, this.policy);
    const blocking = route === ROUTES.BLOCKED
      ? [...twin.warnings, ...twin.contradictions]
      : [];
    const result = {
      decision_id: crypto.randomUUID(),
      order_id: twin.order_id,
      state_version: twin.state_version,
      created_at: this.clock().toISOString(),
      input_hash: decisionInputHash(twin, policySnapshot),
      snapshot_version: twin.snapshot_version,
      workflow: proposal.workflow || (twin.incident.active ? `INCIDENT_${twin.incident.type}` : 'ORDER_CONFIRMATION'),
      selected_workflow: proposal.workflow || (twin.incident.active ? `INCIDENT_${twin.incident.type}` : 'ORDER_CONFIRMATION'),
      route,
      proposed_action: proposal.action,
      policy_state: proposal.policyState || null,
      administrative_alert: proposal.administrativeAlert || null,
      reason_codes: [proposal.reasonCode],
      incident_type: twin.incident.type,
      incident_history: twin.incident_history,
      customer_intent: twin.customer_intent,
      customer_intent_evidence: twin.customer_intent_evidence,
      carrier_state: twin.logistics.carrier_state,
      carrier_evidence: twin.logistics.carrier_evidence,
      latest_relevant_event: twin.latest_relevant_event,
      evidence_freshness: twin.evidence_freshness,
      conflicting_evidence: proposal.conflictingEvidence || twin.conflicting_evidence,
      confidence_breakdown: {
        policy_match: proposal.confidence,
        data_completeness: twin.source_quality.completeness,
        freshness: twin.source_quality.freshness === 'FRESH' ? 1 : 0
      },
      final_confidence: proposal.confidence,
      confidence: proposal.confidence,
      reason_summary: proposal.reason,
      evidence_event_ids: twin.evidence_event_ids,
      policy_version: this.policy.version,
      policy_versions: [this.policy.version],
      policy_hash: policyInputHash(policySnapshot),
      policy_snapshot: policySnapshot,
      alternatives: [{ action: 'MANUAL_REVIEW', reason: 'Disponible como salida segura.' }],
      risk_level: proposal.risk,
      risk_gate_result: route === ROUTES.BLOCKED ? 'BLOCKED' : [ROUTES.HUMAN_REVIEW].includes(route) ? 'REVIEW' : 'PASS',
      qa_status: blocking.length ? 'FAIL' : proposal.risk === 'HIGH' ? 'REVIEW' : 'PASS',
      qa_gate_result: blocking.length ? 'FAIL' : proposal.risk === 'HIGH' ? 'REVIEW' : 'PASS',
      discount_offer_allowed: proposal.discountOfferAllowed ?? null,
      commercial_recovery_allowed: proposal.commercialRecoveryAllowed ?? null,
      customer_message_required: Boolean(proposal.customerMessageRequired),
      customer_message_proposed: Boolean(proposal.customerMessageProposed),
      customer_message_sent: false,
      customer_message_template: proposal.customerMessageTemplate || null,
      blocking_reasons: blocking,
      missing_information: proposal.action === 'WAIT_FOR_EVIDENCE' ? ['customer_intent'] : [],
      requires_human_review: [ROUTES.HUMAN_REVIEW, ROUTES.BLOCKED].includes(route),
      actions_executed: 0,
      run_mode: RUN_MODE
    };
    return assertSimulationSafety(deepFreeze(result));
  }

  isCurrent(decision, twin) {
    return isDecisionCurrent(decision, twin, { policy: this.policy });
  }
}

export { DEFAULT_POLICY };
