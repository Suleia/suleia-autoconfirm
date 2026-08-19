import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('private incident context is encrypted, API-only and rollback protected', () => {
  const up = read('migrations/021_private_incident_customer_context.sql');
  const down = read('migrations/rollback/021_private_incident_customer_context.down.sql');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  const drill = read('infrastructure/vps/run-private-incident-customer-context-rollback-drill.sh');
  const feedback = read('migrations/020_incident_truth_feedback.sql');
  assert.match(up, /message_text_ciphertext/);
  assert.match(up, /REVOKE ALL ON read_models\.operations_private_incident_messages FROM suleia_mcp_readonly/);
  assert.match(up, /GRANT SELECT ON read_models\.operations_private_incident_messages TO suleia_operations_readonly/);
  assert.match(up, /GRANT SELECT,INSERT,UPDATE ON operations\.chatby_private_message_display TO suleia_ingestion/);
  assert.doesNotMatch(up, /message_text\s+text/i);
  assert.match(down, /DROP TABLE IF EXISTS operations\.chatby_private_message_display/);
  assert.match(deploy, /run-private-incident-customer-context-rollback-drill\.sh/);
  assert.match(deploy, /apply-private-incident-customer-context-migration\.sh/);
  assert.match(drill, /mcp_read=0/);
  assert.match(feedback, /GRANT SELECT ON SEQUENCE decision_memory\.incident_recommendation_feedback_feedback_id_seq TO suleia_backup/);
});
