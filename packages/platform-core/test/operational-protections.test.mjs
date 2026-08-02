import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  InMemoryActiveCustomerProductGuard,
  canonicalProductKey,
  checkActiveCustomerProductConflict,
  classifyOrderLifecycle,
  customerIdentity,
  evaluateChatbyContactLifecycle,
  evaluateOperationalProtectionGate,
  evaluateReturnBlockEligibility,
  evaluateTestPhoneGuard,
  mergeBlockedPhoneList,
  normalizeSpanishPhone,
  phoneFingerprint,
  synchronizeReleasitBlocklist
} from '../src/operational-protections/index.mjs';

const KEY = 'fictitious-test-hmac-key-with-32-chars-minimum';
const TEST_PHONE = '+34600000000';

test('Spanish phone normalization is exact across supported formats', () => {
  assert.equal(normalizeSpanishPhone('600000000'), TEST_PHONE);
  assert.equal(normalizeSpanishPhone('+34 600 000 000'), TEST_PHONE);
  assert.equal(normalizeSpanishPhone('0034 600000000'), TEST_PHONE);
  assert.equal(normalizeSpanishPhone('60000000'), null);
  assert.equal(normalizeSpanishPhone('1600000000'), null);
});
test('test-phone guard has absolute blocking precedence without partial matches', () => {
  for (const value of ['600000000', '+34 600 000 000', '0034600000000']) {
    const result = evaluateTestPhoneGuard(value, { testPhoneNormalized: TEST_PHONE });
    assert.equal(result.matched, true);
    assert.equal(result.automatic_confirmation_allowed, false);
    assert.equal(result.execution_allowed, false);
    assert.equal(result.releasit_block_allowed, false);
  }
  assert.equal(evaluateTestPhoneGuard('700000000', { testPhoneNormalized: TEST_PHONE }).matched, false);
});

test('identity uses stable technical priority and only exact/verified can compare', () => {
  const exact = customerIdentity({ customer_id: 'customer-1', phone: '600000001', verified_chatby_contact_id: 'contact-1', identity_status: 'EXACT' });
  assert.equal(exact.identity_type, 'CUSTOMER_ID');
  assert.equal(exact.comparison_allowed, true);
  assert.equal(exact.phone_last4, '0001');
  assert.equal(customerIdentity({ phone: '600000001', identity_status: 'PARTIAL' }).comparison_allowed, false);
  assert.equal(phoneFingerprint('600000001', KEY).length, 64);
});

test('lifecycle keeps requested/in-transit returns active and only verified finals terminal', () => {
  assert.equal(classifyOrderLifecycle({ canonical_state: 'RETURN_REQUESTED' }).lifecycle, 'ACTIVE');
  assert.equal(classifyOrderLifecycle({ canonical_state: 'RETURN_IN_TRANSIT' }).lifecycle, 'ACTIVE');
  assert.equal(classifyOrderLifecycle({ canonical_state: 'RETURN_TO_ORIGIN_COMPLETED' }).lifecycle, 'UNKNOWN');
  assert.equal(classifyOrderLifecycle({ canonical_state: 'RETURN_TO_ORIGIN_COMPLETED', final_state_verified: true }).lifecycle, 'TERMINAL');
  assert.equal(classifyOrderLifecycle({ canonical_state: 'HUMAN_REVIEW', operationally_recoverable: true }).lifecycle, 'ACTIVE');
  assert.equal(classifyOrderLifecycle({ canonical_state: 'carrier free note' }).lifecycle, 'UNKNOWN');
});

test('canonical product key never falls back to commercial title', () => {
  assert.deepEqual(canonicalProductKey({ canonical_product_id: 'p-1', title: 'Title' }), { key: 'PRODUCT:p-1', match_type: 'CANONICAL_PRODUCT_ID' });
  assert.deepEqual(canonicalProductKey({ canonical_sku: ' sku-1 ' }), { key: 'SKU:SKU-1', match_type: 'CANONICAL_SKU' });
  assert.deepEqual(canonicalProductKey({ product_family_id: 'f-1', product_family_approved: true }), { key: 'FAMILY:f-1', match_type: 'APPROVED_PRODUCT_FAMILY' });
  assert.deepEqual(canonicalProductKey({ variant_id: 'v-1' }, { 'v-1': 'pack-a' }), { key: 'MAPPED:pack-a', match_type: 'EXPLICIT_MAPPING' });
  assert.equal(canonicalProductKey({ title: 'Same title' }).key, null);
});

