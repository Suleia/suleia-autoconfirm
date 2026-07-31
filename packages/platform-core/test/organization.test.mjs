import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  AGENT_FORBIDDEN_OPERATIONS,
  EXECUTIVE_SNAPSHOT_FIELDS,
  ORGANIZATION_SCHEMA_VERSION,
  assertExecutiveSnapshotContract
} from '../src/organization/contracts.mjs';
import {
  AGENT_CATALOG,
  DEPARTMENTS,
  SULEIA_OPERATING_SYSTEM,
  validateOrganizationCatalog
} from '../src/organization/catalog.mjs';

test('Phase A organization is complete, unique and one-agent-per-department', () => {
  assert.equal(validateOrganizationCatalog(), true);
  assert.equal(DEPARTMENTS.length, 40);
  assert.equal(AGENT_CATALOG.length, 40);
  assert.deepEqual(Object.keys(SULEIA_OPERATING_SYSTEM.layers), [
    'EXECUTIVE_CONTROL',
    'OPERATIONS',
    'INTELLIGENCE',
    'GOVERNANCE',
    'ECONOMIC',
    'PLATFORM'
  ]);
});

test('every deterministic agent is simulation-only and forbids customer or production actions', () => {
  for (const agent of AGENT_CATALOG) {
    assert.equal(agent.agent_kind, 'DETERMINISTIC_RULE_AGENT');
    assert.equal(agent.run_mode, 'SIMULATION');
    assert.equal(agent.can_execute, false);
    assert.equal(agent.external_ai_allowed, false);
    assert.equal(agent.production_writes_allowed, false);
    for (const operation of AGENT_FORBIDDEN_OPERATIONS) {
      assert.ok(agent.forbidden_operations.includes(operation), `${agent.agent_id}: ${operation}`);
    }
  }
});

test('organization catalog and nested contracts are immutable', () => {
  assert.equal(Object.isFrozen(SULEIA_OPERATING_SYSTEM), true);
  assert.equal(Object.isFrozen(DEPARTMENTS), true);
  assert.equal(Object.isFrozen(DEPARTMENTS[0]), true);
  assert.equal(Object.isFrozen(AGENT_CATALOG[0].forbidden_operations), true);
});

test('executive snapshot contract requires all fields and zero-action safety', () => {
  const snapshot = Object.fromEntries(EXECUTIVE_SNAPSHOT_FIELDS.map((field) => [field, 0]));
  Object.assign(snapshot, {
    snapshot_id: 'snapshot-fixture',
    generated_at: '2026-07-31T00:00:00.000Z',
    business_date: '2026-07-31',
    environment: 'staging',
    source_freshness: 'FRESH',
    schema_version: ORGANIZATION_SCHEMA_VERSION
  });
  assert.equal(assertExecutiveSnapshotContract(snapshot), snapshot);
  assert.throws(
    () => assertExecutiveSnapshotContract({ ...snapshot, production_writes: 1 }),
    /zero-action safety/
  );
});

test('absolute cost and execution invariants remain zero', () => {
  assert.deepEqual(SULEIA_OPERATING_SYSTEM.invariants, {
    openai_api_calls: 0,
    external_ai_calls: 0,
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0,
    discounts_applied: 0
  });
});

test('Phase A organization has no network, external AI or action-executor dependency', async () => {
  const sources = await Promise.all([
    fs.readFile(new URL('../src/organization/contracts.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/organization/catalog.mjs', import.meta.url), 'utf8')
  ]);
  const combined = sources.join('\n').toLowerCase();
  for (const forbidden of [
    'fetch(',
    'api.openai.com',
    '@anthropic-ai/',
    '@google/generative-ai',
    'openai sdk',
    'action-executor'
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
});
