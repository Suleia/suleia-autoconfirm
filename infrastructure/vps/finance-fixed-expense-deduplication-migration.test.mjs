import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the itemised August expenses replace, rather than duplicate, the legacy aggregate', () => {
  const up = read('migrations/029_finance_fixed_expense_deduplication.sql');
  const down = read('migrations/rollback/029_finance_fixed_expense_deduplication.down.sql');
  const apply = read('infrastructure/vps/apply-finance-fixed-expense-deduplication-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  const drill = read('infrastructure/vps/run-financial-control-rollback-drill.sh');
  assert.match(up, /gastos fijos agosto 2026/i);
  assert.match(up, /status='INACTIVE'/);
  assert.match(up, /itemised_count <> 5/);
  assert.match(up, /itemised_total IS DISTINCT FROM 176\.39/);
  assert.match(up, /active_aggregate_count <> 0/);
  assert.match(up, /external_actions,production_writes/);
  assert.match(down, /status='ACTIVE'/);
  assert.match(apply, /029_finance_fixed_expense_deduplication\.sql/);
  assert.match(deploy, /apply-finance-fixed-expense-deduplication-migration\.sh/);
  assert.match(drill, /029_finance_fixed_expense_deduplication\.down\.sql/);
});
