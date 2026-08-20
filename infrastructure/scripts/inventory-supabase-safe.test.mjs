import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupabaseInventoryEnvironment, inventorySupabase } from './inventory-supabase-safe.mjs';

function readerToken({ role = 'suleia_shadow_reader', exp = 1_900_000_000, iss = 'https://fixture.supabase.co/auth/v1' } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp, iss })}.fixture-signature`;
}

const safeEnv = () => ({
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  SUPABASE_SHADOW_READER_TOKEN: readerToken()
});

test('inventory accepts only an HTTPS Supabase host', () => {
  assert.throws(() => assertSupabaseInventoryEnvironment({ ...safeEnv(), SUPABASE_URL: 'https://example.com' }), /allowlisted/);
  assert.throws(() => assertSupabaseInventoryEnvironment({ ...safeEnv(), SUPABASE_SERVICE_ROLE_KEY: 'forbidden' }), { code: 'SERVICE_ROLE_FORBIDDEN' });
  assert.throws(() => assertSupabaseInventoryEnvironment({ ...safeEnv(), SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' }), { code: 'SECRET_API_KEY_FORBIDDEN' });
  assert.throws(() => assertSupabaseInventoryEnvironment({ ...safeEnv(), SUPABASE_SHADOW_READER_TOKEN: readerToken({ role: 'service_role' }) }), { code: 'READER_ROLE_INVALID' });
});

test('inventory returns counts and timestamps without rows or PII', async () => {
  const fetchImpl = async (url) => {
    const descending = String(url).includes('.desc');
    return new Response(JSON.stringify([{ updated_at: descending ? '2026-07-31T12:00:00Z' : '2026-01-01T00:00:00Z', created_at: null, synced_at: null }]), {
      status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/3' }
    });
  };
  const observed = [];
  const observingFetch = async (url, options) => { observed.push(options); return fetchImpl(url, options); };
  const result = await inventorySupabase({ env: safeEnv(), fetchImpl: observingFetch });
  assert.equal(result.tables.length, 11);
  assert.equal(result.total_records, 33);
  assert.equal(result.pii_values_returned, 0);
  assert.equal(result.production_writes, 0);
  assert.ok(observed.every((options) => options.method === 'GET'));
  assert.ok(observed.every((options) => options.headers.apikey === 'sb_publishable_fixture'));
  assert.ok(observed.every((options) => options.headers.Authorization.startsWith('Bearer ey')));
  assert.ok(observed.every((options) => options.headers.apikey !== options.headers.Authorization.replace(/^Bearer /, '')));
});

test('inventory classifies an absent table without failing the complete inventory', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 404 });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  };
  const result = await inventorySupabase({ env: safeEnv(), fetchImpl });
  assert.equal(result.tables[0].status, 'MISSING');
  assert.equal(result.tables[0].classification, 'DISCARD');
});
