import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIncident,
  executeIncidentDiscountNoResponseReturn,
  executeIncorrectAddressResolution,
  incidentDiscountNoResponseReturnDecision,
  incidentOperationalDecision,
  sortIncidentsByIncidenceDesc
} from './incidents.mjs';

const now = Date.parse('2026-07-16T16:00:00.000Z');

const rejectedDiscountIncident = {
  incidenceId: 'fixture-discount-issue',
  orderId: 'fixture-discount-order',
  incidentType: 'rejected_goods',
  chatbyUserNs: 'fixture-chat',
  chatbyReadVerified: true
};

const verifiedDiscount = {
  templateName: 'es_ES dropea_incidencia_descuento_5',
  sentAt: '2026-07-15T16:00:00.000Z',
  verified: true,
  responseStatus: 'NO_RESPONSE'
};

test('requests a return only after 24 hours from a verified discount with no customer activity', () => {
  const before = incidentDiscountNoResponseReturnDecision({
    incident: rejectedDiscountIncident,
    discountRecovery: verifiedDiscount,
    now: Date.parse('2026-07-16T15:59:59.999Z')
  });
  assert.equal(before.eligible, false);
  assert.equal(before.status, 'WAITING_24_HOURS');

  const due = incidentDiscountNoResponseReturnDecision({
    incident: rejectedDiscountIncident,
    discountRecovery: verifiedDiscount,
    now: Date.parse('2026-07-16T16:00:00.000Z')
  });
  assert.equal(due.eligible, true);
  assert.equal(due.action, 'return_to_origin');
  assert.equal(due.ruleId, 'core_incident_discount_no_response_return_24h');
});

test('any response or unverified Chatby read blocks the discount return rule', () => {
  const customerActed = incidentDiscountNoResponseReturnDecision({
    incident: rejectedDiscountIncident,
    discountRecovery: { ...verifiedDiscount, responseStatus: 'OTHER_RESPONSE' },
    now: Date.parse('2026-07-16T17:00:00.000Z')
  });
  assert.equal(customerActed.eligible, false);
  assert.equal(customerActed.status, 'BLOCKED_CUSTOMER_ACTIVITY');

  const unverified = incidentDiscountNoResponseReturnDecision({
    incident: { ...rejectedDiscountIncident, chatbyReadVerified: false },
    discountRecovery: verifiedDiscount,
    now: Date.parse('2026-07-16T17:00:00.000Z')
  });
  assert.equal(unverified.eligible, false);
  assert.equal(unverified.reason, 'chatby_context_unverified');
});

test('re-reads Chatby and requests one persistently claimed Dropea return', async () => {
  const calls = { claimed: 0, returned: 0, finished: null };
  const result = await executeIncidentDiscountNoResponseReturn(rejectedDiscountIncident, verifiedDiscount, {
    now: Date.parse('2026-07-16T17:00:00.000Z'),
    realEnabled: true,
    credentialAvailable: true,
    readCurrent: async () => ({ issue: { id: 'fixture-discount-issue' }, order: { orderId: 'fixture-discount-order' } }),
    readMessages: async () => [],
    claimReturn: async () => { calls.claimed += 1; return { acquired: true, persistent: true }; },
    returnIssue: async () => { calls.returned += 1; return { ok: true }; },
    verifyReturn: async () => ({ verified: true }),
    finishReturn: async (value) => { calls.finished = value; },
    auditReturn: async () => null
  });
  assert.equal(result.status, 'RETURN_REQUESTED_VERIFIED');
  assert.equal(result.verified, true);
  assert.equal(calls.claimed, 1);
  assert.equal(calls.returned, 1);
  assert.equal(calls.finished.status, 'verified');
});

