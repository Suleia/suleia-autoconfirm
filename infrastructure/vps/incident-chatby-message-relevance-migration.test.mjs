import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('incident Chatby relevance is additive, reversible and private from MCP', () => {
  const up = read('migrations/031_incident_chatby_message_relevance.sql');
  const down = read('migrations/rollback/031_incident_chatby_message_relevance.down.sql');
  const apply = read('infrastructure/vps/apply-incident-chatby-message-relevance-migration.sh');
  const deploy = read('infrastructure/vps/deploy-private-staging.sh');
  assert.match(up, /ORDER_LIFECYCLE_ONLY/);
  assert.match(up, /DISCOUNT_RESPONSE/);
  assert.match(up, /context_template_slug/);
  assert.doesNotMatch(up, /GRANT SELECT[^;]*suleia_mcp_readonly/i);
  assert.match(down, /DROP COLUMN IF EXISTS incident_relevance/);
  assert.match(apply, /031_incident_chatby_message_relevance\.sql/);
  assert.match(deploy, /apply-incident-chatby-message-relevance-migration\.sh/);
});
