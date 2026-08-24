import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMetaAdsConfig, MetaAdsConfigurationError } from './config.mjs';

const safe = {
  META_ADS_ACCESS_TOKEN: 'fixture-token',
  META_ADS_AD_ACCOUNT_ID: 'act_123456789',
  META_ADS_API_VERSION: 'v25.0'
};

test('configuration defaults to SIMULATION and exposes no write capability', () => {
  const config = loadMetaAdsConfig(safe);
  assert.equal(config.executionMode, 'SIMULATION');
  assert.equal(config.accountId, '123456789');
  assert.equal(config.writesEnabled, false);
  assert.equal(config.telegramSendEnabled, false);
  assert.equal(config.expectedCurrency, 'EUR');
  assert.equal(config.expectedTimezone, 'Europe/Madrid');
});
for (const [key, value] of [
  ['META_ADS_EXECUTION_MODE', 'PRODUCTION'],
  ['META_ADS_WRITES_ENABLED', 'true'],
  ['META_ADS_BUDGET_WRITES_ENABLED', 'true'],
  ['META_ADS_TELEGRAM_SEND_ENABLED', 'true']
]) {
  test(`configuration fails closed for ${key}=${value}`, () => {
    assert.throws(() => loadMetaAdsConfig({ ...safe, [key]: value }), MetaAdsConfigurationError);
  });
}

test('configuration rejects ambiguous booleans and malformed account/API values', () => {
  assert.throws(() => loadMetaAdsConfig({ ...safe, META_ADS_WRITES_ENABLED: '0' }), /must be false/);
  assert.throws(() => loadMetaAdsConfig({ ...safe, META_ADS_AD_ACCOUNT_ID: 'campaign-name' }), /numeric/);
  assert.throws(() => loadMetaAdsConfig({ ...safe, META_ADS_API_VERSION: 'latest' }), /invalid/);
  assert.throws(() => loadMetaAdsConfig({ ...safe, META_ADS_MAX_PAGES: 'NaN' }), /integer/);
});