test('a last-second Chatby action blocks the return before the persistent claim', async () => {
  const calls = { claimed: 0, returned: 0 };
  const result = await executeIncidentDiscountNoResponseReturn(rejectedDiscountIncident, verifiedDiscount, {
    now: Date.parse('2026-07-16T17:00:00.000Z'),
    realEnabled: true,
    credentialAvailable: true,
    readCurrent: async () => ({ issue: { id: 'fixture-discount-issue' }, order: { orderId: 'fixture-discount-order' } }),
    readMessages: async () => [{ type: 'in', created_at: '2026-07-16T16:30:00.000Z', content: 'Necesito ayuda' }],
    claimReturn: async () => { calls.claimed += 1; return { acquired: true, persistent: true }; },
    returnIssue: async () => { calls.returned += 1; }
  });
  assert.equal(result.status, 'BLOCKED_CUSTOMER_ACTIVITY');
  assert.equal(result.responseStatus, 'OTHER_RESPONSE');
  assert.equal(calls.claimed, 0);
  assert.equal(calls.returned, 0);
});

test('does not call Dropea when the durable return claim is unavailable or already exists', async () => {
  for (const claim of [
    { acquired: false, persistent: false, reason: 'persistent_dedupe_unavailable' },
    { acquired: false, persistent: true, reason: 'already_claimed' }
  ]) {
    let returned = 0;
    const result = await executeIncidentDiscountNoResponseReturn(rejectedDiscountIncident, verifiedDiscount, {
      now: Date.parse('2026-07-16T17:00:00.000Z'),
      realEnabled: true,
      credentialAvailable: true,
      readCurrent: async () => ({ issue: { id: 'fixture-discount-issue' }, order: { orderId: 'fixture-discount-order' } }),
      readMessages: async () => [],
      claimReturn: async () => claim,
      returnIssue: async () => { returned += 1; }
    });
    assert.equal(returned, 0);
    assert.match(result.status, /ALREADY_CLAIMED|BLOCKED_PERSISTENT_LEDGER/);
  }
});

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

test('executes only a freshly re-read exact address decision and records a persistent result', async () => {
  const calls = { resolved: 0, finished: null, audited: null };
  const incident = {
    incidenceId: 'fixture-issue',
    orderId: 'fixture-order',
    incidenceDate: '2026-07-16T10:00:00.000Z',
    chatbyUserNs: 'fixture-chat',
    phone: '+34600111222'
  };
  const decision = {
    eligible: true,
    action: 'accept_solution',
    ruleId: 'core_incident_incorrect_address_customer_solution',
    status: 'READY_FOR_DROPEA'
  };
  const result = await executeIncorrectAddressResolution(incident, decision, {
    realEnabled: true,
    readCurrent: async () => ({
      issue: { id: 'fixture-issue', incidence_code: 'FD', status: 'PENDING', description: 'Direccion incorrecta' },
      order: { orderId: 'fixture-order', customerPhone: '+34600111222' }
    }),
    readMessages: async () => [{
      type: 'in',
      created_at: '2026-07-16T10:15:00.000Z',
      content: 'Calle Prueba portal 4 piso 2 B'
    }],
    claimResolution: async () => ({ acquired: true, persistent: true }),
    resolveIssue: async (_issueId, text) => {
      calls.resolved += 1;
      assert.match(text, /Calle Prueba portal 4 piso 2 B/);
      assert.match(text, /600111222/);
    },
    verifyResolution: async () => true,
    finishResolution: async (value) => { calls.finished = value; },
    auditResolution: async (_incident, _decision, value) => { calls.audited = value; }
  });
  assert.equal(result.status, 'AUTO_RESOLVED');
  assert.equal(result.verified, true);
  assert.equal(calls.resolved, 1);
  assert.equal(calls.finished.status, 'verified');
  assert.deepEqual(calls.finished.evidence, {
    ruleId: 'core_incident_incorrect_address_customer_solution',
    verified: true
  });
  assert.equal(calls.audited.status, 'AUTO_RESOLVED');
});

