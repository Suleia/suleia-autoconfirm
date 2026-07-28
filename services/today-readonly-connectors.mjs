import crypto from 'node:crypto';
import { collectPaginated, createReadOnlyTransport } from '../packages/platform-core/src/read-only-transport.mjs';

function jsonHeaders(token, headerName = 'Authorization') {
  return headerName === 'Authorization'
    ? { Accept: 'application/json', Authorization: `Bearer ${token}` }
    : { Accept: 'application/json', [headerName]: token };
}

async function responseJson(response, source) {
  if (!response.ok) {
    const error = new Error(`${source} read failed with HTTP ${response.status}`);
    error.code = `${source.toUpperCase()}_HTTP_${response.status}`;
    throw error;
  }
  return response.json();
}

function nextLink(response) {
  const header = String(response.headers.get('link') || '');
  for (const segment of header.split(',')) {
    const match = segment.match(/<([^>]+)>;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return null;
}

function normalizeShopifyOrder(order) {
  const id = String(order.id || '');
  const name = String(order.name || '');
  const tags = Array.isArray(order.tags) ? order.tags : String(order.tags || '').split(',');
  const dropeaReferences = tags.flatMap((tag) => {
    if (!/dropea/i.test(String(tag))) return [];
    return String(tag).match(/\b\d{4,12}\b/g) || [];
  });
  const fulfillment = Array.isArray(order.fulfillments)
    ? order.fulfillments.find((item) => item?.tracking_number || item?.tracking_url)
    : null;
  return {
    identity_key: `SHOPIFY:${id}`,
    identity_references: [...new Set([
      id,
      name,
      name.replace(/^#/, ''),
      ...dropeaReferences
    ].filter(Boolean))],
    created_at: order.created_at,
    updated_at: order.updated_at || order.created_at,
    cancelled_at: order.cancelled_at || null,
    status: order.cancelled_at ? 'CANCELLED' : order.fulfillment_status || order.financial_status || 'UNKNOWN',
    financial_status: order.financial_status || 'UNKNOWN',
    fulfillment_status: order.fulfillment_status || 'UNKNOWN',
    currency: order.currency || 'UNKNOWN',
    item_count: Array.isArray(order.line_items)
      ? order.line_items.reduce((total, item) => total + Number(item.quantity || 0), 0)
      : 0,
    tracking_present: Boolean(order.fulfillments?.some((item) => item.tracking_number || item.tracking_url)),
    tracking_reference_ephemeral: fulfillment?.tracking_number || null,
    tracking_url_ephemeral: fulfillment?.tracking_url || null,
    raw_ephemeral: order
  };
}

async function semanticPostJson({
  url,
  allowedHost,
  allowedPath,
  headers,
  body,
  source,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000
}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== allowedHost || target.pathname !== allowedPath) {
    throw new Error(`${source} semantic POST target is not allowlisted`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target, {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error'
    });
    return responseJson(response, source);
  } finally {
    clearTimeout(timeout);
  }
}

function exactReferences(order) {
  return new Set((order.identity_references || [])
    .map((item) => String(item).replace(/^#/, '').trim())
    .filter(Boolean));
}

export async function readDropeaOrdersToday({
  apiKey,
  bounds,
  orders,
  maxPages = 200,
  maxRuntimeMs = 10 * 60_000,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    return {
      orders,
      status: { consultable: false, complete: false, error: 'DROPEA_API_KEY_MISSING', page_count: 0 }
    };
  }
  const query = `
    query TodayOrdersReadOnly($limit: Int!, $page: Int!) {
      orders(limit: $limit, page: $page) {
        data {
          id
          status
          created_at
          updated_at
          tracking_code
          tracking_url
          issues { id incidence_code status }
        }
      }
    }
  `;
  const startedAt = Date.now();
  const rows = [];
  let pageCount = 0;
  let complete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;
    const payload = await semanticPostJson({
      url: 'https://api.dropea.com/graphql/dropshippers',
      allowedHost: 'api.dropea.com',
      allowedPath: '/graphql/dropshippers',
      headers: { 'x-api-key': apiKey },
      body: { query, variables: { limit: 100, page } },
      source: 'dropea',
      fetchImpl
    });
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      const error = new Error('Dropea read-only GraphQL query returned errors');
      error.code = 'DROPEA_GRAPHQL_READ_ERROR';
      throw error;
    }
    const pageRows = payload?.data?.orders?.data ?? payload?.orders?.data ?? [];
    if (!Array.isArray(pageRows)) throw new Error('Dropea read-only response has an unexpected shape');
    rows.push(...pageRows);
    pageCount += 1;
    if (pageRows.length < 100) {
      complete = true;
      break;
    }
  }
  const todayRows = rows.filter((row) => isWithinBounds(row.created_at, bounds));
  const enriched = orders.map((order) => {
    const references = exactReferences(order);
    const matches = todayRows.filter((row) => references.has(String(row.id || '').trim()));
    if (matches.length !== 1) {
      return { ...order, identity_mismatch: order.identity_mismatch || matches.length > 1 };
    }
    const match = matches[0];
    const issues = Array.isArray(match.issues) ? match.issues : [];
    const incident = issues.find((item) => String(item?.status || '').toUpperCase() !== 'RESOLVED') || issues[0];
    return {
      ...order,
      dropea_status: String(match.status || 'UNKNOWN').toUpperCase(),
      incident_present: Boolean(incident),
      incident_type: incident?.incidence_code || 'UNKNOWN',
      incident_at: match.updated_at || match.created_at,
      tracking_present: order.tracking_present || Boolean(match.tracking_code || match.tracking_url),
      tracking_reference_ephemeral: match.tracking_code || order.tracking_reference_ephemeral,
      tracking_url_ephemeral: match.tracking_url || order.tracking_url_ephemeral,
      direct_dropea_read: true
    };
  });
  return {
    orders: enriched,
    status: {
      consultable: true,
      complete,
      error: complete ? null : 'DROPEA_PAGINATION_INCOMPLETE',
      page_count: pageCount,
      records: todayRows.length,
      exact_matches: enriched.filter((order) => order.direct_dropea_read).length
    }
  };
}

function isWithinBounds(value, bounds) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= new Date(bounds.utc_start).getTime()
    && timestamp < new Date(bounds.utc_end_exclusive).getTime();
}

function glsCoordinates(order) {
  const url = String(order.tracking_url_ephemeral || '');
  const match = url.match(/\/e\/(\d+)\/([0-9A-Za-z-]+)(?:\/|$)/i);
  return {
    reference: match?.[1] || null,
    postalCode: match?.[2] || null
  };
}

function glsSignedHeaders(path, secret, now = new Date()) {
  const timestamp = now.toISOString();
  const signature = crypto.createHmac('sha256', secret || 'gls')
    .update(`POST\n${path}\n${timestamp}`)
    .digest('hex');
  return {
    'MyGls-Agent': 'pwa',
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}

function glsState(found) {
  const latest = Array.isArray(found?.tracking) ? found.tracking.at(-1) : null;
  const text = `${found?.state?.code || ''} ${found?.state?.reason || ''} ${latest?.code || ''} ${latest?.description || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/DELIVERED|ENTREGAD/.test(text)) return 'DELIVERED';
  if (/RETURN|DEVUELT/.test(text)) return 'RETURNED';
  if (/INCID|ABSENT|AUSENTE/.test(text)) return 'INCIDENCE';
  return found?.state?.code || latest?.code || 'UNKNOWN';
}

function canonicalLogisticsState(value) {
  const text = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (/DELIVERED|ENTREGAD/.test(text)) return 'DELIVERED';
  if (/RETURN|DEVUELT/.test(text)) return 'RETURNED';
  if (/INCID|ABSENT|AUSENTE|REJECT|RECHAZ/.test(text)) return 'INCIDENCE';
  if (/TRANSIT|TRANSITO|SHIPPED|ENVIADO|REPARTO/.test(text)) return 'IN_TRANSIT';
  if (/PREPARED|PREPARADO/.test(text)) return 'PREPARED';
  if (/PENDING|PENDIENTE/.test(text)) return 'PENDING';
  return 'UNKNOWN';
}

export async function readGlsTrackingToday({
  orders,
  signingSecret = 'gls',
  fetchImpl = globalThis.fetch
}) {
  let pageCount = 0;
  let missingCoordinates = 0;
  let failed = 0;
  const enriched = await mapLimited(orders, 2, async (order) => {
    if (!order.tracking_present) return order;
    const { reference, postalCode } = glsCoordinates(order);
    if (!reference || !postalCode) {
      missingCoordinates += 1;
      return order;
    }
    const path = '/api/v5/expeditions/find';
    const signaturePath = '/expeditions/find';
    try {
      const payload = await semanticPostJson({
        url: `https://api.consignee.gls-spain.es${path}`,
        allowedHost: 'api.consignee.gls-spain.es',
        allowedPath: path,
        headers: glsSignedHeaders(signaturePath, signingSecret),
        body: { find: { reference, destination: { address: { postalCode } } } },
        source: 'gls',
        fetchImpl,
        timeoutMs: 10_000
      });
      pageCount += 1;
      const found = payload?.found || null;
      if (!found) return { ...order, direct_gls_read: true };
      const tracking = Array.isArray(found.tracking) ? found.tracking : [];
      const latest = tracking.at(-1) || null;
      return {
        ...order,
        logistics_state: glsState(found),
        logistics_at: latest?.at || found?.state?.incidenceDatetime || order.updated_at,
        direct_gls_read: true
      };
    } catch {
      failed += 1;
      return order;
    }
  });
  const complete = failed === 0 && missingCoordinates === 0;
  return {
    orders: enriched,
    status: {
      consultable: true,
      complete,
      error: failed
        ? 'GLS_READ_FAILED'
        : missingCoordinates ? 'GLS_TRACKING_COORDINATES_MISSING' : null,
      page_count: pageCount,
      records: enriched.filter((order) => order.direct_gls_read).length,
      missing_coordinates: missingCoordinates,
      failed
    }
  };
}

