import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventStore } from '../src/event-store.mjs';
import { OrderDigitalTwinBuilder } from '../src/digital-twin.mjs';
import { DeterministicDecisionEngine } from '../src/decision-engine.mjs';

const GOLDEN_DIGEST = '6a3f792cff4ecf0d8aae6ec79b38e02c9744e8bde32924158e4de5f592ce641f';
const fixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/orders.json', import.meta.url), 'utf8'));

test('CURRENT_PROD_CANONICAL_BEHAVIOUR remains byte-exact across all 32 anonymized cases', () => {
  const decisions = fixtures.map((fixture) => {
    const store = new InMemoryEventStore();
    for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
    const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
    const decision = new DeterministicDecisionEngine().simulate(twin);
    return {
      id: fixture.id,
      action: decision.proposed_action,
      route: decision.route,
      workflow: decision.workflow,
      reason_codes: decision.reason_codes,
      requires_human_review: decision.requires_human_review
    };
  });
  const digest = crypto.createHash('sha256').update(JSON.stringify(decisions)).digest('hex');
  assert.equal(fixtures.length, 32);
  assert.equal(digest, GOLDEN_DIGEST);
  assert.equal(decisions.every((decision) => !('action_executed' in decision)), true);
});
