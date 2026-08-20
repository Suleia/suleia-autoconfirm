import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXECUTION_MODE,
  ExecutionModeConfigurationError,
  WRITE_CAPABILITY_FLAGS,
  assertExternalWriteAllowed,
  resolveExecutionMode
} from '../src/execution-mode.mjs';

const currentShadowEnv = () => ({
  RUN_MODE: 'SHADOW_READ_ONLY',
  SIMULATION_ONLY: 'true',
  READ_ONLY: 'true',
  PRODUCTION_WRITES_ENABLED: 'false',
  ACTION_EXECUTOR_ENABLED: 'false',
  CONNECTOR_WRITE_ENABLED: 'false',
  REAL_DATA_WRITE_ENABLED: 'false'
});

test('absence of all mode selectors defaults to fail-closed simulation', () => {
  assert.deepEqual(resolveExecutionMode({}), {
    mode: EXECUTION_MODE.SIMULATION,
    source: 'DEFAULT_FAIL_CLOSED',
    production_writes: false,
    external_writes_allowed: false,
    decisions_executable: false,
    fail_closed: true,
    legacy_run_mode: null
  });
});

test('the current Contabo shadow tuple normalizes to canonical READ_ONLY', () => {
  const resolved = resolveExecutionMode(currentShadowEnv());
  assert.equal(resolved.mode, EXECUTION_MODE.READ_ONLY);
  assert.equal(resolved.source, 'LEGACY');
  assert.equal(resolved.legacy_run_mode, 'SHADOW_READ_ONLY');
  assert.equal(resolved.external_writes_allowed, false);
});

for (const value of ['', 'production', 'TRUE', 'UNKNOWN']) {
  test(`invalid canonical mode ${JSON.stringify(value)} aborts`, () => {
    assert.throws(
      () => resolveExecutionMode({ SULEIA_EXECUTION_MODE: value }),
      { code: 'INVALID_CANONICAL_MODE' }
    );
  });
}

test('canonical and legacy selectors must agree', () => {
  assert.throws(() => resolveExecutionMode({
    SULEIA_EXECUTION_MODE: 'SIMULATION',
    RUN_MODE: 'SHADOW_READ_ONLY'
  }), { code: 'MODE_CONTRADICTION' });
});

for (const value of ['', '1', 'yes', 'TRUE', 'False']) {
  test(`non-canonical boolean ${JSON.stringify(value)} aborts`, () => {
    assert.throws(
      () => resolveExecutionMode({ RUN_MODE: 'SHADOW_READ_ONLY', CHATBY_WRITE_ENABLED: value }),
      { code: 'INVALID_BOOLEAN' }
    );
  });
}

for (const flag of WRITE_CAPABILITY_FLAGS) {
  test(`${flag}=true cannot coexist with a safe execution mode`, () => {
    assert.throws(
      () => resolveExecutionMode({ ...currentShadowEnv(), [flag]: 'true' }),
      (error) => error.code === 'CONFIG_CONTRADICTION' && error.violations.includes(flag)
    );
  });
}

test('safe modes reject contradictory safety assertions', () => {
  assert.throws(
    () => resolveExecutionMode({ RUN_MODE: 'SIMULATION', SIMULATION_ONLY: 'false' }),
    { code: 'CONFIG_CONTRADICTION' }
  );
  assert.throws(
    () => resolveExecutionMode({ RUN_MODE: 'SHADOW_READ_ONLY', READ_ONLY: 'false' }),
    { code: 'CONFIG_CONTRADICTION' }
  );
});

test('NODE_ENV and live read triggers never select production or enable writes', () => {
  const resolved = resolveExecutionMode({
    ...currentShadowEnv(),
    NODE_ENV: 'production',
    LIVE_POLLING_ENABLED: 'true',
    LIVE_WEBHOOKS_ENABLED: 'true',
    LIVE_CRON_ENABLED: 'true',
    DROPEA_INGESTION_DRY_RUN: 'false'
  });
  assert.equal(resolved.mode, EXECUTION_MODE.READ_ONLY);
  assert.equal(resolved.external_writes_allowed, false);
});

test('legacy production cannot be inferred and canonical production is unconditionally blocked in Phase 0.5', () => {
  assert.throws(
    () => resolveExecutionMode({ RUN_MODE: 'PRODUCTION' }),
    { code: 'PRODUCTION_REQUIRES_CANONICAL_MODE' }
  );
  assert.throws(() => resolveExecutionMode({
    SULEIA_EXECUTION_MODE: 'PRODUCTION',
    RUN_MODE: 'PRODUCTION',
    PRODUCTION_WRITES_ENABLED: 'true',
    ACTION_EXECUTOR_ENABLED: 'true'
  }), { code: 'PRODUCTION_NOT_IMPLEMENTED' });
  assert.throws(() => resolveExecutionMode({
    SULEIA_EXECUTION_MODE: 'PRODUCTION',
    RUN_MODE: 'PRODUCTION'
  }, { supportedModes: ['PRODUCTION'] }), { code: 'PRODUCTION_NOT_IMPLEMENTED' });
});

test('the supported-mode option accepts only a non-empty list of canonical modes', () => {
  assert.throws(() => resolveExecutionMode({}, { supportedModes: [] }), { code: 'INVALID_SUPPORTED_MODES' });
  assert.throws(() => resolveExecutionMode({}, { supportedModes: ['SHADOW_READ_ONLY'] }), { code: 'INVALID_SUPPORTED_MODES' });
});

test('resolution is deeply immutable and contains no raw environment values', () => {
  const resolved = resolveExecutionMode({
    ...currentShadowEnv(),
    PRIVATE_SECRET: 'must-not-appear'
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(JSON.stringify(resolved).includes('must-not-appear'), false);
  assert.throws(() => { resolved.mode = 'PRODUCTION'; }, TypeError);
});

test('the Phase 0.5 write assertion always denies both admitted modes', () => {
  for (const env of [{}, currentShadowEnv()]) {
    const resolved = resolveExecutionMode(env);
    assert.throws(
      () => assertExternalWriteAllowed(resolved),
      (error) => error instanceof ExecutionModeConfigurationError
        && error.code === 'EXECUTION_MODE_WRITE_BLOCKED'
    );
  }
});
