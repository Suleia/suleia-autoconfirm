import { getAppConfig } from '../config.mjs';

const config = getAppConfig();
const BASE_URL = 'https://api.dropea.com/graphql/dropshippers';

async function requestGraphQL(query, variables = {}) {
  if (!config.dropeaApiKey) throw new Error('Falta DROPEA_API_KEY.');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.dropeaApiKey
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Dropea respondió ${response.status}: ${JSON.stringify(data)}`);
  }
  if (data?.errors?.length) {
    throw new Error(`Dropea errors: ${JSON.stringify(data.errors)}`);
  }
  return data?.data ?? data;
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
    raw: order
  };
}

export async function listPendingDropeaOrders({ limit = 50, page = 1 } = {}) {
  const query = `
    query PendingOrders($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
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

  const result = await requestGraphQL(query, { status: 'PENDING', limit, page });
  const items = result?.orders?.data ?? [];
  return items.map((order) => ({
    ...normalizeOrder(order),
    ...normalizeCustomer(order.customer),
    raw: order
  }));
}

export async function getDropeaOrderById(orderId) {
  const query = `
    query OrderById($ids: [ID!]!) {
      orders(id: $ids) {
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

  const result = await requestGraphQL(query, { ids: [orderId] });
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
