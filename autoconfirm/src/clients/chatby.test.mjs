import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CHATBY_TOKEN = 'test-token';
process.env.CHATBY_BASE_URL = 'https://chatby.test/api';
process.env.CHATBY_REQUEST_MIN_INTERVAL_MS = '0';

const { findSubscriberInIndexForOrder, getChatMessages, sendWhatsappTemplate } = await import('./chatby.mjs');

test('strict order lookup never reuses a confirmed subscriber from another order', () => {
  const subscriber = {
    phone: '+34600000000',
    lead_status: 'CONFIRMADO',
    user_fields: [{ name: 'Dropea: Numero', value: 'older-order' }]
  };
  const index = { byPhone: new Map([['600000000', [subscriber]]]) };

  assert.equal(findSubscriberInIndexForOrder(index, {
    phone: '+34600000000',
    orderId: 'current-order',
    allowConfirmedPhoneFallback: false
  }), null);
  assert.equal(findSubscriberInIndexForOrder(index, {
    phone: '+34600000000',
    orderId: 'current-order'
  })?.lead_status, 'CONFIRMADO');
});

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
