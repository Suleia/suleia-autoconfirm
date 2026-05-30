import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

async function getAdminAccessToken() {
  if (!config.shopifyDomain || !config.shopifyClientId || !config.shopifyClientSecret) {
    throw new Error('Faltan credenciales de Shopify para verificar pagos.');
  }

  const response = await fetch(`https://${config.shopifyDomain}/admin/oauth/access_token`, {
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
    throw new Error(`Shopify token respondió ${response.status}: ${JSON.stringify(data)}`);
  }

  if (!data?.access_token) {
    throw new Error('Shopify no devolvió access_token.');
  }

  return data.access_token;
}

export async function getShopifyOrderFinancialStatus(orderId) {
  const token = await getAdminAccessToken();
  const response = await fetch(`https://${config.shopifyDomain}/admin/api/${config.shopifyApiVersion}/orders/${orderId}.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Shopify-Access-Token': token
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Shopify order respondió ${response.status}: ${JSON.stringify(data)}`);
  }
  return data?.order?.financial_status || null;
}
