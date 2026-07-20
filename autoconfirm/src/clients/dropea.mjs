import { getAppConfig } from '../config.mjs';

const config = getAppConfig();
const BASE_URL = 'https://api.dropea.com/graphql/dropshippers';
const REST_BASE_URL = 'https://api.dropea.com/api';

async function requestGraphQL(query, variables = {}) {
  if (!config.dropeaApiKey) throw new Error('Falta DROPEA_API_KEY.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(BASE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.dropeaApiKey
      },
      body: JSON.stringify({ query, variables })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Dropea no respondio en 20000 ms.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Dropea respondió ${response.status}: ${JSON.stringify(data)}`);
  }
  if (data?.errors?.length) {
    throw new Error(`Dropea errors: ${JSON.stringify(data.errors)}`);
  }
  return data?.data ?? data;
}

async function requestDropeaRest(path, { method = 'GET', body = undefined } = {}) {
  if (!config.dropeaAccessToken) {
    const error = new Error('Falta DROPEA_ACCESS_TOKEN para esta accion especial de incidencias.');
    error.code = 'DROPEA_ACCESS_TOKEN_MISSING';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(`${REST_BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.dropeaAccessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Dropea REST no respondio en 20000 ms.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) {
    throw new Error(`Dropea REST respondio ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function normalizeCustomer(customer) {
  if (!customer) return {};
  return {
    customerName: customer.full_name || customer.fullName || customer.name || customer.display_name || null,
    customerPhone: customer.phone || customer.mobile || null,
    customerEmail: customer.email || null
  };
}

function normalizeOrder(order) {
  return {
    orderId: String(order.id ?? order.order_id ?? order.orderId),
    status: String(order.status ?? 'PENDING').toUpperCase(),
    orderAmount: Number(order.total_amount ?? order.amount ?? order.total ?? order.total_price ?? 0) || null,
    currencyCode: order.currency || order.currency_code || 'EUR',
    createdAt: order.created_at || order.createdAt || order.date || null,
    raw: order
  };
}

function normalizeIncidence(incidence) {
  const order = incidence.order || incidence.order_data || incidence.orderData || incidence.order_info || {};
  const customer = incidence.customer || order.customer || {};
  const orderId = incidence.order_id
    ?? incidence.orderId
    ?? incidence.id_order
    ?? incidence.order?.id
    ?? order.id
    ?? null;

  return {
    orderId: orderId === null || orderId === undefined ? null : String(orderId),
    id: incidence.id ?? incidence.incidence_id ?? incidence.incidenceId ?? null,
    incidenceId: incidence.id ?? incidence.incidence_id ?? incidence.incidenceId ?? null,
    status: String(incidence.status ?? incidence.state ?? 'PENDING').toUpperCase(),
    orderStatus: String(incidence.order_status ?? incidence.orderStatus ?? order.status ?? 'CON INCIDENCIA').toUpperCase(),
    reason: incidence.incidence_code
      || incidence.incidenceCode
      || incidence.reason
      || incidence.type
      || incidence.name
      || incidence.code
      || 'Incidencia pendiente',
    createdAt: incidence.created_at
      || incidence.createdAt
      || incidence.date
      || incidence.opened_at
      || incidence.openedAt
      || null,
    lastResponseAt: incidence.last_response_at || incidence.lastResponseAt || incidence.last_response || null,
    customerName: customer.full_name || customer.fullName || customer.name || incidence.customer_name || incidence.customerName || null,
    customerPhone: customer.phone || customer.mobile || incidence.phone || incidence.customer_phone || incidence.customerPhone || null,
    carrierCompany: incidence.carrier_company || incidence.carrierCompany || order.carrier_company || null,
    carrierService: incidence.carrier_service || incidence.carrierService || order.carrier_service || null,
    description: incidence.description || null,
    solutions: incidence.solutions || null,
    observations: incidence.observations || incidence.observation || incidence.notes || incidence.comments || null,
    history: incidence.history || incidence.histories || incidence.incidence_history || incidence.incident_history || null,
    annotations: incidence.annotations || incidence.annotation || incidence.carrier_notes || incidence.logistics_notes || null,
    distance: incidence.distance || null,
    tracking: incidence.tracking || order.tracking_code || null,
    trackingUrl: incidence.tracking_url || incidence.trackingUrl || order.tracking_url || null,
    raw: incidence
  };
}

function extractConnectionItems(result) {
  if (!result || typeof result !== 'object') return [];
  for (const value of Object.values(result)) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.nodes)) return value.nodes;
  }
  return [];
}

export async function listPendingDropeaOrders({ limit = 50, page = 1 } = {}) {
  const query = `
    query PendingOrders($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
      orders(status: $status, limit: $limit, page: $page) {
        data {
          id
          status
          customer { full_name phone email address alternative_address city state zip }
          items { sku title shopify_name_item unit_price quantity total_value }
          total_amount
          created_at
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { status: 'PENDING', limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function listDropeaOrdersByStatus({ status = 'PENDING', limit = 100, page = 1 } = {}) {
  const query = `
    query OrdersByStatus($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
      orders(status: $status, limit: $limit, page: $page) {
        data {
          id
          status
          customer { full_name phone email address alternative_address city state zip }
          items { sku title shopify_name_item unit_price quantity total_value }
          total_amount
          created_at
          updated_at
          tracking_code
          tracking_url
          carrier_company
          carrier_service
          issues { id incidence_code status }
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { status, limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function listDropeaOrdersByStatusBasic({ status = 'PENDING', limit = 100, page = 1 } = {}) {
  const query = `
    query OrdersByStatusBasic($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
      orders(status: $status, limit: $limit, page: $page) {
        data {
          id
          status
          customer { full_name phone email }
          total_amount
          created_at
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { status, limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function listDropeaOrdersByStatusWithPagination({ status = 'PENDING', limit = 100, page = 1 } = {}) {
  const query = `
    query OrdersByStatusWithPagination($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
      orders(status: $status, limit: $limit, page: $page) {
        total
        per_page
        current_page
        last_page
        has_more_pages
        data {
          id
          status
          customer { full_name phone email }
          total_amount
          created_at
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { status, limit, page });
  const payload = result?.orders || {};
  const items = payload?.data ?? [];
  return {
    orders: items.map((order) => ({
      ...normalizeOrder(order),
      ...normalizeCustomer(order.customer),
      raw: order
    })),
    pagination: {
      total: payload.total ?? items.length,
      perPage: payload.per_page ?? limit,
      currentPage: payload.current_page ?? page,
      lastPage: payload.last_page ?? page,
      hasMorePages: Boolean(payload.has_more_pages)
    }
  };
}

export async function listDropeaOrders({ limit = 100, page = 1 } = {}) {
  const query = `
    query Orders($limit: Int!, $page: Int!) {
      orders(limit: $limit, page: $page) {
        data {
          id
          status
          customer { full_name phone email address alternative_address city state zip }
          items { sku title shopify_name_item unit_price quantity total_value }
          total_amount
          created_at
          updated_at
          tracking_code
          tracking_url
          carrier_company
          carrier_service
          issues { id incidence_code status }
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function listDropeaOrdersBasic({ limit = 100, page = 1 } = {}) {
  const query = `
    query Orders($limit: Int!, $page: Int!) {
      orders(limit: $limit, page: $page) {
        data {
          id
          status
          customer { full_name phone email }
          total_amount
          created_at
        }
      }
    }
  `;

  const result = await requestGraphQL(query, { limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function listDropeaOrderStateValues() {
  const query = `
    query OrderStateEnumValues {
      __type(name: "OrderStateEnum") {
        enumValues {
          name
        }
      }
    }
  `;
  const result = await requestGraphQL(query);
  return (result?.__type?.enumValues || [])
    .map((item) => item?.name)
    .filter(Boolean);
}

export async function listRecentDropeaOrders({ limit = 100, pages = 2, statuses = null } = {}) {
  const targetStatuses = statuses || [
    'PENDING',
    'CONFIRMED',
    'PREPARED',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'ERROR',
    'TRANSIT',
    'INCIDENCE',
    'REJECTED',
    'RECLAIM',
    'RETURNED',
    'INDEMNIFIED',
    'CHARGED',
    'REVIEW',
    'PREPARING',
    'LOST',
    'DAMAGED'
  ];
  const byId = new Map();

  for (const status of targetStatuses) {
    for (let page = 1; page <= pages; page += 1) {
      try {
        const orders = await listDropeaOrdersByStatus({ status, limit, page });
        for (const order of orders) {
          byId.set(String(order.orderId), order);
        }
        if (orders.length < limit) break;
      } catch (error) {
        // Some Dropea environments do not expose every enum. Keep the other statuses available.
        if (status === 'PENDING') throw error;
        break;
      }
    }
  }

  return [...byId.values()];
}

export async function listDropeaIncidences({ limit = 100, page = 1, status = null, sort = 'ID', direction = 'DESC' } = {}) {
  const richIssuesQuery = `
    query DropeaIssuesRich($limit: Int!, $page: Int!, $status: IssueStateEnum, $sort: OrderSortEnum, $direction: FilterDirectionEnum) {
      issues(limit: $limit, page: $page, incidence_status: $status, sort: $sort, direction: $direction) {
        data {
          id
          incidence_code
          status
          description
          solutions
          carrier_company
          carrier_service
          tracking
          tracking_url
          distance
          order {
            id
            status
            created_at
            updated_at
            tracking_code
            tracking_url
            carrier_company
            carrier_service
            customer { full_name phone email }
          }
        }
      }
    }
  `;
  try {
    const result = await requestGraphQL(richIssuesQuery, { limit, page, status, sort, direction });
    const items = result?.issues?.data ?? [];
    if (Array.isArray(items)) {
      return items.map((item) => ({
        ...normalizeIncidence(item),
        source: 'issues_rich'
      }));
    }
  } catch {
    // Fall back to the minimal shape if this Dropea account does not expose rich issue fields.
  }

  const minimalIssuesQuery = `
    query DropeaIssues($limit: Int!, $page: Int!, $status: IssueStateEnum, $sort: OrderSortEnum, $direction: FilterDirectionEnum) {
      issues(limit: $limit, page: $page, incidence_status: $status, sort: $sort, direction: $direction) {
        data {
          id
          incidence_code
          status
          order {
            id
          }
        }
      }
    }
  `;
  try {
    const result = await requestGraphQL(minimalIssuesQuery, { limit, page, status, sort, direction });
    const items = result?.issues?.data ?? [];
    if (Array.isArray(items)) {
      return items.map((item) => ({
        ...normalizeIncidence(item),
        source: 'issues_minimal'
      }));
    }
  } catch {
    // Keep probing alternate shapes below so the log remains useful if Dropea changes the schema.
  }

  const minimalIssuesNoArgsQuery = `
    query DropeaIssues {
      issues {
        data {
          id
          incidence_code
          status
          order {
            id
          }
        }
      }
    }
  `;
  try {
    const result = await requestGraphQL(minimalIssuesNoArgsQuery);
    const items = result?.issues?.data ?? [];
    if (Array.isArray(items) && items.length) {
      return items.map((item) => ({
        ...normalizeIncidence(item),
        source: 'issues_minimal_noargs'
      }));
    }
  } catch {
    // Keep probing alternate shapes below so the log remains useful if Dropea changes the schema.
  }

  const roots = ['issues', 'orderIncidences', 'orderIncidence', 'incidences', 'incidents', 'orderIssues'];
  const fieldSets = [
    'id order { id } incidence_code status',
    'id order_id incidence_code status created_at last_response_at',
    'id orderId incidenceCode status createdAt lastResponseAt',
    'id order_id reason status created_at',
    'id orderId reason status createdAt',
    'id order { id status customer { full_name phone email } } incidence_code status'
  ];
  const attempts = roots.flatMap((rootName) => fieldSets.flatMap((fields, index) => [
    {
      name: `${rootName}_connection_${index + 1}`,
      query: `
        query DropeaIncidences($limit: Int!, $page: Int!) {
          ${rootName}(limit: $limit, page: $page) {
            data {
              ${fields}
            }
          }
        }
      `
    },
    {
      name: `${rootName}_list_${index + 1}`,
      query: `
        query DropeaIncidences($limit: Int!, $page: Int!) {
          ${rootName}(limit: $limit, page: $page) {
            ${fields}
          }
        }
      `
    },
    {
      name: `${rootName}_connection_noargs_${index + 1}`,
      query: `
        query DropeaIncidences {
          ${rootName} {
            data {
              ${fields}
            }
          }
        }
      `
    },
    {
      name: `${rootName}_list_noargs_${index + 1}`,
      query: `
        query DropeaIncidences {
          ${rootName} {
            ${fields}
          }
        }
      `
    }
  ]));

  const errors = [];
  const emptySuccesses = [];
  for (const attempt of attempts) {
    try {
      const result = await requestGraphQL(attempt.query, { limit, page });
      const items = extractConnectionItems(result);
      if (items.length) {
        return items.map((item) => ({
          ...normalizeIncidence(item),
          source: attempt.name
        }));
      }
      emptySuccesses.push(attempt.name);
    } catch (error) {
      errors.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No se pudo leer listado de incidencias en Dropea. Endpoints vacios: ${emptySuccesses.join(', ') || 'ninguno'}. Errores: ${errors.join(' | ')}`);
}

export async function listDropeaIncidencesByIds(ids = []) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [ids])
    .map((value) => Number(value))
    .filter(Number.isFinite))];
  if (!normalizedIds.length) return [];

  const query = `
    query DropeaIssuesByIds($ids: [Int]) {
      issues(ids: $ids) {
        data {
          id
          incidence_code
          status
          description
          solutions
          carrier_company
          carrier_service
          tracking
          tracking_url
          distance
          order {
            id
            status
            created_at
            updated_at
            tracking_code
            tracking_url
            carrier_company
            carrier_service
            customer { full_name phone email }
          }
        }
      }
    }
  `;
  const result = await requestGraphQL(query, { ids: normalizedIds });
  return (result?.issues?.data || []).map((item) => ({
    ...normalizeIncidence(item),
    source: 'issues_by_ids'
  }));
}

export async function getDropeaIncidenceHistory(orderId) {
  const normalizedId = Number(orderId);
  if (!Number.isFinite(normalizedId)) {
    return { skipped: true, reason: 'invalid_order_id', incidences: [] };
  }
  return requestDropeaRest(`/shipping/incidences-history/${normalizedId}`);
}

export async function getDropeaOrderById(orderId) {
  const query = `
    query OrderById($ids: [Int]) {
      orders(id: $ids) {
        data {
          id
          status
          customer { full_name phone email address alternative_address city state zip }
          items { sku title shopify_name_item unit_price quantity total_value }
          total_amount
          created_at
          updated_at
          tracking_code
          tracking_url
          carrier_company
          carrier_service
          issues { id incidence_code status }
        }
      }
    }
  `;

  const numericOrderId = Number(orderId);
  const result = await requestGraphQL(query, { ids: [Number.isFinite(numericOrderId) ? numericOrderId : orderId] });
  const order = result?.orders?.data?.[0];
  if (!order) return null;
  return {
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  };
}

export async function confirmDropeaOrder(orderId) {
  const mutation = `
    mutation ConfirmOrder($id: ID!) {
      orderConfirm(id: $id) {
        status
        message
      }
    }
  `;
  return requestGraphQL(mutation, { id: orderId });
}

export async function cancelDropeaOrder(orderId) {
  const mutation = `
    mutation CancelOrder($id: ID!) {
      orderCancel(id: $id) {
        status
        message
      }
    }
  `;
  return requestGraphQL(mutation, { id: orderId });
}

export async function repairDropeaErrorReviewOrders(orderIds = []) {
  const normalizedIds = [...new Set((Array.isArray(orderIds) ? orderIds : [orderIds])
    .map((id) => Number(id))
    .filter(Number.isFinite))];
  if (!normalizedIds.length) return { skipped: true, reason: 'no_order_ids' };
  return requestDropeaRest('/orders/bulk-fix-error-review', {
    method: 'POST',
    body: { orders_ids: normalizedIds }
  });
}

export async function refreshDropeaOrderShipping(orderId) {
  const normalizedId = Number(orderId);
  if (!Number.isFinite(normalizedId)) {
    return { skipped: true, reason: 'invalid_order_id' };
  }
  // This is the same read/repair action exposed by Dropea as "Actualizar envio".
  return requestDropeaRest(`/order/update-shippnig/${normalizedId}`);
}

export async function resolveDropeaIssue(issueId, text) {
  const mutation = `
    mutation ResolveIssue($id: ID!, $text: String) {
      issueResolve(id: $id, text: $text) {
        status
        message
      }
    }
  `;
  const result = await requestGraphQL(mutation, { id: issueId, text: String(text || '').trim() });
  const response = result?.issueResolve || result;
  if (response?.status !== true) {
    throw new Error(`Dropea no acepto la solucion: ${response?.message || 'respuesta sin confirmacion'}`);
  }
  return response;
}

export async function returnDropeaIssueToOrigin(issueId) {
  return requestDropeaRest(`/shipping/incidences/${encodeURIComponent(issueId)}/status-solution-send`, {
    method: 'POST',
    body: { text: '', return_to_origin: true }
  });
}

export async function pickupDropeaIssueAtDepot(issueId) {
  return requestDropeaRest(`/shipping/incidences/${encodeURIComponent(issueId)}/pickup-at-depot`, {
    method: 'POST',
    body: {}
  });
}
