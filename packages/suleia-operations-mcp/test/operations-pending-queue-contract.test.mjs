import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/operations/repository.mjs', import.meta.url), 'utf8');

test('Operations orders list is permanently scoped to the authoritative Dropea pending queue', () => {
  const method = source.slice(source.indexOf('async listOrders('), source.indexOf('async orderDetail('));
  assert.match(method, /selected\.clauses\.push\("coalesce\(lifecycle_status,status\)='PENDING'"\)/);
  assert.doesNotMatch(method, /lifecycle:\s*'coalesce\(lifecycle_status,status\)'/);
  assert.match(method, /scope:\s*'DROPEA_PENDING'/);
  assert.match(method, /pending_queue_last_sync_at/);
});

test('Operations order summary metrics are calculated only from pending orders', () => {
  const summary = source.slice(source.indexOf('async summary('), source.indexOf('async financialSummary('));
  assert.match(summary, /FROM \$\{ORDER_OPERATIONAL_SOURCE\} orders\s+WHERE coalesce\(lifecycle_status,status\)='PENDING'/);
  assert.match(summary, /count\(\*\) FILTER \(WHERE customer_response_status='RESPONDED'\)/);
  assert.match(summary, /max\(source_updated_at\) AS last_sync_at/);
});
