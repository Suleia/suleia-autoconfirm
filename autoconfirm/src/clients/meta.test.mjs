import assert from 'node:assert/strict';
import test from 'node:test';

process.env.META_ACCESS_TOKEN = 'test-token';
process.env.META_AD_ACCOUNT_ID = '123';
process.env.META_API_VERSION = 'v25.0';
process.env.META_REQUEST_TIMEOUT_MS = '1000';
process.env.META_REQUEST_MAX_ATTEMPTS = '3';

const originalFetch = globalThis.fetch;
const { getAdAccountSummary, getCampaignInsights } = await import('./meta.mjs');

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('retries a transient Meta network timeout', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new TypeError('fetch failed');
      error.cause = Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' });
      throw error;
    }
    return new Response(JSON.stringify({ id: 'act_123', name: 'SULEIA' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await getAdAccountSummary();
  assert.equal(attempts, 2);
  assert.equal(result.id, 'act_123');
});

test('retries a retryable Meta HTTP response', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporary' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ id: 'act_123', name: 'SULEIA' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await getAdAccountSummary();
  assert.equal(attempts, 2);
  assert.equal(result.name, 'SULEIA');
});

test('reads every Meta insights page before calculating spend', async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const parsed = new URL(url);
    const after = parsed.searchParams.get('after');
    const body = after
      ? { data: [{ campaign_id: '2', campaign_name: 'B', date_start: '2026-08-02', date_stop: '2026-08-02', spend: '12.14' }] }
      : {
          data: [{ campaign_id: '1', campaign_name: 'A', date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1890' }],
          paging: { next: 'https://graph.facebook.com/v25.0/act_123/insights?after=next-page&access_token=test-token' }
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const rows = await getCampaignInsights({ since: '2026-08-01', until: '2026-08-31', timeIncrement: 1 });
  assert.equal(calls, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.spend, 0), 1902.14);
});
