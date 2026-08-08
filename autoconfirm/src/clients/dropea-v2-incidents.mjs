export const DROPEA_V2_READ_SCOPES = Object.freeze([
  'dp:issues:read',
  'dp:orders:read',
  'dp:products:read',
  'dp:stores:read',
  'dp:users:read',
  'dp:webhooks:read'
]);

const MARKET_HOSTS = Object.freeze({
  ES: 'es.public-api.dropea.com',
  IT: 'it.public-api.dropea.com',
  PT: 'pt.public-api.dropea.com'
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function jwtClaims(token) {
  const segments = String(token || '').trim().split('.');
  if (segments.length !== 3) fail('DROPEA_TOKEN_NOT_INSPECTABLE');
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return fail('DROPEA_TOKEN_CLAIMS_INVALID');
  }
}

function assertExactReadToken(token, { expectedExpiresAt, now = Date.now } = {}) {
  const claims = jwtClaims(token);
  const rawScopes = claims.scope ?? claims.scopes ?? claims.permissions ?? claims.permission;
  const scopes = (Array.isArray(rawScopes) ? rawScopes : String(rawScopes || '').split(/[\s,]+/))
    .map(String)
    .filter(Boolean);
  const actual = [...new Set(scopes)].sort();
  const approved = [...DROPEA_V2_READ_SCOPES].sort();
  if (actual.some((scope) => !approved.includes(scope))) fail('DROPEA_WRITE_OR_UNKNOWN_SCOPE_BLOCKED');
  if (approved.some((scope) => !actual.includes(scope))) fail('DROPEA_REQUIRED_READ_SCOPE_MISSING');
  if (!Number.isFinite(Number(claims.exp))) fail('DROPEA_TOKEN_EXPIRY_MISSING');
  const expiresAt = new Date(Number(claims.exp) * 1000);
  if (expiresAt.getTime() <= now()) fail('DROPEA_TOKEN_EXPIRED');
  if (expectedExpiresAt && expiresAt.toISOString() !== new Date(expectedExpiresAt).toISOString()) {
    fail('DROPEA_TOKEN_EXPIRY_MISMATCH');
  }
}

export function loadDropeaV2IncidentStoreConfigs(env = process.env, { now = Date.now } = {}) {
  let values;
  try {
    values = JSON.parse(env.DROPEA_STORES_CONFIG || '');
  } catch {
    return fail('DROPEA_STORES_CONFIG_INVALID');
  }
  if (!Array.isArray(values) || values.length === 0) fail('DROPEA_STORES_CONFIG_EMPTY');
  const seen = new Set();
  return values.map((value) => {
    for (const field of ['store_id', 'market', 'base_url', 'jwt_secret_reference', 'jwt_expires_at']) {
      if (value?.[field] === undefined || value[field] === null || value[field] === '') {
        fail(`DROPEA_STORE_CONFIG_${field.toUpperCase()}_MISSING`);
      }
    }
    const market = String(value.market).toUpperCase();
    const host = MARKET_HOSTS[market];
    if (!host) fail('DROPEA_MARKET_NOT_APPROVED');
    if (String(value.base_url).replace(/\/$/, '') !== `https://${host}`) fail('DROPEA_STORE_BASE_URL_MISMATCH');
    const secretReference = String(value.jwt_secret_reference);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(secretReference)) fail('DROPEA_JWT_SECRET_REFERENCE_INVALID');
    const readToken = env[secretReference];
    if (!readToken) fail('DROPEA_JWT_SECRET_REFERENCE_UNRESOLVED');
    assertExactReadToken(readToken, { expectedExpiresAt: value.jwt_expires_at, now });
    const key = `${market}:${value.store_id}`;
    if (seen.has(key)) fail('DROPEA_STORE_CONFIG_DUPLICATE');
    seen.add(key);
    return Object.freeze({
      store_id: String(value.store_id),
      market,
      base_url: `https://${host}`,
      token: readToken
    });
  });
}

