import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('operational protections migration enforces one active guard and private PII storage', () => {
  const migration = read('../../migrations/007_operational_protections.sql');
  assert.match(migration, /UNIQUE INDEX[\s\S]*customer_identity_hash, canonical_product_key[\s\S]*WHERE status = 'ACTIVE'/);
  assert.match(migration, /chatby_contact_id_encrypted bytea/);
  assert.match(migration, /phone_encrypted bytea/);
  assert.match(migration, /phone_hash text NOT NULL/);
  assert.match(migration, /phone_last4 text NOT NULL/);
  assert.match(migration, /operations_protection_summary/);
  assert.doesNotMatch(migration, /664381580|\+34664381580/);
});
test('rollback is scoped to protection objects and restores Operations views', () => {
  const rollback = read('../../migrations/rollback/007_operational_protections.down.sql');
  assert.match(rollback, /DROP TABLE IF EXISTS operations\.active_customer_product_guard/);
  assert.match(rollback, /CREATE VIEW read_models\.operations_orders_queue/);
  assert.doesNotMatch(rollback, /DROP SCHEMA|DROP ROLE|DROP DATABASE/);
});

test('initial runtime flags enable only detection and preview capabilities', () => {
  const compose = read('../../infrastructure/docker/compose.yaml');
  assert.match(compose, /TEST_PHONE_BLOCK_ENABLED: \$\{TEST_PHONE_BLOCK_ENABLED:-true\}/);
  assert.match(compose, /DUPLICATE_ORDER_DETECTION_ENABLED: \$\{DUPLICATE_ORDER_DETECTION_ENABLED:-true\}/);
  assert.match(compose, /DUPLICATE_ORDER_BLOCKING_ENABLED: \$\{DUPLICATE_ORDER_BLOCKING_ENABLED:-false\}/);
  assert.match(compose, /CHATBY_CONTACT_CLEANUP_PREVIEW_ENABLED: \$\{CHATBY_CONTACT_CLEANUP_PREVIEW_ENABLED:-true\}/);
  assert.match(compose, /CHATBY_CONTACT_DELETE_ENABLED: \$\{CHATBY_CONTACT_DELETE_ENABLED:-false\}/);
  assert.match(compose, /RELEASIT_RETURN_BLOCK_PREVIEW_ENABLED: \$\{RELEASIT_RETURN_BLOCK_PREVIEW_ENABLED:-true\}/);
  assert.match(compose, /RELEASIT_RETURN_BLOCK_WRITE_ENABLED: \$\{RELEASIT_RETURN_BLOCK_WRITE_ENABLED:-false\}/);
});

test('Operations Center exposes protection badges, filters and masked detail only', () => {
  const script = read('../review-panel/app.js');
  for (const marker of ['DUPLICADO', 'TEST', 'CHATBY CLEANUP', 'RETURN BLOCK', 'PROTECCIONES OPERATIVAS']) assert.match(script, new RegExp(marker));
  assert.match(script, /phone_last4/);
  assert.doesNotMatch(script, /664381580|\+34664381580/);
  assert.doesNotMatch(script, /phone_normalized/);
});

test('production order path evaluates the test-phone guard before blocked-customer policy', () => {
  const source = read('../../autoconfirm/src/workflows/orders.mjs');
  const functionStart = source.indexOf("async function applyBlockedCustomerPolicy");
  const guard = source.indexOf('applyOperationalTestPhonePolicy', functionStart);
  const blockedMatch = source.indexOf('isBlockedCustomerOrder', functionStart);
  assert.ok(functionStart >= 0 && guard > functionStart && blockedMatch > guard);
  assert.match(source, /OPERATIONAL_TEST_ALLOWLIST/);
  assert.doesNotMatch(source, /664381580|\+34664381580/);
});
