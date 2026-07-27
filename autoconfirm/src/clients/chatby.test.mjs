import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CHATBY_TOKEN = 'test-token';
process.env.CHATBY_BASE_URL = 'https://chatby.test/api';
process.env.CHATBY_REQUEST_MIN_INTERVAL_MS = '0';

const { getChatMessages, sendWhatsappTemplate } = await import('./chatby.mjs');

test('never retries a template delivery after a rate-limit response', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.001' }
        })
      : new Response(JSON.stringify({ ok: true, mid: 'wamid.should-not-exist' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
  };

  try {
    await assert.rejects(
      sendWhatsappTemplate({
        user_ns: 'test-user',
        user_id: 'test-recipient',
        content: { name: 'dropea_pedido_nuevo_v1', lang: 'es_ES', params: {} }
      }),
      /429/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps bounded retries for read-only Chatby requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.001' }
        })
      : new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
  };

  try {
    assert.deepEqual(await getChatMessages('test-user'), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