test('does not retry an address incident after a persistent claim already exists', async () => {
  let resolved = 0;
  const result = await executeIncorrectAddressResolution({
    incidenceId: 'fixture-issue', orderId: 'fixture-order', incidenceDate: '2026-07-16T10:00:00.000Z',
    chatbyUserNs: 'fixture-chat', phone: '+34600111222'
  }, {
    eligible: true, action: 'accept_solution', ruleId: 'core_incident_incorrect_address_customer_solution', status: 'READY_FOR_DROPEA'
  }, {
    realEnabled: true,
    readCurrent: async () => ({
      issue: { id: 'fixture-issue', incidence_code: 'FD', status: 'PENDING', description: 'Direccion incorrecta' },
      order: { orderId: 'fixture-order', customerPhone: '+34600111222' }
    }),
    readMessages: async () => [{ type: 'in', created_at: '2026-07-16T10:15:00.000Z', content: 'Calle Prueba portal 4 piso 2 B' }],
    claimResolution: async () => ({ acquired: false, persistent: true, existing: { status: 'claimed' }, reason: 'already_claimed' }),
    resolveIssue: async () => { resolved += 1; }
  });
  assert.equal(result.status, 'MANUAL_REVIEW_ALREADY_CLAIMED');
  assert.equal(resolved, 0);
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

test('accepts a confirmed afternoon slot with the order phone and never returns it', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'absent' },
    chatby: chatby('He elegido por la tarde y confirmo que prefiero recibirlo por la tarde.'),
    transportHistory: [{ text: 'AUSENTE SEGUNDA VEZ' }],
    incidentDate: '2026-07-12T12:00:00.000Z',
    phone: '34687510419',
    now
  });
  assert.equal(decision.action, 'accept_solution');
  assert.equal(decision.ruleId, 'core_incident_confirmed_delivery_slot_accept');
  assert.equal(decision.confidence, 99);
  assert.equal(decision.text, 'Realizar nueva entrega por la tarde. Llamar antes al 687510419.');
  assert.notEqual(decision.action, 'return_to_origin');
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

test('returns a price rejection only after a verified 5 EUR offer and later explicit refusal', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: {
      ...chatby('No muchas gracias', { wantsCancel: true }),
      messagesForNotification: [
        { id: 30, type: 'in', ts: Date.parse('2026-07-16T15:53:11.000Z') / 1000, content: 'No muchas gracias' },
        { id: 20, type: 'agent', ts: Date.parse('2026-07-16T15:52:37.000Z') / 1000, content: 'Nos gustaria aplicarle un descuento de 5 EUR. Esta interesada?' },
        { id: 10, type: 'in', ts: Date.parse('2026-07-13T11:41:04.000Z') / 1000, content: 'CONFIRMAR MI PEDIDO' }
      ]
    },
    incidentDate: '2026-07-16T14:05:40.000Z',
    now
  });
  assert.equal(decision.action, 'return_to_origin');
  assert.equal(decision.ruleId, 'core_incident_discount_rejected_return');
  assert.equal(decision.confidence, 99);
});

test('does not return a price rejection when the discount offer is not verified', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: {
      ...chatby('No muchas gracias', { wantsCancel: true }),
      messagesForNotification: [
        { id: 30, type: 'in', ts: Date.parse('2026-07-16T15:53:11.000Z') / 1000, content: 'No muchas gracias' },
        { id: 10, type: 'agent', ts: Date.parse('2026-07-16T15:52:37.000Z') / 1000, content: 'Quiere que intentemos entregarlo otra vez?' }
      ]
    },
    incidentDate: '2026-07-16T14:05:40.000Z',
    now
  });
  assert.equal(decision.action, 'none');
  assert.equal(decision.eligible, false);
});

test('keeps the order active when the customer accepts the verified discount', () => {
  const decision = incidentOperationalDecision({
    classification: { type: 'rejected_goods' },
    chatby: {
      ...chatby('Si, me interesa'),
      messagesForNotification: [
        { id: 30, type: 'in', ts: Date.parse('2026-07-16T15:53:11.000Z') / 1000, content: 'Si, me interesa' },
        { id: 20, type: 'agent', ts: Date.parse('2026-07-16T15:52:37.000Z') / 1000, content: 'Podemos aplicarle un descuento de 5 euros. Esta interesada?' }
      ]
    },
    incidentDate: '2026-07-16T14:05:40.000Z',
    now
  });
  assert.equal(decision.action, 'none');
  assert.equal(decision.ruleId, 'core_incident_discount_accepted_requires_price_update');
  assert.equal(decision.confidence, 96);
});
