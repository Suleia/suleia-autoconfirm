import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicDecisionEngine, isDecisionCurrent } from '../src/decision-engine.mjs';
import { OrderDigitalTwinBuilder } from '../src/digital-twin.mjs';
import { InMemoryEventStore, createEvent } from '../src/event-store.mjs';

function append(store, input) {
  return store.append({
    source: 'fixture',
    source_record_id: input.source_record_id,
    deduplication_key: `fixture:${input.source_record_id}`,
    order_id: 'order-shadow-1',
    trust_level: 'HIGH',
    freshness_status: 'FRESH',
    ...input
  });
}

test('stream versions are monotonic, deterministic for equal timestamps and unchanged by duplicates', () => {
  const store = new InMemoryEventStore();
  const first = append(store, {
    source_record_id: 'one', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  const duplicate = append(store, {
    source_record_id: 'one', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  const second = append(store, {
    source_record_id: 'two', event_type: 'CUSTOMER_CANCELLED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  assert.equal(first.event.stream_version, 1);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.event.stream_version, 1);
  assert.equal(second.event.stream_version, 2);
  assert.deepEqual(store.list('order-shadow-1').map((event) => event.event_type), [
    'ORDER_CREATED', 'CUSTOMER_CANCELLED'
  ]);
});

test('invalid or future-dated source facts fail closed before temporal precedence', () => {
  const store = new InMemoryEventStore();
  assert.throws(() => append(store, {
    source_record_id: 'invalid', event_type: 'CUSTOMER_CONFIRMED', occurred_at: 'not-a-timestamp'
  }), /Invalid event timestamp/);
  assert.throws(() => store.append({
    order_id: 'order-shadow-1', source: 'fixture', source_record_id: 'future',
    deduplication_key: 'fixture:future', event_type: 'CUSTOMER_CONFIRMED',
    occurred_at: '2026-08-19T11:00:00.000Z', received_at: '2026-08-19T10:00:00.000Z'
  }), /occurred_at is after received_at/);
  assert.throws(() => store.append({
    order_id: 'order-shadow-1', source: 'fixture', source_record_id: 'equal-future',
    deduplication_key: 'fixture:equal-future', event_type: 'CUSTOMER_CONFIRMED',
    occurred_at: '2100-01-01T00:00:00.000Z', received_at: '2100-01-01T00:00:00.000Z'
  }), /received_at exceeds trusted clock skew/);
  assert.throws(() => store.append({
    order_id: 'order-shadow-1', source: 'fixture', source_record_id: 'empty-time',
    deduplication_key: 'fixture:empty-time', event_type: 'CUSTOMER_CONFIRMED', occurred_at: ''
  }), /Invalid event timestamp/);
  assert.throws(() => createEvent({
    order_id: 'order-shadow-1', event_type: 'CUSTOMER_CONFIRMED', stream_version: 0
  }), /Invalid event stream_version/);
  assert.equal(store.list('order-shadow-1').length, 0);
});

test('accepted events are deeply immutable and checksum-stable inside the store', () => {
  const store = new InMemoryEventStore();
  const accepted = store.append({
    order_id: 'order-shadow-1', source: 'fixture', source_record_id: 'immutable',
    deduplication_key: 'fixture:immutable', event_type: 'ORDER_CREATED',
    occurred_at: '2026-08-19T10:00:00.000Z', received_at: '2026-08-19T10:01:00.000Z',
    payload: { status: 'PENDING', nested: { marker: 'original' } }
  }).event;
  const checksum = accepted.checksum;
  assert.equal(Object.isFrozen(accepted.payload), true);
  assert.equal(Object.isFrozen(accepted.payload.nested), true);
  assert.throws(() => { accepted.payload.nested.marker = 'mutated'; }, TypeError);
  const replayed = store.list('order-shadow-1')[0];
  assert.equal(replayed.payload.nested.marker, 'original');
  assert.equal(replayed.checksum, checksum);
});

test('a stale later fact cannot produce an executable temporal winner', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'cancel', event_type: 'CUSTOMER_CANCELLED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  append(store, {
    source_record_id: 'confirm-stale', event_type: 'CUSTOMER_CONFIRMED', occurred_at: '2026-08-19T10:30:00.000Z',
    freshness_status: 'STALE'
  });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:31:00.000Z'));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  assert.equal(twin.customer_intent, 'CONFIRM');
  assert.equal(decision.route, 'BLOCKED');
  assert.equal(decision.actions_executed, 0);
});

test('a newer fresh observation supersedes stale history only within the same source domain', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'order-stale', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T09:00:00.000Z',
    freshness_status: 'STALE', payload: { status: 'PENDING' }
  });
  append(store, {
    source_record_id: 'order-fresh', event_type: 'ORDER_STATUS_CHANGED', occurred_at: '2026-08-19T09:30:00.000Z',
    freshness_status: 'FRESH', payload: { status: 'PENDING' }
  });
  const refreshedTwin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T09:31:00.000Z'));
  assert.equal(refreshedTwin.source_quality.freshness, 'FRESH');
  assert.deepEqual(refreshedTwin.source_quality.stale_domains, []);

  append(store, {
    source_record_id: 'order-stale-latest', event_type: 'ORDER_STATUS_CHANGED', occurred_at: '2026-08-19T09:45:00.000Z',
    freshness_status: 'STALE', payload: { status: 'PENDING' }
  });
  const staleTwin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T09:46:00.000Z'));
  const decision = new DeterministicDecisionEngine().simulate(staleTwin);
  assert.equal(staleTwin.source_quality.freshness, 'STALE');
  assert.ok(staleTwin.source_quality.stale_domains.includes('fixture:ORDER'));
  assert.equal(decision.route, 'BLOCKED');
});

