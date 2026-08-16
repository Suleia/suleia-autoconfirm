import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDropeaV2OrderActionClient,
  getDropeaV2OrderActionReadiness,
  loadDropeaV2ActionStoreConfigs
} from './dropea-v2-order-actions.mjs';

const actionScopes = [
  'dp:orders:read',
  'dp:orders:confirm',
  'dp:orders:cancel'
];

function token(scopes = actionScopes, exp = 1_817_398_431) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp, scope: scopes.join(' ') })}.test-signature`;
}

function envFor(actionToken = token()) {
  return {
    DROPEA_ACTION_JWT_ES: actionToken,
    DROPEA_ACTIONS_STORES_CONFIG: JSON.stringify([{
      store_id: '16088',
      market: 'ES',
      base_url: 'https://es.public-api.dropea.com',
      jwt_secret_reference: 'DROPEA_ACTION_JWT_ES',
      jwt_expires_at: '2027-08-04T16:53:51.000Z'
    }])
  };
}

test('action credential loader requires both governed order actions and never accepts an unrelated write scope', () => {
  assert.equal(loadDropeaV2ActionStoreConfigs(envFor()).length, 1);
  assert.throws(
    () => loadDropeaV2ActionStoreConfigs(envFor(token(['dp:orders:read', 'dp:orders:confirm']))),
    (error) => error?.code === 'DROPEA_ACTION_TOKEN_REQUIRED_SCOPE_MISSING'
  );
  assert.throws(
    () => loadDropeaV2ActionStoreConfigs(envFor(token([...actionScopes, 'dp:orders:create']))),
    (error) => error?.code === 'DROPEA_ACTION_TOKEN_UNAPPROVED_SCOPE'
  );
});

test('confirmation and cancellation use only official V2 POST endpoints with stable idempotency keys', async () => {
  const calls = [];
  const client = createDropeaV2OrderActionClient({
    token: token(),
    market: 'ES',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const action = String(url).endsWith('/confirm') ? 'CONFIRMED' : 'FINISH';
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, message: 'ok', data: { id: 900001, status: action } };
        }
      };
    }
  });

  await client.confirmOrder(900001);
  await client.cancelOrder(900001);

  assert.deepEqual(calls.map((call) => call.url), [
    'https://es.public-api.dropea.com/dropshipper/orders/900001/confirm',
    'https://es.public-api.dropea.com/dropshipper/orders/900001/cancel'
  ]);
  assert.equal(calls.every((call) => call.options.method === 'POST'), true);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'suleia-confirm-900001');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'suleia-cancel-900001');
  assert.equal(calls.every((call) => call.options.body === undefined), true);
});

test('missing production action configuration is explicit and fail-closed', () => {
  assert.deepEqual(getDropeaV2OrderActionReadiness({}), {
    configured: false,
    ready: false,
    stores: 0,
    error: 'DROPEA_ACTIONS_STORES_CONFIG_EMPTY'
  });
});
