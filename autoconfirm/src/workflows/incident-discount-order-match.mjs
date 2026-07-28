export const INCIDENT_DISCOUNT_ORDER_MATCH_WINDOW_MS = 48 * 3_600_000;

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function dropeaCreatedAt(order) {
  return order?.raw?.created_at || order?.createdAt || '';
}

export function selectIncidentDiscountOrderPair({
  dropeaOrders = [],
  shopifyOrders = [],
  maxDifferenceMs = INCIDENT_DISCOUNT_ORDER_MATCH_WINDOW_MS
} = {}) {
  const newestShopify = [...shopifyOrders]
    .map((order) => ({ order, createdAtMs: timestamp(order?.createdAt) }))
    .filter((entry) => Number.isFinite(entry.createdAtMs))
    .sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
  if (!newestShopify) return null;

  const closestDropea = [...dropeaOrders]
    .map((order) => {
      const createdAtMs = timestamp(dropeaCreatedAt(order));
      return {
        order,
        createdAtMs,
        differenceMs: Math.abs(createdAtMs - newestShopify.createdAtMs)
      };
    })
    .filter((entry) => Number.isFinite(entry.createdAtMs))
    .sort((left, right) => (
      left.differenceMs - right.differenceMs
      || right.createdAtMs - left.createdAtMs
    ))[0];

  if (!closestDropea || closestDropea.differenceMs > maxDifferenceMs) return null;
  return {
    dropeaOrder: closestDropea.order,
    shopifyOrder: newestShopify.order,
    differenceMs: closestDropea.differenceMs
  };
}
