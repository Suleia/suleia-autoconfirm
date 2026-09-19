import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../migrations/040_incident_autopilot_shadow.sql', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('./apply-incident-autopilot-shadow-migration.sh', import.meta.url), 'utf8');
const release = readFileSync(new URL('./deploy-incident-autopilot-shadow.sh', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../migrations/rollback/040_incident_autopilot_shadow.down.sql', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../docker/Dockerfile.node', import.meta.url), 'utf8');

test('autopilot schema is simulation-only and idempotent', () => {
  assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(sql, /external_write_attempted boolean NOT NULL DEFAULT false CHECK \(external_write_attempted = false\)/);
  assert.match(sql, /production_writes integer NOT NULL DEFAULT 0 CHECK \(production_writes = 0\)/);
  assert.match(sql, /incident_human_review_queue/);
  assert.match(sql, /incident_action_verifications/);
});

test('migration runner refuses write-enabled deployments', () => {
  assert.match(deploy, /ACTION_EXECUTOR_ENABLED/);
  assert.match(deploy, /PRODUCTION_WRITES_ENABLED/);
  assert.match(deploy, /SHADOW_READ_ONLY/);
});

test('isolated release preserves runtime flags, applies migration and verifies zero external writes', () => {
  assert.match(release, /branch=feat\/incident-autopilot/);
  assert.match(release, /migrations\/040_incident_autopilot_shadow\.sql/);
  assert.match(release, /external_write_attempted OR actions_executed<>0 OR production_writes<>0/);
  assert.match(release, /mode=SHADOW_READ_ONLY/);
  assert.match(release, /business_actions=0\|production_writes=0/);
  assert.match(release, /autoconfirm\/data:\/test-data:ro/);
  assert.match(release, /cp -R \/test-data\/\. \/app\/autoconfirm\/data\//);
  assert.match(dockerfile, /COPY autoconfirm\/data\/incident-policy\.json \.\/autoconfirm\/data\/incident-policy\.json/);
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.operations_incident_autopilot_current/);
});
