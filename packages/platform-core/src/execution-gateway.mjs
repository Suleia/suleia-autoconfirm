import crypto from 'node:crypto';
import { assertExternalWriteAllowed } from './execution-mode.mjs';

const EXTERNAL_ACTION_BY_PROPOSAL = Object.freeze({
  PROPOSE_CONFIRM: 'DROPEA_CONFIRM',
  PROPOSE_CANCEL: 'DROPEA_CANCEL'
});

export class ExecutionGatewayError extends Error {
  constructor(code, blockers = []) {
    super(`Execution Gateway blocked: ${code}${blockers.length ? ` (${blockers.join(', ')})` : ''}`);
    this.name = 'ExecutionGatewayError';
    this.code = code;
    this.blockers = Object.freeze([...blockers]);
  }
}

function requiredText(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new ExecutionGatewayError('INVALID_ACTION_ENVELOPE', [name]);
  return normalized;
}

export function createActionEnvelope(input = {}) {
  const stateVersion = Number(input.state_version);
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 1) {
    throw new ExecutionGatewayError('INVALID_ACTION_ENVELOPE', ['state_version']);
  }
  const action = {
    action_id: requiredText(input.action_id, 'action_id'),
    order_id: requiredText(input.order_id, 'order_id'),
    action_type: requiredText(input.action_type, 'action_type'),
    idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    decision_id: requiredText(input.decision_id, 'decision_id'),
    state_version: stateVersion,
    input_hash: requiredText(input.input_hash, 'input_hash')
  };
  if (action.idempotency_key !== canonicalActionIdempotencyKey(action)) {
    throw new ExecutionGatewayError('NON_CANONICAL_IDEMPOTENCY_KEY', ['idempotency_key']);
  }
  return Object.freeze(action);
}

export function canonicalActionIdempotencyKey(input = {}) {
  const stateVersion = Number(input.state_version);
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 1) {
    throw new ExecutionGatewayError('INVALID_ACTION_ENVELOPE', ['state_version']);
  }
  const semanticIdentity = [
    requiredText(input.order_id, 'order_id'),
    requiredText(input.action_type, 'action_type'),
    stateVersion,
    requiredText(input.input_hash, 'input_hash')
  ];
  const digest = crypto.createHash('sha256').update(JSON.stringify(semanticIdentity)).digest('hex');
  return `suleia:v1:${digest}`;
}

export function externalActionTypeForDecision(decision = {}) {
  return EXTERNAL_ACTION_BY_PROPOSAL[String(decision.proposed_action || '').trim()] || null;
}

export class InMemoryActionIdempotencyLedger {
  #claims = new Map();

  claim(input) {
    const action = createActionEnvelope(input);
    const existing = this.#claims.get(action.idempotency_key);
    if (existing) {
      const existingSemantic = {
        order_id: existing.action.order_id,
        action_type: existing.action.action_type,
        state_version: existing.action.state_version,
        input_hash: existing.action.input_hash
      };
      const candidateSemantic = {
        order_id: action.order_id,
        action_type: action.action_type,
        state_version: action.state_version,
        input_hash: action.input_hash
      };
      const collision = JSON.stringify(existingSemantic) !== JSON.stringify(candidateSemantic);
      return Object.freeze({ claimed: false, collision, record: existing });
    }
    const record = Object.freeze({
      idempotency_key: action.idempotency_key,
      action,
      status: 'CLAIMED'
    });
    this.#claims.set(action.idempotency_key, record);
    return Object.freeze({ claimed: true, collision: false, record });
  }
}

export class ExecutionGateway {
  constructor({
    executionModeResolution,
    idempotencyLedger = new InMemoryActionIdempotencyLedger(),
    writeAuthority = assertExternalWriteAllowed
  } = {}) {
    this.executionModeResolution = executionModeResolution;
    this.idempotencyLedger = idempotencyLedger;
    this.writeAuthority = writeAuthority;
  }

  inspect(input) {
    const action = createActionEnvelope(input);
    return Object.freeze({
      accepted: false,
      status: 'BLOCKED',
      reason: 'PHASE_0_5_EXTERNAL_EXECUTION_DISABLED',
      action,
      actions_executed: 0,
      production_writes: 0
    });
  }

  async execute(input, context = {}) {
    const action = createActionEnvelope(input);
    const blockers = [];
    if (context.conflict_check !== 'PASS') blockers.push('CONFLICT_CHECK_NOT_PASS');
    if (context.policy_gate !== 'PASS') blockers.push('POLICY_GATE_NOT_PASS');
    if (context.database_available !== true) blockers.push('DATABASE_UNAVAILABLE');
    if (context.credentials_consistent !== true) blockers.push('CREDENTIALS_INCONSISTENT');
    if (context.state_fresh !== true) blockers.push('STATE_STALE');
    if (Number(context.current_state_version) !== action.state_version) blockers.push('STATE_VERSION_MISMATCH');
    if (context.current_input_hash !== action.input_hash) blockers.push('INPUT_HASH_MISMATCH');
    if (!context.current_decision || typeof context.current_decision !== 'object') {
      blockers.push('CURRENT_DECISION_UNAVAILABLE');
    } else {
      if (context.current_decision.decision_id !== action.decision_id) blockers.push('DECISION_ID_MISMATCH');
      const expectedActionType = externalActionTypeForDecision(context.current_decision);
      if (!expectedActionType) blockers.push('DECISION_ACTION_NOT_EXECUTABLE');
      else if (expectedActionType !== action.action_type) blockers.push('ACTION_DECISION_MISMATCH');
      if (Number(context.current_decision.state_version) !== action.state_version
        || context.current_decision.input_hash !== action.input_hash) {
        blockers.push('DECISION_SNAPSHOT_MISMATCH');
      }
    }
    if (blockers.length) throw new ExecutionGatewayError('PRECONDITION_BLOCKED', blockers);
    this.writeAuthority(this.executionModeResolution);
    const claim = this.idempotencyLedger.claim(action);
    if (!claim.claimed) {
      throw new ExecutionGatewayError(
        claim.collision ? 'IDEMPOTENCY_KEY_COLLISION' : 'IDEMPOTENCY_REPLAY',
        [action.idempotency_key]
      );
    }
    throw new ExecutionGatewayError('PHASE_0_5_EXTERNAL_EXECUTION_DISABLED');
  }
}
