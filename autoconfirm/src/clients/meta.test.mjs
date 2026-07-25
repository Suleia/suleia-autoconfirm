import assert from 'node:assert/strict';
import test from 'node:test';

process.env.META_ACCESS_TOKEN = 'test-token';
process.env.META_AD_ACCOUNT_ID = '123';
process.env.META_API_VERSION = 'v25.0';
process.env.META_REQUEST_TIMEOUT_MS = '1000';
process.env.META_REQUEST_MAX_ATTEMPTS = '3';

const originalFetch = globalThis.fetch;
const { getAdAccountSummary } = await import('./meta.mjs');

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
