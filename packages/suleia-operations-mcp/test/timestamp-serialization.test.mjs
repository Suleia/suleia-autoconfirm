import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPii } from '../src/security/pii.mjs';

test('PostgreSQL Date values serialize as ISO 8601 UTC strings through PII masking', () => {
  const timestamp = new Date('2026-08-14T12:34:56.789Z');
  const result = maskPii({
    created_at: timestamp,
    nested: { updated_at: timestamp },
    timeline: [{ occurred_at: timestamp }]
  });

  assert.equal(result.created_at, '2026-08-14T12:34:56.789Z');
  assert.equal(result.nested.updated_at, '2026-08-14T12:34:56.789Z');
  assert.equal(result.timeline[0].occurred_at, '2026-08-14T12:34:56.789Z');
  assert.doesNotMatch(JSON.stringify(result), /:\{\}/);
});

test('invalid Date values serialize as null rather than empty objects', () => {
  assert.deepEqual(maskPii({ measured_at: new Date('invalid') }), { measured_at: null });
});
