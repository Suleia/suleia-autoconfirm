import assert from 'node:assert/strict';
import test from 'node:test';
import { loadShadowConfig, SHADOW_REQUIRED_FLAGS } from '../src/shadow/config.mjs';
import { containsDirectPii, maskRecord } from '../src/shadow/masking.mjs';
import { SupabaseReadSource } from '../src/shadow/source.mjs';
import { syncShadow } from '../src/shadow/sync.mjs';

function readerToken({ role = 'suleia_shadow_reader', exp = 1_900_000_000, alg = 'HS256', iss = 'https://fixture.supabase.co/auth/v1' } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg, typ: 'JWT' })}.${encode({ role, exp, iss })}.fixture-signature`;
}

const safeEnv = () => ({ ...SHADOW_REQUIRED_FLAGS, SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SHADOW_READER_TOKEN: readerToken(),
  SHADOW_DATABASE_URL: 'postgres://reader:fixture@postgres:5432/suleia_staging',
  MIGRATION_HASH_KEY: 'fixture-hash-key' });

test('shadow config fails closed if any production capability is enabled', () => {
  assert.equal(loadShadowConfig(safeEnv()).pageSize, 250);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), CUSTOMER_MESSAGES_ENABLED: 'true' }), /CUSTOMER_MESSAGES_ENABLED=false/);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), READ_ONLY: 'false' }), { code: 'CONFIG_CONTRADICTION' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), OPENAI_API_KEY: 'forbidden' }), /must not be present/);
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SERVICE_ROLE_KEY: 'forbidden' }), { code: 'SERVICE_ROLE_FORBIDDEN' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SERVICE_ROLE_KEY: '' }), { code: 'SERVICE_ROLE_FORBIDDEN' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_PUBLISHABLE_KEY: '' }), { code: 'PUBLISHABLE_KEY_REQUIRED' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' }), { code: 'SECRET_API_KEY_FORBIDDEN' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: '' }), { code: 'READER_JWT_REQUIRED' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: 'opaque-token' }), { code: 'READER_JWT_REQUIRED' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: 'sb_secret_forbidden' }), { code: 'SECRET_BEARER_FORBIDDEN' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: readerToken({ role: 'service_role' }) }), { code: 'READER_ROLE_INVALID' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: readerToken({ exp: 1 }) }), { code: 'READER_JWT_EXPIRED' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: readerToken({ alg: 'none' }) }), { code: 'READER_JWT_ALGORITHM_INVALID' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: readerToken({ iss: 'https://other.supabase.co/auth/v1' }) }), { code: 'READER_ISSUER_INVALID' });
  assert.throws(() => loadShadowConfig({ ...safeEnv(), SHADOW_DATABASE_URL: 'postgres://x:y@remote.example/db' }), /local VPS/);
  for (const value of ['', 'NaN', '25.5', '501', '9007199254740992']) {
    assert.throws(() => loadShadowConfig({ ...safeEnv(), SHADOW_PAGE_SIZE: value }), /SHADOW_PAGE_SIZE/);
  }
  for (const value of ['', 'NaN', '60000.5', '59999', '86400001']) {
    assert.throws(() => loadShadowConfig({ ...safeEnv(), SHADOW_POLL_INTERVAL_MS: value }), /SHADOW_POLL_INTERVAL_MS/);
  }
});

test('masking removes secrets and direct customer identity before persistence', () => {
  const masked = maskRecord({ id: '123', order_id: '456', first_name: 'Ada', email: 'ada@example.com', phone: '612345678',
    address: 'Calle privada 1', note: 'texto libre', status: 'OPEN', total_amount: 42, access_token: 'secret-value' }, 'fixture-key');
  assert.match(masked.id, /^hmac:/); assert.match(masked.order_id, /^hmac:/);
  assert.equal(masked.first_name, '[MASKED]'); assert.equal(masked.email, '[MASKED]'); assert.equal(masked.status, 'OPEN');
  assert.equal(masked.total_amount, 42); assert.equal('access_token' in masked, false); assert.equal(containsDirectPii(masked), false);
  assert.equal(containsDirectPii({ state_key: '20260731612345678' }), false);
  assert.equal(containsDirectPii({ phone: '612345678' }), true);
  assert.equal(containsDirectPii({ safe_field: 'private@example.com' }), true);
  assert.equal(containsDirectPii({ authorization: '[MASKED]' }), true);
  assert.equal(containsDirectPii({ normalized_address_hash: 'a'.repeat(64) }), false);
  assert.equal(containsDirectPii({ shipping_address_ciphertext: 'v1:YWJj:ZGVm:MTIzNDU2Nzg5' }), false);
  assert.equal(containsDirectPii({ customer_name: 'Cliente 612345678' }), true);
});

test('Supabase source can only issue GET reads', async () => {
  let observed;
  const source = new SupabaseReadSource({
    sourceUrl: 'https://fixture.supabase.co',
    sourceApiKey: 'sb_publishable_fixture',
    sourceBearerToken: readerToken(),
    fetchImpl: async (url, options) => {
    observed = { url, options }; return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
  }});
  await source.page('orders', 'updated_at');
  assert.equal(observed.options.method, 'GET'); assert.match(observed.url, /^https:\/\/fixture\.supabase\.co\/rest\/v1\/orders\?/);
  assert.equal(observed.options.headers.apikey, 'sb_publishable_fixture');
  assert.match(observed.options.headers.Authorization, /^Bearer ey/);
  assert.notEqual(observed.options.headers.apikey, observed.options.headers.Authorization.replace(/^Bearer /, ''));
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
