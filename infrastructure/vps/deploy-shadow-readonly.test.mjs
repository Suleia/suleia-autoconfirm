import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('./deploy-shadow-readonly.sh', import.meta.url), 'utf8');

test('shadow deployment requires confirmation, backup verification and an exact archive path', () => {
  assert.match(script, /CONFIRM_SHADOW_DEPLOY/);
  assert.match(script, /\/tmp\/suleia-c1-shadow-deploy\.tar/);
  assert.match(script, /verify_backup\.sh/);
});

test('shadow deployment starts only ingestion and does not run production action services', () => {
  assert.match(script, /up --detach --build --no-deps --wait ingestion-worker/);
  assert.doesNotMatch(script, /up[^\n]*(?:action-executor|autoconfirm)/);
});

test('credential preflight fails before any backup, extraction or container mutation', () => {
  assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(script, /SUPABASE_PUBLISHABLE_KEY=sb_publishable_/);
  assert.match(script, /SUPABASE_SHADOW_READER_TOKEN=/);
  assert.match(script, /SULEIA_EXECUTION_MODE=READ_ONLY/);
  const preflight = script.indexOf("grep -q '^SUPABASE_SERVICE_ROLE_KEY='");
  assert.ok(preflight > 0);
  assert.ok(preflight < script.indexOf('docker compose'));
  assert.ok(preflight < script.indexOf('tar --extract'));
});
