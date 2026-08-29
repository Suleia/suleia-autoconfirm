import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('finance daily-profit migration keeps fixed-expense writes narrow and audited', () => {
  const up = read('migrations/027_finance_daily_profit_and_fixed_expenses.sql');
  const down = read('migrations/rollback/027_finance_daily_profit_and_fixed_expenses.down.sql');
  const apply = read('infrastructure/vps/apply-finance-daily-profit-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.match(up, /finance_fixed_expense_audit/);
  assert.match(up, /GRANT INSERT,UPDATE ON economics\.finance_fixed_expenses TO suleia_api_login/);
  assert.doesNotMatch(up, /GRANT (?:INSERT|UPDATE|DELETE).*operations_order|GRANT (?:INSERT|UPDATE|DELETE).*incident/i);
  assert.match(up, /created_at_utc,confirmed_at_utc,delivered_at_utc,returned_at_utc/);
  assert.match(up, /external_actions integer NOT NULL DEFAULT 0/);
  assert.match(down, /REVOKE INSERT,UPDATE ON economics\.finance_fixed_expenses/);
  assert.match(apply, /027_finance_daily_profit_and_fixed_expenses\.sql/);
  assert.match(deploy, /apply-finance-daily-profit-migration\.sh/);
});
