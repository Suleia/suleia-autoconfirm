import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('one-shot Dropea phase runner is confirmation-gated and reports zero external actions', () => {
  const source = fs.readFileSync(new URL('./run-dropea-v2-shadow-phase.mjs', import.meta.url), 'utf8');
  assert.match(source, /CONFIRM_DROPEA_SHADOW_PHASE/);
  assert.match(source, /CONFIRM_SHADOW_MIRROR_WRITE/);
  assert.match(source, /if \(!dryRun\) await projector\.upsertStoreConfig/);
  assert.match(source, /actions_executed: 0/);
  assert.match(source, /production_writes: 0/);
  assert.match(source, /messages_sent: 0/);
  assert.match(source, /external_mutations: 0/);
  assert.doesNotMatch(source, /console\.log|method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});

test('periodic worker cannot persist store configuration during dry-run', () => {
  const source = fs.readFileSync(new URL('../services/shadow-readonly-worker.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!dropeaDryRun\) await operationsProjector\.upsertStoreConfig\(store\)/);
});
