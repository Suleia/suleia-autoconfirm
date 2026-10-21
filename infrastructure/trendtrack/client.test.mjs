import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './client.mjs';

test('uses fixed origin, bearer, GET, timeout and no redirects', async () => {
  let calls = 0;
  const c = createClient({ key: 'test-only', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.trendtrack.io/v1/me');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer test-only');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ data: {} }));
  } });
  await c.get('/v1/me');
  assert.equal(calls, 1);
});
test('blocks paid endpoints and URL injection before sending', async () => {
  const c = createClient({ key: 'test', fetchImpl: () => assert.fail('sent') });
  for (const path of ['/v1/ads', '/v1/usage?limit=1', 'https://example.com'])
    await assert.rejects(c.get(path), /ENDPOINT_BLOCKED/);
});
test('HTTP failures are safe and never retried', async () => {
  for (const status of [401, 403, 402, 429, 500]) {
    let calls = 0;
    const c = createClient({ key: 'test', fetchImpl: async () => {
      calls++; return new Response('sensitive body', { status });
    } });
    await assert.rejects(c.get('/v1/usage'), e => e.message === 'HTTP_ERROR' && e.status === status);
    assert.equal(calls, 1);
  }
});
test('network error details are suppressed', async () => {
  const c = createClient({ key: 'test', fetchImpl: async () => { throw Error('secret'); } });
  await assert.rejects(c.get('/v1/me'), /^Error: NETWORK_OR_TIMEOUT$/);
});
test('unexpected credit costs stop execution', async () => {
  const c = createClient({ key: 'test', fetchImpl: async () =>
    new Response('{}', { headers: { 'x-usage-cost': '1' } }) });
  await assert.rejects(c.get('/v1/usage'), /UNEXPECTED_CREDIT_COST/);
});
test('invalid JSON and absent data fail closed', async () => {
  for (const body of ['not-json', '{}']) {
    const c = createClient({ key: 'test', fetchImpl: async () => new Response(body) });
    await assert.rejects(c.get('/v1/me'), /INVALID_JSON|INVALID_RESPONSE/);
  }
});
test('missing key and invalid timeout rejected', () => {
  assert.throws(() => createClient({ key: '' }), /INVALID_LOCAL_KEY/);
  assert.throws(() => createClient({ key: 'test', timeoutMs: 0 }), /INVALID_TIMEOUT/);
});
test('accepts current official response envelopes', async () => {
  for (const [path, body] of [
    ['/v1/me', { credential: {}, workspace: {} }],
    ['/v1/usage', { credits: {}, billing: {} }],
  ]) {
    const c = createClient({ key: 'test', fetchImpl: async () =>
      new Response(JSON.stringify(body), { headers: { 'x-usage-cost': '0' } }) });
    assert.equal((await c.get(path)).status, 200);
  }
});
