import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('./verify-shadow-state.sh', import.meta.url), 'utf8');

test('verification preserves failed history but gates on the latest batch per source object', () => {
  assert.match(script, /DISTINCT ON \(source,source_object\)/);
  assert.match(script, /historical_failed_batches/);
  assert.doesNotMatch(script, /DELETE FROM migration\.batches/);
});

test('verification gates direct PII and zero action counters', () => {
  assert.match(script, /unsafe_rows/);
  assert.match(script, /sum\(actions_executed\)/);
  assert.match(script, /sum\(production_writes\)/);
});
