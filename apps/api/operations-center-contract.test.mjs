import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Operations Center migration has two queues, safety checks and no storefront status surface', () => {
  const migration = fs.readFileSync(new URL('../../migrations/006_operations_center_read_models.sql', import.meta.url), 'utf8');
  assert.match(migration, /operations_orders_queue/);
  assert.match(migration, /operations_incidents_queue/);
  assert.match(migration, /WHERE status = 'PENDING' AND is_active = true/);
  assert.match(migration, /CHECK \(email_sent = false\)/);
  assert.match(migration, /CHECK \(actions_executed = 0\)/);
  assert.doesNotMatch(migration, /shopify/i);
});
