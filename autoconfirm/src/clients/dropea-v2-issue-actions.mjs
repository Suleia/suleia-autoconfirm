import crypto from 'node:crypto';

const MARKET_HOSTS = Object.freeze({
  ES: 'es.public-api.dropea.com',
  IT: 'it.public-api.dropea.com',
  PT: 'pt.public-api.dropea.com'
});

const REQUIRED_ISSUE_ACTION_SCOPES = Object.freeze([
  'dp:issues:read',
  'dp:orders:read',
  'dp:issues:resolve'
]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  if (details !== null) error.details = details;
  throw error;
}

function jwtClaims(token) {
  const segments = String(token || '').trim().split('.');
  if (segments.length !== 3) fail('DROPEA_ISSUE_ACTION_TOKEN_NOT_INSPECTABLE');
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return fail('DROPEA_ISSUE_ACTION_TOKEN_CLAIMS_INVALID');
  }
}

function assertIssueActionToken(token, { expectedExpiresAt, now = Date.now } = {}) {
  const claims = jwtClaims(token);
  const rawScopes = claims.scope ?? claims.scopes ?? claims.permissions ?? claims.permission;
  const scopes = (Array.isArray(rawScopes) ? rawScopes : String(rawScopes || '').split(/[\s,]+/))
    .map(String)
    .filter(Boolean);
  const actual = [...new Set(scopes)];
  if (REQUIRED_ISSUE_ACTION_SCOPES.some((scope) => !actual.includes(scope))) {
    fail('DROPEA_ISSUE_ACTION_TOKEN_REQUIRED_SCOPE_MISSING');
  }
  if (!Number.isFinite(Number(claims.exp))) fail('DROPEA_ISSUE_ACTION_TOKEN_EXPIRY_MISSING');
  const expiresAt = new Date(Number(claims.exp) * 1000);
  if (expiresAt.getTime() <= now()) fail('DROPEA_ISSUE_ACTION_TOKEN_EXPIRED');
  if (expectedExpiresAt && expiresAt.toISOString() !== new Date(expectedExpiresAt).toISOString()) {
    fail('DROPEA_ISSUE_ACTION_TOKEN_EXPIRY_MISMATCH');
  }
}

export function loadDropeaV2IssueActionStoreConfigs(env = process.env, { now = Date.now } = {}) {
  if (!env.DROPEA_ISSUE_ACTIONS_STORES_CONFIG) fail('DROPEA_ISSUE_ACTIONS_STORES_CONFIG_EMPTY');
  let values;
  try {
    values = JSON.parse(env.DROPEA_ISSUE_ACTIONS_STORES_CONFIG || '');
  } catch {
    return fail('DROPEA_ISSUE_ACTIONS_STORES_CONFIG_INVALID');
  }
  if (!Array.isArray(values) || values.length === 0) fail('DROPEA_ISSUE_ACTIONS_STORES_CONFIG_EMPTY');
  return values.map((value) => {
    for (const field of ['store_id', 'market', 'base_url', 'jwt_secret_reference', 'jwt_expires_at']) {
      if (value?.[field] === undefined || value[field] === null || value[field] === '') {
        fail(`DROPEA_ISSUE_ACTION_STORE_CONFIG_${field.toUpperCase()}_MISSING`);
      }
    }
    const market = String(value.market).toUpperCase();
    const host = MARKET_HOSTS[market];
    if (!host) fail('DROPEA_ISSUE_ACTION_MARKET_NOT_APPROVED');
    if (String(value.base_url).replace(/\/$/, '') !== `https://${host}`) {
      fail('DROPEA_ISSUE_ACTION_STORE_BASE_URL_MISMATCH');
    }
    const secretReference = String(value.jwt_secret_reference);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(secretReference)) {
      fail('DROPEA_ISSUE_ACTION_JWT_SECRET_REFERENCE_INVALID');
    }
    const token = env[secretReference];
    if (!token) fail('DROPEA_ISSUE_ACTION_JWT_SECRET_REFERENCE_UNRESOLVED');
    assertIssueActionToken(token, { expectedExpiresAt: value.jwt_expires_at, now });
    return Object.freeze({
      store_id: String(value.store_id),
      market,
      base_url: `https://${host}`,
      token
    });
  });
}

function returnIdempotencyKey(issueId) {
  const stable = `suleia-return-requested-${issueId}`;
  if (/^[A-Za-z0-9_-]{1,255}$/.test(stable)) return stable;
  return `suleia-return-requested-${crypto.createHash('sha256').update(String(issueId)).digest('hex').slice(0, 32)}`;
}

export function createDropeaV2IssueActionClient({
  token,
  market,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000
} = {}) {
  if (typeof fetchImpl !== 'function') fail('DROPEA_ISSUE_ACTION_FETCH_REQUIRED');
  const normalizedMarket = String(market || '').toUpperCase();
  const host = MARKET_HOSTS[normalizedMarket];
  if (!host) fail('DROPEA_ISSUE_ACTION_MARKET_NOT_APPROVED');
  assertIssueActionToken(token);

  async function returnToOrigin(issueId) {
    const id = Number(issueId);
    if (!Number.isInteger(id) || id < 1) fail('DROPEA_V2_ISSUE_ACTION_ID_INVALID');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let payload;
    try {
      response = await fetchImpl(`https://${host}/dropshipper/issues/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': returnIdempotencyKey(id)
        },
        body: JSON.stringify({ status: 'RESOLVED', resolution_status: 'RETURN_REQUESTED' }),
        redirect: 'error',
        signal: controller.signal
      });
      payload = await response.json().catch(() => null);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) fail(`DROPEA_V2_ISSUE_ACTION_HTTP_${response.status}`, payload?.failure || payload || null);
    if (
      payload?.success !== true
      || String(payload?.data?.status || '').toUpperCase() !== 'RESOLVED'
      || String(payload?.data?.resolution_status || '').toUpperCase() !== 'RETURN_REQUESTED'
    ) {
      fail('DROPEA_V2_ISSUE_ACTION_RESPONSE_SCHEMA_INVALID');
    }
    return payload.data;
  }

  return Object.freeze({ market: normalizedMarket, returnToOrigin });
}

function issueActionClient({
  env = process.env,
  clientFactory = createDropeaV2IssueActionClient,
  configLoader = loadDropeaV2IssueActionStoreConfigs
} = {}) {
  const [store] = configLoader(env);
  if (!store) fail('DROPEA_ISSUE_ACTIONS_STORES_CONFIG_EMPTY');
  return clientFactory({ token: store.token, market: store.market });
}

export async function returnDropeaV2IssueToOrigin(issueId, options = {}) {
  return issueActionClient(options).returnToOrigin(issueId);
}

export function getDropeaV2IssueActionReadiness(env = process.env) {
  try {
    const stores = loadDropeaV2IssueActionStoreConfigs(env);
    return { configured: true, ready: stores.length > 0, stores: stores.length, error: null };
  } catch (error) {
    return {
      configured: Boolean(env.DROPEA_ISSUE_ACTIONS_STORES_CONFIG),
      ready: false,
      stores: 0,
      error: error?.code || 'DROPEA_ISSUE_ACTION_CONFIGURATION_INVALID'
    };
  }
}
