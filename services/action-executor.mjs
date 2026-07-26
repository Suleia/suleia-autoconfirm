export const ACTION_EXECUTOR_ENABLED = false;

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
