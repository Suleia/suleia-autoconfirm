import crypto from 'node:crypto';

const MARKET_HOSTS = Object.freeze({
  ES: 'es.public-api.dropea.com',
  IT: 'it.public-api.dropea.com',
  PT: 'pt.public-api.dropea.com'
});

const APPROVED_ACTION_SCOPES = Object.freeze([
  'dp:issues:read',
  'dp:orders:read',
  'dp:products:read',
  'dp:stores:read',
  'dp:users:read',
  'dp:webhooks:read',
  'dp:orders:confirm',
  'dp:orders:cancel'
]);

const REQUIRED_ACTION_SCOPES = Object.freeze([
  'dp:orders:read',
  'dp:orders:confirm',
  'dp:orders:cancel'
]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  if (details !== null) error.details = details;
  throw error;
}

function jwtClaims(token) {
  const segments = String(token || '').trim().split('.');
  if (segments.length !== 3) fail('DROPEA_ACTION_TOKEN_NOT_INSPECTABLE');
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return fail('DROPEA_ACTION_TOKEN_CLAIMS_INVALID');
  }
}

function assertActionToken(token, { expectedExpiresAt, now = Date.now } = {}) {
  const claims = jwtClaims(token);
  const rawScopes = claims.scope ?? claims.scopes ?? claims.permissions ?? claims.permission;
  const scopes = (Array.isArray(rawScopes) ? rawScopes : String(rawScopes || '').split(/[\s,]+/))
    .map(String)
    .filter(Boolean);
  const actual = [...new Set(scopes)];
  if (actual.some((scope) => !APPROVED_ACTION_SCOPES.includes(scope))) {
    fail('DROPEA_ACTION_TOKEN_UNAPPROVED_SCOPE');
  }
  if (REQUIRED_ACTION_SCOPES.some((scope) => !actual.includes(scope))) {
    fail('DROPEA_ACTION_TOKEN_REQUIRED_SCOPE_MISSING');
  }
  if (!Number.isFinite(Number(claims.exp))) fail('DROPEA_ACTION_TOKEN_EXPIRY_MISSING');
  const expiresAt = new Date(Number(claims.exp) * 1000);
  if (expiresAt.getTime() <= now()) fail('DROPEA_ACTION_TOKEN_EXPIRED');
  if (expectedExpiresAt && expiresAt.toISOString() !== new Date(expectedExpiresAt).toISOString()) {
    fail('DROPEA_ACTION_TOKEN_EXPIRY_MISMATCH');
  }
}

export function loadDropeaV2ActionStoreConfigs(env = process.env, { now = Date.now } = {}) {
  if (!env.DROPEA_ACTIONS_STORES_CONFIG) fail('DROPEA_ACTIONS_STORES_CONFIG_EMPTY');
  let values;
  try {
    values = JSON.parse(env.DROPEA_ACTIONS_STORES_CONFIG || '');
  } catch {
    return fail('DROPEA_ACTIONS_STORES_CONFIG_INVALID');
  }
  if (!Array.isArray(values) || values.length === 0) fail('DROPEA_ACTIONS_STORES_CONFIG_EMPTY');
  return values.map((value) => {
    for (const field of ['store_id', 'market', 'base_url', 'jwt_secret_reference', 'jwt_expires_at']) {
      if (value?.[field] === undefined || value[field] === null || value[field] === '') {
        fail(`DROPEA_ACTION_STORE_CONFIG_${field.toUpperCase()}_MISSING`);
      }
    }
    const market = String(value.market).toUpperCase();
    const host = MARKET_HOSTS[market];
    if (!host) fail('DROPEA_ACTION_MARKET_NOT_APPROVED');
    if (String(value.base_url).replace(/\/$/, '') !== `https://${host}`) {
      fail('DROPEA_ACTION_STORE_BASE_URL_MISMATCH');
    }
    const secretReference = String(value.jwt_secret_reference);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(secretReference)) {
      fail('DROPEA_ACTION_JWT_SECRET_REFERENCE_INVALID');
    }
    const token = env[secretReference];
    if (!token) fail('DROPEA_ACTION_JWT_SECRET_REFERENCE_UNRESOLVED');
    assertActionToken(token, { expectedExpiresAt: value.jwt_expires_at, now });
    return Object.freeze({
      store_id: String(value.store_id),
      market,
      base_url: `https://${host}`,
      token
    });
  });
}

