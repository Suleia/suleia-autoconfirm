import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresReadRepository } from '../src/data/postgres-read-repository.mjs';

test('Postgres repository uses fixed SELECT statements and parameterized values', async () => {
  const calls = [];
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('FROM read_models.operations_order_context') && text.includes('LIMIT 1')) {
        return { rows: [{ canonical_order_id: 'masked-order' }] };
      }
      return { rows: [] };
    }
  };
  const repository = createPostgresReadRepository({ databaseUrl: 'postgres://unused' }, { pool });

  assert.equal((await repository.getOrder("x' OR true --")).canonical_order_id, 'masked-order');
  await repository.getOrderTimeline('masked-order', 200);
  await repository.getActiveTimers({ orderId: 'masked-order', timerType: 'confirmation_wait' });
  await repository.getAgentDecisions('masked-order', 25);
  await repository.listOrdersRequiringReview({ limit: 15, reason: 'HUMAN_REVIEW' });

  assert.equal(repository.source, 'postgres_shadow_readonly');
  assert.equal(calls.every(({ text }) => /^SELECT\b/i.test(text.trim())), true);
  assert.equal(calls.every(({ text }) => !/\b(?:INSERT|UPDATE|DELETE|UPSERT|CALL)\b/i.test(text)), true);
  assert.deepEqual(calls[0].values, ["x' OR true --"]);
  assert.equal(calls.some(({ text }) => text.includes("x' OR true --")), false);
});

test('Postgres repository reports freshness without exposing credentials', async () => {
  const pool = { async query() { return { rows: [
    { source: 'dropea', source_updated_at: '2026-08-01T10:00:00Z' },
    { source: 'chatby', source_updated_at: '2026-08-01T11:00:00Z' }
  ] }; } };
  const repository = createPostgresReadRepository({ databaseUrl: 'postgres://unused' }, { pool });
  const result = await repository.getDataFreshness();
  assert.equal(result.source_updated_at, '2026-08-01T11:00:00.000Z');
  assert.equal(result.sources.length, 2);
});
