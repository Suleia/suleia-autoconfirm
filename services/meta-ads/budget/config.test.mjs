import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetaBudgetConfig } from './config.mjs';

const safe = (extra = {}) => ({ META_AUTOMATION_MODE: 'SIMULATION', META_WRITES_ENABLED: 'false',
  META_LIVE_EXECUTION_ENABLED: 'false', META_EXTERNAL_ACTIONS_ENABLED: 'false', META_AUTOMATION_ENABLED: 'false',
  META_ADS_WRITES_ENABLED: 'false', META_ADS_BUDGET_WRITES_ENABLED: 'false',
  META_ADS_TELEGRAM_SEND_ENABLED: 'false', ...extra });

test('defaults safely and allows only simulation or shadow', () => {
  const defaults = loadMetaBudgetConfig({});
  assert.equal(defaults.mode, 'SIMULATION'); assert.equal(defaults.writerCompiled, false);
  assert.equal(loadMetaBudgetConfig(safe({ META_AUTOMATION_MODE: 'SHADOW' })).mode, 'SHADOW');
  for (const mode of ['APPROVAL_REQUIRED', 'LIVE']) {
    assert.throws(() => loadMetaBudgetConfig(safe({ META_AUTOMATION_MODE: mode })), { code: 'META_BUDGET_MODE_NOT_ENABLED' });
  }
});

test('every external, live, automation and Meta write flag is false-only', () => {
  for (const key of ['META_WRITES_ENABLED', 'META_LIVE_EXECUTION_ENABLED', 'META_EXTERNAL_ACTIONS_ENABLED',
    'META_AUTOMATION_ENABLED', 'META_ADS_WRITES_ENABLED', 'META_ADS_BUDGET_WRITES_ENABLED',
    'META_ADS_TELEGRAM_SEND_ENABLED']) {
    assert.throws(() => loadMetaBudgetConfig(safe({ [key]: 'true' })), { code: 'META_BUDGET_WRITE_CONFIGURATION_BLOCKED' });
  }
});

test('policy values are configured as exact cents', () => {
  const result = loadMetaBudgetConfig(safe({ META_MIN_DAILY_BUDGET_EUR: '15.00',
    META_MAX_DAILY_BUDGET_EUR: '70', META_NIGHT_MAX_DAILY_BUDGET_EUR: '35', META_SCALE_INCREMENT_EUR: '10.00' }));
  assert.equal(result.policy.minDailyBudgetCents, 1500); assert.equal(result.policy.maxDailyBudgetCents, 7000);
  assert.equal(result.policy.scaleIncrementCents, 1000);
  assert.throws(() => loadMetaBudgetConfig(safe({ META_MIN_DAILY_BUDGET_EUR: '15.001' })), /at most two places/);
  assert.throws(() => loadMetaBudgetConfig(safe({ META_MAX_DAILY_BUDGET_EUR: '71' })),
    { code: 'META_BUDGET_POLICY_VERSION_REQUIRED' });
});
