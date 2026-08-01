import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Checkpoint H deploy verifies archive, backup, restore and rollback before deployment', () => {
  const script = fs.readFileSync(new URL('./deploy-checkpoint-h-shadow.sh', import.meta.url), 'utf8');
  const checksum = script.indexOf('checksum mismatch');
  const backup = script.indexOf('run --rm --no-TTY backup');
  const restore = script.indexOf('run-restore-drill.sh');
  const rollback = script.indexOf('run-operations-center-rollback-drill.sh');
  const deploy = script.indexOf('deploy-private-staging.sh');
  assert.equal([checksum, backup, restore, rollback, deploy].every((index) => index >= 0), true);
  assert.equal(checksum < backup && backup < restore && restore < rollback && rollback < deploy, true);
  assert.match(script, /CONFIRM_SHADOW_DEPLOY/);
  assert.match(script, /actions=0\|production_writes=0/);
});

test('Operations OAuth provisioning uses and removes a temporary Keycloak service', () => {
  const wrapper = fs.readFileSync(new URL('./apply-operations-keycloak.sh', import.meta.url), 'utf8');
  const provisioner = fs.readFileSync(new URL('./provision-operations-keycloak.sh', import.meta.url), 'utf8');
  assert.match(wrapper, /trap cleanup EXIT/);
  assert.match(wrapper, /bootstrap-keycloak-config-service\.sh/);
  assert.match(wrapper, /cleanup-keycloak-config-service\.sh/);
  assert.match(provisioner, /--client suleia-config-service/);
  assert.doesNotMatch(provisioner, /--user .*admin|KC_BOOTSTRAP_ADMIN_PASSWORD/);
  assert.doesNotMatch(provisioner, /\|\s*(?:awk|head|grep)\b/);
});
