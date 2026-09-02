import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('discount recovery observations are additive, evidence-gated and excluded from MCP', () => {
  const up = read('migrations/030_incident_discount_recovery_observations.sql');
  const down = read('migrations/rollback/030_incident_discount_recovery_observations.down.sql');
  const apply = read('infrastructure/vps/apply-incident-discount-recovery-observations-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.match(up, /DISCOUNT_ACCEPTED/);
  assert.match(up, /responded_at>discount_sent_at/);
  assert.match(up, /discount_amount<=5/);
  assert.match(up, /REVOKE ALL .*suleia_mcp_readonly/);
  assert.match(up, /production_writes=0/);
  assert.match(down, /DROP TABLE IF EXISTS operations\.incident_discount_recovery_observations/);
  assert.match(apply, /030_incident_discount_recovery_observations\.sql/);
  assert.match(deploy, /apply-incident-discount-recovery-observations-migration\.sh/);
});
