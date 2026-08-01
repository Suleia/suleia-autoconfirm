import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDropeaPublicApi } from './shadow-sync.mjs';

const order = {
  id: 41, external_order_id: 'external-masked', status: 'PENDING', sub_status: 'PENDING',
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
