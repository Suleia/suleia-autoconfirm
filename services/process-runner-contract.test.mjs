import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./process-runner.mjs', import.meta.url), 'utf8');

test('placeholder Decision Engine and Scheduler report NOT_IMPLEMENTED, never healthy', () => {
  assert.match(source, /health_status:\s*implemented \? 'UNKNOWN' : 'NOT_IMPLEMENTED'/);
  assert.match(source, /if \(!implemented\) res\.statusCode = 501/);
  assert.match(source, /functional_cycle_available:\s*false/);
  assert.match(source, /production_writes:\s*0/);
  assert.match(source, /evaluateScheduledRun\(\{\}\)/);
  assert.match(source, /scheduler_disposition/);
  assert.doesNotMatch(source, /ok:\s*true/);
});
