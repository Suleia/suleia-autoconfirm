import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_RESPONSE_WAIT_STATE,
  evaluateIncidentResponseWait
} from './incident-response-wait.mjs';

const incidentAt = '2026-07-20T09:22:21.000Z';

function evaluate(overrides = {}) {
  return evaluateIncidentResponseWait({
    orderId: '1300310',
    incidenceId: 'current-2',
    incidentType: 'address',
    reason: 'FALTAN DATOS',
    observation: 'No hay piso y no contesta el telefono',
    incidentAt,
    messages: [],
    chatbyReadVerified: true,
    currentIncidentVerified: true,
    dropeaStillPending: true,
    dropeaStatus: 'CON INCIDENCIA',
    now: Date.parse('2026-07-21T09:22:20.000Z'),
    ...overrides
  });
}

test('A: waits when the customer has not responded and 48 hours have not elapsed', () => {
  const result = evaluate();
  assert.equal(result.state, INCIDENT_RESPONSE_WAIT_STATE);
  assert.equal(result.pendingDecision, 'WAIT_FOR_CUSTOMER');
  assert.equal(result.expired, false);
  assert.equal(result.validResponse, false);
  assert.equal(result.deadlineAt, '2026-07-22T09:22:21.000Z');
});

test('Dropea local timestamps preserve the Madrid wall-clock deadline', () => {
  const result = evaluate({
    incidentAt: '2026-07-20T09:22:21',
    now: Date.parse('2026-07-21T07:22:21.000Z')
  });
  assert.equal(result.incidentAt, '2026-07-20T07:22:21.000Z');
  assert.equal(result.deadlineAt, '2026-07-22T07:22:21.000Z');
});

test('B: proposes return to origin after 48 hours but remains training only', () => {
  const result = evaluate({ now: Date.parse('2026-07-22T09:22:22.000Z') });
  assert.equal(result.pendingDecision, 'RETURN_TO_ORIGIN_TRAINING');
  assert.equal(result.expired, true);
  assert.equal(result.trainingOnly, true);
  assert.equal(result.finalVerificationReady, true);
});

test('C: a useful inbound customer response inside the window cancels the return proposal', () => {
  const result = evaluate({
    messages: [{ type: 'in', created_at: '2026-07-21T08:00:00.000Z', content: 'Falta el piso 3 puerta B. Podeis llamarme antes.' }],
    now: Date.parse('2026-07-23T09:22:22.000Z')
  });
  assert.equal(result.validResponse, true);
  assert.equal(result.pendingDecision, 'PROCESS_CUSTOMER_RESPONSE');
  assert.match(result.latestValidMessage, /piso 3 puerta B/i);
});

test('D: a newer carrier incident restarts the complete 48-hour deadline', () => {
  const oldResult = evaluate({
    incidenceId: 'old-1',
    incidentAt: '2026-07-17T10:58:00.000Z',
    now: Date.parse('2026-07-20T12:00:00.000Z')
  });
  const currentResult = evaluate({ now: Date.parse('2026-07-20T12:00:00.000Z') });
  assert.equal(oldResult.expired, true);
  assert.equal(currentResult.expired, false);
  assert.equal(currentResult.deadlineAt, '2026-07-22T09:22:21.000Z');
});

test('E: an inbound message before the current incident is not a valid response', () => {
  const result = evaluate({
    messages: [{ type: 'in', created_at: '2026-07-19T15:00:00.000Z', content: 'La direccion es correcta.' }]
  });
  assert.equal(result.validResponse, false);
  assert.equal(result.postIncidentInboundCount, 0);
  assert.equal(result.pendingDecision, 'WAIT_FOR_CUSTOMER');
});

test('F: a Chatby read failure after 48 hours fails closed to manual review', () => {
  const result = evaluate({
    chatbyReadVerified: false,
    now: Date.parse('2026-07-22T09:22:22.000Z')
  });
  assert.equal(result.pendingDecision, 'MANUAL_REVIEW');
  assert.equal(result.finalVerificationReady, false);
  assert.equal(result.verificationStatus, 'chatby_unverified');
});

test('outbound templates and empty inbound messages never count as valid responses', () => {
  const result = evaluate({
    messages: [
      { type: 'agent', created_at: '2026-07-21T08:00:00.000Z', content: 'Plantilla de direccion' },
      { type: 'in', created_at: '2026-07-21T08:01:00.000Z', content: 'ok' }
    ]
  });
  assert.equal(result.validResponse, false);
  assert.equal(result.postIncidentInboundCount, 1);
});
