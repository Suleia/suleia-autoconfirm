import { assertExactReadOnlyScopes, assertTokenActive, marketHost } from './contract.mjs';

const REQUIRED_FIELDS = Object.freeze([
  'store_id', 'market', 'base_url', 'jwt_secret_reference', 'jwt_expires_at',
  'migration_cutover_at', 'native_v2_activation_at', 'historical_reingestion_allowed'
]);

function requiredIso(value, field) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`DROPEA_STORE_CONFIG_${field.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

export function loadDropeaStoreConfigs(env = process.env, { now = Date.now } = {}) {
  let values;
  try {
    values = JSON.parse(env.DROPEA_STORES_CONFIG || '');
  } catch {
    throw new Error('DROPEA_STORES_CONFIG_INVALID');
  }
  if (!Array.isArray(values) || values.length === 0) throw new Error('DROPEA_STORES_CONFIG_EMPTY');
  const seen = new Set();
  return Object.freeze(values.map((value) => {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in value) || value[field] === '' || value[field] === null) {
        throw new Error(`DROPEA_STORE_CONFIG_${field.toUpperCase()}_MISSING`);
      }
    }
    if (typeof value.historical_reingestion_allowed !== 'boolean') {
      throw new Error('DROPEA_HISTORICAL_REINGESTION_MUST_BE_BOOLEAN');
    }
    const market = String(value.market).toUpperCase();
    const expectedBaseUrl = `https://${marketHost(market)}`;
    if (String(value.base_url).replace(/\/$/, '') !== expectedBaseUrl) throw new Error('DROPEA_STORE_BASE_URL_MISMATCH');
    const storeId = String(value.store_id);
    const key = `${market}:${storeId}`;
    if (seen.has(key)) throw new Error('DROPEA_STORE_CONFIG_DUPLICATE');
    seen.add(key);
    const secretReference = String(value.jwt_secret_reference);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(secretReference)) throw new Error('DROPEA_JWT_SECRET_REFERENCE_INVALID');
    const token = env[secretReference];
    if (!token) throw new Error('DROPEA_JWT_SECRET_REFERENCE_UNRESOLVED');
    assertExactReadOnlyScopes(token);
    const expiry = assertTokenActive(token, { now, expectedExpiresAt: value.jwt_expires_at });
    return Object.freeze({
      store_id: storeId,
      market,
      base_url: expectedBaseUrl,
      jwt_secret_reference: secretReference,
      jwt_expires_at: expiry.expires_at,
      migration_cutover_at: requiredIso(value.migration_cutover_at, 'migration_cutover_at'),
      native_v2_activation_at: requiredIso(value.native_v2_activation_at, 'native_v2_activation_at'),
      historical_reingestion_allowed: value.historical_reingestion_allowed,
      token
    });
  }));
}