function operation(name, params = {}) {
  if (name === 'listIssues') {
    const allowed = new Set(['page', 'limit', 'only_pending_to_resolve']);
    if (Object.keys(params).some((key) => !allowed.has(key))) fail('DROPEA_V2_PARAMETER_NOT_ALLOWED');
    return { path: '/dropshipper/issues', paginated: true };
  }
  if (name === 'getOrder') {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1 || Object.keys(params).some((key) => key !== 'id')) {
      fail('DROPEA_V2_ORDER_ID_INVALID');
    }
    return { path: `/dropshipper/orders/${encodeURIComponent(id)}`, paginated: false };
  }
  return fail('DROPEA_V2_OPERATION_BLOCKED');
}

export function createDropeaV2IncidentClient({
  token,
  market,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000
} = {}) {
  if (typeof fetchImpl !== 'function') fail('DROPEA_V2_FETCH_REQUIRED');
  const normalizedMarket = String(market || '').toUpperCase();
  const host = MARKET_HOSTS[normalizedMarket];
  if (!host) fail('DROPEA_MARKET_NOT_APPROVED');
  assertExactReadToken(token);

  async function request(name, params = {}) {
    const definition = operation(name, params);
    const url = new URL(`https://${host}${definition.path}`);
    if (name === 'listIssues') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, typeof value === 'boolean' ? String(value) : value);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: undefined,
        redirect: 'error',
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) fail(`DROPEA_V2_HTTP_${response.status}`);
      if (!payload || payload.success !== true || typeof payload.message !== 'string' || !('data' in payload)) {
        fail('DROPEA_V2_RESPONSE_SCHEMA_INVALID');
      }
      if (definition.paginated && (!Array.isArray(payload.data?.items) || !payload.data?.pagination)) {
        fail('DROPEA_V2_PAGINATION_SCHEMA_INVALID');
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function listAll(name, params = {}, { maxPages = 30, maxRecords = 3_000, requestedLimit = 100 } = {}) {
    const items = [];
    const seen = new Set();
    const fingerprints = new Set();
    const limit = normalizedLimit(requestedLimit, 100, 100);
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await request(name, { ...params, page, limit });
      const pageItems = payload.data.items;
      const fingerprint = JSON.stringify(pageItems.map((item) => item?.id));
      if (pageItems.length && fingerprints.has(fingerprint)) fail('DROPEA_V2_PAGE_REPEATED');
      fingerprints.add(fingerprint);
      for (const item of pageItems) {
        if (item?.id === undefined || item.id === null) fail('DROPEA_V2_ITEM_ID_MISSING');
        const key = String(item.id);
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
      if (items.length > maxRecords) fail('DROPEA_V2_MAX_RECORDS_EXCEEDED');
      if (pageItems.length < limit) return { items, complete: true, page_count: page };
    }
    return fail('DROPEA_V2_MAX_PAGES_EXCEEDED');
  }

  return Object.freeze({ market: normalizedMarket, request, listAll });
}

function normalizedLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function customerFromOrder(order = {}) {
  const shipping = order.shipping_address || {};
  const fullName = shipping.full_name
    || [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')
    || '';
  return {
    full_name: fullName,
    first_name: shipping.first_name || '',
    last_name: shipping.last_name || '',
    phone: shipping.phone_number || '',
    email: shipping.email || '',
    address: shipping.address_line_1 || '',
    alternative_address: shipping.address_line_2 || '',
    city: shipping.city || '',
    state: shipping.state || '',
    zip: shipping.postal_code || '',
    country: shipping.country || ''
  };
}

function legacyItemsFromOrder(order = {}) {
  return (Array.isArray(order.line_items) ? order.line_items : []).map((item) => ({
    ...item,
    title: item.product_name || item.external_name || item.variant_name || '',
    shopify_name_item: item.external_name || item.product_name || '',
    total_value: Number(item.unit_price || 0) * Number(item.quantity || 0)
  }));
}

export function normalizeDropeaV2Incident(issue = {}, order = {}, { market = 'ES' } = {}) {
  const orderId = String(issue.order_id ?? order.id ?? '');
  if (!orderId) throw new Error('DROPEA_V2_ISSUE_ORDER_ID_MISSING');
  const customer = customerFromOrder(order);
  const rawOrder = {
    ...order,
    customer,
    items: legacyItemsFromOrder(order),
    tracking_code: order.tracking_number || null,
    carrier_company: order.carrier || issue.carrier || null,
    carrier_service: order.service_type || null
  };
  const reasonCode = issue.initial_carrier_code || issue.type || 'GENERAL_INCIDENCE';
  const description = issue.initial_carrier_description || issue.type || 'Incidencia pendiente';
  const rawIssue = {
    ...issue,
    incidence_code: reasonCode,
    description,
    order_status: order.status || null,
    tracking: issue.tracking_number || order.tracking_number || null,
    tracking_url: order.tracking_url || null,
    order: rawOrder,
    source: 'DROPEA_PUBLIC_API_V2',
    market: String(market).toUpperCase()
  };

  return {
    order: {
      orderId,
      status: order.status || 'INCIDENCE',
      customerName: customer.full_name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      orderAmount: Number.isFinite(Number(order.total_amount)) ? Number(order.total_amount) : null,
      currencyCode: order.currency || 'EUR',
      createdAt: order.created_at || null,
      raw: rawOrder
    },
    issue: {
      id: issue.id,
      incidenceId: issue.id,
      orderId,
      status: String(issue.status || 'PENDING').toUpperCase(),
      orderStatus: String(order.status || 'INCIDENCE').toUpperCase(),
      incidence_code: reasonCode,
      reason: reasonCode,
      type: issue.type || null,
      description,
      observations: description,
      createdAt: issue.created_at || null,
      created_at: issue.created_at || null,
      lastResponseAt: issue.resolution_changed_at || null,
      customerName: customer.full_name,
      customerPhone: customer.phone,
      carrierCompany: issue.carrier || order.carrier || null,
      carrierService: order.service_type || null,
      tracking: issue.tracking_number || order.tracking_number || null,
      trackingUrl: order.tracking_url || null,
      raw: rawIssue
    }
  };
}

function pendingActiveIssue(issue) {
  return String(issue?.status || '').toUpperCase() === 'PENDING' && issue?.is_active === true;
}

export async function collectPendingDropeaV2Incidents({
  env = process.env,
  limit = 100,
  pages = 3,
  clientFactory = createDropeaV2IncidentClient,
  configLoader = loadDropeaV2IncidentStoreConfigs
} = {}) {
  // The local store loader rejects expired tokens and any token whose scopes are
  // not exactly the approved six read-only scopes. There is deliberately no V1 fallback.
  const storeConfigs = configLoader(env);
  const requestedLimit = normalizedLimit(limit, 100, 100);
  // Preserve the dashboard's previous 30-page pending-incidence read ceiling.
  const maxPages = Math.max(normalizedLimit(pages, 3, 30), 30);
  const issuesByKey = new Map();
  const orderRequests = new Map();

  for (const store of storeConfigs) {
    const client = clientFactory({ token: store.token, market: store.market });
    const result = await client.listAll('listIssues', { only_pending_to_resolve: true }, {
      maxPages,
      maxRecords: maxPages * requestedLimit,
      requestedLimit,
      pagePauseMs: 0
    });
    for (const issue of result.items || []) {
      if (!pendingActiveIssue(issue)) continue;
      if (issue.id === undefined || issue.id === null) throw new Error('DROPEA_V2_ISSUE_ID_MISSING');
      if (issue.order_id === undefined || issue.order_id === null) throw new Error('DROPEA_V2_ISSUE_ORDER_ID_MISSING');
      const issueKey = `${client.market}:${issue.id}`;
      if (!issuesByKey.has(issueKey)) issuesByKey.set(issueKey, { client, issue });
    }
  }

  const rows = [];
  for (const { client, issue } of issuesByKey.values()) {
    const orderId = String(issue.order_id);
    const orderKey = `${client.market}:${orderId}`;
    if (!orderRequests.has(orderKey)) {
      orderRequests.set(orderKey, client.request('getOrder', { id: Number(orderId) }).then((payload) => {
        if (!payload?.data || typeof payload.data !== 'object') throw new Error('DROPEA_V2_ORDER_RESPONSE_INVALID');
        return payload.data;
      }));
    }
    const order = await orderRequests.get(orderKey);
    rows.push(normalizeDropeaV2Incident(issue, order, { market: client.market }));
  }

  return rows;
}
