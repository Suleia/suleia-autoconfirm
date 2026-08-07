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
  const secretProvisioner = fs.readFileSync(new URL('./provision-keycloak-config-service-secret.sh', import.meta.url), 'utf8');
  const cleanup = fs.readFileSync(new URL('./cleanup-keycloak-config-service.sh', import.meta.url), 'utf8');
  assert.match(wrapper, /trap cleanup EXIT/);
  assert.match(wrapper, /bootstrap-keycloak-config-service\.sh/);
  assert.match(wrapper, /cleanup-keycloak-config-service\.sh/);
  assert.match(provisioner, /--client "\$\{KEYCLOAK_CONFIG_SERVICE_CLIENT_ID\}"/);
  assert.match(secretProvisioner, /suleia-config-service-\$\(openssl rand -hex 8\)/);
  assert.match(cleanup, /"\$\{KEYCLOAK_CONFIG_SERVICE_CLIENT_ID\}" suleia-config-service/);
  assert.match(cleanup, /\^\$\{CLIENT_ID_NAME\}=/);
  assert.doesNotMatch(provisioner, /--user .*admin|KC_BOOTSTRAP_ADMIN_PASSWORD/);
  assert.doesNotMatch(provisioner, /\|\s*(?:awk|head|grep)\b/);
});

test('private staging applies operational protections only after Operations Center base migration', () => {
  const script = fs.readFileSync(new URL('./deploy-private-staging.sh', import.meta.url), 'utf8');
  const base = script.indexOf('apply-operations-center-migration.sh');
  const protections = script.indexOf('apply-operational-protections-migration.sh');
  assert.ok(base >= 0 && protections > base);
});

test('operational protections rollback drill preserves the base read model', () => {
  const script = fs.readFileSync(new URL('./run-operational-protections-rollback-drill.sh', import.meta.url), 'utf8');
  assert.match(script, /007_operational_protections\.sql/);
  assert.match(script, /007_operational_protections\.down\.sql/);
  assert.match(script, /base_preserved=1/);
  assert.doesNotMatch(script, /DROP SCHEMA|DROP DATABASE/);
});
