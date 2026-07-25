import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetry } from './fetch-with-retry.mjs';

test('retries a transient network failure', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await fetchWithRetry('https://example.test', {}, {
    retryDelayMs: 1,
    timeoutMs: 1000
  });

  assert.equal(await response.text(), 'ok');
  assert.equal(calls, 2);
});

test('retries a server error but not a client error', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('error', { status: calls === 1 ? 503 : 400 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await fetchWithRetry('https://example.test', {}, {
    retryDelayMs: 1,
    timeoutMs: 1000
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 2);
});
