import { pathToFileURL } from 'node:url';

const TABLES = Object.freeze([
  ['app_state', 'updated_at'], ['orders', 'updated_at'], ['operational_orders', 'updated_at'],
  ['incidents', 'updated_at'], ['incident_carrier_history', 'synced_at'], ['agent_feedback', 'created_at'],
  ['agent_memory_events', 'created_at'], ['telegram_messages', 'created_at'], ['webhook_events', 'created_at'],
  ['template_delivery_ledger', 'updated_at'], ['meta_campaign_insights', 'updated_at']
]);

export function assertSupabaseInventoryEnvironment(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase read credentials are missing');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('Supabase host is not allowlisted');
}

async function request(url, headers, fetchImpl) {
  const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Supabase inventory read failed: HTTP ${response.status}`);
  return response;
}

export async function inventorySupabase({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  assertSupabaseInventoryEnvironment(env);
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: 'application/json', Prefer: 'count=exact', Range: '0-0'
  };
  const results = [];
  for (const [table, timestamp] of TABLES) {
    const countResponse = await request(`${base}/rest/v1/${table}?select=${timestamp}`, headers, fetchImpl);
    if (!countResponse) {
      results.push({ table, classification: 'DISCARD', records: 0, oldest: null, newest: null, status: 'MISSING' });
      continue;
    }
    const range = countResponse.headers.get('content-range') || '0-0/0';
    const count = Number(range.split('/').at(-1));
    const oldestResponse = await request(`${base}/rest/v1/${table}?select=${timestamp}&order=${timestamp}.asc&limit=1`, headers, fetchImpl);
    const newestResponse = await request(`${base}/rest/v1/${table}?select=${timestamp}&order=${timestamp}.desc&limit=1`, headers, fetchImpl);
    const oldest = oldestResponse ? (await oldestResponse.json())?.[0]?.[timestamp] || null : null;
    const newest = newestResponse ? (await newestResponse.json())?.[0]?.[timestamp] || null : null;
    results.push({ table, classification: table === 'telegram_messages' ? 'MANUAL_REVIEW' : 'TRANSFORM', records: Number.isFinite(count) ? count : 0, oldest, newest, status: 'AVAILABLE' });
  }
  return Object.freeze({
    source: 'supabase', tables: results, total_records: results.reduce((sum, item) => sum + item.records, 0),
    pii_values_returned: 0, credentials_returned: 0, operation: 'READ_QUERY', actions_executed: 0, production_writes: 0
  });
}

async function main() {
  process.stdout.write(`${JSON.stringify(await inventorySupabase(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, actions_executed: 0, production_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}
