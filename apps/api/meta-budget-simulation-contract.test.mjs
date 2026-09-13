import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/034_meta_budget_simulation.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/034_meta_budget_simulation.down.sql', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../../infrastructure/docker/compose.yaml', import.meta.url), 'utf8');

test('migration enforces hourly idempotency and immutable zero-write evidence', () => {
  assert.match(migration, /UNIQUE \(campaign_id,evaluation_hour,policy_version\)/);
  assert.match(migration, /CHECK \(executed=false\)/);
  assert.match(migration, /CHECK \(meta_write_attempted=false\)/);
  assert.match(migration, /external_actions=0/); assert.match(migration, /production_writes=0/);
  assert.match(migration, /meta_budget_writes=0/);
  assert.match(migration, /meta_budget_would_execute_bounds[\s\S]*budget_proposed_cents BETWEEN 1500 AND 7000/);
  assert.match(migration, /REVOKE ALL[\s\S]*suleia_mcp_readonly/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[^;]*suleia_operations_readonly/i);
});

test('rollback is bounded to the isolated Meta simulation objects', () => {
  assert.match(rollback, /DROP TABLE IF EXISTS economics\.meta_budget_decisions/);
  assert.doesNotMatch(rollback, /operations_(?:orders|incidents)|chatby|dropea/i);
});

test('manual compose profile is simulation-only and introduces no scheduler or live flag', () => {
  assert.match(compose, /meta-budget-shadow:[\s\S]*profiles: \["meta-budget-shadow"\]/);
  assert.match(compose, /META_WRITES_ENABLED: "false"/);
  assert.match(compose, /META_LIVE_EXECUTION_ENABLED: "false"/);
  assert.match(compose, /META_AUTOMATION_ENABLED: "false"/);
  assert.doesNotMatch(compose.match(/meta-budget-shadow:[\s\S]*?(?=\n  [a-z][\w-]+:|\n  review-panel:)/)?.[0] || '', /timer|cron|schedule/i);
});
