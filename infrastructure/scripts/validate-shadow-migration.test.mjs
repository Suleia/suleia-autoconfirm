import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const up = fs.readFileSync(new URL('../../migrations/005_shadow_operational_replica.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('../../migrations/rollback/005_shadow_operational_replica.down.sql', import.meta.url), 'utf8');

test('shadow migration enforces mode and zero actions at the database boundary', () => {
  assert.match(up, /CHECK \(run_mode = 'SHADOW_READ_ONLY'\)/);
  assert.match(up, /CHECK \(actions_executed = 0\)/);
  assert.match(up, /CHECK \(production_writes = 0\)/);
});

test('MCP cannot access raw shadow records', () => {
  assert.match(up, /REVOKE ALL ON ALL TABLES IN SCHEMA raw_private FROM PUBLIC/);
  assert.doesNotMatch(up, /GRANT SELECT ON ALL TABLES IN SCHEMA raw_private[^;]*suleia_mcp_readonly/);
  assert.match(up, /GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_mcp_readonly/);
});

test('rollback is limited to schemas introduced by migration 005', () => {
  for (const schema of ['read_models','knowledge','process_intelligence','economics','enterprise_twins','decision_memory','enterprise_graph','reconciliation','truth','raw_private','migration']) {
    assert.match(down, new RegExp(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
  }
  assert.doesNotMatch(down, /DROP SCHEMA IF EXISTS (?:core|events|decisions|mcp|audit|configuration|operations)/);
});
