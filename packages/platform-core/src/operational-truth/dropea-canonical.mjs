import crypto from 'node:crypto';
import { C0_SCHEMA_VERSION, stableId, zeroActionEnvelope } from './contracts.mjs';
import { validateCanonicalIdentity } from './identity-engine.mjs';
import { canonicalProductKey, classifyOrderLifecycle, evaluateTestPhoneGuard, normalizeSpanishPhone } from '../operational-protections/index.mjs';

export const DROPEA_SOURCE_VERSION = '0.1.0';
export const DROPEA_ORDER_MAPPER_VERSION = '1.0.0';
export const DROPEA_ISSUE_MAPPER_VERSION = '1.0.0';

export const DROPEA_ORDER_STATUSES = Object.freeze([
  'DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'FINISH', 'ERROR'
]);

export const DROPEA_ORDER_SUB_STATUSES = Object.freeze([
  'CREATING', 'PENDING', 'PENDING_SUPPLIER', 'PICKING', 'PACKED', 'AWAITING_PICKUP',
  'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'DELIVERED', 'PAID', 'CANCELLED',
  'REFUSED', 'LOST_DAMAGED', 'REFUSED_LOST_DAMAGED', 'DELIVERY_EXCEPTION', 'REVIEW',
  'TECHNICAL_ERROR', 'REJECTED', 'INSUFFICIENT_STOCK', 'CARRIER_VALIDATION_FAILED',
  'WAREHOUSE_INTEGRATION_FAILED'
]);

export const DROPEA_ISSUE_TYPES = Object.freeze([
  'ADDRESS_INCORRECT', 'RECIPIENT_ABSENT', 'REFUSED_BY_RECIPIENT', 'DAMAGED_PACKAGE',
  'LOST_PACKAGE', 'CUSTOMS_ISSUE', 'PENDING_AUTHORIZATION', 'PENDING_DATA', 'POSSIBLE_RETURN',
  'RETURN_REQUESTED', 'RETAINED', 'ADMINISTRATIVE_ISSUE', 'DELIVERY_FAILED', 'GENERAL_INCIDENCE'
]);

export const DROPEA_ISSUE_STATUSES = Object.freeze(['INFO', 'PENDING', 'MANAGING_WITH_CLIENT', 'RESOLVED']);
export const DROPEA_RESOLUTION_STATUSES = Object.freeze([
  'RETRY', 'CHANGE_ADDRESS', 'PICKUP_AT_AGENCY', 'RETURN_REQUESTED', 'SOLUTION_PROVIDED'
]);

const ORDER_STATE_BY_SUB_STATUS = Object.freeze({
  CREATING: 'CREATING', PENDING: 'PENDING', PENDING_SUPPLIER: 'PENDING_SUPPLIER',
  PICKING: 'PREPARING', PACKED: 'PREPARED', AWAITING_PICKUP: 'PREPARED', SHIPPED: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERY_ATTEMPTED: 'DELIVERY_ATTEMPTED',
  DELIVERED: 'DELIVERED', PAID: 'FINISHED', CANCELLED: 'CANCELLED', REFUSED: 'REFUSED',
  LOST_DAMAGED: 'LOST_OR_DAMAGED', REFUSED_LOST_DAMAGED: 'REFUSED_LOST_OR_DAMAGED',
  DELIVERY_EXCEPTION: 'INCIDENCE', REVIEW: 'REVIEW', TECHNICAL_ERROR: 'TECHNICAL_ERROR',
  REJECTED: 'REJECTED', INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  CARRIER_VALIDATION_FAILED: 'CARRIER_VALIDATION_FAILED',
  WAREHOUSE_INTEGRATION_FAILED: 'WAREHOUSE_INTEGRATION_FAILED'
});

