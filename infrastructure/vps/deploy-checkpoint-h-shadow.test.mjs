import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Checkpoint H deploy verifies archive, backup, restore and rollback before deployment', () => {
  const script = fs.readFileSync(new URL('./deploy-checkpoint-h-shadow.sh', import.meta.url), 'utf8');
  const checksum = script.indexOf('checksum mismatch');
  const backup = script.indexOf('run --rm --no-TTY backup');
  const restore = script.indexOf('run-restore-drill.sh');
  const rollback = script.indexOf('run-operations-center-rollback-drill.sh');
  const deploy = script.indexOf('deploy-private-staging.sh');
  assert.equal([checksum, backup, restore, rollback, deploy].every((index) => index >= 0), true);
  assert.equal(checksum < backup && backup < restore && restore < rollback && rollback < deploy, true);
  assert.match(script, /CONFIRM_SHADOW_DEPLOY/);
  assert.match(script, /actions=0\|production_writes=0/);
});
