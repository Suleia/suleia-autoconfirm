const REQUIRED = Object.freeze({
  APP_ENV: 'staging', RUN_MODE: 'SHADOW_READ_ONLY', SIMULATION_ONLY: 'true',
  REAL_DATA_READ_ENABLED: 'true', REAL_DATA_WRITE_ENABLED: 'false',
  PRODUCTION_WRITES_ENABLED: 'false', ACTION_EXECUTOR_ENABLED: 'false',
  CONNECTOR_WRITE_ENABLED: 'false', CUSTOMER_MESSAGES_ENABLED: 'false',
  ORDER_CONFIRMATION_ENABLED: 'false', ORDER_CANCELLATION_ENABLED: 'false',
  RETURN_TO_ORIGIN_ENABLED: 'false', DISCOUNTS_ENABLED: 'false',
  OPENAI_API_ENABLED: 'false', OPENAI_API_AUTOMATION_ENABLED: 'false',
  EXTERNAL_LLM_CALLS_ENABLED: 'false', PII_MASKING_ENABLED: 'true',
  AUDIT_LOGGING_ENABLED: 'true'
});

export function loadShadowConfig(env = process.env) {
  for (const [name, expected] of Object.entries(REQUIRED)) {
    if (env[name] !== expected) throw new Error(`Shadow safety gate requires ${name}=${expected}`);
  }
  if (env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY must not be present in the shadow worker');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase read credentials are missing');
  const sourceUrl = new URL(env.SUPABASE_URL);
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.supabase.co')) {
    throw new Error('Supabase source host is not allowlisted');
  }
  if (!env.SHADOW_DATABASE_URL || !env.MIGRATION_HASH_KEY) throw new Error('Shadow database and hashing credentials are missing');
  const databaseUrl = new URL(env.SHADOW_DATABASE_URL);
  if (!['postgres', '127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
    throw new Error('Shadow database must be the local VPS PostgreSQL service');
  }
  return Object.freeze({
    sourceUrl: sourceUrl.href.replace(/\/$/, ''), sourceToken: env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: env.SHADOW_DATABASE_URL, hashKey: env.MIGRATION_HASH_KEY,
    pageSize: Math.min(500, Math.max(25, Number(env.SHADOW_PAGE_SIZE || 250))),
    pollIntervalMs: Math.max(60000, Number(env.SHADOW_POLL_INTERVAL_MS || 300000))
  });
}

export { REQUIRED as SHADOW_REQUIRED_FLAGS };