const ORDER_STATE_BY_STATUS = Object.freeze({
  DRAFT: 'DRAFT', PENDING: 'PENDING', CONFIRMED: 'CONFIRMED', PROCESSING: 'PREPARING',
  SHIPPING: 'IN_TRANSIT', DELIVERED: 'DELIVERED', FINISH: 'FINISHED', ERROR: 'ERROR'
});

function required(value, field) {
  if (value === undefined || value === null || value === '') throw new Error(`${field} is required`);
  return value;
}

function nullableIso(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value);
  const timestamp = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw) ? `${raw}Z` : raw);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${field} must be an ISO date`);
  return timestamp.toISOString();
}

function encryptPrivateJson(value, hmacKey) {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return null;
  const key = crypto.createHash('sha256').update(`suleia-private-v1|${hmacKey}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function hashTechnical(value, hmacKey) {
  if (typeof hmacKey !== 'string' || hmacKey.length < 32) throw new Error('A protected HMAC key of at least 32 characters is required');
  return crypto.createHmac('sha256', hmacKey).update(String(value)).digest('hex');
}

function cleanTechnicalText(value, maxLength = 160) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength) || null;
}

function normalizeLineItem(item = {}) {
  return Object.freeze({
    product_id: item.product_id ?? null,
    variant_id: required(item.variant_id, 'line_item.variant_id'),
    sku: cleanTechnicalText(item.sku, 128),
    product_name: cleanTechnicalText(item.product_name, 200),
    variant_name: cleanTechnicalText(item.variant_name, 200),
    variant_type: item.variant_type ?? 'UNKNOWN',
    quantity: Number(required(item.quantity, 'line_item.quantity')),
    unit_price: Number(required(item.unit_price, 'line_item.unit_price'))
  });
}

function productSummary(lineItems) {
  return Object.freeze({
    distinct_lines: lineItems.length,
    total_units: lineItems.reduce((total, item) => total + item.quantity, 0),
    products: lineItems.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      name: item.product_name,
      quantity: item.quantity
    }))
  });
}

export function mapDropeaOrderState(status, subStatus) {
  const normalizedStatus = String(status || '').toUpperCase();
  const normalizedSubStatus = subStatus === undefined || subStatus === null ? null : String(subStatus).toUpperCase();
  const statusSupported = DROPEA_ORDER_STATUSES.includes(normalizedStatus);
  const subStatusSupported = normalizedSubStatus === null || DROPEA_ORDER_SUB_STATUSES.includes(normalizedSubStatus);
  if (!statusSupported || !subStatusSupported) {
    return Object.freeze({
      canonical_state: 'UNKNOWN_UNSUPPORTED', status_supported: statusSupported,
      sub_status_supported: subStatusSupported, decision_eligible: false,
      blocking_reasons: ['DROPEA_ORDER_ENUM_UNSUPPORTED'], mapper_version: DROPEA_ORDER_MAPPER_VERSION
    });
  }
  return Object.freeze({
    canonical_state: normalizedSubStatus
      ? ORDER_STATE_BY_SUB_STATUS[normalizedSubStatus]
      : ORDER_STATE_BY_STATUS[normalizedStatus],
    status_supported: true,
    sub_status_supported: true,
    decision_eligible: true,
    blocking_reasons: [],
    mapper_version: DROPEA_ORDER_MAPPER_VERSION
  });
}

export function technicalIdentityLink(namespace, value, hmacKey, verification = 'EXACT') {
  if (value === undefined || value === null || value === '') return null;
  return Object.freeze({ namespace, value_hash: hashTechnical(value, hmacKey), verification });
}

export function buildDropeaCanonicalIdentity({ order, hmacKey, market, storeId = order?.store_id, additionalLinks = [] }) {
  required(market, 'market');
  required(storeId, 'store_id');
  const links = [
    technicalIdentityLink('dropea_order_id', `${String(market).toUpperCase()}:${storeId}:${order?.id}`, hmacKey),
    technicalIdentityLink('dropea_external_reference', order?.external_order_id, hmacKey),
    ...additionalLinks
  ].filter(Boolean);
  const primary = links.find((link) => link.namespace === 'dropea_order_id');
  const canonicalOrderId = stableId('order', { namespace: primary.namespace, value_hash: primary.value_hash });
  return validateCanonicalIdentity({ canonical_order_id: canonicalOrderId, links });
}