function actionIdempotencyKey(action, orderId) {
  const stable = `suleia-${action}-${orderId}`;
  if (/^[A-Za-z0-9_-]{1,255}$/.test(stable)) return stable;
  return `suleia-${action}-${crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 32)}`;
}

export function createDropeaV2OrderActionClient({
  token,
  market,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000
} = {}) {
  if (typeof fetchImpl !== 'function') fail('DROPEA_ACTION_FETCH_REQUIRED');
  const normalizedMarket = String(market || '').toUpperCase();
  const host = MARKET_HOSTS[normalizedMarket];
  if (!host) fail('DROPEA_ACTION_MARKET_NOT_APPROVED');
  assertActionToken(token);

  async function fetchJson(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    } finally {
      clearTimeout(timer);
    }
  }

  async function pollOperation(operationId) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 2_000));
      const { response, payload } = await fetchJson(
        `https://${host}/dropshipper/operations/${encodeURIComponent(operationId)}`,
        { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) fail(`DROPEA_V2_ACTION_POLL_HTTP_${response.status}`);
      const status = payload?.data?.status;
      if (status === 'completed') return payload.data.result;
      if (status === 'failed') fail('DROPEA_V2_ACTION_ASYNC_FAILED', payload.data.error || null);
      if (status !== 'in_progress') fail('DROPEA_V2_ACTION_POLL_SCHEMA_INVALID');
    }
    return fail('DROPEA_V2_ACTION_ASYNC_TIMEOUT');
  }

  async function execute(action, orderId) {
    if (!['confirm', 'cancel'].includes(action)) fail('DROPEA_V2_ACTION_BLOCKED');
    const id = Number(orderId);
    if (!Number.isInteger(id) || id < 1) fail('DROPEA_V2_ACTION_ORDER_ID_INVALID');
    const idempotencyKey = actionIdempotencyKey(action, id);
    const { response, payload } = await fetchJson(
      `https://${host}/dropshipper/orders/${encodeURIComponent(id)}/${action}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey
        },
        body: undefined
      }
    );
    if (response.status === 504 && payload?.data?.operation_id) {
      return pollOperation(payload.data.operation_id);
    }
    if (!response.ok) fail(`DROPEA_V2_ACTION_HTTP_${response.status}`, payload?.failure || payload || null);
    if (payload?.success !== true || !payload?.data || typeof payload.data !== 'object') {
      fail('DROPEA_V2_ACTION_RESPONSE_SCHEMA_INVALID');
    }
    return payload.data;
  }

  return Object.freeze({
    market: normalizedMarket,
    confirmOrder: (orderId) => execute('confirm', orderId),
    cancelOrder: (orderId) => execute('cancel', orderId)
  });
}

function actionClientForOrder({
  env = process.env,
  clientFactory = createDropeaV2OrderActionClient,
  configLoader = loadDropeaV2ActionStoreConfigs
} = {}) {
  const [store] = configLoader(env);
  if (!store) fail('DROPEA_ACTIONS_STORES_CONFIG_EMPTY');
  return clientFactory({ token: store.token, market: store.market });
}

export async function confirmDropeaV2Order(orderId, options = {}) {
  return actionClientForOrder(options).confirmOrder(orderId);
}

export async function cancelDropeaV2Order(orderId, options = {}) {
  return actionClientForOrder(options).cancelOrder(orderId);
}

export function getDropeaV2OrderActionReadiness(env = process.env) {
  try {
    const stores = loadDropeaV2ActionStoreConfigs(env);
    return { configured: true, ready: stores.length > 0, stores: stores.length, error: null };
  } catch (error) {
    return {
      configured: Boolean(env.DROPEA_ACTIONS_STORES_CONFIG),
      ready: false,
      stores: 0,
      error: error?.code || 'DROPEA_ACTION_CONFIGURATION_INVALID'
    };
  }
}
