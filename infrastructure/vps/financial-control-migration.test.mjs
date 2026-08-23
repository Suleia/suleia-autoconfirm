import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('financial control schema is additive, reversible and isolated from MCP and external actions', () => {
  const up = read('migrations/024_financial_control.sql');
  const down = read('migrations/rollback/024_financial_control.down.sql');
  const apply = read('infrastructure/vps/apply-financial-control-migration.sh');
  const drill = read('infrastructure/vps/run-financial-control-rollback-drill.sh');
  for (const table of ['finance_cost_rates', 'finance_fixed_expenses', 'finance_ad_spend_daily', 'finance_sync_checkpoints']) {
    assert.match(up, new RegExp(`CREATE TABLE IF NOT EXISTS economics\\.${table}`));
    assert.match(down, new RegExp(`DROP TABLE IF EXISTS economics\\.${table}`));
  }
  assert.match(up, /GRANT SELECT,INSERT,UPDATE ON economics\.finance_ad_spend_daily,economics\.finance_sync_checkpoints\s+TO suleia_ingestion/);
  assert.doesNotMatch(up, /GRANT[^;]+suleia_mcp_readonly/i);
  assert.doesNotMatch(up, /\b(?:customer_name|phone|email|postal_address)\b/i);
  assert.match(apply, /024_financial_control\.sql/);
  assert.match(drill, /mcp_read=0/);
  assert.match(drill, /production_writes=0/);
});
