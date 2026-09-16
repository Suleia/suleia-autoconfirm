import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('incident evidence deploy is whitelisted, isolated and preserves trusted runtime',()=>{
  const script=readFileSync(new URL('./deploy-recipient-absent-shadow.sh',import.meta.url),'utf8');
  assert.match(script,/incident-notification-evidence\) branch=fix\/incident-notification-evidence; migration=036_incident_notification_evidence\.sql/);
  assert.match(script,/unsupported isolated deployment scope/);
  assert.match(script,/up -d --no-deps --no-build api mcp-server ingestion-worker review-panel/);
  assert.match(script,/cmp .*before-env\.json.*after-env\.json/);
  assert.match(script,/--table=operations\.chatby_conversation_links --table=operations\.chatby_private_message_display/);
  assert.match(script,/exec -T postgres psql --no-psqlrc/);
  assert.doesNotMatch(script,/exec -T --interactive=false postgres psql --no-psqlrc/);
  assert.match(script,/SELECT to_regclass\('read_models.operations_incident_evidence_context'\) IS NOT NULL/);
  assert.doesNotMatch(script,/install-staging|git push|CHATBY_REAL_SENDS=true|DROPEA_ACTIONS_ENABLED=true/);
});
