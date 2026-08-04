import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_READ_SCOPES } from './contract.mjs';
import { loadDropeaStoreConfigs } from './store-config.mjs';

function jwt({ scopes = APPROVED_READ_SCOPES, exp = 1817337600 } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ scope: scopes.join(' '), exp })}.signature`;
}

function env(overrides = {}) {
  return {
    DROPEA_READ_JWT_ES: jwt(),
    DROPEA_STORES_CONFIG: JSON.stringify([{
      store_id: 17, market: 'ES', base_url: 'https://es.public-api.dropea.com',
      jwt_secret_reference: 'DROPEA_READ_JWT_ES', jwt_expires_at: '2027-08-04T00:00:00.000Z',
      migration_cutover_at: '2026-08-03T00:00:00Z', native_v2_activation_at: '2026-08-04T00:00:00Z',
      historical_reingestion_allowed: false
    }]),
    ...overrides
  };
}

test('store configuration is explicit, exact-host and exact-read-token only', () => {
  const [config] = loadDropeaStoreConfigs(env(), { now: () => new Date('2026-08-04T12:00:00Z').getTime() });
  assert.equal(config.market, 'ES');
  assert.equal(config.store_id, '17');
  assert.equal(config.historical_reingestion_allowed, false);
});

test('store configuration blocks missing fields, fallback hosts, expired and write tokens', () => {
  const missing = JSON.parse(env().DROPEA_STORES_CONFIG); delete missing[0].store_id;
  assert.throws(() => loadDropeaStoreConfigs(env({ DROPEA_STORES_CONFIG: JSON.stringify(missing) })), /STORE_ID_MISSING/);
  const wrongHost = JSON.parse(env().DROPEA_STORES_CONFIG); wrongHost[0].base_url = 'https://pt.public-api.dropea.com';
  assert.throws(() => loadDropeaStoreConfigs(env({ DROPEA_STORES_CONFIG: JSON.stringify(wrongHost) })), /BASE_URL_MISMATCH/);
  assert.throws(() => loadDropeaStoreConfigs(env({ DROPEA_READ_JWT_ES: jwt({ exp: 1 }) })), { code: 'DROPEA_TOKEN_EXPIRED' });
  assert.throws(() => loadDropeaStoreConfigs(env({ DROPEA_READ_JWT_ES: jwt({ scopes: [...APPROVED_READ_SCOPES, 'dp:orders:confirm'] }) })), { code: 'DROPEA_WRITE_OR_UNKNOWN_SCOPE_BLOCKED' });
});
