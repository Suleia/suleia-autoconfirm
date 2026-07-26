import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseReadRepository, VIEW_ALLOWLIST } from '../src/data/supabase-read-repository.mjs';

test('Supabase adapter uses GET only and allowlisted staging views', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const repository = createSupabaseReadRepository({
    supabaseUrl: 'https://staging.example.invalid',
    supabaseReaderToken: 'reader-token',
    supabaseSchema: 'mcp_read'
  }, { fetchImpl });

  await repository.getOrder('STG-ORDER-0001');
  await repository.getOrderTimeline('STG-ORDER-0001');
  await repository.getDataFreshness();
  await repository.getActiveTimers({});
  await repository.getAgentDecisions('STG-ORDER-0001');
  await repository.listOrdersRequiringReview({});

  assert.equal(calls.length, Object.keys(VIEW_ALLOWLIST).length);
  assert.equal(calls.every((call) => call.method === 'GET'), true);
  for (const call of calls) {
    assert.equal(Object.values(VIEW_ALLOWLIST).some((view) => call.url.includes(`/rest/v1/${view}`)), true);
  }
});
