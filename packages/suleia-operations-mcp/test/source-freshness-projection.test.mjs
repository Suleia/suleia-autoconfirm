import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationsProjector } from '../src/operations/projector.mjs';

test('Source freshness records failures and clears them only after a later success', async () => {
  const calls = [];
  const projector = new OperationsProjector({ query: async (sql, values) => {
    calls.push({ sql, values });
    return { rowCount: 1, rows: [] };
  } });

  const failure = await projector.recordSourceFailure({ source: 'chatby', status: 'UNAVAILABLE' });
  const success = await projector.recordSourceFreshness({
    source: 'chatby', last_success_at: '2026-08-15T10:00:00.000Z', lag_seconds: 0, status: 'FRESH'
  });

  assert.equal(failure.production_writes, 0);
  assert.equal(success.actions_executed, 0);
  assert.match(calls[0].sql, /last_failure_at=now\(\)/);
  assert.doesNotMatch(calls[0].sql, /last_success_at=EXCLUDED\.last_success_at/);
  assert.match(calls[1].sql, /last_failure_at=NULL/);
  assert.deepEqual(calls[0].values, ['chatby', 'UNAVAILABLE']);
});
