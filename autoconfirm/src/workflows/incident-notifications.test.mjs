import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedOutboundAfterIncident,
  customerRespondedAfterIncident,
  incidentNotificationPolicy,
  incidentTemplateNameForType,
  messageHasAcceptedTemplate
} from './incident-notifications.mjs';

const now = Date.parse('2026-07-14T18:00:00.000Z');

function incident(overrides = {}) {
  return {
    orderId: '1291818',
    incidenceId: '1163809',
    incidenceDate: '2026-07-13T16:00:00.000Z',
    incidentType: 'rejected_goods',
    issueStatus: 'PENDING',
    chatbyUserNs: 'chat-1',
    customerResponded: false,
    chatbyIntent: 'outbound_only',
    lastCustomerMessage: '',
    ...overrides
  };
}

test('maps each supported incident type to the approved template', () => {
  assert.equal(incidentTemplateNameForType('absent'), 'es_ES dropea_incidencia_ausente_v2');
  assert.equal(incidentTemplateNameForType('address'), 'es_ES dropea_incidencia_direccion_v1');
  assert.equal(incidentTemplateNameForType('rejected_goods'), 'es_ES dropea_incidencia_mercancia_v1');
});

test('allows a due incident without customer response', () => {
  const result = incidentNotificationPolicy({ incident: incident(), messages: [], now, minAgeHours: 24 });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'notification_due');
});

test('blocks a customer cancellation after the incident', () => {
  const messages = [{ direction: 'inbound', created_at: '2026-07-14T10:00:00.000Z', text: 'Quiero cancelarlo' }];
  const result = incidentNotificationPolicy({
    incident: incident({ orderId: '1292937', incidentType: 'absent' }),
    messages,
    now,
    minAgeHours: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'customer_requests_cancellation');
});

test('recognizes Chatby direction in and blocks an earlier cancellation for the same order', () => {
  const messages = [{ type: 'in', ts: Date.parse('2026-07-13T10:00:00.000Z') / 1000, content: 'Cancelarlo' }];
  const result = incidentNotificationPolicy({
    incident: incident({ orderId: '1292937', incidentType: 'absent' }),
    messages,
    now,
    minAgeHours: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'customer_requests_cancellation');
});

test('blocks any other customer response after the incident', () => {
  const messages = [{ direction: 'inbound', created_at: '2026-07-14T10:00:00.000Z', text: 'Entregar por la tarde' }];
  const result = incidentNotificationPolicy({
    incident: incident({ incidentType: 'absent' }),
    messages,
    now,
    minAgeHours: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'customer_already_responded');
  assert.equal(customerRespondedAfterIncident(messages, incident().incidenceDate), true);
});

test('requires the rejected-goods template even when the customer already replied', () => {
  const messages = [{ direction: 'inbound', created_at: '2026-07-14T10:00:00.000Z', text: 'Ok' }];
  const result = incidentNotificationPolicy({ incident: incident(), messages, now, minAgeHours: 0 });
  assert.equal(result.eligible, true);
  assert.equal(result.templateName, 'es_ES dropea_incidencia_mercancia_v1');
  assert.equal(result.reason, 'notification_due');
});

test('does not let an unrelated outbound message replace the mandatory rejected-goods template', () => {
  const messages = [{
    type: 'agent',
    ts: Date.parse('2026-07-14T10:00:00.000Z') / 1000,
    mid: 'wamid.HBgLMzQ2UNRELATED',
    content: 'Otro mensaje saliente'
  }];
  const result = incidentNotificationPolicy({ incident: incident(), messages, now, minAgeHours: 0 });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'notification_due');
});

test('blocks a duplicate when a verified outbound message already exists after the incident', () => {
  const messages = [{
    type: 'agent',
    ts: Date.parse('2026-07-14T10:00:00.000Z') / 1000,
    mid: 'wamid.HBgLMzQ2MANUAL',
    content: 'Cuando quiere que realicemos la nueva entrega?'
  }];
  const result = incidentNotificationPolicy({
    incident: incident({ incidentType: 'absent' }),
    messages,
    now,
    minAgeHours: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'accepted_outbound_already_exists');
  assert.equal(acceptedOutboundAfterIncident(messages, incident().incidenceDate), true);
});

test('waits until the configured notification window', () => {
  const result = incidentNotificationPolicy({
    incident: incident({ incidenceDate: '2026-07-14T08:00:00.000Z' }),
    messages: [],
    now,
    minAgeHours: 24
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'waiting_notification_window');
});

test('fails closed when the Chatby conversation could not be verified', () => {
  const result = incidentNotificationPolicy({
    incident: incident({ chatbyReadVerified: false }),
    messages: [],
    now,
    minAgeHours: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'chatby_context_unverified');
});

test('only treats a template as accepted when a WhatsApp wamid exists', () => {
  const template = 'es_ES dropea_incidencia_mercancia_v1';
  const failedInternal = {
    created_at: '2026-07-14T10:00:00.000Z',
    content: { name: 'dropea_incidencia_mercancia_v1' },
    mid: 'internal-id'
  };
  const accepted = {
    created_at: '2026-07-14T10:00:00.000Z',
    content: { name: 'dropea_incidencia_mercancia_v1' },
    mid: 'wamid.HBgLMzQ2TEST'
  };
  assert.equal(messageHasAcceptedTemplate(failedInternal, template), false);
  assert.equal(messageHasAcceptedTemplate(accepted, template), true);
});
