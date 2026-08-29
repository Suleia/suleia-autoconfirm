import {
  createDropeaV2IncidentClient,
  loadDropeaV2IncidentStoreConfigs
} from './dropea-v2-incidents.mjs';

export const DROPEA_V2_ORDER_STATUSES = Object.freeze([
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPING',
  'FINISH',
  'ERROR',
  'DELIVERED'
]);

const STATUS_FILTER_ALIASES = Object.freeze({
  IN_PREPARATION: 'PROCESSING',
  PREPARING: 'PROCESSING',
  PREPARED: 'PROCESSING',
  IN_TRANSIT: 'SHIPPING',
  TRANSIT: 'SHIPPING',
  SHIPPED: 'SHIPPING',
  CANCELLED: 'FINISH',
  REJECTED: 'FINISH',
  RETURNED: 'FINISH',
  INDEMNIFIED: 'FINISH',
  CHARGED: 'FINISH',
  LOST: 'FINISH',
  DAMAGED: 'FINISH',
  REVIEW: 'ERROR'
});

function normalizedLimit(value, fallback = 100, maximum = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizedPage(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
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

export function normalizeDropeaV2Order(order = {}, { market = 'ES' } = {}) {
  const orderId = String(order.id ?? '');
  if (!orderId) throw new Error('DROPEA_V2_ORDER_ID_MISSING');
  const customer = customerFromOrder(order);
  const raw = {
    ...order,
    customer,
    items: legacyItemsFromOrder(order),
    tracking_code: order.tracking_number || null,
    carrier_company: order.carrier || null,
    carrier_service: order.service_type || null,
    source: 'DROPEA_PUBLIC_API_V2',
    market: String(market).toUpperCase()
  };
  const amount = Number(order.total_amount);
  const topStatus = String(order.status || 'PENDING').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  let compatibleStatus = topStatus;
  if (topStatus === 'PROCESSING') {
    compatibleStatus = ['PACKED', 'AWAITING_PICKUP'].includes(subStatus) ? 'PREPARED' : 'PREPARING';
  } else if (topStatus === 'SHIPPING') {
    compatibleStatus = 'TRANSIT';
  } else if (topStatus === 'FINISH') {
    if (['DELIVERED', 'PAID'].includes(subStatus)) compatibleStatus = 'DELIVERED';
    else if (subStatus === 'CANCELLED') compatibleStatus = 'CANCELLED';
    else if (['REFUSED', 'REJECTED', 'REFUSED_LOST_DAMAGED'].includes(subStatus)) compatibleStatus = 'REJECTED';
  }
  return {
    orderId,
    status: compatibleStatus,
    orderAmount: Number.isFinite(amount) ? amount : null,
    currencyCode: order.currency || 'EUR',
    createdAt: order.created_at || null,
    customerName: customer.full_name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    raw
  };
}

function clientsForStores(env, clientFactory, configLoader) {
  return configLoader(env).map((store) => ({
    store,
    client: clientFactory({ token: store.token, market: store.market })
  }));
}

export async function listDropeaV2Orders({
  status = null,
  limit = 100,
  page = 1,
  env = process.env,
  clientFactory = createDropeaV2IncidentClient,
  configLoader = loadDropeaV2IncidentStoreConfigs
} = {}) {
  const requestedStatus = status === null || status === undefined || status === ''
    ? null
    : String(status).toUpperCase();
  const normalizedStatus = requestedStatus ? (STATUS_FILTER_ALIASES[requestedStatus] || requestedStatus) : null;
  if (normalizedStatus && !DROPEA_V2_ORDER_STATUSES.includes(normalizedStatus)) {
    const error = new Error('DROPEA_V2_ORDER_STATUS_INVALID');
    error.code = 'DROPEA_V2_ORDER_STATUS_INVALID';
    throw error;
  }
  const requestedLimit = normalizedLimit(limit);
  const requestedPage = normalizedPage(page);
  const byId = new Map();

  for (const { store, client } of clientsForStores(env, clientFactory, configLoader)) {
    const payload = await client.request('listOrders', {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      store_id: Number(store.store_id),
      page: requestedPage,
      limit: requestedLimit,
      sort_by: 'created_at',
      sort_order: 'desc'
    });
    for (const order of payload.data.items) {
      const normalized = normalizeDropeaV2Order(order, { market: client.market });
      byId.set(`${client.market}:${normalized.orderId}`, normalized);
    }
  }

  return [...byId.values()];
}

export async function listDropeaV2OrdersByStatus(options = {}) {
  return listDropeaV2Orders(options);
}

export async function listPendingDropeaV2Orders(options = {}) {
  return listDropeaV2OrdersByStatus({ ...options, status: 'PENDING' });
}

export async function getDropeaV2OrderById(orderId, {
  env = process.env,
  clientFactory = createDropeaV2IncidentClient,
  configLoader = loadDropeaV2IncidentStoreConfigs
} = {}) {
  const numericOrderId = Number(orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId < 1) {
    const error = new Error('DROPEA_V2_ORDER_ID_INVALID');
    error.code = 'DROPEA_V2_ORDER_ID_INVALID';
    throw error;
  }

  let notFound = false;
  for (const { client } of clientsForStores(env, clientFactory, configLoader)) {
    try {
      const payload = await client.request('getOrder', { id: numericOrderId });
      if (!payload?.data || typeof payload.data !== 'object') {
        throw new Error('DROPEA_V2_ORDER_RESPONSE_INVALID');
      }
      return normalizeDropeaV2Order(payload.data, { market: client.market });
    } catch (error) {
      if (error?.code === 'DROPEA_V2_HTTP_404') {
        notFound = true;
        continue;
      }
      throw error;
    }
  }
  if (notFound) return null;
  return null;
}
