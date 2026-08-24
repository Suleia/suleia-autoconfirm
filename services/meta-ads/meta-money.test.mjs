import assert from 'node:assert/strict';
import test from 'node:test';
import { minorUnitsToCurrency, parseMetaMinorUnits, readBudgetFields } from './meta-money.mjs';

test('MetaMoney converts EUR minor units without guessing', () => {
  assert.equal(parseMetaMinorUnits('3000'), 3000);
  assert.equal(minorUnitsToCurrency(3000), 30);
  assert.deepEqual(readBudgetFields({ daily_budget: '3041' }), {
    budget_period: 'DAILY', budget_minor: 3041
  });
});
test('MetaMoney preserves missing budget and rejects decimals/negative values', () => {
  assert.deepEqual(readBudgetFields({}), { budget_period: 'NONE', budget_minor: null });
  assert.throws(() => parseMetaMinorUnits('30.41'), /minor units/);
  assert.throws(() => parseMetaMinorUnits('-1'), /minor units/);
});
