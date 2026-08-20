import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionGateway,
  InMemoryActionIdempotencyLedger,
  canonicalActionIdempotencyKey,
  createActionEnvelope,
  externalActionTypeForDecision
} from '../src/execution-gateway.mjs';
import { resolveExecutionMode } from '../src/execution-mode.mjs';
import { DeterministicDecisionEngine } from '../src/decision-engine.mjs';
import { OrderDigitalTwinBuilder } from '../src/digital-twin.mjs';
import { InMemoryEventStore } from '../src/event-store.mjs';

const action = () => {
  const candidate = {
  action_id: 'action-shadow-1',
  order_id: 'order-shadow-1',
  action_type: 'DROPEA_CONFIRM',
  decision_id: 'decision-shadow-1',
  state_version: 3,
  input_hash: 'a'.repeat(64)
  };
  return { ...candidate, idempotency_key: canonicalActionIdempotencyKey(candidate) };
};

const currentDecision = () => ({
  decision_id: 'decision-shadow-1', proposed_action: 'PROPOSE_CONFIRM',
  state_version: 3, input_hash: 'a'.repeat(64)
});

test('the gateway uses an explicit allowlist to translate real decision proposals', () => {
  const store = new InMemoryEventStore();
  for (const [source_record_id, event_type, occurred_at, payload = {}] of [
    ['created', 'ORDER_CREATED', '2026-08-19T09:00:00.000Z', { status: 'PENDING' }],
    ['confirmed', 'CUSTOMER_CONFIRMED', '2026-08-19T10:00:00.000Z'],
    ['timer', 'TIMER_STARTED', '2026-08-19T10:00:00.000Z', {
      timer_id: 'confirm-order-shadow-1', workflow: 'CONFIRMATION_WAIT_1H', deadline_at: '2026-08-19T11:00:00.000Z'
    }],
    ['expired', 'TIMER_EXPIRED', '2026-08-19T11:00:00.000Z', { timer_id: 'confirm-order-shadow-1' }]
  ]) {
    store.append({
      order_id: 'order-shadow-1', source: 'fixture', source_record_id,
      deduplication_key: `fixture:${source_record_id}`, event_type, occurred_at, payload,
      trust_level: 'HIGH', freshness_status: 'FRESH'
    });
  }
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(
    'order-shadow-1', new Date('2026-08-19T11:01:00.000Z')
  );
  const decision = new DeterministicDecisionEngine({
    clock: () => new Date('2026-08-19T11:01:00.000Z')
  }).simulate(twin);
  assert.equal(decision.proposed_action, 'PROPOSE_CONFIRM');
  assert.equal(externalActionTypeForDecision(decision), 'DROPEA_CONFIRM');
  assert.equal(externalActionTypeForDecision({ proposed_action: 'PROPOSE_CANCEL' }), 'DROPEA_CANCEL');
  assert.equal(externalActionTypeForDecision({ proposed_action: 'WAIT_FOR_EVIDENCE' }), null);
});

test('mismatched and non-executable decisions fail before write authority or idempotency', async () => {
  let writeAuthorityCalls = 0;
  const gateway = new ExecutionGateway({
    executionModeResolution: resolveExecutionMode({}),
    writeAuthority: () => { writeAuthorityCalls += 1; }
  });
  const context = {
    conflict_check: 'PASS', policy_gate: 'PASS', database_available: true,
    credentials_consistent: true, state_fresh: true, current_state_version: 3,
    current_input_hash: 'a'.repeat(64)
  };
  await assert.rejects(gateway.execute(action(), {
    ...context,
    current_decision: { ...currentDecision(), proposed_action: 'PROPOSE_CANCEL' }
  }), (error) => error.code === 'PRECONDITION_BLOCKED'
    && error.blockers.includes('ACTION_DECISION_MISMATCH'));
  await assert.rejects(gateway.execute(action(), {
    ...context,
    current_decision: { ...currentDecision(), proposed_action: 'WAIT_FOR_EVIDENCE' }
  }), (error) => error.code === 'PRECONDITION_BLOCKED'
    && error.blockers.includes('DECISION_ACTION_NOT_EXECUTABLE'));
  assert.equal(writeAuthorityCalls, 0);
});