export async function readShopifyOrdersToday({
  domain,
  token,
  apiVersion = '2026-04',
  bounds,
  maxPages = 200,
  maxRuntimeMs = 10 * 60_000,
  fetchImpl = globalThis.fetch
}) {
  if (!domain || !token) {
    return {
      orders: [],
      status: { consultable: false, complete: false, error: 'SHOPIFY_GET_CREDENTIALS_MISSING', page_count: 0 }
    };
  }
  const host = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const transport = createReadOnlyTransport({ fetchImpl, allowedHosts: [host], maxRetries: 3 });
  const fields = [
    'id', 'name', 'created_at', 'updated_at', 'cancelled_at', 'financial_status',
    'fulfillment_status', 'currency', 'line_items', 'fulfillments', 'tags'
  ].join(',');
  const first = new URL(`https://${host}/admin/api/${apiVersion}/orders.json`);
  first.searchParams.set('status', 'any');
  first.searchParams.set('limit', '250');
  first.searchParams.set('created_at_min', bounds.utc_start);
  first.searchParams.set('created_at_max', bounds.utc_end_exclusive);
  first.searchParams.set('fields', fields);

  const pages = await collectPaginated({
    firstCursor: first.toString(),
    maxPages,
    maxRuntimeMs,
    fetchPage: async (cursor) => {
      const response = await transport(cursor, {
        headers: jsonHeaders(token, 'X-Shopify-Access-Token')
      });
      const payload = await responseJson(response, 'shopify');
      return {
        items: Array.isArray(payload.orders) ? payload.orders : [],
        next_cursor: nextLink(response)
      };
    }
  });
  return {
    orders: pages.items.map(normalizeShopifyOrder),
    status: {
      consultable: true,
      complete: pages.complete,
      error: pages.reason,
      page_count: pages.page_count,
      records: pages.items.length
    }
  };
}

