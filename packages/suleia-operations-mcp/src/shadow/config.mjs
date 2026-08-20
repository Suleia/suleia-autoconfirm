import { EXECUTION_MODE, resolveExecutionMode } from '../../../platform-core/src/execution-mode.mjs';
import { loadShadowSourceCredential } from './source-credential.mjs';

const REQUIRED = Object.freeze({
  APP_ENV: 'staging', RUN_MODE: 'SHADOW_READ_ONLY', SIMULATION_ONLY: 'true',
  REAL_DATA_READ_ENABLED: 'true', REAL_DATA_WRITE_ENABLED: 'false',
  PRODUCTION_WRITES_ENABLED: 'false', ACTION_EXECUTOR_ENABLED: 'false',
  CONNECTOR_WRITE_ENABLED: 'false', CUSTOMER_MESSAGES_ENABLED: 'false',
  DROPEA_READ_ENABLED: 'true', DROPEA_WRITE_ENABLED: 'false',
  DROPEA_MUTATION_CLIENT_ENABLED: 'false', CHATBY_READ_ENABLED: 'true',
  CHATBY_WRITE_ENABLED: 'false', GLS_WRITE_ENABLED: 'false',
  INCIDENT_INTERPRETATION_ENABLED: 'true', INCIDENT_DECISION_ENABLED: 'true',
  INCIDENT_SIMULATION_ENABLED: 'true', ISSUE_RESOLUTION_ENABLED: 'false',
  RETURN_EXECUTION_ENABLED: 'false', ADDRESS_UPDATE_ENABLED: 'false',
  ORDER_CONFIRMATION_ENABLED: 'false', ORDER_CANCELLATION_ENABLED: 'false',
  RETURN_TO_ORIGIN_ENABLED: 'false', DISCOUNTS_ENABLED: 'false',
  TEMPLATE_SENDING_ENABLED: 'false', DISCOUNT_SENDING_ENABLED: 'false',
  EMAIL_SENDING_ENABLED: 'false', EXTERNAL_AI_CALLS_ENABLED: 'false',
  OPENAI_API_ENABLED: 'false', OPENAI_API_AUTOMATION_ENABLED: 'false',
  EXTERNAL_LLM_CALLS_ENABLED: 'false', PII_MASKING_ENABLED: 'true',
  AUDIT_LOGGING_ENABLED: 'true'
});

function boundedInteger(env, name, { fallback, minimum, maximum }) {
  if (!Object.prototype.hasOwnProperty.call(env, name) || env[name] === undefined) return fallback;
  const raw = String(env[name]);
  if (!/^\d+$/.test(raw)) throw new Error(`Shadow safety gate requires ${name} to be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Shadow safety gate requires ${name} between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadShadowConfig(env = process.env) {
  for (const [name, expected] of Object.entries(REQUIRED)) {
    if (env[name] !== expected) throw new Error(`Shadow safety gate requires ${name}=${expected}`);
  }
  if (env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY must not be present in the shadow worker');
  if (!env.SUPABASE_URL) throw new Error('Supabase source URL is missing');
  const sourceUrl = new URL(env.SUPABASE_URL);
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.supabase.co')) {
    throw new Error('Supabase source host is not allowlisted');
  }
  const sourceCredential = loadShadowSourceCredential(env, {
    expectedIssuer: `${sourceUrl.href.replace(/\/$/, '')}/auth/v1`
  });
  if (!env.SHADOW_DATABASE_URL || !env.MIGRATION_HASH_KEY) throw new Error('Shadow database and hashing credentials are missing');
  const databaseUrl = new URL(env.SHADOW_DATABASE_URL);
  if (!['postgres', '127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
    throw new Error('Shadow database must be the local VPS PostgreSQL service');
  }
  const executionModeResolution = resolveExecutionMode(env);
  if (executionModeResolution.mode !== EXECUTION_MODE.READ_ONLY) {
    throw new Error('Shadow safety gate requires canonical READ_ONLY execution mode');
  }
  return Object.freeze({
    sourceUrl: sourceUrl.href.replace(/\/$/, ''),
    sourceApiKey: sourceCredential.apiKey,
    sourceBearerToken: sourceCredential.bearerToken,
    databaseUrl: env.SHADOW_DATABASE_URL, hashKey: env.MIGRATION_HASH_KEY,
    pageSize: boundedInteger(env, 'SHADOW_PAGE_SIZE', { fallback: 250, minimum: 25, maximum: 500 }),
    pollIntervalMs: boundedInteger(env, 'SHADOW_POLL_INTERVAL_MS', {
      fallback: 300000,
      minimum: 60000,
      maximum: 86400000
    }),
    executionMode: executionModeResolution.mode,
    executionModeResolution
  });
}

export { REQUIRED as SHADOW_REQUIRED_FLAGS };