test('every new action envelope requires identity, idempotency and decision snapshot fields', () => {
  assert.deepEqual(createActionEnvelope(action()), action());
  for (const field of ['action_id', 'order_id', 'action_type', 'idempotency_key', 'decision_id', 'input_hash']) {
    assert.throws(() => createActionEnvelope({ ...action(), [field]: '' }), { code: 'INVALID_ACTION_ENVELOPE' });
  }
  assert.throws(() => createActionEnvelope({ ...action(), state_version: 0 }), { code: 'INVALID_ACTION_ENVELOPE' });
  assert.throws(() => createActionEnvelope({ ...action(), idempotency_key: 'caller-selected-key' }), { code: 'NON_CANONICAL_IDEMPOTENCY_KEY' });
});

test('inspection can only produce a zero-action blocked result', () => {
  const gateway = new ExecutionGateway({ executionModeResolution: resolveExecutionMode({}) });
  const result = gateway.inspect(action());
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
});

test('idempotency ledger claims a new action key exactly once', () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  assert.equal(ledger.claim(action()).claimed, true);
  const replay = ledger.claim(action());
  assert.equal(replay.claimed, false);
  assert.equal(replay.collision, false);
  const semanticRetry = ledger.claim({ ...action(), action_id: 'different-action-id' });
  assert.equal(semanticRetry.claimed, false);
  assert.equal(semanticRetry.collision, false);
  const regeneratedDecision = { ...action(), action_id: 'new-action', decision_id: 'new-decision' };
  regeneratedDecision.idempotency_key = canonicalActionIdempotencyKey(regeneratedDecision);
  assert.equal(regeneratedDecision.idempotency_key, action().idempotency_key);
  assert.equal(ledger.claim(regeneratedDecision).claimed, false);
});

test('unknown or failed preconditions block before any execution capability is considered', async () => {
  const gateway = new ExecutionGateway({ executionModeResolution: resolveExecutionMode({}) });
  await assert.rejects(gateway.execute(action(), {}), (error) => (
    error.code === 'PRECONDITION_BLOCKED'
    && error.blockers.includes('CONFLICT_CHECK_NOT_PASS')
    && error.blockers.includes('POLICY_GATE_NOT_PASS')
    && error.blockers.includes('STATE_STALE')
    && error.blockers.includes('STATE_VERSION_MISMATCH')
    && error.blockers.includes('INPUT_HASH_MISMATCH')
  ));
});

test('even all-PASS preconditions cannot cross the Phase 0.5 execution-mode boundary', async () => {
  let adapterCalls = 0;
  const gateway = new ExecutionGateway({
    executionModeResolution: resolveExecutionMode({}),
    writeAuthority: () => { adapterCalls += 1; throw Object.assign(new Error('blocked'), { code: 'EXECUTION_MODE_WRITE_BLOCKED' }); }
  });
  await assert.rejects(gateway.execute(action(), {
    conflict_check: 'PASS',
    policy_gate: 'PASS',
    database_available: true,
    credentials_consistent: true,
    state_fresh: true,
    current_state_version: 3,
    current_input_hash: 'a'.repeat(64)
    , current_decision: currentDecision()
  }), { code: 'EXECUTION_MODE_WRITE_BLOCKED' });
  assert.equal(adapterCalls, 1);
});

test('the gateway owns idempotency and never trusts a caller-supplied claim', async () => {
  let claims = 0;
  const ledger = { claim: (candidate) => { claims += 1; return { claimed: true, collision: false, record: candidate }; } };
  const gateway = new ExecutionGateway({
    executionModeResolution: resolveExecutionMode({}),
    idempotencyLedger: ledger,
    writeAuthority: () => undefined
  });
  await assert.rejects(gateway.execute(action(), {
    conflict_check: 'PASS', policy_gate: 'PASS', database_available: true,
    credentials_consistent: true, state_fresh: true, current_state_version: 3,
    current_input_hash: 'a'.repeat(64), current_decision: currentDecision(),
    idempotency_claim: 'FAKE_CALLER_CLAIM'
  }), { code: 'PHASE_0_5_EXTERNAL_EXECUTION_DISABLED' });
  assert.equal(claims, 1);
});
