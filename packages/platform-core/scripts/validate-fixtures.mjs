import fs from 'node:fs/promises';
import { InMemoryEventStore } from '../src/event-store.mjs';
import { OrderDigitalTwinBuilder } from '../src/digital-twin.mjs';
import { DeterministicDecisionEngine } from '../src/decision-engine.mjs';

const fixtures = JSON.parse(await fs.readFile(new URL('../fixtures/orders.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  const store = new InMemoryEventStore();
  for (const event of fixture.events) store.append({ ...event, order_id: fixture.order_id });
  const twin = new OrderDigitalTwinBuilder(store).buildCurrentTwin(fixture.order_id, new Date(fixture.now));
  const decision = new DeterministicDecisionEngine().simulate(twin);
  if (decision.proposed_action !== fixture.expected.action || decision.route !== fixture.expected.route) {
    throw new Error(`${fixture.id}: expected ${fixture.expected.action}/${fixture.expected.route}, got ${decision.proposed_action}/${decision.route}`);
  }
}
console.log(`Validated ${fixtures.length} fictitious simulations with actions_executed=0.`);
