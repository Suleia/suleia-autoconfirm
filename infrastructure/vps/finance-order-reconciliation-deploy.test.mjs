import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/033_finance_order_reconciliation.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/033_finance_order_reconciliation.down.sql', import.meta.url), 'utf8');
const apply = fs.readFileSync(new URL('./apply-finance-order-reconciliation-migration.sh', import.meta.url), 'utf8');

test('finance order reconciliation migration exposes only the exact provider join key', () => {
  assert.match(migration, /r\.dropea_order_id/);
  assert.match(migration, /GRANT SELECT .*suleia_operations_readonly,suleia_backup/);
  assert.match(migration, /amount=1\.00[\s\S]*cost_type='OUTBOUND_FULFILLMENT'/);
  assert.match(migration, /amount=1\.20[\s\S]*cost_type='COD'/);
  assert.doesNotMatch(migration, /suleia_mcp_readonly[^;]*GRANT/i);
  assert.match(rollback, /CREATE OR REPLACE VIEW read_models\.operations_finance_order_inputs/);
  assert.match(apply, /033_finance_order_reconciliation\.sql/);
  assert.match(apply, /ON_ERROR_STOP=1/);
});
