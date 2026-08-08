import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Chatby recovery persists explicit conversation states and masked operational evidence', () => {
  const migration = read('migrations/013_chatby_conversation_recovery.sql');
  assert.match(migration, /'NONE','FOUND','MULTIPLE','STALE','BROKEN','UNKNOWN'/);
  assert.match(migration, /last_customer_message_at/);
  assert.match(migration, /last_suleia_message_at/);
  assert.match(migration, /latest_template_hash/);
  assert.match(migration, /conversation_freshness/);
  assert.match(migration, /operations_chatby_conversation_coverage/);
  assert.match(migration, /CHECK \(actions_executed = 0\)/);
  assert.match(migration, /CHECK \(production_writes = 0\)/);
  assert.doesNotMatch(migration, /customer_name|customer_phone|message_text|raw_message/i);
});

test('Chatby recovery is deployed after the operational history and rolls back before dependent views', () => {
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.ok(deploy.indexOf('apply-customer-operational-history-migration.sh')
    < deploy.indexOf('apply-chatby-conversation-recovery-migration.sh'));
  const operationsDrill = read('infrastructure/vps/run-operations-center-rollback-drill.sh');
  assert.ok(operationsDrill.indexOf('014_operational_data_model_hardening.down.sql')
    < operationsDrill.indexOf('013_chatby_conversation_recovery.down.sql'));
  assert.ok(operationsDrill.indexOf('013_chatby_conversation_recovery.down.sql')
    < operationsDrill.indexOf('012_customer_operational_history.down.sql'));
  const incidentDrill = read('infrastructure/vps/run-incident-handbook-rollback-drill.sh');
  assert.ok(incidentDrill.indexOf('014_operational_data_model_hardening.down.sql')
    < incidentDrill.indexOf('013_chatby_conversation_recovery.down.sql'));
  const chatbyDrill = read('infrastructure/vps/run-chatby-conversation-recovery-rollback-drill.sh');
  assert.match(chatbyDrill, /CHATBY_RECOVERY_ROLLBACK_DRILL\|PASS/);
  assert.ok(chatbyDrill.indexOf('014_operational_data_model_hardening.down.sql')
    < chatbyDrill.indexOf('013_chatby_conversation_recovery.down.sql'));
  const checkpoint = read('infrastructure/vps/deploy-checkpoint-h-shadow.sh');
  assert.ok(checkpoint.indexOf('run-chatby-conversation-recovery-rollback-drill.sh')
    < checkpoint.indexOf('deploy-private-staging.sh'));
});

test('Operations Center and MCP expose conversation facts without adding write tools', () => {
  const migration = read('migrations/013_chatby_conversation_recovery.sql');
  const hardening = read('migrations/014_operational_data_model_hardening.sql');
  const repository = read('packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs');
  const server = read('packages/suleia-operations-mcp/src/mcp/server.mjs');
  assert.match(migration, /conversation_reason/);
  assert.match(hardening, /conversation_identity_method/);
  assert.match(hardening, /interpretation_summary/);
  assert.match(repository, /operations_incident_context/);
  const toolNames = server.match(/export const MCP_TOOL_NAMES[\s\S]*?\]\);/)?.[0] || '';
  assert.equal((toolNames.match(/^\s+'[^']+'/gm) || []).length, 16);
  assert.doesNotMatch(server, /send_message|resolve_issue|confirm_order/);
});
