import crypto from 'node:crypto';
import { classifyOrderLifecycle } from './lifecycle.mjs';

export const DUPLICATE_GUARD_POLICY_VERSION = 'active-customer-product-guard-v1.0.0';

export function canonicalProductKey(product = {}, explicitMappings = {}) {
  if (product.canonical_product_id) return Object.freeze({ key: `PRODUCT:${product.canonical_product_id}`, match_type: 'CANONICAL_PRODUCT_ID' });
  if (product.canonical_sku) return Object.freeze({ key: `SKU:${String(product.canonical_sku).trim().toUpperCase()}`, match_type: 'CANONICAL_SKU' });
  if (product.product_family_id && product.product_family_approved === true) return Object.freeze({ key: `FAMILY:${product.product_family_id}`, match_type: 'APPROVED_PRODUCT_FAMILY' });
  const mappingKey = product.variant_id || product.sku || product.pack_id;
  if (mappingKey && explicitMappings[mappingKey]) return Object.freeze({ key: `MAPPED:${explicitMappings[mappingKey]}`, match_type: 'EXPLICIT_MAPPING' });
  return Object.freeze({ key: null, match_type: 'UNKNOWN' });
}
export function checkActiveCustomerProductConflict({ customer_identity_hash, identity_status, canonical_product_key, candidate_order_id, orders = [] } = {}) {
  if (!['EXACT', 'VERIFIED'].includes(String(identity_status || '').toUpperCase())) {
    return Object.freeze({ result: 'IDENTITY_UNCERTAIN', blocked: false, human_review: true, conflicting_order_id: null, policy_version: DUPLICATE_GUARD_POLICY_VERSION });
  }
  if (!customer_identity_hash || !canonical_product_key) {
    return Object.freeze({ result: 'PROTECTION_DATA_STALE', blocked: false, human_review: true, conflicting_order_id: null, policy_version: DUPLICATE_GUARD_POLICY_VERSION });
  }
  const conflict = orders.find((order) =>
    String(order.canonical_order_id) !== String(candidate_order_id)
    && order.customer_identity_hash === customer_identity_hash
    && order.canonical_product_key === canonical_product_key
    && classifyOrderLifecycle(order).lifecycle === 'ACTIVE'
  );
  return Object.freeze({
    result: conflict ? 'DUPLICATE_ACTIVE_ORDER' : 'NO_ACTIVE_DUPLICATE',
    blocked: Boolean(conflict),
    human_review: Boolean(conflict),
    conflicting_order_id: conflict?.canonical_order_id || null,
    policy_version: DUPLICATE_GUARD_POLICY_VERSION
  });
}

export function duplicateGuardIdempotencyKey(customerIdentityHash, canonicalProductKeyValue, orderId) {
  return crypto.createHash('sha256')
    .update(['ACTIVE_CUSTOMER_PRODUCT_GUARD', customerIdentityHash, canonicalProductKeyValue, orderId, DUPLICATE_GUARD_POLICY_VERSION].join('|'))
    .digest('hex');
}

export class InMemoryActiveCustomerProductGuard {
  #active = new Map();

  acquire({ customer_identity_hash, canonical_product_key, active_order_id }) {
    const key = `${customer_identity_hash}|${canonical_product_key}`;
    const existing = this.#active.get(key);
    if (existing && existing.active_order_id !== active_order_id) return Object.freeze({ acquired: false, existing: structuredClone(existing) });
    const record = Object.freeze({
      customer_identity_hash, canonical_product_key, active_order_id, status: 'ACTIVE',
      idempotency_key: duplicateGuardIdempotencyKey(customer_identity_hash, canonical_product_key, active_order_id),
      policy_version: DUPLICATE_GUARD_POLICY_VERSION
    });
    this.#active.set(key, record);
    return Object.freeze({ acquired: true, record });
  }

  release({ customer_identity_hash, canonical_product_key, active_order_id, order }) {
    if (classifyOrderLifecycle(order).lifecycle !== 'TERMINAL') return Object.freeze({ released: false, reason: 'ORDER_NOT_VERIFIED_TERMINAL' });
    const key = `${customer_identity_hash}|${canonical_product_key}`;
    const existing = this.#active.get(key);
    if (!existing || existing.active_order_id !== active_order_id) return Object.freeze({ released: false, reason: 'GUARD_NOT_OWNED' });
    this.#active.delete(key);
    return Object.freeze({ released: true });
  }
}
