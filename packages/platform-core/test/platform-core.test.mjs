import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { InMemoryEventStore } from '../src/event-store.mjs';
import { OrderDigitalTwinBuilder } from '../src/digital-twin.mjs';
import { classifyDecisionRoute, DeterministicDecisionEngine } from '../src/decision-engine.mjs';
import { containsDirectPii, maskRecord } from '../src/masking.mjs';
import { LocalIngestionPipeline } from '../src/ingestion-pipeline.mjs';

const fixtures = JSON.parse(await fs.readFile(new URL('../fixtures/orders.json', import.meta.url), 'utf8'));

test('event store is idempotent and does not expose mutable events', () => {
  const store = new InMemoryEventStore();
  const input = { order_id: 'fixture-1', event_type: 'ORDER_CREATED', source_record_id: 'a', deduplication_key: 'fixture:a' };
  assert.equal(store.append(input).inserted, true);
  assert.equal(store.append(input).inserted, false);
  const copy = store.list('fixture-1');
  copy[0].payload.changed = true;
  assert.equal(store.list('fixture-1')[0].payload.changed, undefined);
});

test('all fixture decisions remain simulation-only', () => {
  assert.equal(fixtures.length, 32);
  for (const fixture of fixtures) {
    const store = new InMemoryEventStore();
    for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
    const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
    const decision = new DeterministicDecisionEngine().simulate(twin);
    assert.equal(decision.actions_executed, 0, fixture.id);
    assert.equal(decision.run_mode, 'SIMULATION', fixture.id);
    assert.equal(decision.proposed_action, fixture.expected.action, fixture.id);
    assert.equal(decision.route, fixture.expected.route, fixture.id);
  }
});

function simulateFixture(id) {
  const fixture = fixtures.find((item) => item.id === id);
  const store = new InMemoryEventStore();
  for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
  return new DeterministicDecisionEngine().simulate(twin);
}

test('aligned return evidence selects return to origin and strictly blocks discounts', () => {
  const decision = simulateFixture('incident-return-aligned');
  assert.equal(decision.workflow, 'INCIDENT_RETURN_TO_ORIGIN');
  assert.equal(decision.customer_intent, 'RETURN');
  assert.equal(decision.carrier_state, 'SHIPMENT_NOT_ACCEPTED');
  assert.equal(decision.proposed_action, 'RETURN_TO_ORIGIN');
  assert.equal(decision.route, 'DETERMINISTIC');
  assert.equal(decision.discount_offer_allowed, false);
  assert.equal(decision.commercial_recovery_allowed, false);
  assert.equal(decision.actions_executed, 0);
});

test('a later receive intent revokes return and requires human review', () => {
  const decision = simulateFixture('incident-return-revoked');
  assert.equal(decision.proposed_action, 'NO_ACTION');
  assert.equal(decision.route, 'HUMAN_REVIEW');
  assert.ok(decision.conflicting_evidence.includes('CUSTOMER_RETURN_REVOKED'));
});

test('carrier-confirmed agency pickup is deterministic and only proposes a safe message', () => {
  const decision = simulateFixture('agency-pickup-confirmed');
  assert.equal(decision.workflow, 'INCIDENT_AGENCY_PICKUP');
  assert.equal(decision.proposed_action, 'MARK_AGENCY_PICKUP');
  assert.equal(decision.customer_message_required, true);
  assert.equal(decision.customer_message_proposed, true);
  assert.equal(decision.customer_message_sent, false);
  assert.match(decision.customer_message_template, /recogida en la agencia/i);
  assert.equal(decision.discount_offer_allowed, false);
  assert.equal(decision.commercial_recovery_allowed, false);
  assert.equal(decision.actions_executed, 0);
});

test('customer pickup preference alone never replaces carrier evidence', () => {
  const decision = simulateFixture('agency-pickup-unconfirmed');
  assert.equal(decision.proposed_action, 'VERIFY_AGENCY_PICKUP');
  assert.equal(decision.route, 'HUMAN_REVIEW');
  assert.equal(decision.customer_message_sent, false);
});

