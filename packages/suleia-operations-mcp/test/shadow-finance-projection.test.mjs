import test from 'node:test';
import assert from 'node:assert/strict';
import { ShadowRepository } from '../src/shadow/repository.mjs';

test('completed Meta shadow batch projects current daily spend into the internal finance ledger', async () => {
  const calls = [];
  const pool = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [], rowCount: 0 }; }, end: async () => {} };
  const repository = new ShadowRepository('postgres://fixture', { pool });
  await repository.finishBatch('batch-fixture', {
    sourceObject: 'meta_campaign_insights', rangeEnd: '2026-08-25T10:00:00Z',
    seen: 3, imported: 3, rejected: 0, duplicates: 0, errors: 0,
    checksum: 'fixture-checksum', status: 'COMPLETED'
  });
  assert.equal(calls.length, 4);
  assert.match(calls[2].sql, /INSERT INTO economics\.finance_ad_spend_daily/);
  assert.match(calls[2].sql, /SUPABASE_META_CAMPAIGN_INSIGHTS/);
  assert.match(calls[2].sql, /count\(\*\)=1/);
  assert.match(calls[3].sql, /INSERT INTO economics\.finance_sync_checkpoints/);
  assert.doesNotMatch(calls.map((call) => call.sql).join('\n'), /UPDATE\s+.*campaign|DELETE\s+FROM/i);
});

test('an incomplete Meta batch never marks finance coverage complete', async () => {
  const calls = [];
  const pool = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [], rowCount: 0 }; }, end: async () => {} };
  const repository = new ShadowRepository('postgres://fixture', { pool });
  await repository.finishBatch('batch-fixture', {
    sourceObject: 'meta_campaign_insights', rangeEnd: '2026-08-25T10:00:00Z',
    seen: 2, imported: 1, rejected: 1, duplicates: 0, errors: 1,
    checksum: 'fixture-checksum', status: 'FAILED'
  });
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls.map((call) => call.sql).join('\n'), /finance_ad_spend_daily/);
});