test('duplicate assessment blocks only an exact active same-customer same-product conflict', () => {
  const orders = [
    { canonical_order_id: 'o-1', customer_identity_hash: 'c-1', canonical_product_key: 'PRODUCT:p-1', canonical_state: 'SHIPPING' },
    { canonical_order_id: 'o-2', customer_identity_hash: 'c-1', canonical_product_key: 'PRODUCT:p-2', canonical_state: 'SHIPPING' }
  ];
  const conflict = checkActiveCustomerProductConflict({ customer_identity_hash: 'c-1', identity_status: 'EXACT', canonical_product_key: 'PRODUCT:p-1', candidate_order_id: 'o-3', orders });
  assert.equal(conflict.result, 'DUPLICATE_ACTIVE_ORDER');
  assert.equal(conflict.conflicting_order_id, 'o-1');
  assert.equal(checkActiveCustomerProductConflict({ customer_identity_hash: 'c-1', identity_status: 'PARTIAL', canonical_product_key: 'PRODUCT:p-1', candidate_order_id: 'o-3', orders }).result, 'IDENTITY_UNCERTAIN');
  assert.equal(checkActiveCustomerProductConflict({ customer_identity_hash: 'c-1', identity_status: 'EXACT', canonical_product_key: 'PRODUCT:p-2', candidate_order_id: 'o-2', orders }).blocked, false);
});

test('transactional guard serializes simultaneous acquisition and releases only verified terminal', async () => {
  const guard = new InMemoryActiveCustomerProductGuard();
  const input = { customer_identity_hash: 'c-1', canonical_product_key: 'PRODUCT:p-1' };
  const [first, second] = await Promise.all([
    Promise.resolve().then(() => guard.acquire({ ...input, active_order_id: 'o-1' })),
    Promise.resolve().then(() => guard.acquire({ ...input, active_order_id: 'o-2' }))
  ]);
  assert.equal(Number(first.acquired) + Number(second.acquired), 1);
  const owner = first.acquired ? 'o-1' : 'o-2';
  assert.equal(guard.release({ ...input, active_order_id: owner, order: { canonical_state: 'DELIVERED' } }).released, false);
  assert.equal(guard.release({ ...input, active_order_id: owner, order: { canonical_state: 'DELIVERED', final_state_verified: true } }).released, true);
});

test('Chatby cleanup preserves contacts for any active, unknown or pending process', () => {
  const terminal = { canonical_order_id: 'o-1', canonical_state: 'DELIVERED', final_state_verified: true };
  const base = { orders: [terminal], identity_status: 'VERIFIED', contact_id_hash: 'contact-hash', processes: { data_reconciled: true } };
  assert.equal(evaluateChatbyContactLifecycle(base).lifecycle_status, 'DELETE_ELIGIBLE');
  assert.equal(evaluateChatbyContactLifecycle({ ...base, orders: [{ canonical_order_id: 'o-2', canonical_state: 'SHIPPING' }] }).eligible, false);
  assert.equal(evaluateChatbyContactLifecycle({ ...base, orders: [{ canonical_order_id: 'o-2', canonical_state: 'mystery' }] }).lifecycle_status, 'BLOCKED_UNKNOWN_ORDER');
  assert.equal(evaluateChatbyContactLifecycle({ ...base, processes: { data_reconciled: true, active_timer: true } }).eligible, false);
});

test('Releasit merge preserves every original line, normalizes duplicates and excludes test phone', () => {
  const existing = '611111111\r\n+34 622 222 222\r\ncustom-preserved-line\r\n';
  const added = mergeBlockedPhoneList(existing, '633333333', { testPhoneNormalized: TEST_PHONE });
  assert.equal(added.changed, true);
  assert.match(added.value, /611111111/);
  assert.match(added.value, /\+34 622 222 222/);
  assert.match(added.value, /custom-preserved-line/);
  assert.match(added.value, /\+34633333333$/);
  assert.equal(mergeBlockedPhoneList(added.value, '+34633333333', { testPhoneNormalized: TEST_PHONE }).status, 'ALREADY_BLOCKED');
  assert.equal(mergeBlockedPhoneList(existing, TEST_PHONE, { testPhoneNormalized: TEST_PHONE }).status, 'EXCLUDED_TEST_PHONE');
  assert.equal(mergeBlockedPhoneList(existing, 'invalid', { testPhoneNormalized: TEST_PHONE }).status, 'INVALID_PHONE');
});

