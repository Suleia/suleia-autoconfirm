import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('purchase-cohort deployment replaces only finance API and panel, preserving business runtime and secrets',()=>{
  const script=readFileSync(new URL('./deploy-finance-purchase-cohort.sh',import.meta.url),'utf8');
  assert.match(script,/up -d --no-deps --no-build api review-panel/);
  assert.match(script,/cmp "\$backup\/api-before-env.json" "\$backup\/api-after-env.json"/);
  assert.match(script,/for service in mcp-server ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring/);
  assert.match(script,/CURRENT_FINANCE_IMAGE_TESTS\|PASS/);
  assert.doesNotMatch(script,/\bpsql\b|migrations\/\d+|AUSENTE_AUTOMATION_LIVE.*true|DROPEA_ACTIONS_ENABLED.*true/);
});
