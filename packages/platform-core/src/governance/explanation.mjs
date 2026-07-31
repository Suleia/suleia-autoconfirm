import crypto from 'node:crypto';
import { containsDirectPii } from '../masking.mjs';
import { deepFreeze } from './contracts.mjs';
import { minimizeUntrustedPayload } from './untrusted-content.mjs';

export const DECISION_EXPLANATION_FIELDS = Object.freeze([
  'decision_id',
  'masked_order_id',
  'facts_used',
  'facts_rejected',
  'source_freshness',
  'policies_considered',
  'policy_selected',
  'policies_rejected',
  'conflicts_detected',
  'risk_factors',
  'risk_level',
  'qa_result',
  'compliance_result',
  'proposed_action',
  'blocked_reasons',
  'human_review_reason',
  'policy_version',
  'generated_at',
  'correlation_id'
]);

export function maskOrderId(orderId) {
  return `ORDER-${crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 12)}`;
}

export function createDecisionExplanation(input, { now = new Date() } = {}) {
  const record = {
    decision_id: input.decision_id ?? crypto.randomUUID(),
    masked_order_id: input.masked_order_id ?? maskOrderId(input.order_id),
    facts_used: minimizeUntrustedPayload(input.facts_used ?? []),
    facts_rejected: minimizeUntrustedPayload(input.facts_rejected ?? []),
    source_freshness: structuredClone(input.source_freshness ?? {}),
    policies_considered: [...(input.policies_considered ?? [])],
    policy_selected: input.policy_selected ?? null,
    policies_rejected: [...(input.policies_rejected ?? [])],
    conflicts_detected: [...(input.conflicts_detected ?? [])],
    risk_factors: [...(input.risk_factors ?? [])],
    risk_level: input.risk_level,
    qa_result: input.qa_result,
    compliance_result: input.compliance_result,
    proposed_action: input.proposed_action ?? 'NO_ACTION',
    blocked_reasons: [...(input.blocked_reasons ?? [])],
    human_review_reason: input.human_review_reason ?? null,
    policy_version: input.policy_version ?? null,
    generated_at: new Date(now).toISOString(),
    correlation_id: input.correlation_id
  };
  const missing = DECISION_EXPLANATION_FIELDS.filter((field) => !(field in record));
  if (missing.length) throw new Error(`Decision explanation is missing: ${missing.join(', ')}`);
  if (containsDirectPii(record)) throw new Error('Decision explanation contains direct PII');
  return deepFreeze(record);
}
