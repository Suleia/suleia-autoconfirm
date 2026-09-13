import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/032_finance_results_performance.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/032_finance_results_performance.down.sql', import.meta.url), 'utf8');
const apply = fs.readFileSync(new URL('./apply-finance-results-performance-migration.sh', import.meta.url), 'utf8');
const deploy = fs.readFileSync(new URL('./deploy-private-staging.sh', import.meta.url), 'utf8');

test('finance results use a dedicated read-only projection without operational case joins', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW read_models\.operations_finance_order_inputs/);
  assert.match(migration, /FROM read_models\.operations_order_records r/);
  assert.match(migration, /LEFT JOIN integration\.dropea_orders d/);
  assert.match(migration, /DISTINCT ON \(canonical_order_id\)/);
  assert.match(migration, /DISTINCT ON \(dropea_order_id\)/);
  assert.doesNotMatch(migration.split('CREATE OR REPLACE VIEW read_models.finance_available_months')[0], /operations_order_context/);
  assert.match(migration, /REVOKE ALL .* FROM PUBLIC,suleia_mcp_readonly/);
  assert.match(migration, /GRANT SELECT .* TO suleia_operations_readonly,suleia_backup/);
  assert.doesNotMatch(migration, /customer_(?:name|phone|email)|message_text/i);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:operations|integration)\./i);
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.operations_finance_order_inputs/);
  assert.match(apply, /032_finance_results_performance\.sql/);
  assert.match(apply, /production_writes=0/);
  assert.ok(deploy.indexOf('apply-finance-results-performance-migration.sh') > deploy.indexOf('apply-finance-realized-event-rates-migration.sh'));
});
