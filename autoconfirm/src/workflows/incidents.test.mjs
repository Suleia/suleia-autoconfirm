import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIncident,
  incidentOperationalDecision,
  sortIncidentsByIncidenceDesc
} from './incidents.mjs';

const now = Date.parse('2026-07-16T16:00:00.000Z');

function chatby(lastCustomerMessage, operationalDetails = {}) {
  return {
    customerMessages: 1,
    chatbyReadVerified: true,
    lastCustomerMessage,
    rawCustomerText: lastCustomerMessage,
    operationalDetails: {
      wantsCancel: false,
      paymentQuestion: false,
      paymentMethod: '',
      deliveryTomorrow: false,
      deliveryMorning: false,
      deliveryAfternoon: false,
      deliveryBeforeTime: '',
      deliveryAfterTime: '',
      deliveryDay: '',
      phoneMentioned: '',
      ...operationalDetails
    }
  };
}

test('orders the incident panel by incidence id descending', () => {
  const sorted = sortIncidentsByIncidenceDesc([
    { orderId: '1300000', incidenceId: '1150000' },
    { orderId: '1290000', incidenceId: '1160000' },
    { orderId: '1310000', incidenceId: '1155000' }
  ]);
  assert.deepEqual(sorted.map((item) => item.incidenceId), ['1160000', '1155000', '1150000']);
});

test('classifies Dropea NAM as rejected goods and FD as address data', () => {
  assert.equal(classifyIncident({ incidence_code: 'NAM' }, {}).type, 'rejected_goods');
  assert.equal(classifyIncident({ incidence_code: 'FD' }, {}).type, 'address');
});

test('turns an exact before-time reply into an accepted delivery solution', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'absent' },
    chatby: chatby('Quiero recibirlo antes de las 19:00', { deliveryBeforeTime: '19:00' }),
    phone: '34651709719',
    now
  });
  assert.equal(decision.action, 'accept_solution');
  assert.equal(decision.ruleId, 'core_incident_exact_availability_accept');
  assert.match(decision.text, /antes de las 19:00/i);
  assert.match(decision.text, /651709719/);
  assert.ok(decision.text.length <= 80);
});

test('uses the exact new day communicated by an absent customer', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'absent' },
    chatby: chatby('He estado en casa y no vino nadie. Manana vuelvo a estar en casa.', {
      deliveryTomorrow: true,
      courierIssue: true
    }),
    phone: '34691289011',
    now
  });
  assert.equal(decision.action, 'accept_solution');
  assert.match(decision.text, /entrega manana/i);
  assert.match(decision.text, /691289011/);
});

test('keeps purchase intent when the customer asks to pay by card', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: chatby('Puedo pagar con tarjeta?', {
      paymentQuestion: true,
      paymentMethod: 'tarjeta'
    }),
    phone: '34698613168',
    now
  });
  assert.equal(decision.action, 'accept_solution');
  assert.equal(decision.ruleId, 'core_incident_payment_method_delivery');
  assert.match(decision.text, /pago con tarjeta/i);
  assert.match(decision.text, /698613168/);
});

test('maps a transport pickup annotation directly to pickup at depot', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'absent' },
    chatby: { customerMessages: 0, chatbyReadVerified: true },
    transportHistory: [{ text: '16/07/2026 12:52:14 - PASARAN A RECOGER EN AGENCIA' }],
    incidentDate: '2026-07-16T10:52:14.000Z',
    now
  });
  assert.equal(decision.action, 'pickup_at_depot');
  assert.equal(decision.text, '');
  assert.equal(decision.confidence, 99);
});

test('returns a no-money rejection after 72 hours without customer response', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: { customerMessages: 0, chatbyReadVerified: true },
    transportHistory: [{ text: 'NO TIENE DINERO' }],
    incidentDate: '2026-07-12T12:00:00.000Z',
    now
  });
  assert.equal(decision.action, 'return_to_origin');
  assert.equal(decision.ruleId, 'core_incident_return_after_rejection_72h');
});

test('does not return a no-money rejection when the customer responded later', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: chatby('Lo recibo manana', { deliveryTomorrow: true }),
    transportHistory: [{ text: 'NO TIENE DINERO' }],
    incidentDate: '2026-07-12T12:00:00.000Z',
    phone: '34600000000',
    now
  });
  assert.notEqual(decision.action, 'return_to_origin');
});
