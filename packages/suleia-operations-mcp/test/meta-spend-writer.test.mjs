import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaSpendWriter } from '../src/finance/meta-spend-writer.mjs';

test('daily Meta spend is stored atomically without any external write', async () => {
  const calls = [];
  const client = { query: async (sql, values = []) => { calls.push({ sql, values }); }, release() {} };
  const writer = new MetaSpendWriter({ connect: async () => client, end: async () => {} });
  const result = await writer.persistDay({ storeId: 'fixture-store', sourceRecordKey: 'fixture-account', result: {
    ok: true, execution_mode: 'SIMULATION', business_date: '2026-08-23', account: { currency: 'EUR' }, campaign_count: 1,
    campaigns: [{ campaign_id: '1', spend: 3.25, purchases: 1, purchase_value: 20, purchase_roas: 6.15 }], meta_budget_writes: 0, telegram_messages: 0
  }});
  assert.equal(result.external_writes, 0);
  assert.equal(result.spend, 3.25);
  assert.deepEqual(calls.map((call) => call.sql.split(/\s+/)[0]), ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
  assert.doesNotMatch(JSON.stringify(calls), /campaign_name/);
});

test('unsafe Meta result is rejected before opening a transaction', async () => {
  let connected = false;
  const writer = new MetaSpendWriter({ connect: async () => { connected = true; } });
  await assert.rejects(() => writer.persistDay({ storeId: 'fixture', sourceRecordKey: 'fixture', result: { ok: true, execution_mode: 'PRODUCTION', meta_budget_writes: 1 } }), /FINANCE_META_RESULT_UNSAFE/);
  assert.equal(connected, false);
});

test('failed Meta sync records only a sanitized internal checkpoint', async () => {
  const calls = [];
  const writer = new MetaSpendWriter({ query: async (sql, values) => { calls.push({ sql, values }); }, end: async () => {} });
  const result = await writer.persistFailure({
    storeId: 'fixture-store', businessDate: '2026-08-23', failureCode: 'token=secret value'
  });
  assert.equal(result.failure_code, 'FINANCE_SYNC_FAILED');
  assert.equal(result.external_writes, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sync_status='FAILED'/);
  assert.doesNotMatch(JSON.stringify(calls), /token=secret value/);
});

test('campaign count must match the persisted daily breakdown', async () => {
  let connected = false;
  const writer = new MetaSpendWriter({ connect: async () => { connected = true; } });
  await assert.rejects(() => writer.persistDay({ storeId: 'fixture', sourceRecordKey: 'fixture', result: {
    ok: true, execution_mode: 'SIMULATION', business_date: '2026-08-23', account: { currency: 'EUR' }, campaign_count: 2,
    campaigns: [{ campaign_id: '1', spend: 1 }], meta_budget_writes: 0, telegram_messages: 0
  }}), /FINANCE_META_CAMPAIGN_COUNT_INVALID/);
  assert.equal(connected, false);
});
