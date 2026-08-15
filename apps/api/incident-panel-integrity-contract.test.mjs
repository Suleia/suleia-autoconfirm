import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/017_incident_panel_integrity.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/017_incident_panel_integrity.down.sql', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/operations/repository.mjs', import.meta.url), 'utf8');

test('incident panel projection preserves separate source semantics and safe execution', () => {
  assert.match(migration, /operations_incident_panel_context/);
  assert.match(migration, /response_evidence_status/);
  assert.match(migration, /customer_intent_confidence/);
  assert.match(migration, /mapping_confidence/);
  assert.match(migration, /stored_timer_status/);
  assert.match(migration, /effective_timer_status/);
  assert.match(migration, /TIMER_EXPIRED_NOT_RECONCILED/);
  assert.match(migration, /CHATBY_EVIDENCE_STALE/);
  assert.match(migration, /GLS_CODE_UNMAPPED/);
  assert.match(migration, /'NOT_EXECUTED'::text AS external_action_status/);
  assert.match(migration, /status='PENDING' AND is_active=true/);
  assert.doesNotMatch(migration, /initial_carrier_code\s*=\s*'-30'/);
});

test('API table and cards share the same incident selection builder', () => {
  assert.match(repository, /function incidentSelection/);
  assert.equal((repository.match(/incidentSelection\(searchParams\)/g) || []).length, 3);
  assert.match(repository, /scope === 'ACTIVE'.*status='PENDING' AND is_active=true/s);
  assert.match(repository, /operations_incident_panel_context/);
});

test('incident panel migration is additive and has a bounded rollback', () => {
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.operations_incident_panel_context/);
  assert.match(rollback, /CREATE VIEW read_models\.operations_incidents_summary/);
  assert.doesNotMatch(rollback, /DROP TABLE|DROP ROLE|DROP OWNED/);
});