export function mapDropeaOrder(order, {
  hmacKey,
  market,
  observedAt = new Date().toISOString(),
  dataFreshness = 'FRESH',
  additionalIdentityLinks = [],
  testPhoneNormalized = null
} = {}) {
  required(order?.id, 'order.id');
  required(order?.status, 'order.status');
  if (!Array.isArray(order?.line_items)) throw new Error('order.line_items is required');
  const normalizedMarket = String(required(market, 'market')).toUpperCase();
  const identity = buildDropeaCanonicalIdentity({ order, hmacKey, market: normalizedMarket, additionalLinks: additionalIdentityLinks });
  const state = mapDropeaOrderState(order.status, order.sub_status);
  const lineItems = order.line_items.map(normalizeLineItem);
  const lifecycle = classifyOrderLifecycle({
    canonical_state: state.canonical_state,
    final_state_verified: ['DELIVERED', 'FINISHED'].includes(state.canonical_state)
  });
  const productKey = lineItems.length === 1 ? canonicalProductKey({
    canonical_product_id: lineItems[0].product_id,
    canonical_sku: lineItems[0].sku
  }) : { key: null, match_type: 'UNKNOWN' };
  const customerPhoneNormalized = normalizeSpanishPhone(order.customer?.phone || order.customer_phone);
  const testPhone = evaluateTestPhoneGuard(customerPhoneNormalized, { testPhoneNormalized });
  const address = order.shipping_address || {};
  const normalizedAddress = [address.address_line_1, address.address_line_2, address.postal_code, address.city, address.state, address.country]
    .filter(Boolean).map((part) => String(part).trim().toUpperCase()).join('|');
  const productDisplayNames = lineItems.map((item, index) => cleanTechnicalText(
    order.line_items[index]?.external_name || item.product_name,
    200
  ));
  return Object.freeze({
    canonical_order_id: identity.canonical_order_id,
    dropea_order_id: String(order.id),
    market: normalizedMarket,
    external_order_id_hash: order.external_order_id ? hashTechnical(order.external_order_id, hmacKey) : null,
    external_order_id_ciphertext: order.external_order_id ? encryptPrivateJson({ value: order.external_order_id }, hmacKey) : null,
    store_id: order.store_id ?? null,
    status: String(order.status).toUpperCase(),
    sub_status: order.sub_status === undefined || order.sub_status === null ? null : String(order.sub_status).toUpperCase(),
    canonical_state: state.canonical_state,
    line_items: lineItems,
    product_summary: productSummary(lineItems),
    product_display_names: productDisplayNames,
    total_amount: Number(required(order.total_amount, 'order.total_amount')),
    currency: String(required(order.currency, 'order.currency')).toUpperCase(),
    payment_method: order.payment_method ?? 'UNKNOWN',
    supplier_id: order.supplier_id ?? null,
    fulfillment_type: order.fulfillment_type ?? 'UNKNOWN',
    carrier: order.carrier ?? 'UNKNOWN',
    service_type: order.service_type ?? 'UNKNOWN',
    tracking_reference_masked: order.tracking_number ? hashTechnical(order.tracking_number, hmacKey) : null,
    normalized_address_hash: normalizedAddress ? hashTechnical(normalizedAddress, hmacKey) : null,
    shipping_address_ciphertext: encryptPrivateJson(address, hmacKey),
    address_line_2_present: Boolean(address.address_line_2),
    created_at: nullableIso(required(order.created_at, 'order.created_at'), 'order.created_at'),
    updated_at: nullableIso(required(order.updated_at, 'order.updated_at'), 'order.updated_at'),
    confirmed_at: nullableIso(order.confirmed_at, 'order.confirmed_at'),
    processing_at: nullableIso(order.processing_at, 'order.processing_at'),
    delivered_at: nullableIso(order.delivered_at, 'order.delivered_at'),
    rejected_at: nullableIso(order.rejected_at, 'order.rejected_at'),
    identity_status: identity.status,
    identity,
    lifecycle_classification: lifecycle.lifecycle,
    phone_last4: customerPhoneNormalized?.slice(-4) || null,
    canonical_product_key: productKey.key,
    product_match_type: productKey.match_type,
    duplicate_status: 'NOT_ASSESSED',
    conflicting_order_id: null,
    automatic_confirmation_allowed: false,
    test_order: testPhone.matched,
    chatby_cleanup_status: 'NOT_ASSESSED',
    chatby_cleanup_blockers: ['CONTACT_LIFECYCLE_NOT_RECONCILED'],
    return_block_status: 'NOT_ELIGIBLE',
    return_block_reason: null,
    protection_review: testPhone.matched || !productKey.key,
    protection_last_reconciled_at: nullableIso(observedAt, 'observed_at'),
    data_freshness: dataFreshness,
    observed_at: nullableIso(observedAt, 'observed_at'),
    source_version: DROPEA_SOURCE_VERSION,
    source_system: 'DROPEA_PUBLIC_API_V2',
    payload_hash: hashTechnical(JSON.stringify({
      market: normalizedMarket, store_id: order.store_id, id: order.id, status: order.status,
      sub_status: order.sub_status, total_amount: order.total_amount, updated_at: order.updated_at
    }), hmacKey),
    mapper_version: DROPEA_ORDER_MAPPER_VERSION,
    schema_version: C0_SCHEMA_VERSION,
    decision_eligible: state.decision_eligible && identity.shadow_eligible,
    blocking_reasons: [...new Set([...state.blocking_reasons, ...(identity.shadow_eligible ? [] : ['IDENTITY_NOT_EXACT_OR_VERIFIED'])])],
    ...zeroActionEnvelope()
  });
}

