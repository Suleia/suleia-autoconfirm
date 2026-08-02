import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

test('incident handbook migration is applied after existing operational read models', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-operational-protections-migration.sh') < deploy.indexOf('apply-incident-handbook-migration.sh'));
  assert.match(deploy, /apply-incident-handbook-migration\.sh/);
});

test('transactional VPS deploy runs the incident rollback drill before applying migrations', () => {
  const deploy = read('infrastructure/vps/deploy-checkpoint-h-shadow.sh');
  assert.ok(deploy.indexOf('run-incident-handbook-rollback-drill.sh') < deploy.indexOf('deploy-private-staging.sh'));
  assert.match(deploy, /incident_rollback=verified\|actions=0\|production_writes=0/);
});

test('legacy Operations Center drill rolls back the restored migration chain without reapplying version 006', () => {
  const drill = read('infrastructure/vps/run-operations-center-rollback-drill.sh');
  assert.match(drill, /007_operational_protections\.down\.sql/);
  assert.match(drill, /006_operations_center_read_models\.down\.sql/);
  assert.doesNotMatch(drill, /migrations\/006_operations_center_read_models\.sql/);
  assert.ok(drill.indexOf('PROTECTIONS_DOWN_MIGRATION') < drill.indexOf('OPERATIONS_DOWN_MIGRATION'));
});

test('historical migration launchers skip complete state and fail closed on partial state', () => {
  for (const script of [
    read('infrastructure/vps/apply-operations-center-migration.sh'),
    read('infrastructure/vps/apply-operational-protections-migration.sh')
  ]) {
    assert.match(script, /if \[\[ "\$\{state\}" = "3" \]\]/);
    assert.match(script, /if \[\[ "\$\{state\}" != "0" \]\]/);
    assert.match(script, /partially applied; refusing to guess/);
  }
});

test('incident handbook rollback drill proves all new operational tables are removable', () => {
  const drill = read('infrastructure/vps/run-incident-handbook-rollback-drill.sh');
  assert.match(drill, /created.*5/s);
  assert.match(drill, /remaining=0\|base_preserved=1\|actions=0\|production_writes=0/);
});

test('runtime declares strict read and simulation flags with every external write disabled', () => {
  const compose = read('infrastructure/docker/compose.yaml');
  for (const pattern of [
    /RUN_MODE: \$\{RUN_MODE:-SHADOW_READ_ONLY\}/,
    /DROPEA_READ_ENABLED: \$\{DROPEA_READ_ENABLED:-true\}/,
    /CHATBY_READ_ENABLED: \$\{CHATBY_READ_ENABLED:-true\}/,
    /DROPEA_MUTATION_CLIENT_ENABLED: \$\{DROPEA_MUTATION_CLIENT_ENABLED:-false\}/,
    /DROPEA_WRITE_ENABLED: \$\{DROPEA_WRITE_ENABLED:-false\}/,
    /CHATBY_WRITE_ENABLED: \$\{CHATBY_WRITE_ENABLED:-false\}/,
    /GLS_WRITE_ENABLED: \$\{GLS_WRITE_ENABLED:-false\}/,
    /ISSUE_RESOLUTION_ENABLED: \$\{ISSUE_RESOLUTION_ENABLED:-false\}/,
    /TEMPLATE_SENDING_ENABLED: \$\{TEMPLATE_SENDING_ENABLED:-false\}/,
    /EMAIL_SENDING_ENABLED: \$\{EMAIL_SENDING_ENABLED:-false\}/,
    /EXTERNAL_AI_CALLS_ENABLED: \$\{EXTERNAL_AI_CALLS_ENABLED:-false\}/
  ]) assert.match(compose, pattern);
});

test('deployment upgrades existing environments to the strict incident safety envelope', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  for (const declaration of [
    'ensure_env_value RUN_MODE SHADOW_READ_ONLY',
    'ensure_env_value REAL_DATA_READ_ENABLED true',
    'ensure_env_value DROPEA_WRITE_ENABLED false',
    'ensure_env_value DROPEA_MUTATION_CLIENT_ENABLED false',
    'ensure_env_value CHATBY_WRITE_ENABLED false',
    'ensure_env_value GLS_WRITE_ENABLED false',
    'ensure_env_value ISSUE_RESOLUTION_ENABLED false',
    'ensure_env_value RETURN_EXECUTION_ENABLED false',
    'ensure_env_value TEMPLATE_SENDING_ENABLED false',
    'ensure_env_value DISCOUNT_SENDING_ENABLED false',
    'ensure_env_value EMAIL_SENDING_ENABLED false',
    'ensure_env_value EXTERNAL_AI_CALLS_ENABLED false'
  ]) assert.match(deploy, new RegExp(declaration));
});
