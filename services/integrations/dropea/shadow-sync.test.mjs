import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDropeaPublicApi } from './shadow-sync.mjs';

const order = {
  id: 41, store_id: 17, external_order_id: 'external-masked', status: 'PENDING', sub_status: 'PENDING',
  line_items: [{ product_id: 2, variant_id: 3, product_name: 'Producto', quantity: 1, unit_price: 20 }],
  total_amount: 20, currency: 'EUR', carrier: 'GLS', created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:01:00Z'
};
const issue = {
  id: 9, order_id: 41, type: 'RECIPIENT_ABSENT', status: 'PENDING', is_active: true,
  carrier: 'GLS', initial_carrier_code: 'A1', initial_carrier_description: 'Destinatario ausente',
  allowed_resolution_options: ['RETRY'], created_at: '2026-08-01T11:00:00Z',
  updated_at: '2026-08-01T11:01:00Z'
};

test('Dropea V2 shadow sync projects canonical orders before exactly linked issues', async () => {
  const writes = [];
  const client = {
    market: 'ES',
    async listAll(name) {
      return { items: name === 'listOrders' ? [order] : [issue], page_count: 1, complete: true };
    }
  };
  const projector = {
    async upsertOrder(value) { writes.push(['order', value]); },
    async upsertIssue(value) { writes.push(['issue', value]); },
    async connectorHealth(value) { writes.push(['health', value]); }
  };
  const result = await syncDropeaPublicApi({
    client, projector, hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    now: () => new Date('2026-08-01T12:00:00Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions_executed, 0);
  assert.deepEqual(writes.map(([type]) => type), ['order', 'issue', 'health']);
  assert.equal(writes[1][1].canonical_order_id, writes[0][1].canonical_order_id);
  assert.equal(JSON.stringify(writes).includes('external-masked'), false);
});

test('Dropea V2 shadow sync blocks orphan issues without guessing identity', async () => {
  const writes = [];
  const client = {
    market: 'ES',
    async listAll(name) {
      return { items: name === 'listOrders' ? [order] : [{ ...issue, order_id: 999 }], page_count: 1, complete: true };
    }
  };
  const projector = {
    async upsertOrder(value) { writes.push(['order', value]); },
    async upsertIssue(value) { writes.push(['issue', value]); },
    async connectorHealth(value) { writes.push(['health', value]); }
  };
  const result = await syncDropeaPublicApi({
    client, projector, hmacKey: 'a-protected-hmac-key-with-more-than-32-characters'
  });
  assert.equal(result.ok, false);
  assert.equal(result.orphan_issues_blocked, 1);
  assert.equal(writes.some(([type]) => type === 'issue'), false);
  assert.equal(writes.at(-1)[1].data_health, 'DEGRADED');
});

test('Dropea V2 shadow sync blocks a pre-cutover new identity and reuses an existing V1 identity', async () => {
  const projected = [];
  const client = {
    market: 'ES',
    async listAll(name) {
      return { items: name === 'listOrders' ? [
        { ...order, id: 40, external_order_id: 'old-missing', created_at: '2026-08-01T10:00:00Z' },
        { ...order, id: 41, external_order_id: 'old-existing', created_at: '2026-08-01T10:00:00Z' }
      ] : [], page_count: 1, complete: true, records_read: 2, requested_limit: 100 };
    }
  };
  const projector = {
    async resolveCanonicalOrder(value) { return value.dropea_order_id === '41' ? { status: 'FOUND', canonical_order_id: 'order-v1-existing' } : { status: 'NOT_FOUND' }; },
    async upsertOrder(value) { projected.push(value); return { inserted: false }; },
    async upsertIssue() {}, async connectorHealth() {}, async syncCheckpoint() {}
  };
  const result = await syncDropeaPublicApi({
    client, projector, hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    storeConfig: { store_id: '17', migration_cutover_at: '2026-08-03T00:00:00Z', native_v2_activation_at: '2026-08-04T00:00:00Z' }
  });
  assert.equal(result.historical_orders_blocked, 1);
  assert.equal(result.identities_reused, 1);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].canonical_order_id, 'order-v1-existing');
});

test('CANARY ignores pending issues outside the five-order sample', async () => {
  const projected = [];
  const client = {
    market: 'ES',
    async request(name) {
      assert.equal(name, 'listOrders');
      return { data: { items: [{ ...order, created_at: '2026-08-04T10:00:00Z', updated_at: '2026-08-04T10:01:00Z' }] } };
    },
    async listAll(name) {
      assert.equal(name, 'listIssues');
      return { items: [issue, { ...issue, id: 10, order_id: 999 }], page_count: 1, complete: true };
    }
  };
  const projector = {
    async resolveCanonicalOrder() { return { status: 'NOT_FOUND' }; },
    async upsertOrder(value) { projected.push(['order', value]); return { inserted: true }; },
    async upsertIssue(value) { projected.push(['issue', value]); return { inserted: true }; },
    async connectorHealth() {}, async syncCheckpoint() {}
  };
  const result = await syncDropeaPublicApi({
    client, projector, hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    phase: 'CANARY',
    storeConfig: { store_id: '17', migration_cutover_at: '2026-08-03T00:00:00Z', native_v2_activation_at: '2026-08-01T00:00:00Z' },
    now: () => new Date('2026-08-04T12:00:00Z')
  });
  assert.equal(result.ok, true);
  assert.equal(result.orphan_issues_blocked, 0);
  assert.equal(result.issues_out_of_scope, 1);
  assert.equal(projected.filter(([type]) => type === 'issue').length, 1);
});

test('TODAY links a pending issue to an order already present in the mirror', async () => {
  const projected = [];
  const client = {
    market: 'ES',
    async listAll(name) {
      return { items: name === 'listOrders' ? [] : [issue], page_count: 1, complete: true };
    }
  };
  const projector = {
    async resolveCanonicalOrderByDropeaId(value) {
      assert.deepEqual(value, { market: 'ES', storeId: '17', dropeaOrderId: '41' });
      return { status: 'FOUND', canonical_order_id: 'order-existing' };
    },
    async upsertOrder() {},
    async upsertIssue(value) { projected.push(value); return { inserted: false }; },
    async connectorHealth() {}, async syncCheckpoint() {}
  };
  const result = await syncDropeaPublicApi({
    client, projector, hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    phase: 'TODAY',
    storeConfig: { store_id: '17', migration_cutover_at: '2026-08-03T00:00:00Z', native_v2_activation_at: '2026-08-04T00:00:00Z' },
    now: () => new Date('2026-08-04T12:00:00Z')
  });
  assert.equal(result.ok, true);
  assert.equal(result.orphan_issues_blocked, 0);
  assert.equal(projected[0].canonical_order_id, 'order-existing');
});

test('authorized BACKFILL reads complete order and issue history and mirrors pre-cutover identities', async () => {
  const calls = [];
  const projected = [];
  const client = {
    market: 'ES',
    async listAll(name, params) {
      calls.push([name, params]);
      return { items: name === 'listOrders' ? [order] : [issue], page_count: 1, complete: true,
        records_read: 1, requested_limit: 100 };
    }
  };
  const projector = {
    async resolveCanonicalOrder() { return { status: 'NOT_FOUND' }; },
    async upsertOrder(value) { projected.push(['order', value]); return { inserted: true }; },
    async upsertIssue(value) { projected.push(['issue', value]); return { inserted: true }; },
    async connectorHealth() {}, async syncCheckpoint() {}
  };
  const result = await syncDropeaPublicApi({
    client, projector, phase: 'BACKFILL',
    hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    storeConfig: { store_id: '17', migration_cutover_at: '2026-08-03T00:00:00Z',
      native_v2_activation_at: '2026-08-04T00:00:00Z', historical_reingestion_allowed: true },
    now: () => new Date('2026-08-04T12:00:00Z')
  });
  assert.equal(calls[0][0], 'listOrders');
  assert.equal('date_from' in calls[0][1], false);
  assert.equal(calls[0][1].date_type, 'created_at');
  assert.deepEqual(calls[1], ['listIssues', {}]);
  assert.equal(result.historical_orders_blocked, 0);
  assert.equal(projected.filter(([type]) => type === 'order').length, 1);
  assert.equal(projected.filter(([type]) => type === 'issue').length, 1);
});

test('INCREMENTAL reconciles complete orders and issues ordered by source update without unsupported filters', async () => {
  const calls = [];
  const client = {
    market: 'ES',
    async listAll(name, params) {
      calls.push([name, params]);
      return { items: [], page_count: 1, complete: true, records_read: 0, requested_limit: 100 };
    }
  };
  const projector = {
    async connectorHealth() {}, async syncCheckpoint() {}
  };
  await syncDropeaPublicApi({
    client, projector, phase: 'INCREMENTAL',
    hmacKey: 'a-protected-hmac-key-with-more-than-32-characters',
    storeConfig: { store_id: '17', migration_cutover_at: '2026-08-03T00:00:00Z',
      native_v2_activation_at: '2026-08-04T00:00:00Z', historical_reingestion_allowed: true },
    now: () => new Date('2026-08-04T12:00:00Z')
  });
  assert.equal(calls[0][1].sort_by, 'updated_at');
  assert.equal('date_from' in calls[0][1], false);
  assert.equal('date_type' in calls[0][1], false);
  assert.deepEqual(calls[1], ['listIssues', {}]);
});

test('dry-run performs zero mirror writes on success and failure', async () => {
  const writes = [];
  const projector = {
    async resolveCanonicalOrder() { return { status: 'NOT_FOUND' }; },
    async upsertOrder() { writes.push('order'); },
    async upsertIssue() { writes.push('issue'); },
    async connectorHealth() { writes.push('health'); },
    async syncCheckpoint() { writes.push('checkpoint'); }
  };
  const client = {
    market: 'ES',
    async listAll(name) {
      return { items: name === 'listOrders' ? [order] : [issue], page_count: 1, complete: true };
    }
  };
  const result = await syncDropeaPublicApi({
    client, projector, dryRun: true,
    hmacKey: 'a-protected-hmac-key-with-more-than-32-characters'
  });
  assert.equal(result.dry_run, true);
  assert.deepEqual(writes, []);

  await assert.rejects(() => syncDropeaPublicApi({
    client: { market: 'ES', async listAll() { throw new Error('read failed'); } },
    projector, dryRun: true,
    hmacKey: 'a-protected-hmac-key-with-more-than-32-characters'
  }), /read failed/);
  assert.deepEqual(writes, []);
});