test('later return evidence supersedes agency pickup and blocks action', () => {
  const decision = simulateFixture('agency-pickup-superseded-returned');
  assert.equal(decision.proposed_action, 'NO_ACTION');
  assert.equal(decision.route, 'HUMAN_REVIEW');
  assert.ok(decision.conflicting_evidence.includes('AGENCY_PICKUP_SUPERSEDED_BY_RETURN'));
});

test('an ambiguous absence reply does not become a return intent', () => {
  const decision = simulateFixture('absent-tomorrow-retry');
  assert.equal(decision.workflow, 'INCIDENT_AUSENTE');
  assert.equal(decision.proposed_action, 'WAIT_INCIDENT_WORKFLOW');
  assert.notEqual(decision.customer_intent, 'RETURN');
});

test('an attempted discount proposal cannot override an explicit aligned return', () => {
  const decision = simulateFixture('return-blocks-discount');
  assert.equal(decision.proposed_action, 'RETURN_TO_ORIGIN');
  assert.equal(decision.discount_offer_allowed, false);
  assert.equal(decision.commercial_recovery_allowed, false);
  assert.equal(decision.actions_executed, 0);
});

test('masking redacts contact and secret data', () => {
  const masked = maskRecord({
    phone: '+34612345482',
    email: 'maria@gmail.com',
    address: 'Calle Mayor 1, 2A',
    access_token: 'top-secret'
  });
  assert.equal(masked.phone, '*** *** 482');
  assert.equal(masked.email, 'm****@gmail.com');
  assert.equal(masked.address, '[ADDRESS REDACTED]');
  assert.equal(masked.access_token, '[REDACTED]');
  assert.equal(containsDirectPii(masked), false);
});

test('a cancellation after confirmation blocks the decision', () => {
  const fixture = fixtures.find((item) => item.id === 'changed-mind-within-hour');
  const store = new InMemoryEventStore();
  for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  assert.equal(decision.route, 'BLOCKED');
  assert.ok(decision.blocking_reasons.includes('CUSTOMER_INTENT_CONTRADICTION'));
});

test('local ingestion masks PII and deduplicates source records', () => {
  const store = new InMemoryEventStore();
  const pipeline = new LocalIngestionPipeline(store);
  const record = {
    source: 'chatby',
    source_record_id: 'message-123',
    order_id: 'fixture-ingestion',
    event_type: 'CHATBY_MESSAGE_RECEIVED',
    occurred_at: '2026-07-26T09:00:00.000Z',
    payload: {
      customer_name: 'Maria Example',
      phone: '+34612345482',
      text: 'Llamame en el 612345482'
    }
  };

  const first = pipeline.ingest(record);
  const duplicate = pipeline.ingest(record);
  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(first.actions_executed, 0);
  assert.equal(first.run_mode, 'SIMULATION');
  assert.equal(first.event.payload.customer_name, '[NAME REDACTED]');
  assert.equal(containsDirectPii(first.event.payload), false);
});

test('local ingestion rejects unknown sources before creating an event', () => {
  const store = new InMemoryEventStore();
  const pipeline = new LocalIngestionPipeline(store);
  assert.throws(() => pipeline.ingest({
    source: 'production-direct',
    source_record_id: 'unsafe-1',
    order_id: 'fixture-ingestion',
    event_type: 'ORDER_CREATED'
  }), /Unsupported ingestion source/);
  assert.equal(store.list().length, 0);
});

test('critical-risk proposals are always blocked', () => {
  const route = classifyDecisionRoute({
    source_quality: { freshness: 'FRESH' },
    contradictions: [],
    warnings: []
  }, {
    confidence: 1,
    risk: 'CRITICAL'
  });
  assert.equal(route, 'BLOCKED');
});

test('UNKNOWN cases reaching 72 hours require human review without execution', () => {
  const fixture = fixtures.find((item) => item.id === 'unknown-72h');
  const store = new InMemoryEventStore();
  for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  assert.equal(decision.proposed_action, 'NO_ACTION');
  assert.equal(decision.route, 'HUMAN_REVIEW');
  assert.equal(decision.policy_state, 'UNKNOWN');
  assert.equal(decision.administrative_alert.required, true);
  assert.equal(decision.administrative_alert.type, 'UNKNOWN_72H_REVIEW');
  assert.equal(decision.actions_executed, 0);
  assert.equal(decision.run_mode, 'SIMULATION');
});
