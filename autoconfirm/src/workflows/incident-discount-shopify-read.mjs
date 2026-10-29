import { listRecentShopifyOrders } from '../clients/shopify.mjs';

const phoneDigits = value => String(value || '').replace(/\D/g, '').slice(-9);

// Incidents often outlive the newest 250 orders. Read the owned source
// reference directly; a same-phone newer purchase is never a substitute.
export async function findIncidentDiscountShopifyOrders(phone, dropeaOrder, {
  listOrders = listRecentShopifyOrders
} = {}) {
  const target = phoneDigits(phone);
  if (target.length !== 9) return [];
  const reference = String(dropeaOrder?.raw?.external_order_id || '').trim();
  if (reference) {
    if (!/^#?\d{1,18}$/.test(reference)) return [];
    const name = `#${reference.replace(/^#/, '')}`;
    const orders = await listOrders({ first: 2, query: `name:${name}` });
    // The API search is not an equality guarantee. Reject ambiguity before
    // filtering by phone, rather than choosing one of two source identities.
    const exact = orders.filter(order => String(order.name).trim() === name);
    if (exact.length !== 1) return [];
    return phoneDigits(exact[0].customerPhone) === target ? exact : [];
  }
  // Preserve the existing bounded compatibility path for sources without a
  // reference; the order matcher still requires its timestamp correlation.
  const orders = await listOrders({ first: 250 });
  return orders.filter(order => phoneDigits(order.customerPhone) === target);
}

export function incidentDiscountSourceAmountsMatch(dropeaOrder, shopifyOrder) {
  const amount = order => {
    const value = order?.orderAmount ?? order?.totalAmount;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Math.round(Number(value) * 100) : null;
  };
  const source = amount(dropeaOrder), destination = amount(shopifyOrder);
  return source !== null && source >= 500 && source === destination
    && String(dropeaOrder?.currencyCode || 'EUR') === 'EUR'
    && String(shopifyOrder?.currencyCode || '') === 'EUR'
    && !shopifyOrder?.cancelledAt;
}
