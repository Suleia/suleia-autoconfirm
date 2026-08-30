import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('August fixed expenses are exact, recurring, audited and deployment-wired', () => {
  const up = read('migrations/028_finance_august_fixed_expenses.sql');
  const down = read('migrations/rollback/028_finance_august_fixed_expenses.down.sql');
  const apply = read('infrastructure/vps/apply-finance-august-fixed-expenses-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  for (const amount of ['103.00', '13.13', '25.00', '9.99', '25.27', '176.39']) assert.match(up, new RegExp(amount.replace('.', '\\.')));
  assert.match(up, /USER_CONFIRMED_FIXED_EXPENSES_2026_08_30/);
  assert.match(up, /finance_fixed_expense_audit/);
  assert.doesNotMatch(up, /integration\.dropea_orders|operations_order_records|chatby_messages/i);
  assert.match(down, /a8260001-0000-4000-8000-000000000005/);
  assert.match(apply, /028_finance_august_fixed_expenses\.sql/);
  assert.match(deploy, /apply-finance-august-fixed-expenses-migration\.sh/);
});
