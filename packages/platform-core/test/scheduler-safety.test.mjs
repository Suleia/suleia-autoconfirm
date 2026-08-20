import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateScheduledRun } from '../src/scheduler-safety.mjs';

const ready = () => ({
  decision_engine_available: true,
  policy_engine_available: true,
  api_available: true,
  database_available: true,
  config_valid: true,
  state_fresh: true,
  credentials_consistent: true,
  idempotency_available: true,
  lock_acquired: true
});

for (const [field, blocker] of [
  ['decision_engine_available', 'DECISION_ENGINE_UNAVAILABLE'],
  ['policy_engine_available', 'POLICY_ENGINE_UNAVAILABLE'],
  ['api_available', 'API_UNAVAILABLE'],
  ['database_available', 'DATABASE_UNAVAILABLE'],
  ['config_valid', 'CONFIG_INVALID'],
  ['state_fresh', 'STATE_STALE'],
  ['credentials_consistent', 'CREDENTIALS_INCONSISTENT'],
  ['idempotency_available', 'IDEMPOTENCY_UNAVAILABLE'],
  ['lock_acquired', 'LOCK_NOT_ACQUIRED']
]) {
  test(`scheduled work fails safe when ${field} is unavailable or unknown`, () => {
    for (const value of [false, null, undefined, 'true']) {
      const result = evaluateScheduledRun({ ...ready(), [field]: value });
      assert.equal(result.disposition, 'SKIP_RETRY_SAFE');
      assert.equal(result.blockers.includes(blocker), true);
      assert.equal(result.actions_executed, 0);
      assert.equal(result.production_writes, 0);
    }
  });
}

test('an all-ready scheduled run remains simulation-only in Phase 0.5', () => {
  const result = evaluateScheduledRun(ready());
  assert.equal(result.disposition, 'SIMULATION_ONLY');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.actions_executed, 0);
  assert.equal(result.production_writes, 0);
});
