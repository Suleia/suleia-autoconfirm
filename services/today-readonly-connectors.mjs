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
  return {
    identity_key: `SHOPIFY:${id}`,
    identity_references: [id, name, name.replace(/^#/, '')].filter(Boolean),
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
    raw_ephemeral: order
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
  fetchImpl = globalThis.fetch
}) {
  if (!sessionSecret) {
    return {
      orders: [],
      status: { consultable: false, complete: false, error: 'DASHBOARD_SESSION_SECRET_MISSING', page_count: 0 }
    };
  }
  const base = new URL(baseUrl);
  const transport = createReadOnlyTransport({ fetchImpl, allowedHosts: [base.hostname], maxRetries: 2 });
  const value = `suleia:${Date.now()}`;
  const signature = crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
  const cookie = `suleia_dashboard=${encodeURIComponent(`${value}.${signature}`)}`;
  const response = await transport(new URL('/api/dashboard', base.origin), {
    headers: { Accept: 'application/json', Cookie: cookie }
  });
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
      logistics_state: order.raw?.delivery_status || order.raw?.status || 'UNKNOWN',
      created_at: order.createdAt || null
    })),
    status: {
      consultable: true,
      complete: false,
      error: 'CURRENT_SYSTEM_CACHE_NOT_AUTHORITATIVE_FOR_COMPLETENESS',
      page_count: 1,
      records: rows.length
    }
  };
}

export const POST_ONLY_SOURCE_STATUS = Object.freeze({
  dropea: {
    consultable: false,
    complete: false,
    error: 'DIRECT_READ_REQUIRES_POST_BLOCKED_BY_CHECKPOINT',
    page_count: 0
  },
  gls: {
    consultable: false,
    complete: false,
    error: 'DIRECT_READ_REQUIRES_POST_BLOCKED_BY_CHECKPOINT',
    page_count: 0
  }
});
