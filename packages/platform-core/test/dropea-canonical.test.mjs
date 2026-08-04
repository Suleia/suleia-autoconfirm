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
    initial_carrier_code: 'NAM',
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

const ISSUE_CONTEXT = Object.freeze({ hmacKey: HMAC_KEY, canonicalOrderId: 'order-fixture', market: 'ES', storeId: '2', observedAt: AT });

test('central order mapper keeps status and sub_status separate', () => {
  const state = mapDropeaOrderState('SHIPPING', 'OUT_FOR_DELIVERY');
  assert.equal(state.canonical_state, 'OUT_FOR_DELIVERY');
  assert.equal(state.decision_eligible, true);
  const result = mapDropeaOrder(order(), { hmacKey: HMAC_KEY, market: 'ES', observedAt: AT });
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
    market: 'ES',
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
  const result = mapDropeaOrder(order({ sub_status: 'FUTURE_STATE' }), { hmacKey: HMAC_KEY, market: 'ES', observedAt: AT });
  assert.equal(result.sub_status, 'FUTURE_STATE');
  assert.equal(result.canonical_state, 'UNKNOWN_UNSUPPORTED');
  assert.equal(result.decision_eligible, false);
  assert.deepEqual(result.blocking_reasons, ['DROPEA_ORDER_ENUM_UNSUPPORTED']);
});

test('identity uses only technical HMAC links and exact/verified gating', () => {
  const exact = buildDropeaCanonicalIdentity({ order: order(), hmacKey: HMAC_KEY, market: 'ES' });
  const samePrimary = buildDropeaCanonicalIdentity({ order: order({ external_order_id: 'A-DIFFERENT-EXTERNAL-ID' }), hmacKey: HMAC_KEY, market: 'ES' });
  const partial = buildDropeaCanonicalIdentity({ order: order({ external_order_id: null }), hmacKey: HMAC_KEY, market: 'ES' });
  assert.equal(exact.status, 'EXACT');
  assert.equal(exact.shadow_eligible, true);
  assert.equal(exact.canonical_order_id, samePrimary.canonical_order_id);
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.shadow_eligible, false);
  assert.equal(exact.namespaces.includes('phone'), false);
  assert.throws(() => technicalIdentityLink('dropea_order_id', 1, 'too-short'), /HMAC key/);
});

test('canonical issue keeps event, workflow and resolution axes separate', () => {
  const result = mapDropeaIssue(issue(), ISSUE_CONTEXT);
  assert.equal(result.type, 'RECIPIENT_ABSENT');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.resolution_status, null);
  assert.equal(result.actionable, true);
  assert.equal(result.actions_executed, 0);
  assert.notEqual(result.tracking_reference_masked, 'fixture-tracking-reference');
});

test('only active pending issues enter the actionable queue', () => {
  const info = mapDropeaIssue(issue({ status: 'INFO' }), ISSUE_CONTEXT);
  const inactive = mapDropeaIssue(issue({ is_active: false }), ISSUE_CONTEXT);
  assert.equal(info.actionable, false);
  assert.equal(inactive.actionable, false);
});

test('unknown issue enums and carrier codes are retained but blocked', () => {
  const result = mapDropeaIssue(issue({ type: 'FUTURE_ISSUE', initial_carrier_code: 'FUTURE-CODE' }), ISSUE_CONTEXT);
  assert.equal(result.type, 'UNKNOWN');
  assert.equal(result.raw_type, 'FUTURE_ISSUE');
  assert.equal(result.mapping_status, 'UNMAPPED');
  assert.equal(result.human_review, true);
  assert.equal(result.schema_drift_alert, true);
  assert.equal(result.qa_result, 'BLOCKED');
  assert.equal(result.confidence, 0);
  assert.equal(result.actionable, false);
  assert.deepEqual(result.blocking_reasons, ['DROPEA_CARRIER_CODE_UNKNOWN', 'DROPEA_ISSUE_ENUM_UNSUPPORTED']);
});

test('carrier code is the primary classifier and empty capabilities are not inferred', () => {
  const result = mapDropeaIssue(issue({ type: 'GENERAL_INCIDENCE', initial_carrier_code: 'DI', allowed_resolution_options: [] }), {
    ...ISSUE_CONTEXT
  });
  assert.equal(result.type, 'ADDRESS_INCORRECT');
  assert.equal(result.secondary_type, 'GENERAL_INCIDENCE');
  assert.equal(result.capability_status, 'NOT_DECLARED');
  assert.equal(result.automation_allowed, false);
  assert.equal(result.actionable, true);
});

test('order mapping uses total_amount, product fallback, address line 2 hash and UTC timestamps', () => {
  const result = mapDropeaOrder(order({
    external_order_id: '#1234', total_amount: 99, line_items: [{ variant_id: 1, product_id: 8, product_name: 'Fallback product', external_name: '', quantity: 3, unit_price: 1 }],
    shipping_address: { address_line_1: 'Private one', address_line_2: 'Private two', postal_code: '28001', city: 'Madrid', country: 'ES' },
    created_at: '2026-08-01T12:00:00+02:00'
  }), { hmacKey: HMAC_KEY, market: 'ES', observedAt: AT });
  assert.equal(result.total_amount, 99);
  assert.deepEqual(result.product_display_names, ['Fallback product']);
  assert.equal(result.address_line_2_present, true);
  assert.equal(result.created_at, '2026-08-01T10:00:00.000Z');
  assert.equal(JSON.stringify(result).includes('Private one'), false);
  assert.match(result.shipping_address_ciphertext, /^v1:/);
  assert.equal(result.external_order_id_ciphertext.includes('#1234'), false);
});

test('empty carrier code and timezone-less timestamps fail closed safely', () => {
  const mappedIssue = mapDropeaIssue(issue({ initial_carrier_code: '', initial_carrier_description: '' }), ISSUE_CONTEXT);
  assert.equal(mappedIssue.type, 'UNKNOWN');
  assert.equal(mappedIssue.human_review, true);
  assert.equal(mappedIssue.actionable, false);
  const mappedOrder = mapDropeaOrder(order({ created_at: '2026-08-01T10:00:00' }), { hmacKey: HMAC_KEY, market: 'ES', observedAt: AT });
  assert.equal(mappedOrder.created_at, '2026-08-01T10:00:00.000Z');
});

test('pickup point omits address, phone, email and coordinates', () => {
  const result = mapDropeaIssue(issue({ pickup_point: {
    pup_id: 'fixture-pup', display_name: 'Fixture agency', country_code: 'ES', is_active: true,
    updated_at: AT, street_name: 'private', phone: 'private', email: 'private', latitude: 1, longitude: 2
  } }), ISSUE_CONTEXT);
  assert.deepEqual(Object.keys(result.pickup_point).sort(), [
    'country_code', 'display_name', 'is_active', 'pickup_point_id_hash', 'updated_at'
  ]);
});
