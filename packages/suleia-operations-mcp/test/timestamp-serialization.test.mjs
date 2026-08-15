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

test('database catalog identifiers remain usable without weakening customer-name masking', () => {
  const result = maskPii({
    schema_name: 'read_models',
    object_name: 'operations_incident_panel_context',
    columns: [{ name: 'canonical_issue_id', position: 1, type: 'uuid' }],
    indexes: [{ name: 'incident_timers_issue_current_idx', definition: 'CREATE INDEX …' }],
    customer_name: 'Example Customer'
  });

  assert.equal(result.schema_name, 'read_models');
  assert.equal(result.object_name, 'operations_incident_panel_context');
  assert.equal(result.columns[0].name, 'canonical_issue_id');
  assert.equal(result.indexes[0].name, 'incident_timers_issue_current_idx');
  assert.equal(result.customer_name, 'Cliente enmascarado');
});
