const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const EXECUTION_MODE = Object.freeze({
  SIMULATION: 'SIMULATION',
  READ_ONLY: 'READ_ONLY',
  PRODUCTION: 'PRODUCTION'
});

export const WRITE_CAPABILITY_FLAGS = Object.freeze([
  'PRODUCTION_WRITES_ENABLED',
  'REAL_DATA_WRITE_ENABLED',
  'CONNECTOR_WRITE_ENABLED',
  'ACTION_EXECUTOR_ENABLED',
  'MCP_WRITE_TOOLS_ENABLED',
  'DROPEA_WRITE_ENABLED',
  'DROPEA_MUTATION_CLIENT_ENABLED',
  'CHATBY_WRITE_ENABLED',
  'GLS_WRITE_ENABLED',
  'ISSUE_RESOLUTION_ENABLED',
  'RETURN_EXECUTION_ENABLED',
  'ADDRESS_UPDATE_ENABLED',
  'CUSTOMER_MESSAGES_ENABLED',
  'ORDER_CONFIRMATION_ENABLED',
  'ORDER_CANCELLATION_ENABLED',
  'RETURN_TO_ORIGIN_ENABLED',
  'DISCOUNTS_ENABLED',
  'TEMPLATE_SENDING_ENABLED',
  'DISCOUNT_SENDING_ENABLED',
  'EMAIL_SENDING_ENABLED',
  'CHATBY_CONTACT_DELETE_ENABLED',
  'RELEASIT_RETURN_BLOCK_WRITE_ENABLED'
]);

const LEGACY_MODE_ALIASES = Object.freeze({
  SIMULATION: EXECUTION_MODE.SIMULATION,
  SHADOW_READ_ONLY: EXECUTION_MODE.READ_ONLY,
  READ_ONLY: EXECUTION_MODE.READ_ONLY,
  PRODUCTION: EXECUTION_MODE.PRODUCTION
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function strictBoolean(env, name) {
  if (!hasOwn(env, name) || env[name] === undefined) return null;
  if (env[name] === 'true' || env[name] === true) return true;
  if (env[name] === 'false' || env[name] === false) return false;
  throw new ExecutionModeConfigurationError('INVALID_BOOLEAN', [name]);
}

function canonicalMode(env) {
  if (!hasOwn(env, 'SULEIA_EXECUTION_MODE') || env.SULEIA_EXECUTION_MODE === undefined) return null;
  const value = env.SULEIA_EXECUTION_MODE;
  if (!Object.values(EXECUTION_MODE).includes(value)) {
    throw new ExecutionModeConfigurationError('INVALID_CANONICAL_MODE', ['SULEIA_EXECUTION_MODE']);
  }
  return value;
}

function legacyMode(env) {
  if (!hasOwn(env, 'RUN_MODE') || env.RUN_MODE === undefined) return null;
  const raw = env.RUN_MODE;
  if (!hasOwn(LEGACY_MODE_ALIASES, raw)) {
    throw new ExecutionModeConfigurationError('INVALID_LEGACY_MODE', ['RUN_MODE']);
  }
  return { raw, mode: LEGACY_MODE_ALIASES[raw] };
}

export class ExecutionModeConfigurationError extends Error {
  constructor(code, violations = []) {
    super(`Unsafe execution mode configuration: ${code}${violations.length ? ` (${violations.join(', ')})` : ''}`);
    this.name = 'ExecutionModeConfigurationError';
    this.code = code;
    this.violations = Object.freeze([...violations]);
  }
}

export function resolveExecutionMode(
  env = process.env,
  { supportedModes = [EXECUTION_MODE.SIMULATION, EXECUTION_MODE.READ_ONLY] } = {}
) {
  if (
    !Array.isArray(supportedModes)
    || supportedModes.length === 0
    || supportedModes.some((value) => !Object.values(EXECUTION_MODE).includes(value))
  ) {
    throw new ExecutionModeConfigurationError('INVALID_SUPPORTED_MODES', ['supportedModes']);
  }
  const requestedCanonical = canonicalMode(env);
  const legacy = legacyMode(env);
  if (requestedCanonical && legacy && requestedCanonical !== legacy.mode) {
    throw new ExecutionModeConfigurationError('MODE_CONTRADICTION', [
      'SULEIA_EXECUTION_MODE',
      'RUN_MODE'
    ]);
  }

  let mode = requestedCanonical || legacy?.mode || EXECUTION_MODE.SIMULATION;
  let source = requestedCanonical ? 'CANONICAL' : legacy ? 'LEGACY' : 'DEFAULT_FAIL_CLOSED';

  const activeWriteFlags = [];
  for (const name of WRITE_CAPABILITY_FLAGS) {
    if (strictBoolean(env, name) === true) activeWriteFlags.push(name);
  }

  const simulationOnly = strictBoolean(env, 'SIMULATION_ONLY');
  const readOnly = strictBoolean(env, 'READ_ONLY');
  if (mode !== EXECUTION_MODE.PRODUCTION && activeWriteFlags.length) {
    throw new ExecutionModeConfigurationError('CONFIG_CONTRADICTION', activeWriteFlags);
  }
  if (mode !== EXECUTION_MODE.PRODUCTION && simulationOnly === false) {
    throw new ExecutionModeConfigurationError('CONFIG_CONTRADICTION', ['SIMULATION_ONLY']);
  }
  if (mode === EXECUTION_MODE.READ_ONLY && readOnly === false) {
    throw new ExecutionModeConfigurationError('CONFIG_CONTRADICTION', ['READ_ONLY']);
  }
  if (mode === EXECUTION_MODE.PRODUCTION && requestedCanonical !== EXECUTION_MODE.PRODUCTION) {
    throw new ExecutionModeConfigurationError('PRODUCTION_REQUIRES_CANONICAL_MODE', ['SULEIA_EXECUTION_MODE']);
  }
  if (mode === EXECUTION_MODE.PRODUCTION) {
    throw new ExecutionModeConfigurationError('PRODUCTION_NOT_IMPLEMENTED', ['SULEIA_EXECUTION_MODE']);
  }
  if (!supportedModes.includes(mode)) {
    throw new ExecutionModeConfigurationError('MODE_NOT_SUPPORTED', ['SULEIA_EXECUTION_MODE']);
  }

  // Phase 0.5 exposes no path that can authorize an external write. A future
  // capability must opt into PRODUCTION explicitly and pass the Execution Gateway.
  const resolution = {
    mode,
    source,
    production_writes: false,
    external_writes_allowed: false,
    decisions_executable: false,
    fail_closed: true,
    legacy_run_mode: legacy?.raw || null
  };
  return deepFreeze(resolution);
}

export function assertExternalWriteAllowed(resolution) {
  if (!resolution || resolution.external_writes_allowed !== true) {
    throw new ExecutionModeConfigurationError('EXECUTION_MODE_WRITE_BLOCKED', ['external_writes_allowed']);
  }
  return resolution;
}