test('return blocking requires a verified completed return and excludes test/internal orders', () => {
  const phoneHash = phoneFingerprint('633333333', KEY);
  const eligible = evaluateReturnBlockEligibility({ order: { canonical_order_id: 'o-1', canonical_state: 'RETURN_TO_ORIGIN_COMPLETED', final_state_verified: true }, identity_status: 'EXACT', phone: '633333333', phone_hash: phoneHash, testPhoneNormalized: TEST_PHONE });
  assert.equal(eligible.status, 'BLOCK_ELIGIBLE');
  assert.equal(evaluateReturnBlockEligibility({ order: { canonical_state: 'RETURN_REQUESTED' }, identity_status: 'EXACT', phone: '633333333', phone_hash: phoneHash }).eligible, false);
  assert.equal(evaluateReturnBlockEligibility({ order: { canonical_state: 'RETURN_TO_ORIGIN_COMPLETED', final_state_verified: true }, identity_status: 'PARTIAL', phone: '633333333', phone_hash: phoneHash }).status, 'MANUAL_REVIEW');
  assert.equal(evaluateReturnBlockEligibility({ order: { canonical_state: 'RETURN_TO_ORIGIN_COMPLETED', final_state_verified: true }, identity_status: 'EXACT', phone: TEST_PHONE, phone_hash: phoneFingerprint(TEST_PHONE, KEY), testPhoneNormalized: TEST_PHONE }).status, 'EXCLUDED_TEST_PHONE');
});

test('Releasit preview performs zero writes and retry is idempotent', async () => {
  let writes = 0;
  const client = { read: async () => ({ value: '611111111', version: 'v1' }), write: async () => { writes += 1; } };
  const preview = await synchronizeReleasitBlocklist({ client, phone: '633333333', testPhoneNormalized: TEST_PHONE });
  assert.equal(preview.status, 'BLOCK_PENDING');
  assert.equal(preview.actions_executed, 0);
  assert.equal(writes, 0);
  const already = await synchronizeReleasitBlocklist({ client: { read: async () => ({ value: '611111111\n+34633333333', version: 'v2' }) }, phone: '633333333', testPhoneNormalized: TEST_PHONE });
  assert.equal(already.status, 'ALREADY_BLOCKED');
});

test('Releasit optimistic concurrency recomposes after conflict and verifies reread', async () => {
  let version = 1;
  let value = '611111111';
  let calls = 0;
  const client = {
    read: async () => ({ value, version }),
    write: async ({ value: next, expectedVersion }) => {
      calls += 1;
      if (calls === 1) { value = `${value}\n622222222`; version += 1; return { conflict: true }; }
      assert.equal(expectedVersion, version);
      value = next; version += 1; return { conflict: false };
    }
  };
  const result = await synchronizeReleasitBlocklist({ client, phone: '633333333', testPhoneNormalized: TEST_PHONE, writeEnabled: true, officialCapabilityVerified: true });
  assert.equal(result.status, 'BLOCKED_VERIFIED');
  assert.match(value, /622222222/);
  assert.match(value, /\+34633333333/);
});

test('protection gate follows mandatory precedence and only blocks existing logic', () => {
  const test = evaluateOperationalProtectionGate({ phone: TEST_PHONE, testPhoneNormalized: TEST_PHONE, identity_status: 'EXACT', idempotency_ok: true, duplicate: { result: 'NO_ACTIVE_DUPLICATE' }, guard: { acquired: true } });
  assert.equal(test.decision_override, 'TEST_PHONE');
  const duplicate = evaluateOperationalProtectionGate({ phone: '633333333', testPhoneNormalized: TEST_PHONE, identity_status: 'VERIFIED', idempotency_ok: true, duplicate: { result: 'DUPLICATE_ACTIVE_ORDER' }, guard: { acquired: false } });
  assert.equal(duplicate.decision_override, 'DUPLICATE_ACTIVE_ORDER');
  const pass = evaluateOperationalProtectionGate({ phone: '633333333', testPhoneNormalized: TEST_PHONE, identity_status: 'VERIFIED', idempotency_ok: true, duplicate: { result: 'NO_ACTIVE_DUPLICATE' }, guard: { acquired: true } });
  assert.equal(pass.route, 'EXISTING_CONFIRMATION_LOGIC');
  assert.equal(pass.automatic_confirmation_allowed, true);
});

test('phone hashes are deterministic and not reversible phone text', () => {
  const hash = phoneFingerprint('633333333', KEY);
  assert.equal(hash, phoneFingerprint('+34 633 333 333', KEY));
  assert.equal(hash, crypto.createHmac('sha256', KEY).update('+34633333333').digest('hex'));
  assert.doesNotMatch(hash, /633333333/);
});
