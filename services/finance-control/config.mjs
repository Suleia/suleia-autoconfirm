export class FinanceSyncConfigurationError extends Error {
  constructor(message, code) { super(message); this.name = 'FinanceSyncConfigurationError'; this.code = code; }
}

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new FinanceSyncConfigurationError(`${key} is required`, 'FINANCE_SYNC_CONFIG_MISSING');
  return value;
}

export function loadFinanceSyncConfig(env = process.env) {
  if (String(env.FINANCE_INTERNAL_LEDGER_WRITES_ENABLED || 'false') !== 'true') {
    throw new FinanceSyncConfigurationError('Internal finance ledger writes are not enabled', 'FINANCE_LEDGER_WRITE_DISABLED');
  }
  for (const key of ['PRODUCTION_WRITES_ENABLED', 'CONNECTOR_WRITE_ENABLED', 'META_ADS_WRITES_ENABLED', 'META_ADS_BUDGET_WRITES_ENABLED', 'META_ADS_TELEGRAM_SEND_ENABLED']) {
    if (String(env[key] || 'false') !== 'false') throw new FinanceSyncConfigurationError(`${key} must be false`, 'FINANCE_EXTERNAL_WRITE_BLOCKED');
  }
  return Object.freeze({ databaseUrl: required(env, 'FINANCE_DATABASE_URL'), storeId: required(env, 'FINANCE_STORE_ID'), sourceRecordKey: required(env, 'META_ADS_AD_ACCOUNT_ID').replace(/^act_/, '') });
}

export function assertDedicatedMetaReadScope(result) {
  if (!result?.permissions?.ads_read || result.permissions.broader_management_scope_present) {
    throw new FinanceSyncConfigurationError('A dedicated ads_read-only Meta token is required', 'FINANCE_META_SCOPE_BLOCKED');
  }
}
