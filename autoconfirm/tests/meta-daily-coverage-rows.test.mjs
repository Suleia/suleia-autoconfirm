import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaDailyCoverageRows } from '../src/db/supabase-store.mjs';

test('daily Meta coverage explicitly records verified zero-spend days', () => {
  const rows = buildMetaDailyCoverageRows({
    since: '2026-08-01',
    until: '2026-08-03',
    updatedAt: '2026-08-03T10:00:00.000Z'
  });
  assert.deepEqual(rows.map((row) => row.date_start), ['2026-08-01', '2026-08-02', '2026-08-03']);
  assert.ok(rows.every((row) => row.date_start === row.date_stop));
  assert.ok(rows.every((row) => row.spend === 0));
  assert.equal(new Set(rows.map((row) => row.meta_row_id)).size, 3);
});

test('daily Meta coverage fails closed for invalid or reversed periods', () => {
  assert.deepEqual(buildMetaDailyCoverageRows({ since: 'invalid', until: '2026-08-03' }), []);
  assert.deepEqual(buildMetaDailyCoverageRows({ since: '2026-08-04', until: '2026-08-03' }), []);
});
