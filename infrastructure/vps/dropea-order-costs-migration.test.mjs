import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Dropea order costs migration is additive, reversible and deployed after finance schema', () => {
  const up = read('migrations/025_dropea_order_costs.sql');
  const down = read('migrations/rollback/025_dropea_order_costs.down.sql');
  const apply = read('infrastructure/vps/apply-dropea-order-costs-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.match(up, /ADD COLUMN IF NOT EXISTS order_costs_masked jsonb/);
  assert.match(up, /Null means unavailable; it is never interpreted as zero/);
  assert.match(up, /CREATE OR REPLACE VIEW read_models\.operations_order_financial_inputs/);
  assert.match(up, /REVOKE ALL ON read_models\.operations_order_financial_inputs FROM PUBLIC,suleia_mcp_readonly/);
  assert.match(up, /GRANT SELECT ON read_models\.operations_order_financial_inputs TO suleia_operations_readonly,suleia_backup/);
  assert.match(down, /DROP COLUMN IF EXISTS order_costs_masked/);
  assert.match(down, /DROP VIEW IF EXISTS read_models\.operations_order_financial_inputs/);
  assert.match(apply, /025_dropea_order_costs\.sql/);
  assert.ok(deploy.indexOf('apply-financial-control-migration.sh') < deploy.indexOf('apply-dropea-order-costs-migration.sh'));
  assert.doesNotMatch(`${up}\n${apply}`, /DROPEA_(?:CONFIRM|CANCEL)|CHATBY_SEND|META_ADS_BUDGET/);
});