function sanitizeCarrierDescription(value) {
  return cleanTechnicalText(value, 300)?.replace(/(?:\+?34)?[6789]\d{8}/g, '[PHONE REDACTED]') || null;
}

function safePickupPoint(value, hmacKey) {
  if (!value) return null;
  return Object.freeze({
    pickup_point_id_hash: value.pup_id ? hashTechnical(value.pup_id, hmacKey) : null,
    display_name: cleanTechnicalText(value.display_name, 160),
    country_code: cleanTechnicalText(value.country_code, 2),
    is_active: value.is_active === true,
    updated_at: nullableIso(value.updated_at, 'pickup_point.updated_at')
  });
}

export function mapDropeaIssue(issue, { hmacKey, canonicalOrderId, market, storeId, observedAt = new Date().toISOString(), freshness = 'FRESH' } = {}) {
  required(issue?.id, 'issue.id');
  required(canonicalOrderId, 'canonicalOrderId');
  const normalizedMarket = String(required(market, 'market')).toUpperCase();
  const normalizedStoreId = String(required(storeId, 'store_id'));
  const type = String(required(issue.type, 'issue.type')).toUpperCase();
  const status = String(required(issue.status, 'issue.status')).toUpperCase();
  const resolutionStatus = issue.resolution_status ? String(issue.resolution_status).toUpperCase() : null;
  const carrierCode = cleanTechnicalText(issue.initial_carrier_code, 80);
  const canonicalByCarrierCode = Object.freeze({ DI: 'ADDRESS_INCORRECT', NAM: 'RECIPIENT_ABSENT' });
  const canonicalType = canonicalByCarrierCode[String(carrierCode || '').toUpperCase()] || 'UNKNOWN';
  const carrierCodeMapped = canonicalType !== 'UNKNOWN';
  const typeSupported = DROPEA_ISSUE_TYPES.includes(type);
  const supported = typeSupported
    && DROPEA_ISSUE_STATUSES.includes(status)
    && (resolutionStatus === null || DROPEA_RESOLUTION_STATUSES.includes(resolutionStatus))
    && carrierCodeMapped;
  const actionable = supported && status === 'PENDING' && issue.is_active === true;
  const capabilityStatus = Array.isArray(issue.allowed_resolution_options) && issue.allowed_resolution_options.length > 0
    ? 'DECLARED' : 'NOT_DECLARED';
  return Object.freeze({
    canonical_issue_id: stableId('issue', { dropea_issue_id: String(issue.id), canonical_order_id: canonicalOrderId }),
    dropea_issue_id: String(issue.id),
    canonical_order_id: String(canonicalOrderId),
    market: normalizedMarket,
    store_id: normalizedStoreId,
    dropea_order_id: issue.order_id === undefined || issue.order_id === null ? null : String(issue.order_id),
    tracking_reference_masked: issue.tracking_number ? hashTechnical(issue.tracking_number, hmacKey) : null,
    carrier: String(required(issue.carrier, 'issue.carrier')).toUpperCase(),
    type: canonicalType,
    secondary_type: typeSupported ? type : 'UNKNOWN',
    raw_type: type,
    mapping_status: carrierCodeMapped ? 'MAPPED' : 'UNMAPPED',
    human_review: !supported,
    schema_drift_alert: !typeSupported || !carrierCodeMapped,
    status,
    is_active: issue.is_active === true,
    actionable,
    resolution_status: resolutionStatus,
    allowed_resolution_options: Array.isArray(issue.allowed_resolution_options) ? [...issue.allowed_resolution_options] : [],
    capability_status: capabilityStatus,
    automation_allowed: false,
    initial_carrier_code: carrierCode,
    initial_carrier_description_sanitized: sanitizeCarrierDescription(issue.initial_carrier_description),
    initial_carrier_substatus_code: cleanTechnicalText(issue.initial_carrier_substatus_code, 80),
    resolution_data_present: issue.resolution_data !== undefined && issue.resolution_data !== null,
    resolution_changed_at: nullableIso(issue.resolution_changed_at, 'issue.resolution_changed_at'),
    created_at: nullableIso(required(issue.created_at, 'issue.created_at'), 'issue.created_at'),
    updated_at: nullableIso(required(issue.updated_at, 'issue.updated_at'), 'issue.updated_at'),
    resolved_at: nullableIso(issue.resolved_at, 'issue.resolved_at'),
    pickup_point: safePickupPoint(issue.pickup_point, hmacKey),
    delivery_attempt_number: null,
    carrier_retention_deadline: null,
    customer_response_status: 'UNKNOWN',
    customer_intent: 'UNKNOWN',
    proposed_resolution: null,
    policy_id: null,
    confidence: supported ? 100 : 0,
    risk: supported ? 'NOT_ASSESSED' : 'HIGH',
    qa_result: supported ? 'PENDING' : 'BLOCKED',
    blocking_reasons: supported ? [] : [
      ...(!carrierCodeMapped ? ['DROPEA_CARRIER_CODE_UNKNOWN'] : []),
      ...(!typeSupported ? ['DROPEA_ISSUE_ENUM_UNSUPPORTED'] : [])
    ],
    source_event_id: null,
    source_version: DROPEA_SOURCE_VERSION,
    mapper_version: DROPEA_ISSUE_MAPPER_VERSION,
    payload_hash: hashTechnical(JSON.stringify({
      id: issue.id, order_id: issue.order_id, status: issue.status, is_active: issue.is_active,
      initial_carrier_code: issue.initial_carrier_code, updated_at: issue.updated_at
    }), hmacKey),
    freshness,
    observed_at: nullableIso(observedAt, 'observed_at'),
    schema_version: C0_SCHEMA_VERSION,
    ...zeroActionEnvelope()
  });
}
