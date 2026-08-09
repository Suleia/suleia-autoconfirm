import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const operationsRepository = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/operations/repository.mjs', import.meta.url), 'utf8');
const mcpRepository = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../migrations/016_canonical_source_freshness.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/016_canonical_source_freshness.down.sql', import.meta.url), 'utf8');
const drill = fs.readFileSync(new URL('../../infrastructure/vps/run-source-freshness-rollback-drill.sh', import.meta.url), 'utf8');

test('Operations Center and MCP share the canonical freshness evaluator', () => {
  assert.match(operationsRepository, /evaluateSourceFreshness/);
  assert.match(mcpRepository, /evaluateSourceFreshness/);
  assert.match(mcpRepository, /DISTINCT ON \(market,store_id,resource_type\)/);
  assert.match(migration, /source_observed_at/);
  assert.match(migration, /source_event_at/);
  assert.match(migration, /last_successful_sync_at/);
  assert.match(rollback, /DROP VIEW read_models\.operations_data_freshness/);
  assert.match(rollback, /CREATE VIEW read_models\.operations_data_freshness/);
  assert.match(drill, /SOURCE_FRESHNESS_ROLLBACK_DRILL\|PASS/);
  assert.match(drill, /016_canonical_source_freshness\.sql/);
  assert.match(drill, /016_canonical_source_freshness\.down\.sql/);
  assert.doesNotMatch(mcpRepository, /freshness AS status/);
});
