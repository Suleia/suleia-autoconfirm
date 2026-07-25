import { getAppConfig } from '../config.mjs';
import { fetchWithRetry } from '../fetch-with-retry.mjs';

const config = getAppConfig();
let cachedAccessToken = null;

async function getAdminAccessToken() {
  if (config.shopifyAdminAccessToken) return config.shopifyAdminAccessToken;
  if (cachedAccessToken) return cachedAccessToken;

  if (!config.shopifyDomain || !config.shopifyClientId || !config.shopifyClientSecret) {
    throw new Error('Faltan credenciales de Shopify para verificar pedidos.');
  }

  const response = await fetchWithRetry(`https://${config.shopifyDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.shopifyClientId,
      client_secret: config.shopifyClientSecret
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Shopify token respondio ${response.status}: ${JSON.stringify(data)}`);
  }

  if (!data?.access_token) {
    throw new Error('Shopify no devolvio access_token.');
  }

  cachedAccessToken = data.access_token;
  return cachedAccessToken;
}

async function shopifyGraphql(query, variables = {}) {
  const token = await getAdminAccessToken();
  if (!config.shopifyDomain) throw new Error('Falta SHOPIFY_DOMAIN.');

  const response = await fetchWithRetry(`https://${config.shopifyDomain}/admin/api/${config.shopifyApiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.errors) {
    throw new Error(`Shopify GraphQL respondio ${response.status}: ${JSON.stringify(data?.errors || data)}`);
  }

  return data?.data || {};
}

function normalizeShopifyOrder(node) {
  const total = node?.totalPriceSet?.shopMoney || {};
  const customer = node?.customer || {};
  const billingAddress = node?.billingAddress || {};
  const lineItems = node?.lineItems?.nodes || [];

  return {
    id: node?.id || '',
    name: node?.name || '',
    createdAt: node?.createdAt || '',
    cancelledAt: node?.cancelledAt || null,
    financialStatus: node?.displayFinancialStatus || '',
    fulfillmentStatus: node?.displayFulfillmentStatus || '',
    totalAmount: Number(total.amount || 0),
    currencyCode: total.currencyCode || 'EUR',
    customerName: customer.displayName || billingAddress.name || '',
    customerEmail: customer.email || node?.email || '',
    customerPhone: customer.phone || node?.phone || billingAddress.phone || '',
    products: lineItems.map((item) => ({
      title: item?.product?.title || item?.name || '',
      handle: item?.product?.handle || '',
      quantity: item?.quantity || 0
    })),
    tags: node?.tags || [],
    source: 'shopify',
    raw: node
  };
}

export async function listRecentShopifyOrders({ first = 100, query = null } = {}) {
  const result = await shopifyGraphql(`
    query RecentShopifyOrders($first: Int!, $query: String) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          tags
          email
          phone
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            displayName
            email
            phone
          }
          billingAddress {
            name
            phone
          }
          lineItems(first: 10) {
            nodes {
              name
              quantity
              product {
                title
                handle
              }
            }
          }
        }
      }
    }
  `, { first, query });

  return (result.orders?.nodes || []).map(normalizeShopifyOrder);
}

export async function getShopifyOrderFinancialStatus(orderId) {
  const token = await getAdminAccessToken();
  const response = await fetchWithRetry(`https://${config.shopifyDomain}/admin/api/${config.shopifyApiVersion}/orders/${orderId}.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Shopify-Access-Token': token
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Shopify order respondio ${response.status}: ${JSON.stringify(data)}`);
  }
  return data?.order?.financial_status || null;
}
