import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDedicatedMetaReadScope, loadFinanceSyncConfig } from './config.mjs';

test('finance sync requires explicit internal-only writes and blocks external writes', () => {
  assert.throws(() => loadFinanceSyncConfig({ FINANCE_DATABASE_URL: 'fixture', FINANCE_STORE_ID: 's', META_ADS_AD_ACCOUNT_ID: '1' }), /ledger writes/i);
  assert.throws(() => loadFinanceSyncConfig({ FINANCE_INTERNAL_LEDGER_WRITES_ENABLED: 'true', FINANCE_DATABASE_URL: 'fixture', FINANCE_STORE_ID: 's', META_ADS_AD_ACCOUNT_ID: '1', CONNECTOR_WRITE_ENABLED: 'true' }), /must be false/i);
  assert.equal(loadFinanceSyncConfig({ FINANCE_INTERNAL_LEDGER_WRITES_ENABLED: 'true', FINANCE_DATABASE_URL: 'fixture', FINANCE_STORE_ID: 's', META_ADS_AD_ACCOUNT_ID: 'act_1' }).sourceRecordKey, '1');
  assert.equal(loadFinanceSyncConfig({ FINANCE_INTERNAL_LEDGER_WRITES_ENABLED: 'true', FINANCE_DATABASE_URL: 'fixture', FINANCE_STORE_ID: 's', META_ADS_AD_ACCOUNT_ID: 'act_1', FINANCE_SYNC_BUSINESS_DATE: '2026-08-30' }).businessDate, '2026-08-30');
  assert.throws(() => loadFinanceSyncConfig({ FINANCE_INTERNAL_LEDGER_WRITES_ENABLED: 'true', FINANCE_DATABASE_URL: 'fixture', FINANCE_STORE_ID: 's', META_ADS_AD_ACCOUNT_ID: 'act_1', FINANCE_SYNC_BUSINESS_DATE: '30/08/2026' }), /YYYY-MM-DD/);
});

test('finance sync rejects historical Meta tokens with management scope', () => {
  assert.throws(() => assertDedicatedMetaReadScope({ permissions: { ads_read: true, broader_management_scope_present: true } }), /ads_read-only/i);
  assert.doesNotThrow(() => assertDedicatedMetaReadScope({ permissions: { ads_read: true, broader_management_scope_present: false } }));
});
