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
  assert.match(migration, /w\.canonical_order_id = i\.canonical_order_id/);
  assert.doesNotMatch(migration, /shopify/i);
});

test('Operations Center rollback removes only its schema objects and preserves global roles', () => {
  const rollback = fs.readFileSync(new URL('../../migrations/rollback/006_operations_center_read_models.down.sql', import.meta.url), 'utf8');
  assert.match(rollback, /DROP TABLE IF EXISTS read_models\.operations_order_records/);
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.operations_incident_detail/);
  assert.doesNotMatch(rollback, /DROP ROLE|DROP OWNED|suleia_api_login/i);
});