function chatbyRows(payload) {
  const rows = payload?.data ?? payload;
  return Array.isArray(rows) ? rows : [];
}

function exactReferenceMatch(subscriber, references) {
  const expected = new Set(references.map((item) => String(item).replace(/^#/, '')).filter(Boolean));
  const values = (subscriber?.user_fields || []).map((field) => String(field?.value || '').replace(/^#/, ''));
  return values.some((value) => expected.has(value));
}

function messageAt(message) {
  const value = message?.created_at || message?.createdAt || message?.timestamp || message?.ts || null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString();
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function messageText(message) {
  return [
    message?.content,
    message?.message,
    message?.text,
    message?.button_text,
    message?.buttonText,
    message?.payload?.title,
    message?.payload?.body
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isInbound(message) {
  const role = String(message?.role || message?.sender || message?.direction || message?.type || '').toLowerCase();
  if (message?.is_from_customer === true || message?.isFromCustomer === true) return true;
  if (message?.is_echo === true || message?.isEcho === true) return false;
  return ['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user', 'client'].includes(role);
}

function semanticSignal(messages) {
  const inbound = messages
    .filter(isInbound)
    .map((message) => ({ message, at: messageAt(message), text: messageText(message) }))
    .filter((item) => item.at && item.text)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
  let latest = null;
  for (const item of inbound) {
    let intent = null;
    if (/(no confirm|cancel|rechaz|no lo quiero|me arrep)/.test(item.text)) intent = latest?.intent === 'CONFIRM' ? 'CHANGED_MIND' : 'CANCEL';
    else if (/(confirmar mi pedido|confirmo|confirmado|si lo quiero|lo quiero|vale|perfecto)/.test(item.text)) intent = 'CONFIRM';
    else if (/(cambiar datos|cambio de direccion|cambiar direccion)/.test(item.text)) intent = 'CHANGED_MIND';
    if (intent) latest = { intent, occurred_at: item.at };
  }
  if (!latest) return null;
  return {
    ...latest,
    evidence_type: 'CHATBY_INBOUND_SEMANTIC',
    source_record_id_hash: crypto.createHash('sha256')
      .update(`${latest.occurred_at}:${latest.intent}`)
      .digest('hex')
  };
}

async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

export async function readChatbySignals({
  baseUrl = 'https://app.chatby.io/api',
  token,
  orders,
  maxPages = 200,
  fetchImpl = globalThis.fetch
}) {
  if (!token) {
    return {
      orders,
      status: { consultable: false, complete: false, error: 'CHATBY_GET_CREDENTIAL_MISSING', page_count: 0 }
    };
  }
  const base = new URL(baseUrl);
  const transport = createReadOnlyTransport({ fetchImpl, allowedHosts: [base.hostname], maxRetries: 3 });
  const pages = await collectPaginated({
    firstCursor: 1,
    maxPages,
    fetchPage: async (page) => {
      const url = new URL('/api/subscribers', base.origin);
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));
      const response = await transport(url, { headers: jsonHeaders(token) });
      const rows = chatbyRows(await responseJson(response, 'chatby'));
      return { items: rows, next_cursor: rows.length < 100 ? null : Number(page) + 1 };
    }
  });
  if (!pages.complete) {
    return {
      orders,
      status: {
        consultable: true,
        complete: false,
        error: pages.reason,
        page_count: pages.page_count,
        records: pages.items.length
      }
    };
  }
  const enriched = await mapLimited(orders, 2, async (order) => {
    const matches = pages.items.filter((subscriber) => exactReferenceMatch(subscriber, order.identity_references || []));
    if (matches.length !== 1) {
      return {
        ...order,
        identity_mismatch: matches.length > 1,
        chatby_match_count: matches.length
      };
    }
    const subscriber = matches[0];
    const userNs = subscriber.user_ns || subscriber.userNs;
    if (!userNs) return order;
    const url = new URL('/api/subscriber/chat-messages', base.origin);
    url.searchParams.set('user_ns', userNs);
    const response = await transport(url, { headers: jsonHeaders(token) });
    const messages = chatbyRows(await responseJson(response, 'chatby'));
    return {
      ...order,
      chatby_signal: semanticSignal(messages),
      chatby_has_conversation: messages.length > 0
    };
  });
  return {
    orders: enriched,
    status: {
      consultable: true,
      complete: true,
      error: null,
      page_count: pages.page_count,
      records: pages.items.length
    }
  };
}

export async function readCurrentSystemDashboard({
  baseUrl = 'https://suleia-autoconfirm.onrender.com',
  sessionSecret,
  dashboardPassword,
  fetchImpl = globalThis.fetch
}) {
  if (!sessionSecret && !dashboardPassword) {
    return {
      orders: [],
      status: { consultable: false, complete: false, error: 'DASHBOARD_AUTH_CREDENTIAL_MISSING', page_count: 0 }
    };
  }
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.hostname !== 'suleia-autoconfirm.onrender.com') {
    throw new Error('Current-system host is not allowlisted');
  }
  const transport = createReadOnlyTransport({ fetchImpl, allowedHosts: [base.hostname], maxRetries: 2 });
  let cookie = null;
  if (sessionSecret) {
    const value = `suleia:${Date.now()}`;
    const signature = crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
    cookie = `suleia_dashboard=${encodeURIComponent(`${value}.${signature}`)}`;
  }
  let response = cookie
    ? await transport(new URL('/api/dashboard', base.origin), {
        headers: { Accept: 'application/json', Cookie: cookie }
      })
    : null;
  if ((!response || response.status === 401) && dashboardPassword) {
    const loginUrl = new URL('/api/dashboard-login', base.origin);
    if (loginUrl.protocol !== 'https:') throw new Error('Current-system login requires HTTPS');
    const login = await fetchImpl(loginUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: dashboardPassword }).toString(),
      redirect: 'manual'
    });
    if (login.status !== 303) {
      const error = new Error(`current_system authentication failed with HTTP ${login.status}`);
      error.code = `CURRENT_SYSTEM_AUTH_HTTP_${login.status}`;
      throw error;
    }
    const setCookie = login.headers.get('set-cookie') || '';
    cookie = setCookie.split(';', 1)[0];
    if (!cookie.startsWith('suleia_dashboard=')) throw new Error('Current-system authentication returned no session');
    response = await transport(new URL('/api/dashboard', base.origin), {
      headers: { Accept: 'application/json', Cookie: cookie }
    });
  }
  const payload = await responseJson(response, 'current_system');
  const rows = Array.isArray(payload?.dashboard?.orders) ? payload.dashboard.orders : [];
  return {
    orders: rows.map((order) => ({
      identity_references: [
        order.orderId,
        order.shopifyOrderId,
        String(order.orderId || '').replace(/^SHOPIFY-/, '')
      ].filter(Boolean),
      status: order.status || 'UNKNOWN',
      action: order.agentAction || 'UNKNOWN',
      intent: order.agentIntent || 'UNKNOWN',
      incident_present: String(order.issue || '').toLowerCase() === 'si' || Boolean(order.issueCode),
      tracking_present: Boolean(order.raw?.tracking_code || order.raw?.tracking),
      logistics_state: canonicalLogisticsState(order.raw?.delivery_status || order.raw?.status),
      created_at: order.createdAt || null
    })),
    status: {
      consultable: true,
      complete: false,
      error: 'CURRENT_SYSTEM_CACHE_NOT_AUTHORITATIVE_FOR_COMPLETENESS',
      page_count: 1,
      records: rows.length,
      authenticated: true
    }
  };
}
