import crypto from 'node:crypto';
import {buildDropeaResolutionBody} from './dropea-v2-resolution-contract.mjs';

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

function returnIdempotencyKey(issueId, nonce = crypto.randomUUID()) {
  const candidate = `suleia-return-requested-${issueId}-${nonce}`;
  if (/^[A-Za-z0-9_-]{1,255}$/.test(candidate)) return candidate;
  return `suleia-return-requested-${issueId}-${crypto.createHash('sha256').update(String(nonce)).digest('hex').slice(0, 32)}`;
}

export function createDropeaV2IssueActionClient({
  token,
  market,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  idempotencyNonceFactory = crypto.randomUUID
} = {}) {
  if (typeof fetchImpl !== 'function') fail('DROPEA_ISSUE_ACTION_FETCH_REQUIRED');
  const normalizedMarket = String(market || '').toUpperCase();
  const host = MARKET_HOSTS[normalizedMarket];
  if (!host) fail('DROPEA_ISSUE_ACTION_MARKET_NOT_APPROVED');
  assertIssueActionToken(token);

  async function resolve(issueId, resolution='RETURN_REQUESTED', note=null, contractBody=null) {
    const body=contractBody||{status:'RESOLVED',resolution_status:resolution,...(note?{resolution_note:note}:{})};
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
          // Dropea caches an idempotency key for 24 hours. A retry after an
          // explicit 5xx response is a new logical attempt and therefore must
          // use a fresh key; the persistent workflow ledger still prevents
          // concurrent or duplicate returns for the same issue.
          'Idempotency-Key': returnIdempotencyKey(id, idempotencyNonceFactory())
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal
      });
      payload = await response.json().catch(() => null);
    } catch {
      fail('DROPEA_V2_ISSUE_ACTION_NETWORK_UNKNOWN');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) fail(`DROPEA_V2_ISSUE_ACTION_HTTP_${response.status}`, payload?.failure || payload || null);
    if (
      payload?.success !== true
      || String(payload?.data?.status || '').toUpperCase() !== body.status
      || (body.resolution_status && String(payload?.data?.resolution_status || '').toUpperCase() !== body.resolution_status)
    ) {
      fail('DROPEA_V2_ISSUE_ACTION_RESPONSE_SCHEMA_INVALID');
    }
    return payload.data;
  }

  return Object.freeze({market:normalizedMarket,executeResolution:(issueId,action,data)=>resolve(issueId,null,null,buildDropeaResolutionBody(action,data)),returnToOrigin:issueId=>resolve(issueId),provideSolution:(issueId,note)=>{
    if(typeof note!=='string'||!note.trim()||note.length>500)fail('DROPEA_SOLUTION_NOTE_INVALID');
    return resolve(issueId,'SOLUTION_PROVIDED',note);
  }});
}

function issueActionClient({
  env = process.env,
  idempotencyNonce,
  clientFactory = createDropeaV2IssueActionClient,
  configLoader = loadDropeaV2IssueActionStoreConfigs
} = {}) {
  const [store] = configLoader(env);
  if (!store) fail('DROPEA_ISSUE_ACTIONS_STORES_CONFIG_EMPTY');
  return clientFactory({ token: store.token, market: store.market,
    idempotencyNonceFactory: idempotencyNonce ? () => idempotencyNonce : undefined });
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

export async function provideDropeaV2AddressSolution(issueId,note,options={}){return issueActionClient(options).provideSolution(issueId,note);}
export async function executeDropeaV2Resolution(issueId,action,data,options={}){return issueActionClient(options).executeResolution(issueId,action,data);}

// Read the outcome of the original mutation; never re-POST to diagnose it.
export async function readDropeaV2IssueOperation(issueId,nonce,{env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!nonce) return null;
  const [store]=loadDropeaV2IssueActionStoreConfigs(env);
  const response=await fetchImpl(`${store.base_url}/dropshipper/operations/${encodeURIComponent(returnIdempotencyKey(issueId,nonce))}`,{
    method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${store.token}`},redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)return null;
  const payload=await response.json();const code=payload?.data?.error?.code;
  return {status:payload?.data?.status||null,errorCode:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/.test(code)?code:null};
}
