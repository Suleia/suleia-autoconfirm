import crypto from 'node:crypto';
import { evaluateAuthorizationContract } from './authorization.mjs';
import { evaluateTechnicalCompliance } from './compliance-engine.mjs';
import { resolvePolicyConflict } from './conflict-resolver.mjs';
import { GovernanceEventStore } from './governance-event-store.mjs';
import { createDecisionExplanation } from './explanation.mjs';
import { isActiveAt } from './policy-registry.mjs';
import { evaluateQaGate } from './qa-gate.mjs';
import { evaluateRisk } from './risk-engine.mjs';
import { collectUntrustedContentSignals, minimizeUntrustedPayload } from './untrusted-content.mjs';

function matches(policy, facts) {
  if (!isActiveAt(policy, facts.now ?? new Date())) return false;
  if (!facts.fact_codes?.includes(policy.trigger.fact_code)) return false;
  if (policy.trigger.incident_type && policy.trigger.incident_type !== facts.incident_type) return false;
  return policy.scope.includes(facts.scope);
}

function append(store, eventType, correlationId, index, payload) {
  store.append({
    event_type: eventType,
    correlation_id: correlationId,
    deduplication_key: `${correlationId}:${index}:${eventType}`,
    payload
  });
}

export class DeterministicGovernanceEngine {
  constructor({ registry, eventStore = new GovernanceEventStore() }) {
    if (!registry) throw new Error('Governance engine requires a PolicyRegistry');
    this.registry = registry;
    this.eventStore = eventStore;
  }

  evaluate(input, { now = new Date() } = {}) {
    const correlationId = input.correlation_id ?? crypto.randomUUID();
    const allPolicies = this.registry.list({ now });
    const candidates = allPolicies.filter((policy) => matches(policy, { ...input.facts, now }));
    const conflict = resolvePolicyConflict(candidates, input.conflict_context ?? {});
    const selected = conflict.selected_policy;
    append(this.eventStore, 'PolicyEvaluated', correlationId, 1, {
      considered_policy_ids: candidates.map((policy) => policy.policy_id),
      selected_policy_id: selected?.policy_id ?? null,
      outcome: conflict.outcome
    });
    if (conflict.conflicts?.length) append(this.eventStore, 'PolicyConflictDetected', correlationId, 2, {
      conflict_codes: conflict.conflicts,
      reason_code: conflict.reason_code
    });

    const minimizedFactsUsed = minimizeUntrustedPayload(input.facts_used ?? []);
    const riskFactors = [...(input.risk_factors ?? [])];
    if (collectUntrustedContentSignals(minimizedFactsUsed).some((item) => item.customer_signal.contains_prompt_injection)) {
      riskFactors.push('PROMPT_INJECTION');
    }
    if (conflict.outcome === 'HUMAN_REVIEW') riskFactors.push('AMBIGUOUS_POLICY');
    if (input.conflict_context?.unmasked_pii) riskFactors.push('PII_EXPOSED');
    const risk = evaluateRisk(riskFactors, { previousLevel: input.previous_risk_level ?? 'LOW' });
    append(this.eventStore, 'RiskEvaluated', correlationId, 3, risk);

    const qa = evaluateQaGate({
      ...input.qa,
      policy_current: Boolean(selected),
      risk_level: risk.risk_level
    });
    append(this.eventStore, 'QAEvaluated', correlationId, 4, qa);

    const compliance = evaluateTechnicalCompliance(input.compliance);
    append(this.eventStore, 'ComplianceEvaluated', correlationId, 5, compliance);
    const authorization = evaluateAuthorizationContract({
      policy: selected,
      risk,
      qa,
      compliance,
      correlation_id: correlationId
    });
    const blockedReasons = [
      ...(conflict.outcome === 'BLOCKED' ? [conflict.reason_code] : []),
      ...authorization.blockers
    ];
    const humanReviewReason = conflict.outcome === 'HUMAN_REVIEW'
      ? conflict.reason_code
      : risk.risk_level === 'HIGH' ? 'HIGH_RISK' : qa.qa_result === 'HUMAN_REVIEW' ? 'QA_HUMAN_REVIEW' : null;
    const explanation = createDecisionExplanation({
      order_id: input.order_id,
      facts_used: minimizedFactsUsed,
      facts_rejected: input.facts_rejected,
      source_freshness: input.source_freshness,
      policies_considered: candidates.map((policy) => policy.policy_id),
      policy_selected: selected?.policy_id ?? null,
      policies_rejected: conflict.rejected_policies ?? [],
      conflicts_detected: conflict.conflicts ?? [],
      risk_factors: risk.risk_factors,
      risk_level: risk.risk_level,
      qa_result: qa.qa_result,
      compliance_result: compliance.compliance_result,
      proposed_action: selected?.proposed_action ?? 'NO_ACTION',
      blocked_reasons: blockedReasons,
      human_review_reason: humanReviewReason,
      policy_version: selected?.version ?? null,
      correlation_id: correlationId
    }, { now });

    const eventType = blockedReasons.length ? 'DecisionBlocked' : humanReviewReason ? 'HumanReviewRequested' : 'DecisionProposed';
    append(this.eventStore, eventType, correlationId, 6, {
      decision_id: explanation.decision_id,
      masked_order_id: explanation.masked_order_id,
      proposed_action: explanation.proposed_action,
      execution_disposition: 'SIMULATION_ONLY',
      actions_executed: 0
    });
    return Object.freeze({
      run_mode: 'SIMULATION',
      execution_disposition: 'SIMULATION_ONLY',
      conflict,
      risk,
      qa,
      compliance,
      authorization,
      explanation,
      actions_executed: 0,
      production_writes: 0,
      messages_sent: 0,
      discounts_applied: 0,
      orders_confirmed: 0,
      orders_cancelled: 0,
      external_ai_calls: 0,
      openai_api_calls: 0
    });
  }
}
