import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropeaCanonicalIdentity,
  mapDropeaIssue,
  mapDropeaOrder,
  mapDropeaOrderState,
  technicalIdentityLink
} from '../src/operational-truth/dropea-canonical.mjs';

const HMAC_KEY = 'fixture-only-hmac-key-with-32-characters-minimum';
const AT = '2026-08-01T12:00:00.000Z';

function order(overrides = {}) {
  return {
    id: 24,
    status: 'SHIPPING',
    sub_status: 'OUT_FOR_DELIVERY',
    external_order_id: 'SHOPIFY-1234',
    store_id: 2,
    line_items: [{ variant_id: 1, product_id: 8, product_name: 'Fixture product', quantity: 2, unit_price: 19.99 }],
    total_amount: 39.98,
    currency: 'EUR',
    carrier: 'GLS',
    tracking_number: 'fixture-tracking-reference',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T11:00:00.000Z',
    ...overrides
  };
}

function issue(overrides = {}) {
  return {
    id: 1234,
    order_id: 24,
    tracking_number: 'fixture-tracking-reference',
    owner_id: 42,
    carrier: 'GLS',
    type: 'RECIPIENT_ABSENT',
    status: 'PENDING',
    resolution_status: null,
    allowed_resolution_options: ['RETRY', 'PICKUP_AT_AGENCY'],
    initial_carrier_code: 'FIXTURE-CODE',
    initial_carrier_description: 'Recipient absent',
    initial_carrier_substatus_code: null,
    is_active: true,
    resolution_data: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T11:00:00.000Z',
    pickup_point: null,
    ...overrides
  };
}

test('central order mapper keeps status and sub_status separate', () => {
  const state = mapDropeaOrderState('SHIPPING', 'OUT_FOR_DELIVERY');
  assert.equal(state.canonical_state, 'OUT_FOR_DELIVERY');
  assert.equal(state.decision_eligible, true);
  const result = mapDropeaOrder(order(), { hmacKey: HMAC_KEY, observedAt: AT });
  assert.equal(result.status, 'SHIPPING');
  assert.equal(result.sub_status, 'OUT_FOR_DELIVERY');
  assert.equal(result.canonical_state, 'OUT_FOR_DELIVERY');
  assert.equal(result.identity_status, 'EXACT');
  assert.equal(result.actions_executed, 0);
  assert.notEqual(result.tracking_reference_masked, 'fixture-tracking-reference');
  assert.equal('shipping_address' in result, false);
});

test('central mapper projects only masked operational protections and blocks test orders', () => {
  const result = mapDropeaOrder(order({ customer: { phone: '600000000' } }), {
    hmacKey: HMAC_KEY,
    observedAt: AT,
    testPhoneNormalized: '+34600000000'
  });
  assert.equal(result.lifecycle_classification, 'ACTIVE');
  assert.equal(result.phone_last4, '0000');
  assert.equal(result.canonical_product_key, 'PRODUCT:8');
  assert.equal(result.test_order, true);
  assert.equal(result.automatic_confirmation_allowed, false);
  assert.equal(result.protection_review, true);
  assert.equal(JSON.stringify(result).includes('600000000'), false);
});

test('unknown status or sub-status fails closed without losing source values', () => {
  const result = mapDropeaOrder(order({ sub_status: 'FUTURE_STATE' }), { hmacKey: HMAC_KEY, observedAt: AT });
  assert.equal(result.sub_status, 'FUTURE_STATE');
  assert.equal(result.canonical_state, 'UNKNOWN_UNSUPPORTED');
  assert.equal(result.decision_eligible, false);
  assert.deepEqual(result.blocking_reasons, ['DROPEA_ORDER_ENUM_UNSUPPORTED']);
});

test('identity uses only technical HMAC links and exact/verified gating', () => {
  const exact = buildDropeaCanonicalIdentity({ order: order(), hmacKey: HMAC_KEY });
  const samePrimary = buildDropeaCanonicalIdentity({ order: order({ external_order_id: 'A-DIFFERENT-EXTERNAL-ID' }), hmacKey: HMAC_KEY });
  const partial = buildDropeaCanonicalIdentity({ order: order({ external_order_id: null }), hmacKey: HMAC_KEY });
  assert.equal(exact.status, 'EXACT');
  assert.equal(exact.shadow_eligible, true);
  assert.equal(exact.canonical_order_id, samePrimary.canonical_order_id);
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.shadow_eligible, false);
  assert.equal(exact.namespaces.includes('phone'), false);
  assert.throws(() => technicalIdentityLink('dropea_order_id', 1, 'too-short'), /HMAC key/);
});

test('canonical issue keeps event, workflow and resolution axes separate', () => {
  const result = mapDropeaIssue(issue(), { hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', observedAt: AT });
  assert.equal(result.type, 'RECIPIENT_ABSENT');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.resolution_status, null);
  assert.equal(result.actionable, true);
  assert.equal(result.actions_executed, 0);
  assert.notEqual(result.tracking_reference_masked, 'fixture-tracking-reference');
});

test('only active pending issues enter the actionable queue', () => {
  const info = mapDropeaIssue(issue({ status: 'INFO' }), { hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', observedAt: AT });
  const inactive = mapDropeaIssue(issue({ is_active: false }), { hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', observedAt: AT });
  assert.equal(info.actionable, false);
  assert.equal(inactive.actionable, false);
});

test('unknown issue enums are retained but blocked', () => {
  const result = mapDropeaIssue(issue({ type: 'FUTURE_ISSUE' }), { hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', observedAt: AT });
  assert.equal(result.type, 'FUTURE_ISSUE');
  assert.equal(result.qa_result, 'BLOCKED');
  assert.equal(result.confidence, 0);
  assert.equal(result.actionable, false);
  assert.deepEqual(result.blocking_reasons, ['DROPEA_ISSUE_ENUM_UNSUPPORTED']);
});

test('pickup point omits address, phone, email and coordinates', () => {
  const result = mapDropeaIssue(issue({ pickup_point: {
    pup_id: 'fixture-pup', display_name: 'Fixture agency', country_code: 'ES', is_active: true,
    updated_at: AT, street_name: 'private', phone: 'private', email: 'private', latitude: 1, longitude: 2
  } }), { hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', observedAt: AT });
  assert.deepEqual(Object.keys(result.pickup_point).sort(), [
    'country_code', 'display_name', 'is_active', 'pickup_point_id_hash', 'updated_at'
  ]);
});
