import assert from 'node:assert/strict';
import test from 'node:test';
import { loadShadowConfig, SHADOW_REQUIRED_FLAGS } from '../src/shadow/config.mjs';
import { containsDirectPii, maskRecord } from '../src/shadow/masking.mjs';
import { SupabaseReadSource } from '../src/shadow/source.mjs';
import { syncShadow } from '../src/shadow/sync.mjs';

const safeEnv = () => ({ ...SHADOW_REQUIRED_FLAGS, SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-source-token', SHADOW_DATABASE_URL: 'postgres://reader:fixture@postgres:5432/suleia_staging',
  MIGRATION_HASH_KEY: 'fixture-hash-key' });

test('shadow config fails closed if any production capability is enabled', () => {
  assert.equal(loadShadowConfig(safeEnv()).pageSize, 250);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), CUSTOMER_MESSAGES_ENABLED: 'true' }), /CUSTOMER_MESSAGES_ENABLED=false/);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), OPENAI_API_KEY: 'forbidden' }), /must not be present/);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SHADOW_DATABASE_URL: 'postgres://x:y@remote.example/db' }), /local VPS/);
});

test('masking removes secrets and direct customer identity before persistence', () => {
  const masked = maskRecord({ id: '123', order_id: '456', first_name: 'Ada', email: 'ada@example.com', phone: '612345678',
    address: 'Calle privada 1', note: 'texto libre', status: 'OPEN', total_amount: 42, access_token: 'secret-value' }, 'fixture-key');
  assert.match(masked.id, /^hmac:/); assert.match(masked.order_id, /^hmac:/);
  assert.equal(masked.first_name, '[MASKED]'); assert.equal(masked.email, '[MASKED]'); assert.equal(masked.status, 'OPEN');
  assert.equal(masked.total_amount, 42); assert.equal('access_token' in masked, false); assert.equal(containsDirectPii(masked), false);
});

test('Supabase source can only issue GET reads', async () => {
  let observed;
  const source = new SupabaseReadSource({ sourceUrl: 'https://fixture.supabase.co', sourceToken: 'fixture', fetchImpl: async (url, options) => {
    observed = { url, options }; return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
  }});
  await source.page('orders', 'updated_at');
  assert.equal(observed.options.method, 'GET'); assert.match(observed.url, /^https:\/\/fixture\.supabase\.co\/rest\/v1\/orders\?/);
});

test('sync is incremental, idempotent at the repository boundary and executes zero actions', async () => {
  const stored = new Set();
  const repository = {
    checkpoint: async () => null, inventory: async () => {}, startBatch: async () => 'batch',
    store: async (_batch, item) => { const key = `${item.sourceObject}:${item.sourceRecordHash}:${item.payloadChecksum}`; const fresh = !stored.has(key); stored.add(key); return fresh; },
    finishBatch: async () => {}
  };
  const row = { id: '1', order_id: '2', email: 'private@example.com', status: 'OPEN', updated_at: '2026-07-31T10:00:00Z' };
  const source = { page: async () => ({ rows: [row], total: 1, missing: false }) };
  const tables = [['orders', 'updated_at', 'TRANSFORM']];
  const first = await syncShadow({ source, repository, hashKey: 'key', pageSize: 10, tables });
  const second = await syncShadow({ source, repository, hashKey: 'key', pageSize: 10, tables });
  assert.equal(first.reports[0].imported, 1); assert.equal(second.reports[0].duplicates, 1);
  assert.equal(first.actions_executed, 0); assert.equal(first.production_writes, 0);
});
