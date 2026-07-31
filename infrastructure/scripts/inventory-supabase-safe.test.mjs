import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupabaseInventoryEnvironment, inventorySupabase } from './inventory-supabase-safe.mjs';

test('inventory accepts only an HTTPS Supabase host', () => {
  assert.throws(() => assertSupabaseInventoryEnvironment({ SUPABASE_URL: 'https://example.com', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }), /allowlisted/);
});

test('inventory returns counts and timestamps without rows or PII', async () => {
  const fetchImpl = async (url) => {
    const descending = String(url).includes('.desc');
    return new Response(JSON.stringify([{ updated_at: descending ? '2026-07-31T12:00:00Z' : '2026-01-01T00:00:00Z', created_at: null, synced_at: null }]), {
      status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/3' }
    });
  };
  const result = await inventorySupabase({ env: { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, fetchImpl });
  assert.equal(result.tables.length, 11);
  assert.equal(result.total_records, 33);
  assert.equal(result.pii_values_returned, 0);
  assert.equal(result.production_writes, 0);
});

test('inventory classifies an absent table without failing the complete inventory', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 404 });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  };
  const result = await inventorySupabase({ env: { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, fetchImpl });
  assert.equal(result.tables[0].status, 'MISSING');
  assert.equal(result.tables[0].classification, 'DISCARD');
});
