import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/017_incident_panel_integrity.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/017_incident_panel_integrity.down.sql', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/operations/repository.mjs', import.meta.url), 'utf8');
const mcpServer = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/mcp/server.mjs', import.meta.url), 'utf8');
const mcpRepository = fs.readFileSync(new URL('../../packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs', import.meta.url), 'utf8');

test('incident panel projection preserves separate source semantics and safe execution', () => {
  assert.match(migration, /operations_incident_panel_context/);
  assert.match(migration, /response_evidence_status/);
  assert.match(migration, /customer_intent_confidence/);
  assert.match(migration, /response_evidence_reason/);
  assert.match(migration, /mapping_confidence/);
  assert.match(migration, /stored_timer_status/);
  assert.match(migration, /effective_timer_status/);
  assert.match(migration, /waiting_customer/);
  assert.match(migration, /dropea_freshness_status/);
  assert.match(migration, /effective_decision_status/);
  assert.match(migration, /currently_blocked/);
  assert.match(migration, /decision_status_reason/);
  assert.match(migration, /snapshot_status/);
  assert.match(migration, /TIMER_EXPIRED_NOT_RECONCILED/);
  assert.match(migration, /CHATBY_EVIDENCE_STALE/);
  assert.doesNotMatch(migration, /CHATBY_EVIDENCE_STALE[\s\S]{0,500}300 seconds/);
  assert.match(migration, /GLS_CODE_UNMAPPED/);
  assert.match(migration, /'NOT_EXECUTED'::text AS external_action_status/);
  assert.match(migration, /status='PENDING' AND is_active=true/);
  assert.doesNotMatch(migration, /initial_carrier_code\s*=\s*'-30'/);
});

test('API table and cards share the same incident selection builder', () => {
  assert.match(repository, /function incidentSelection/);
  assert.equal((repository.match(/incidentSelection\(searchParams\)/g) || []).length, 4);
  assert.match(repository, /scope === 'ACTIVE'.*status='PENDING' AND is_active=true/s);
  assert.match(repository, /operations_incident_panel_context/);
  assert.match(repository, /customer_replied_after_issue=true[\s\S]{0,100}messages_used,0\)>0 THEN 'VALID_RESPONSE'/);
  assert.equal((repository.match(/chatby_last_successful_sync_at < now\(\)-interval '900 seconds'/g) || []).length, 3);
  assert.match(repository, /WITH selected AS MATERIALIZED/);
  assert.match(repository, /jsonb_agg\(to_jsonb\(p\)/);
  assert.match(repository, /AT TIME ZONE 'Europe\/Madrid'/);
});

test('incident panel migration is additive and has a bounded rollback', () => {
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.operations_incident_panel_context/);
  assert.match(rollback, /CREATE VIEW read_models\.operations_incidents_summary/);
  assert.doesNotMatch(rollback, /DROP TABLE|DROP ROLE|DROP OWNED/);
});

test('MCP incident identity and effective filters use explicit namespaces', () => {
  assert.match(mcpServer, /canonical_issue_id: incidentId\.optional\(\)/);
  assert.match(mcpServer, /dropea_issue_id: incidentId\.optional\(\)/);
  assert.match(mcpServer, /canonical_order_id: orderId\.optional\(\)/);
  assert.match(mcpServer, /dropea_order_id: orderId\.optional\(\)/);
  assert.match(mcpRepository, /\[humanReview, 'effective_human_review'\]/);
  assert.match(mcpRepository, /const identityColumn = canonicalIssueId \? 'canonical_issue_id' : 'dropea_issue_id'/);
  assert.match(mcpServer, /provide exactly one of canonical_issue_id or dropea_issue_id/);
});
