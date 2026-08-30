export const INCIDENT_DISCOUNT_ORDER_MATCH_WINDOW_MS = 48 * 3_600_000;
export const INCIDENT_DISCOUNT_SHOPIFY_TEST_MAX_AGE_MS = 48 * 3_600_000;

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function dropeaCreatedAt(order) {
  return order?.raw?.created_at || order?.createdAt || '';
}

function normalizedReference(value) {
  return String(value || '').trim().replace(/^#/, '').toLowerCase();
}

function dropeaExternalReferences(order = {}) {
  const raw = order?.raw || {};
  return new Set([
    raw.external_order_id,
    raw.external_id,
    raw.shopify_order_id,
    raw.shopify_order_name,
    raw.order_number,
    order.externalOrderId,
    order.shopifyOrderId
  ].map(normalizedReference).filter(Boolean));
}

function shopifyReferences(order = {}) {
  return new Set([order.id, order.name].map(normalizedReference).filter(Boolean));
}

export function selectShopifyOrderForDropeaOrder({
  dropeaOrder,
  shopifyOrders = [],
  maxDifferenceMs = INCIDENT_DISCOUNT_ORDER_MATCH_WINDOW_MS
} = {}) {
  if (!dropeaOrder) return null;
  const dropeaAt = timestamp(dropeaCreatedAt(dropeaOrder));
  if (!Number.isFinite(dropeaAt)) return null;
  const external = dropeaExternalReferences(dropeaOrder);
  const candidates = shopifyOrders
    .map((order) => {
      const createdAtMs = timestamp(order?.createdAt);
      const exactReference = [...shopifyReferences(order)].some((reference) => external.has(reference));
      return {
        order,
        createdAtMs,
        exactReference,
        differenceMs: Math.abs(createdAtMs - dropeaAt)
      };
    })
    .filter((entry) => Number.isFinite(entry.createdAtMs))
    .sort((left, right) => (
      Number(right.exactReference) - Number(left.exactReference)
      || left.differenceMs - right.differenceMs
      || right.createdAtMs - left.createdAtMs
    ));
  const selected = candidates[0];
  if (!selected || (!selected.exactReference && selected.differenceMs > maxDifferenceMs)) return null;
  return selected;
}

export function selectIncidentDiscountOrderPair({
  dropeaOrders = [],
  shopifyOrders = [],
  maxDifferenceMs = INCIDENT_DISCOUNT_ORDER_MATCH_WINDOW_MS
} = {}) {
  const newestShopifyOrder = selectNewestShopifyOrder(shopifyOrders);
  const newestShopify = newestShopifyOrder && {
    order: newestShopifyOrder,
    createdAtMs: timestamp(newestShopifyOrder.createdAt)
  };
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

export function selectNewestShopifyOrder(shopifyOrders = []) {
  return [...shopifyOrders]
    .map((order) => ({ order, createdAtMs: timestamp(order?.createdAt) }))
    .filter((entry) => Number.isFinite(entry.createdAtMs))
    .sort((left, right) => right.createdAtMs - left.createdAtMs)[0]?.order || null;
}

export function selectRecentShopifyOnlyTestOrder(
  shopifyOrders = [],
  {
    now = Date.now(),
    maxAgeMs = INCIDENT_DISCOUNT_SHOPIFY_TEST_MAX_AGE_MS
  } = {}
) {
  const order = selectNewestShopifyOrder(shopifyOrders);
  if (!order) return null;
  const createdAtMs = timestamp(order.createdAt);
  const ageMs = Number(now) - createdAtMs;
  if (!Number.isFinite(ageMs) || ageMs < -60 * 60 * 1000 || ageMs > maxAgeMs) return null;
  return { order, ageMs };
}
