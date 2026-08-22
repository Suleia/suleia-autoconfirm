const SAFE_MODE = 'SIMULATION';

export class MetaAdsConfigurationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MetaAdsConfigurationError';
    this.code = code;
  }
}
function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new MetaAdsConfigurationError(`${key} is required`, 'META_ADS_CONFIG_MISSING');
  return value;
}

function integer(env, key, fallback, { min, max }) {
  if (!Object.hasOwn(env, key)) return fallback;
  const raw = String(env[key]).trim();
  if (!/^\d+$/.test(raw)) throw new MetaAdsConfigurationError(`${key} must be an integer`, 'META_ADS_CONFIG_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new MetaAdsConfigurationError(`${key} is out of range`, 'META_ADS_CONFIG_INVALID');
  }
  return value;
}

function falseOnly(env, key) {
  if (!Object.hasOwn(env, key)) return false;
  if (String(env[key]).trim() !== 'false') {
    throw new MetaAdsConfigurationError(`${key} must be false`, 'META_ADS_WRITE_CONFIGURATION_BLOCKED');
  }
  return false;
}

export function loadMetaAdsConfig(env = process.env) {
  const executionMode = String(env.META_ADS_EXECUTION_MODE || SAFE_MODE).trim();
  if (executionMode !== SAFE_MODE) {
    throw new MetaAdsConfigurationError(
      'META_ADS_EXECUTION_MODE must remain SIMULATION during META-0/META-1',
      'META_ADS_MODE_BLOCKED'
    );
  }
  falseOnly(env, 'META_ADS_WRITES_ENABLED');
  falseOnly(env, 'META_ADS_BUDGET_WRITES_ENABLED');
  falseOnly(env, 'META_ADS_TELEGRAM_SEND_ENABLED');

  const accountId = required(env, 'META_ADS_AD_ACCOUNT_ID').replace(/^act_/, '');
  if (!/^\d+$/.test(accountId)) {
    throw new MetaAdsConfigurationError('META_ADS_AD_ACCOUNT_ID must be numeric', 'META_ADS_CONFIG_INVALID');
  }
  const apiVersion = String(env.META_ADS_API_VERSION || 'v25.0').trim();
  if (!/^v\d+\.0$/.test(apiVersion)) {
    throw new MetaAdsConfigurationError('META_ADS_API_VERSION is invalid', 'META_ADS_CONFIG_INVALID');
  }

  return Object.freeze({
    executionMode,
    accessToken: required(env, 'META_ADS_ACCESS_TOKEN'),
    accountId,
    apiVersion,
    expectedCurrency: String(env.META_ADS_EXPECTED_CURRENCY || 'EUR').trim(),
    expectedTimezone: String(env.META_ADS_TIMEZONE || 'Europe/Madrid').trim(),
    timeoutMs: integer(env, 'META_ADS_TIMEOUT_MS', 15_000, { min: 1_000, max: 60_000 }),
    maxRetries: integer(env, 'META_ADS_MAX_RETRIES', 2, { min: 0, max: 5 }),
    maxPages: integer(env, 'META_ADS_MAX_PAGES', 100, { min: 1, max: 500 }),
    writesEnabled: false,
    telegramSendEnabled: false
  });
}
