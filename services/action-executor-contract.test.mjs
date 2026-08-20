import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalActionIdempotencyKey } from '../packages/platform-core/src/execution-gateway.mjs';
import {
  ACTION_EXECUTOR_ENABLED,
  executeExternalAction,
  executeGatewayAction,
  inspectGatewayAction,
  proposeExternalAction
} from './action-executor.mjs';

function gatewayAction() {
  const candidate = {
    action_id: 'action-shadow-contract', order_id: 'order-shadow-contract',
    action_type: 'DROPEA_CONFIRM', decision_id: 'decision-shadow-contract',
    state_version: 1, input_hash: 'a'.repeat(64)
  };
  return { ...candidate, idempotency_key: canonicalActionIdempotencyKey(candidate) };
}

test('legacy disabled Action Executor exports retain their exact public contract', () => {
  assert.equal(ACTION_EXECUTOR_ENABLED, false);
  assert.deepEqual(proposeExternalAction({ type: 'DROPEA_CONFIRM' }), {
    accepted: false,
    proposed_action: 'DROPEA_CONFIRM',
    reason: 'ACTION_EXECUTOR_DISABLED_IN_STAGING',
    run_mode: 'SIMULATION',
    actions_executed: 0
  });
  assert.throws(
    () => executeExternalAction(),
    /Action Executor is disabled\. Production execution is not implemented in this phase\./
  );
});

test('additive Gateway APIs remain zero-action and fail closed', async () => {
  const inspected = inspectGatewayAction(gatewayAction());
  assert.equal(inspected.accepted, false);
  assert.equal(inspected.actions_executed, 0);
  assert.equal(inspected.production_writes, 0);
  await assert.rejects(executeGatewayAction(gatewayAction(), {
    conflict_check: 'PASS', policy_gate: 'PASS', database_available: true,
    credentials_consistent: true, state_fresh: true, current_state_version: 1,
    current_input_hash: 'a'.repeat(64),
    current_decision: {
      decision_id: 'decision-shadow-contract', proposed_action: 'PROPOSE_CONFIRM',
      state_version: 1, input_hash: 'a'.repeat(64)
    }
  }), { code: 'EXECUTION_MODE_WRITE_BLOCKED' });
});
