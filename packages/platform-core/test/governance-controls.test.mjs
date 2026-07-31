import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASE_B_EXECUTION_FLAGS, evaluateAuthorizationContract } from '../src/governance/authorization.mjs';
import { evaluateTechnicalCompliance } from '../src/governance/compliance-engine.mjs';
import { GovernanceEventStore } from '../src/governance/governance-event-store.mjs';
import { evaluateQaGate } from '../src/governance/qa-gate.mjs';
import { evaluateRisk } from '../src/governance/risk-engine.mjs';
import { createPhaseAReview } from '../src/organization/phase-a-review.mjs';

const PASSING_QA = Object.freeze({
  identity_valid: true,
  state_valid: true,
  freshness_valid: true,
  evidence_sufficient: true,
  policy_current: true,
  timer_valid: true,
  no_contradictions: true,
  no_duplicates: true,
  idempotency_present: true,
  logistics_compatible: true,
  action_allowed: true,
  masking_valid: true,
  authorization_present: true,
  schema_valid: true
});

const PASSING_COMPLIANCE = Object.freeze({
  record: { masked_order_id: 'ORDER-aabbccddeeff', note: '[FREE TEXT REDACTED]' },
  data_minimized: true,
  pii_classified: true,
  retention_days: 30,
  allowed_retention_days: [30],
  role_authorized: true,
  traceable: true,
  declared_purpose: 'simulation audit',
  safe_logs: true,
  export_controlled: true
});

test('Phase A remains a 40-module modular monolith with no cycles or direct writes', () => {
  const review = createPhaseAReview();
  assert.equal(review.architecture_style, 'MODULAR_MONOLITH');
  assert.equal(review.department_count, 40);
  assert.equal(review.agent_count, 40);
  assert.equal(review.independent_service_count, 0);
  assert.equal(review.permanent_worker_count, 0);
  assert.equal(review.duplicate_responsibilities.length, 0);
  assert.equal(review.dependency_cycles.length, 0);
  assert.equal(review.all_agents_single_owner, true);
  assert.equal(review.all_agents_inactive, true);
  assert.equal(review.direct_write_capability_count, 0);
  assert.equal(review.matrix.length, 40);
  for (const row of review.matrix) {
    for (const field of ['department_id', 'agent_id', 'functional_owner', 'inputs', 'outputs', 'policy_domain', 'risk_domain']) {
      assert.ok(row[field]);
    }
  }
});

test('risk engine covers LOW, MEDIUM, HIGH and CRITICAL', () => {
  assert.equal(evaluateRisk([]).risk_level, 'LOW');
  assert.equal(evaluateRisk(['INSUFFICIENT_EVIDENCE']).risk_level, 'MEDIUM');
  assert.equal(evaluateRisk(['STALE_SOURCE']).risk_level, 'HIGH');
  assert.equal(evaluateRisk(['PII_EXPOSED']).risk_level, 'CRITICAL');
});

test('multiple risk factors select the highest and risk never automatically decreases', () => {
  const result = evaluateRisk(['INCOMPLETE_ADDRESS', 'CONTRADICTORY_SOURCES', 'INVALID_SCHEMA']);
  assert.equal(result.risk_level, 'CRITICAL');
  assert.equal(evaluateRisk([], { previousLevel: 'HIGH' }).risk_level, 'HIGH');
});

test('partial identity, stale source and contradictory sources are HIGH', () => {
  for (const factor of ['UNCORRELATED_IDENTITY', 'STALE_SOURCE', 'CONTRADICTORY_SOURCES']) {
    assert.equal(evaluateRisk([factor]).risk_level, 'HIGH');
  }
});

test('QA produces every permitted result and always remains simulation-only', () => {
  assert.equal(evaluateQaGate({ ...PASSING_QA, risk_level: 'LOW' }).qa_result, 'PASS');
  assert.equal(evaluateQaGate({ ...PASSING_QA, risk_level: 'MEDIUM' }).qa_result, 'PASS_WITH_WARNING');
  assert.equal(evaluateQaGate({ ...PASSING_QA, risk_level: 'HIGH' }).qa_result, 'HUMAN_REVIEW');
  assert.equal(evaluateQaGate({ ...PASSING_QA, risk_level: 'CRITICAL' }).qa_result, 'BLOCKED');
  assert.equal(evaluateQaGate({ ...PASSING_QA, risk_level: 'LOW' }).execution_disposition, 'SIMULATION_ONLY');
});

test('QA blocks duplicate timer, incompatible action and missing idempotency', () => {
  assert.equal(evaluateQaGate({ ...PASSING_QA, timer_valid: false, risk_level: 'MEDIUM' }).qa_result, 'BLOCKED');
  assert.equal(evaluateQaGate({ ...PASSING_QA, logistics_compatible: false, risk_level: 'MEDIUM' }).qa_result, 'BLOCKED');
  assert.equal(evaluateQaGate({ ...PASSING_QA, idempotency_present: false, risk_level: 'MEDIUM' }).qa_result, 'BLOCKED');
});

test('technical compliance passes masked records and blocks PII in data or logs', () => {
  assert.equal(evaluateTechnicalCompliance(PASSING_COMPLIANCE).compliance_result, 'PASS');
  const exposed = evaluateTechnicalCompliance({ ...PASSING_COMPLIANCE, record: { email: 'person@example.com' } });
  assert.ok(exposed.failures.includes('PII_NOT_MASKED'));
  assert.equal(exposed.compliance_result, 'BLOCKED');
});

test('technical compliance blocks secrets, unauthorized access and invalid retention', () => {
  const secret = evaluateTechnicalCompliance({ ...PASSING_COMPLIANCE, record: { api_token: 'secret-value' } });
  assert.ok(secret.failures.includes('SECRET_EXPOSED'));
  assert.ok(evaluateTechnicalCompliance({ ...PASSING_COMPLIANCE, role_authorized: false }).failures.includes('ACCESS_NOT_AUTHORIZED'));
  assert.ok(evaluateTechnicalCompliance({ ...PASSING_COMPLIANCE, retention_days: 31 }).failures.includes('RETENTION_INVALID'));
});

test('authorization contract can never authorize execution in Phase B', () => {
  assert.ok(Object.values(PHASE_B_EXECUTION_FLAGS).every((value) => value === false));
  const result = evaluateAuthorizationContract({
    policy: { policy_id: 'safe', version: '1.0.0', proposed_action: 'NO_ACTION' },
    risk: { risk_level: 'LOW' },
    qa: { qa_result: 'PASS' },
    compliance: { compliance_result: 'PASS' },
    correlation_id: 'fixture-correlation'
  });
  assert.equal(result.authorization_result, 'SIMULATION_ONLY');
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
});

test('governance event store is append-only, idempotent and masks PII', () => {
  const store = new GovernanceEventStore();
  const input = {
    event_type: 'PolicyEvaluated',
    correlation_id: 'fixture-correlation',
    deduplication_key: 'fixture:policy-evaluated',
    payload: { phone: '+34612345482', result: 'SIMULATION_ONLY' }
  };
  assert.equal(store.append(input).inserted, true);
  assert.equal(store.append(input).inserted, false);
  assert.equal(store.list()[0].payload.phone, '*** *** 482');
  const copy = store.list();
  copy[0].payload.result = 'tampered';
  assert.equal(store.list()[0].payload.result, 'SIMULATION_ONLY');
});

export { PASSING_COMPLIANCE, PASSING_QA };
