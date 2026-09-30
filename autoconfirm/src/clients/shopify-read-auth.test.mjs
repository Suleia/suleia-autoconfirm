import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopifyReadAuth } from './shopify-read-auth.mjs';

const config = { shopifyDomain: 'example.myshopify.com', shopifyClientId: 'fixture-id', shopifyClientSecret: 'fixture-secret' };
const url = 'https://example.myshopify.com/admin/api/2026-04/graphql.json';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness({ ttl = 86399, staticToken, reject = () => false } = {}) {
  let clock = 0, exchanges = 0;
  const used = [];
  const read = createShopifyReadAuth({ ...config, shopifyAdminAccessToken: staticToken }, {
    now: () => clock,
    fetchImpl: async (target, options) => {
      if (target.endsWith('/access_token')) {
        exchanges++;
        await Promise.resolve();
        assert.equal(options.body.get('grant_type'), 'client_credentials');
        return json({ access_token: `fixture-${exchanges}`, expires_in: ttl });
      }
      const token = options.headers['X-Shopify-Access-Token'];
      used.push(token);
      return json({}, reject(token) ? 401 : 200);
    }
  });
  return { read, used, at: value => { clock = value; }, exchanges: () => exchanges };
}

test('scheduled reads renew before the 24-hour expiry, across multiple days', async () => {
  const h = harness();
  await h.read(url); h.at(23 * 3600_000); await h.read(url);
  assert.equal(h.exchanges(), 1);
  h.at(24 * 3600_000 - 30_000); await h.read(url);
  h.at(48 * 3600_000); await h.read(url);
  assert.deepEqual(h.used, ['fixture-1', 'fixture-1', 'fixture-2', 'fixture-3']);
});

test('concurrent due jobs share initial acquisition and expiry renewal', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 20 }, () => h.read(url)));
  assert.equal(h.exchanges(), 1);
  h.at(24 * 3600_000);
  await Promise.all(Array.from({ length: 20 }, () => h.read(url)));
  assert.equal(h.exchanges(), 2);
});

test('a rejected cached credential is renewed and the read is replayed once', async () => {
  const h = harness({ reject: t => t === 'fixture-1' });
  assert.equal((await h.read(url)).status, 200);
  assert.deepEqual(h.used, ['fixture-1', 'fixture-2']);
});

test('concurrent 401 responses cannot invalidate a newer refreshed token', async () => {
  const h = harness({ reject: t => t === 'fixture-1' });
  const results = await Promise.all(Array.from({ length: 20 }, () => h.read(url)));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(h.exchanges(), 2);
});

test('persistent authorization failure remains visible after one replay', async () => {
  const h = harness({ reject: () => true });
  assert.equal((await h.read(url)).status, 401);
  assert.equal(h.exchanges(), 2);
  assert.equal(h.used.length, 2);
});

test('explicit static tokens are preserved and never silently exchanged', async () => {
  const h = harness({ staticToken: 'fixture-static', reject: () => true });
  assert.equal((await h.read(url)).status, 401);
  assert.equal(h.exchanges(), 0);
  assert.deepEqual(h.used, ['fixture-static']);
});

test('missing expiry is not cached forever', async () => {
  const h = harness({ ttl: null });
  await h.read(url); await h.read(url);
  assert.equal(h.exchanges(), 2);
});

test('failed renewal propagates without leaking token response and can recover later', async () => {
  let exchanges = 0, reads = 0;
  const read = createShopifyReadAuth(config, { fetchImpl: async target => {
    if (target.endsWith('/access_token')) {
      if (++exchanges === 1) return json({ access_token: 'MUST_NOT_LEAK' }, 401);
      return json({ access_token: 'fixture-ok', expires_in: 86399 });
    }
    reads++; return json({});
  }});
  await assert.rejects(read(url), e => e.message === 'Shopify token respondio 401.');
  assert.equal(reads, 0);
  assert.equal((await read(url)).status, 200);
  assert.equal(exchanges, 2);
});

test('non-auth errors do not trigger token renewal or replay', async () => {
  let exchanges = 0, reads = 0;
  const read = createShopifyReadAuth(config, { fetchImpl: async target => {
    if (target.endsWith('/access_token')) { exchanges++; return json({ access_token: 'fixture-ok', expires_in: 86399 }); }
    reads++; return json({}, 403);
  }});
  assert.equal((await read(url)).status, 403);
  assert.equal(exchanges, 1); assert.equal(reads, 1);
});

test('401 recovery preserves the exact read method, body and non-auth headers', async () => {
  let exchanges = 0;
  const options = { method: 'POST', body: JSON.stringify({ query: 'query { shop { id } }' }), headers: { 'Content-Type': 'application/json' } };
  const read = createShopifyReadAuth(config, { fetchImpl: async (target, received) => {
    if (target.endsWith('/access_token')) return json({ access_token: `fixture-${++exchanges}`, expires_in: 86399 });
    assert.equal(received.body, options.body); assert.equal(received.method, options.method);
    assert.equal(received.headers['Content-Type'], 'application/json');
    return json({}, received.headers['X-Shopify-Access-Token'] === 'fixture-1' ? 401 : 200);
  }});
  assert.equal((await read(url, options)).status, 200);
});
