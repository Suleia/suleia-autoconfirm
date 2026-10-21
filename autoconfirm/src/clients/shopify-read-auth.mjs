import { fetchWithRetry } from '../fetch-with-retry.mjs';

// Used only by Shopify order reads. Never replay a financial mutation here.
export function createShopifyReadAuth(config, { fetchImpl = fetchWithRetry, now = Date.now } = {}) {
  let cached = null;
  let pending = null;

  async function token() {
    if (config.shopifyAdminAccessToken) return config.shopifyAdminAccessToken;
    if (cached && now() < cached.refreshAt) return cached.value;
    if (pending) return pending;
    if (!config.shopifyDomain || !config.shopifyClientId || !config.shopifyClientSecret) {
      throw new Error('Faltan credenciales de Shopify para verificar pedidos.');
    }
    pending = (async () => {
      const startedAt = now();
      const response = await fetchImpl(`https://${config.shopifyDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials',
          client_id: config.shopifyClientId, client_secret: config.shopifyClientSecret })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Shopify token respondio ${response.status}.`);
      if (!data?.access_token) throw new Error('Shopify no devolvio access_token.');
      const ttl = Number(data.expires_in) * 1000;
      // Missing expiry must never create another permanently cached token.
      const refreshAt = Number.isFinite(ttl) && ttl > 0
        ? startedAt + ttl - Math.min(60_000, ttl / 10) : startedAt;
      cached = { value: data.access_token, refreshAt };
      return cached.value;
    })();
    try { return await pending; } finally { pending = null; }
  }

  return async function read(url, options = {}) {
    const request = value => fetchImpl(url, { ...options,
      headers: { ...options.headers, 'X-Shopify-Access-Token': value } });
    const used = await token();
    let response = await request(used);
    if (response.status === 401 && !config.shopifyAdminAccessToken) {
      await response.body?.cancel().catch(() => {});
      // An older concurrent request must not discard a newer refreshed token.
      if (cached?.value === used) cached = null;
      response = await request(await token());
    }
    return response;
  };
}
