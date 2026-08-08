import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('hardening reuses the canonical Dropea identity and adds only derived read models', () => {
  const migration = read('migrations/014_operational_data_model_hardening.sql');
  assert.match(migration, /CREATE OR REPLACE VIEW read_models\.order_identity_map/);
  assert.match(migration, /d\.market,d\.store_id,d\.dropea_order_id/);
  assert.match(migration, /source_version/);
  assert.match(migration, /'EXACT'.*'VERIFIED'/s);
  assert.doesNotMatch(migration, /CREATE TABLE/);
  assert.doesNotMatch(migration, /phone.*identity_method|fuzzy/i);
});

test('central contexts, timeline, quality and findings contain no raw payload or PII columns', () => {
  const migration = read('migrations/014_operational_data_model_hardening.sql');
  for (const view of ['operations_incident_context','operations_order_context',
    'operations_order_timeline','operations_data_quality','reconciliation_findings']) {
    assert.match(migration, new RegExp(`read_models\\.${view}`));
  }
  assert.match(migration, /CHATBY_CONVERSATION_MISSING/);
  assert.match(migration, /UNKNOWN_GLS_CODE/);
  assert.match(migration, /OUT_OF_ORDER_EVENT/);
  assert.match(migration, /operations_incidents_order_updated_idx/);
  assert.doesNotMatch(migration, /customer_name|customer_email|customer_phone|raw_payload|message_text/i);
});

test('Operations Center and MCP query the same central contexts', () => {
  const operationsRepository = read('packages/suleia-operations-mcp/src/operations/repository.mjs');
  const mcpRepository = read('packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs');
  for (const view of ['operations_order_context','operations_incident_context','operations_order_timeline']) {
    assert.match(operationsRepository, new RegExp(view));
    assert.match(mcpRepository, new RegExp(view));
  }
  assert.doesNotMatch(mcpRepository, /integration_dropea_orders|integration_dropea_issues/);
});

test('migration deployment and rollback are ordered after Chatby recovery', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-chatby-conversation-recovery-migration.sh')
    < deploy.indexOf('apply-operational-data-model-hardening-migration.sh'));
  const apply = read('infrastructure/vps/apply-operational-data-model-hardening-migration.sh');
  const drill = read('infrastructure/vps/run-operational-data-model-hardening-rollback-drill.sh');
  const checkpointDeploy = read('infrastructure/vps/deploy-checkpoint-h-shadow.sh');
  assert.match(apply, /014_operational_data_model_hardening\.sql/);
  assert.match(drill, /014_operational_data_model_hardening\.down\.sql/);
  assert.match(drill, /actions=0\|production_writes=0/);
  assert.match(checkpointDeploy, /run-operational-data-model-hardening-rollback-drill\.sh/);
});

test('new MCP catalog exposes real order, incident, quality and reconciliation reads only', () => {
  const server = read('packages/suleia-operations-mcp/src/mcp/server.mjs');
  for (const tool of ['search_orders','get_order','search_incidents','get_incident',
    'get_order_timeline','search_operational_findings','get_platform_overview',
    'get_runtime_inventory','get_database_catalog','get_component_details']) {
    assert.match(server, new RegExp(`name: '${tool}'`));
  }
  assert.match(server, /readOnlyHint: true/);
  assert.match(server, /securitySchemes/);
  assert.doesNotMatch(server, /name: '(?:send|confirm|cancel|resolve|update)_/);
});
