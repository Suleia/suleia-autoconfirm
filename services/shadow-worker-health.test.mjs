import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowWorkerHealth } from './shadow-worker-health.mjs';

test('worker is not healthy before the first complete synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: null, lastError: null, running: true });
  assert.equal(state.statusCode, 503);
  assert.equal(state.body.ok, false);
  assert.equal(state.body.first_cycle_complete, false);
  assert.equal(state.body.last_sync_ok, null);
});

test('worker becomes healthy only after a successful complete synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: { ok: true }, lastError: null, running: false });
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.ok, true);
  assert.equal(state.body.first_cycle_complete, true);
  assert.equal(state.body.actions_executed, 0);
  assert.equal(state.body.production_writes, 0);
});

test('worker stays unhealthy after a failed synchronization', () => {
  const state = shadowWorkerHealth({ lastResult: { ok: false }, lastError: 'SAFE_FAILURE', running: false });
  assert.equal(state.statusCode, 503);
  assert.equal(state.body.ok, false);
  assert.equal(state.body.last_error, 'SAFE_FAILURE');
});

