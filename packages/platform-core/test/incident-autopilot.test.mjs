import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAutopilotTransition,
  buildIncidentAutopilotProjection,
  createAutopilotActionIntent,
  customerActionForIncident,
  expiredTimerReevaluation
} from '../src/incident/autopilot.mjs';
import { verifyIncidentAction } from '../src/incident/autopilot-verification.mjs';
import { replayIncidentAutopilot } from '../src/incident/autopilot-replay.mjs';

const now = '2026-09-19T12:00:00.000Z';
const issue = { canonical_issue_id: 'issue-1', canonical_order_id: 'order-1', status: 'PENDING', is_active: true,
  created_at: '2026-09-19T08:00:00.000Z', updated_at: '2026-09-19T08:00:00.000Z', source_event_id: 'event-1' };
const order = { canonical_order_id: 'order-1', canonical_state: 'SHIPPING' };

test('initial order confirmation is never incident evidence', () => {
  const result = customerActionForIncident({ incident: issue, now,
    evidence: { notification_at: '2026-09-19T09:00:00Z', conversation_status: 'FOUND', message: 'CONFIRMAR MI PEDIDO', incident_relevance: 'AFTER_NOTIFICATION' },
    interpretation: { latest_inbound_message_at: '2026-09-19T10:00:00Z', customer_intent: 'CONFIRM' } });
  assert.equal(result.customerInteracted, true);
  assert.equal(result.validIncidentResponse, false);
  assert.equal(result.customerActed, false);
});

test('a valid post-notification customer answer is incident-bound', () => {
  const result = customerActionForIncident({ incident: issue, now,
    evidence: { notification_at: '2026-09-19T09:00:00Z', conversation_status: 'FOUND', message: 'Mañana por la mañana', incident_relevance: 'AFTER_NOTIFICATION' },
    interpretation: { latest_inbound_message_at: '2026-09-19T10:00:00Z', customer_intent: 'RESCHEDULE_DELIVERY', latest_relevant_message_hash: 'hash-1' } });
  assert.equal(result.validIncidentResponse, true);
  assert.equal(result.customerActionSource, 'CHATBY_EXACT_POST_NOTIFICATION');
});

test('an unmatched conversation can never become incident evidence', () => {
  const result = customerActionForIncident({ incident: issue, now,
    evidence: { notification_at: '2026-09-19T09:00:00Z', conversation_status: 'NONE', message: 'Mañana', incident_relevance: 'AFTER_NOTIFICATION' },
    interpretation: { latest_inbound_message_at: '2026-09-19T10:00:00Z', customer_intent: 'RESCHEDULE_DELIVERY' } });
  assert.equal(result.conversationFound, false);
  assert.equal(result.validIncidentResponse, false);
});

test('action intents are idempotent and can never be LIVE', () => {
  const input = { orderId: 'order-1', incidentId: 'issue-1', actionType: 'REQUEST_REDELIVERY', payload: { day: 'tomorrow' }, createdAt: now };
  const one = createAutopilotActionIntent(input);
  const two = createAutopilotActionIntent({ ...input, createdAt: '2026-09-19T12:05:00Z' });
  assert.equal(one.idempotencyKey, two.idempotencyKey);
  assert.equal(one.externalWriteAttempted, false);
  assert.throws(() => createAutopilotActionIntent({ ...input, mode: 'LIVE' }), /cannot be LIVE/);
});

test('projection reaches the derived state in one shadow cycle', () => {
  const projection = buildIncidentAutopilotProjection({ issue, order, now,
    interpretation: { has_customer_replied: false },
    decision: { decision_id: 'decision-1', simulated_action: { action_type: 'REQUEST_REDELIVERY' } } });
  assert.equal(projection.state, 'ACTION_PENDING');
  assert.deepEqual(projection.transitions.map(value => `${value.fromState}->${value.toState}`), [
    'DETECTED->CONTEXT_LOADING','CONTEXT_LOADING->READY_FOR_DECISION','READY_FOR_DECISION->ACTION_PENDING'
  ]);
  assert.equal(projection.transition.fromState, 'READY_FOR_DECISION');
  assert.equal(projection.transition.toState, 'ACTION_PENDING');
  assert.equal(projection.productionWrites, 0);
});

test('expired timers only refresh sources and reevaluate policy', () => {
  const event = expiredTimerReevaluation({ timer_id: 'timer-1', issue_id: 'issue-1', status: 'ACTIVE', due_at: '2026-09-19T11:59:00Z' }, { now });
  assert.equal(event.command, 'REFRESH_CONTEXT_AND_REEVALUATE');
  assert.equal(event.directAction, null);
  const projection = buildIncidentAutopilotProjection({ issue, order, now,
    timer: { status: 'ACTIVE', due_at: '2026-09-19T11:59:00Z' } });
  assert.equal(projection.state, 'READY_FOR_DECISION');
});

test('verification requires provider evidence and escalates after retries', () => {
  const action = createAutopilotActionIntent({ orderId: 'order-1', incidentId: 'issue-1', actionType: 'REQUEST_REDELIVERY', createdAt: now });
  assert.equal(verifyIncidentAction({ action, expected: { status: 'REDELIVERY' }, observed: null }).status, 'PENDING');
  assert.equal(verifyIncidentAction({ action, expected: { status: 'REDELIVERY' }, observed: { status: 'OTHER' }, attempt: 3 }).status, 'FAILED');
  assert.equal(verifyIncidentAction({ action, expected: { status: 'REDELIVERY' }, observed: { status: 'REDELIVERY' } }).status, 'VERIFIED');
});

test('replay reports no unsafe action for the shadow engine', () => {
  const projection = buildIncidentAutopilotProjection({ issue, order, now });
  const result = replayIncidentAutopilot([projection]);
  assert.equal(result.potential_unsafe_actions, 0);
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
});

test('invalid state transitions fail closed', () => {
  assert.throws(() => assertAutopilotTransition('RESOLVED', 'ACTION_EXECUTING'), /Invalid Autopilot transition/);
});
