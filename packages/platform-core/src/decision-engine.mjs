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

function propose(twin, policy) {
  if (twin.logistics.delivered || twin.status === 'DELIVERED') {
    return { action: 'NO_ACTION', confidence: 1, reason: 'El pedido ya está entregado.', reasonCode: 'ORDER_ALREADY_DELIVERED', risk: 'LOW' };
  }
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
      action: 'PROPOSE_UNKNOWN_POLICY_REVIEW',
      confidence: 0.90,
      reason: 'El caso UNKNOWN superó 72 horas y requiere revisión humana; no se autoriza cancelación automática.',
      reasonCode: 'UNKNOWN_72H_HUMAN_REVIEW',
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
  if (proposal.risk === 'HIGH') return ROUTES.HUMAN_REVIEW;
  if (proposal.confidence >= policy.deterministicConfidence) return ROUTES.DETERMINISTIC;
  if (proposal.confidence >= policy.aiReviewMinConfidence) return ROUTES.AI_REVIEW;
  return ROUTES.HUMAN_REVIEW;
}

export class DeterministicDecisionEngine {
  constructor({ policy = DEFAULT_POLICY } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  simulate(twin) {
    const proposal = propose(twin, this.policy);
    const route = classifyDecisionRoute(twin, proposal, this.policy);
    const blocking = route === ROUTES.BLOCKED
      ? [...twin.warnings, ...twin.contradictions]
      : [];
    const result = {
      decision_id: crypto.randomUUID(),
      order_id: twin.order_id,
      snapshot_version: twin.snapshot_version,
      workflow: twin.incident.active ? `INCIDENT_${twin.incident.type}` : 'ORDER_CONFIRMATION',
      route,
      proposed_action: proposal.action,
      reason_codes: [proposal.reasonCode],
      confidence_breakdown: {
        policy_match: proposal.confidence,
        data_completeness: twin.source_quality.completeness,
        freshness: twin.source_quality.freshness === 'FRESH' ? 1 : 0
      },
      final_confidence: proposal.confidence,
      reason_summary: proposal.reason,
      evidence_event_ids: twin.evidence_event_ids,
      policy_version: this.policy.version,
      policy_versions: [this.policy.version],
      alternatives: [{ action: 'MANUAL_REVIEW', reason: 'Disponible como salida segura.' }],
      risk_level: proposal.risk,
      qa_status: blocking.length ? 'FAIL' : proposal.risk === 'HIGH' ? 'REVIEW' : 'PASS',
      blocking_reasons: blocking,
      missing_information: proposal.action === 'WAIT_FOR_EVIDENCE' ? ['customer_intent'] : [],
      requires_human_review: [ROUTES.HUMAN_REVIEW, ROUTES.BLOCKED].includes(route),
      actions_executed: 0,
      run_mode: RUN_MODE
    };
    return assertSimulationSafety(result);
  }
}

export { DEFAULT_POLICY };
