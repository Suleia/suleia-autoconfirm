import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('./run-render-automation-cycle.sh', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('./suleia-render-automation.service', import.meta.url), 'utf8');
const timer = fs.readFileSync(new URL('./suleia-render-automation.timer', import.meta.url), 'utf8');

test('runner calls only the authenticated complete-cycle endpoint and never logs its body', () => {
  assert.match(runner, /https:\/\/suleia-autoconfirm\.onrender\.com\/api\/cron\/automation-cycle/);
  assert.match(runner, /Authorization: Bearer \$\{CRON_SECRET\}/);
  assert.match(runner, /flock --nonblock/);
  assert.match(runner, /--output "\$\{response_file\}"/);
  assert.match(runner, /secret_disclosed=0/);
  assert.doesNotMatch(runner, /cat "\$\{response_file\}"/);
});

test('systemd timer is persistent, non-overlapping and sandboxed', () => {
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(timer, /Persistent=true/);
  assert.match(service, /User=suleiaops/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /CapabilityBoundingSet=/);
});
