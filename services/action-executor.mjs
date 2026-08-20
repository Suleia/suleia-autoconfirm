import { ExecutionGateway } from '../packages/platform-core/src/execution-gateway.mjs';
import { resolveExecutionMode } from '../packages/platform-core/src/execution-mode.mjs';

export const ACTION_EXECUTOR_ENABLED = false;

// Compatibility contract: keep the pre-existing staging exports byte-for-byte
// equivalent for callers. New Gateway APIs are additive and explicitly named.
export function proposeExternalAction(action) {
  return Object.freeze({
    accepted: false,
    proposed_action: action?.type || 'UNKNOWN',
    reason: 'ACTION_EXECUTOR_DISABLED_IN_STAGING',
    run_mode: 'SIMULATION',
    actions_executed: 0
  });
}

export function executeExternalAction() {
  throw new Error('Action Executor is disabled. Production execution is not implemented in this phase.');
}

export function inspectGatewayAction(action, { executionModeResolution = resolveExecutionMode({}) } = {}) {
  const gateway = new ExecutionGateway({ executionModeResolution });
  const inspected = gateway.inspect(action);
  return Object.freeze({ ...inspected, proposed_action: action?.action_type || 'UNKNOWN', run_mode: 'SIMULATION' });
}

export async function executeGatewayAction(action, context = {}, { executionModeResolution = resolveExecutionMode({}) } = {}) {
  const gateway = new ExecutionGateway({ executionModeResolution });
  return gateway.execute(action, context);
}
