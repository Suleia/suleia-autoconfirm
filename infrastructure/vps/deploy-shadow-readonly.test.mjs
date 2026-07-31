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