test('a decision carries the minimum immutable shadow snapshot contract', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'created', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T09:00:00.000Z',
    payload: { status: 'PENDING' }
  });
  append(store, {
    source_record_id: 'confirm', event_type: 'CUSTOMER_CONFIRMED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:10:00.000Z'));
  const decision = new DeterministicDecisionEngine({
    clock: () => new Date('2026-08-19T10:10:00.000Z')
  }).simulate(twin);
  assert.equal(typeof decision.decision_id, 'string');
  assert.equal(decision.order_id, 'order-shadow-1');
  assert.equal(decision.state_version, 2);
  assert.equal(decision.created_at, '2026-08-19T10:10:00.000Z');
  assert.match(decision.input_hash, /^[a-f0-9]{64}$/);
  assert.match(decision.policy_hash, /^[a-f0-9]{64}$/);
  assert.equal(decision.actions_executed, 0);
  assert.equal(isDecisionCurrent(decision, twin), false);
  assert.equal(isDecisionCurrent(decision, twin, { policy: decision.policy_snapshot }), true);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.policy_snapshot), true);
  assert.equal(Object.isFrozen(decision.confidence_breakdown), true);
  assert.throws(() => { decision.proposed_action = 'PROPOSE_CANCEL'; }, TypeError);
  assert.equal(Object.isFrozen(twin.logistics), true);
  assert.equal(Object.isFrozen(twin.source_quality), true);
  assert.throws(() => { twin.logistics.delivered = true; }, TypeError);
});

test('every field consumed by routing and the policy snapshot participates in freshness', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'created', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T09:00:00.000Z',
    payload: { status: 'PENDING' }
  });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:10:00.000Z'));
  const engine = new DeterministicDecisionEngine({ clock: () => new Date('2026-08-19T10:10:00.000Z') });
  const decision = engine.simulate(twin);
  const deliveredTwin = structuredClone(twin);
  deliveredTwin.logistics.delivered = true;
  assert.equal(isDecisionCurrent(decision, deliveredTwin, { policy: decision.policy_snapshot }), false);
  assert.equal(engine.simulate(deliveredTwin).proposed_action, 'NO_ACTION');
  assert.equal(isDecisionCurrent(decision, twin, { policy: { ...decision.policy_snapshot, deterministicConfidence: 0.97 } }), false);
});

test('a later semantically valid customer fact makes the prior decision stale and forces reevaluation', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'created', event_type: 'ORDER_CREATED', occurred_at: '2026-08-19T09:00:00.000Z',
    payload: { status: 'PENDING' }
  });
  append(store, {
    source_record_id: 'cancel', event_type: 'CUSTOMER_CANCELLED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  const builder = new OrderDigitalTwinBuilder(store);
  const oldTwin = builder.buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:10:00.000Z'));
  const engine = new DeterministicDecisionEngine({ clock: () => new Date('2026-08-19T10:10:00.000Z') });
  const oldDecision = engine.simulate(oldTwin);

  append(store, {
    source_record_id: 'accept-later', event_type: 'CUSTOMER_CONFIRMED', occurred_at: '2026-08-19T10:30:00.000Z'
  });
  const currentTwin = builder.buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:31:00.000Z'));
  assert.equal(currentTwin.customer_intent, 'CONFIRM');
  assert.equal(currentTwin.state_version, 3);
  assert.equal(engine.isCurrent(oldDecision, currentTwin), false);
  const reevaluated = new DeterministicDecisionEngine({
    clock: () => new Date('2026-08-19T10:31:00.000Z')
  }).simulate(currentTwin);
  assert.equal(reevaluated.route, 'DETERMINISTIC');
  assert.equal(reevaluated.proposed_action, 'WAIT_CONFIRMATION_WINDOW');
  assert.equal(isDecisionCurrent(reevaluated, currentTwin), false);
  assert.equal(isDecisionCurrent(reevaluated, currentTwin, { policy: reevaluated.policy_snapshot }), true);
  assert.equal(reevaluated.actions_executed, 0);
});

test('a later valid cancellation supersedes an earlier confirmation without permanent contradiction', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'confirm-first', event_type: 'CUSTOMER_CONFIRMED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  append(store, {
    source_record_id: 'cancel-later', event_type: 'CUSTOMER_CANCELLED', occurred_at: '2026-08-19T10:30:00.000Z'
  });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:31:00.000Z'));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  assert.equal(twin.customer_intent, 'CANCEL');
  assert.deepEqual(twin.contradictions, []);
  assert.equal(decision.route, 'DETERMINISTIC');
  assert.equal(decision.proposed_action, 'PROPOSE_CANCEL');
  assert.equal(decision.actions_executed, 0);
});

test('same-time opposing customer facts remain blocked as ambiguous', () => {
  const store = new InMemoryEventStore();
  append(store, {
    source_record_id: 'confirm-same', event_type: 'CUSTOMER_CONFIRMED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  append(store, {
    source_record_id: 'cancel-same', event_type: 'CUSTOMER_CANCELLED', occurred_at: '2026-08-19T10:00:00.000Z'
  });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin('order-shadow-1', new Date('2026-08-19T10:01:00.000Z'));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  assert.ok(twin.contradictions.includes('CUSTOMER_INTENT_CONTRADICTION'));
  assert.equal(decision.route, 'BLOCKED');
  assert.equal(decision.actions_executed, 0);
});
