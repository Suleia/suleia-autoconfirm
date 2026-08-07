import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

test('incident handbook migration is applied after existing operational read models', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-operational-protections-migration.sh') < deploy.indexOf('apply-incident-handbook-migration.sh'));
  assert.match(deploy, /apply-incident-handbook-migration\.sh/);
});

test('Dropea V2 read mirror migration follows the incident handbook and has a rollback gate', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-incident-handbook-migration.sh') < deploy.indexOf('apply-dropea-v2-read-mirror-migration.sh'));
  const transactional = read('infrastructure/vps/deploy-checkpoint-h-shadow.sh');
  assert.ok(transactional.indexOf('run-dropea-v2-read-mirror-rollback-drill.sh') < transactional.indexOf('deploy-private-staging.sh'));
  assert.match(transactional, /dropea_v2_rollback=verified/);
});

test('transactional VPS deploy runs the incident rollback drill before applying migrations', () => {
  const deploy = read('infrastructure/vps/deploy-checkpoint-h-shadow.sh');
  assert.ok(deploy.indexOf('run-incident-handbook-rollback-drill.sh') < deploy.indexOf('deploy-private-staging.sh'));
  assert.match(deploy, /incident_rollback=verified\|dropea_v2_rollback=verified\|actions=0\|production_writes=0/);
});

test('legacy Operations Center drill rolls back the restored migration chain without reapplying version 006', () => {
  const drill = read('infrastructure/vps/run-operations-center-rollback-drill.sh');
  assert.match(drill, /012_customer_operational_history\.down\.sql/);
  assert.match(drill, /010_dropea_complete_history\.down\.sql/);
  assert.match(drill, /009_dropea_v2_real_read_mirror\.down\.sql/);
  assert.match(drill, /008_incident_management_handbook\.down\.sql/);
  assert.match(drill, /007_operational_protections\.down\.sql/);
  assert.match(drill, /006_operations_center_read_models\.down\.sql/);
  assert.doesNotMatch(drill, /migrations\/006_operations_center_read_models\.sql/);
  const customerHistoryExecution = drill.indexOf('< "${CUSTOMER_HISTORY_DOWN_MIGRATION}"');
  const completeHistoryExecution = drill.indexOf('< "${COMPLETE_HISTORY_DOWN_MIGRATION}"');
  const v2Execution = drill.indexOf('< "${V2_DOWN_MIGRATION}"');
  const incidentExecution = drill.indexOf('< "${INCIDENT_DOWN_MIGRATION}"');
  const protectionsExecution = drill.indexOf('< "${PROTECTIONS_DOWN_MIGRATION}"');
  const operationsExecution = drill.indexOf('< "${OPERATIONS_DOWN_MIGRATION}"');
  assert.ok(customerHistoryExecution >= 0 && customerHistoryExecution < completeHistoryExecution);
  assert.ok(completeHistoryExecution < v2Execution && v2Execution < incidentExecution);
  assert.ok(incidentExecution < protectionsExecution && protectionsExecution < operationsExecution);
});

test('historical migration launchers skip complete state and fail closed on partial state', () => {
  for (const script of [
    read('infrastructure/vps/apply-operations-center-migration.sh'),
    read('infrastructure/vps/apply-operational-protections-migration.sh'),
    read('infrastructure/vps/apply-incident-handbook-migration.sh'),
    read('infrastructure/vps/apply-dropea-v2-read-mirror-migration.sh'),
    read('infrastructure/vps/apply-dropea-complete-history-migration.sh'),
    read('infrastructure/vps/apply-customer-operational-history-migration.sh')
  ]) {
    assert.match(script, /if \[\[ "\$\{state\}" = "[135]" \]\]/);
    assert.match(script, /if \[\[ "\$\{state\}" != "0" \]\]/);
    assert.match(script, /partially applied; refusing to guess/);
  }
});

test('incident handbook rollback drill proves all new operational tables are removable', () => {
  const drill = read('infrastructure/vps/run-incident-handbook-rollback-drill.sh');
  assert.match(drill, /created.*5/s);
  assert.match(drill, /if \[\[ "\$\{created\}" = "0" \]\]/);
  assert.match(drill, /remaining=0\|base_preserved=1\|actions=0\|production_writes=0/);
});

test('customer operational history follows read-only permissions and stores only a technical HMAC', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-operations-readonly-permissions.sh')
    < deploy.indexOf('apply-customer-operational-history-migration.sh'));
  const migration = read('migrations/012_customer_operational_history.sql');
  const rollback = read('migrations/rollback/012_customer_operational_history.down.sql');
  assert.match(migration, /customer_identity_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /CREATE OR REPLACE VIEW read_models\.customer_operational_history/);
  assert.match(migration, /0::integer AS actions_executed,0::integer AS production_writes/);
  assert.doesNotMatch(migration, /phone_number|email|shipping_address_ciphertext/);
  assert.match(rollback, /DROP VIEW IF EXISTS read_models\.customer_operational_history/);
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

test('complete-history migration follows the base Dropea V2 mirror migration', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-dropea-v2-read-mirror-migration.sh')
    < deploy.indexOf('apply-dropea-complete-history-migration.sh'));
  const migration = read('migrations/010_dropea_complete_history.sql');
  const rollback = read('migrations/rollback/010_dropea_complete_history.down.sql');
  assert.match(migration, /carrier_issue_code_registry/);
  assert.match(migration, /automation_allowed boolean NOT NULL DEFAULT false CHECK \(automation_allowed = false\)/);
  assert.match(rollback, /historical_reingestion_allowed=false/);
});

test('MCP receives only read access to incident operations after the complete-history migration', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-dropea-complete-history-migration.sh')
    < deploy.indexOf('apply-operations-readonly-permissions.sh'));
  const migration = read('migrations/011_operations_readonly_permissions.sql');
  assert.match(migration, /GRANT USAGE ON SCHEMA operations TO suleia_mcp_readonly/);
  assert.match(migration, /GRANT SELECT ON operations\.chatby_conversation_events/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL)/);
});

test('public edge exposes only the authenticated Dropea V2 webhook namespace to ingestion', () => {
  const edge = read('infrastructure/reverse-proxy/McpEdgeCaddyfile');
  assert.match(edge, /@dropea_webhooks path \/webhooks\/dropea\/v2\/\*/);
  assert.match(edge, /handle @dropea_webhooks \{[\s\S]*reverse_proxy ingestion-worker:3302[\s\S]*\}/);
  assert.doesNotMatch(edge, /path \/webhook(?:\s|$)/);
});
