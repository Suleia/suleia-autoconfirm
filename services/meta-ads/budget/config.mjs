import { META_BUDGET_POLICY_V1, validateMetaBudgetPolicy } from './policy.mjs';

const ENABLED_MODES = new Set(['SIMULATION', 'SHADOW']);
const DECLARED_MODES = Object.freeze(['SIMULATION', 'SHADOW', 'APPROVAL_REQUIRED', 'LIVE']);

export class MetaBudgetConfigurationError extends Error {
  constructor(message, code) {
    super(message); this.name = 'MetaBudgetConfigurationError'; this.code = code;
  }
}

function falseOnly(env, name) {
  const value = Object.hasOwn(env, name) ? String(env[name]).trim().toLowerCase() : 'false';
  if (value !== 'false') throw new MetaBudgetConfigurationError(`${name} must remain false`, 'META_BUDGET_WRITE_CONFIGURATION_BLOCKED');
  return false;
}

function decimalToCents(env, name, fallbackCents) {
  if (!Object.hasOwn(env, name)) return fallbackCents;
  const raw = String(env[name]).trim(); const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new MetaBudgetConfigurationError(`${name} must be an EUR decimal with at most two places`, 'META_BUDGET_CONFIG_INVALID');
  const cents = (Number(match[1]) * 100) + Number(String(match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new MetaBudgetConfigurationError(`${name} is outside the safe range`, 'META_BUDGET_CONFIG_INVALID');
  return cents;
}

function time(env, name, fallback) {
  const value = String(env[name] || fallback).trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new MetaBudgetConfigurationError(`${name} must use HH:mm`, 'META_BUDGET_CONFIG_INVALID');
  return value;
}

export function loadMetaBudgetConfig(env = process.env) {
  const mode = String(env.META_AUTOMATION_MODE || 'SIMULATION').trim().toUpperCase();
  if (!DECLARED_MODES.includes(mode)) throw new MetaBudgetConfigurationError('Unknown META_AUTOMATION_MODE', 'META_BUDGET_MODE_INVALID');
  if (!ENABLED_MODES.has(mode)) throw new MetaBudgetConfigurationError(`${mode} is declared but disabled in this release`, 'META_BUDGET_MODE_NOT_ENABLED');
  const writesEnabled = falseOnly(env, 'META_WRITES_ENABLED');
  const liveExecutionEnabled = falseOnly(env, 'META_LIVE_EXECUTION_ENABLED');
  const externalActionsEnabled = falseOnly(env, 'META_EXTERNAL_ACTIONS_ENABLED');
  const automationEnabled = falseOnly(env, 'META_AUTOMATION_ENABLED');
  falseOnly(env, 'META_ADS_WRITES_ENABLED');
  falseOnly(env, 'META_ADS_BUDGET_WRITES_ENABLED');
  falseOnly(env, 'META_ADS_TELEGRAM_SEND_ENABLED');

  const policy = validateMetaBudgetPolicy(Object.freeze({
    ...META_BUDGET_POLICY_V1,
    minDailyBudgetCents: decimalToCents(env, 'META_MIN_DAILY_BUDGET_EUR', META_BUDGET_POLICY_V1.minDailyBudgetCents),
    maxDailyBudgetCents: decimalToCents(env, 'META_MAX_DAILY_BUDGET_EUR', META_BUDGET_POLICY_V1.maxDailyBudgetCents),
    nightMaxDailyBudgetCents: decimalToCents(env, 'META_NIGHT_MAX_DAILY_BUDGET_EUR', META_BUDGET_POLICY_V1.nightMaxDailyBudgetCents),
    scaleIncrementCents: decimalToCents(env, 'META_SCALE_INCREMENT_EUR', META_BUDGET_POLICY_V1.scaleIncrementCents),
    nightStart: time(env, 'META_NIGHT_START', META_BUDGET_POLICY_V1.nightStart),
    dayScalingStart: time(env, 'META_DAY_SCALING_START', META_BUDGET_POLICY_V1.dayScalingStart),
    timezone: String(env.META_BUDGET_TIMEZONE || META_BUDGET_POLICY_V1.timezone).trim()
  }));
  for (const key of ['minDailyBudgetCents', 'maxDailyBudgetCents', 'nightMaxDailyBudgetCents',
    'scaleIncrementCents', 'nightStart', 'dayScalingStart', 'timezone']) {
    if (policy[key] !== META_BUDGET_POLICY_V1[key]) {
      throw new MetaBudgetConfigurationError(`${key} cannot change without a new policy version`,
        'META_BUDGET_POLICY_VERSION_REQUIRED');
    }
  }

  return Object.freeze({
    mode, declaredModes: DECLARED_MODES, policy,
    writesEnabled, liveExecutionEnabled, externalActionsEnabled, automationEnabled,
    internalDatabaseWritesEnabled: String(env.META_BUDGET_INTERNAL_DB_WRITES_ENABLED || 'false').trim().toLowerCase() === 'true',
    databaseUrl: String(env.META_BUDGET_DATABASE_URL || '').trim(),
    approvalRequiredEnabled: false,
    liveEnabled: false,
    writerCompiled: false
  });
}
