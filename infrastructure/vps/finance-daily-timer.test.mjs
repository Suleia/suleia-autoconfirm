import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('finance refresh is daily, persistent and uses the isolated compose profile', () => {
  const timer = fs.readFileSync(new URL('./suleia-finance-daily.timer', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('./suleia-finance-daily.service', import.meta.url), 'utf8');
  const runner = fs.readFileSync(new URL('./run-finance-daily-sync.sh', import.meta.url), 'utf8');
  assert.match(timer, /OnCalendar=.*Europe\/Madrid/);
  assert.match(timer, /Persistent=true/);
  assert.match(service, /Type=oneshot/);
  assert.match(runner, /--env-file "\$env_file" -f "\$compose_file" --profile finance-sync run --rm finance-daily-sync/);
  assert.match(runner, /test -f "\$env_file"/);
  assert.doesNotMatch(runner, /access_token|password|secret/i);
});
