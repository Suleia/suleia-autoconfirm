import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function integer(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback = []) {
  const raw = process.env[name];
  return raw === undefined
    ? fallback
    : raw.split(',').map((value) => value.trim()).filter(Boolean);
}

export function loadConfig(overrides = {}) {
  const config = {
    environment: process.env.NODE_ENV || 'development',
    port: integer('PORT', 3100),
    dataMode: process.env.MCP_DATA_MODE || 'fixture',
    fixturePath: path.join(packageRoot, 'fixtures', 'order.masked.json'),
    databaseUrl: process.env.MCP_DATABASE_URL || '',
    authMode: process.env.MCP_AUTH_MODE || 'bearer',
    bearerToken: process.env.MCP_STAGING_BEARER_TOKEN || '',
    publicBaseUrl: process.env.MCP_PUBLIC_BASE_URL || '',
    oauthIssuer: process.env.MCP_OAUTH_ISSUER || '',
    oauthAudience: process.env.MCP_OAUTH_AUDIENCE || '',
    oauthJwksUrl: process.env.MCP_OAUTH_JWKS_URL || '',
    oauthRequiredRole: process.env.MCP_OAUTH_REQUIRED_ROLE || 'mcp_reader',
    grantedScopes: list('MCP_GRANTED_SCOPES', [
      'orders:read',
      'timelines:read',
      'decisions:read',
      'reviews:read',
      'orders:simulate'
    ]),
    allowedOrigins: list('MCP_ALLOWED_ORIGINS'),
    rateLimitPerMinute: integer('MCP_RATE_LIMIT_PER_MINUTE', 30),
    requestBodyLimit: process.env.MCP_REQUEST_BODY_LIMIT || '64kb',
    toolTimeoutMs: integer('MCP_TOOL_TIMEOUT_MS', 10_000),
    maxResponseBytes: integer('MCP_MAX_RESPONSE_BYTES', 51_200),
    publicEndpointEnabled: bool('MCP_PUBLIC_ENDPOINT_ENABLED', false),
    auditMode: process.env.MCP_AUDIT_MODE || 'stderr',
    auditLogPath: process.env.MCP_AUDIT_LOG_PATH || '',
    auditPolicyVersion: process.env.MCP_AUDIT_POLICY_VERSION || '2026-07-28',
    maskingPolicyVersion: process.env.MCP_MASKING_POLICY_VERSION || '2026-07-28',
    supabaseUrl: process.env.SUPABASE_STAGING_URL || '',
    supabaseReaderToken: process.env.SUPABASE_STAGING_READER_TOKEN || '',
    supabaseSchema: process.env.SUPABASE_STAGING_SCHEMA || 'mcp_read',
    supabaseProjectRef: process.env.SUPABASE_STAGING_PROJECT_REF || '',
    expectedStagingProjectRef: process.env.EXPECTED_STAGING_PROJECT_REF || '',
    readOnly: bool('READ_ONLY', true),
    simulationOnly: bool('SIMULATION_ONLY', true),
    productionWritesEnabled: bool('PRODUCTION_WRITES_ENABLED', false),
    actionExecutorEnabled: bool('ACTION_EXECUTOR_ENABLED', false),
    writeToolsEnabled: bool('MCP_WRITE_TOOLS_ENABLED', false),
    openAiApiEnabled: bool('OPENAI_API_ENABLED', false),
    openAiApiAutomationEnabled: bool('OPENAI_API_AUTOMATION_ENABLED', false),
    openAiResponsesApiEnabled: bool('OPENAI_RESPONSES_API_ENABLED', false),
    openAiAssistantsApiEnabled: bool('OPENAI_ASSISTANTS_API_ENABLED', false),
    openAiChatCompletionsEnabled: bool('OPENAI_CHAT_COMPLETIONS_ENABLED', false),
    externalLlmCallsEnabled: bool('EXTERNAL_LLM_CALLS_ENABLED', false),
    localLlmEnabled: bool('LOCAL_LLM_ENABLED', false),
    realDataWriteEnabled: bool('REAL_DATA_WRITE_ENABLED', false),
    connectorWriteEnabled: bool('CONNECTOR_WRITE_ENABLED', false),
    ...overrides
  };

  assertSafetyInvariants(config);
  return Object.freeze(config);
}

export function assertSafetyInvariants(config) {
  const violations = [];
  if (!config.readOnly) violations.push('READ_ONLY must be true');
  if (!config.simulationOnly) violations.push('SIMULATION_ONLY must be true');
  if (config.productionWritesEnabled) violations.push('PRODUCTION_WRITES_ENABLED must be false');
  if (config.actionExecutorEnabled) violations.push('ACTION_EXECUTOR_ENABLED must be false');
  if (config.writeToolsEnabled) violations.push('MCP_WRITE_TOOLS_ENABLED must be false');
  if (config.openAiApiEnabled) violations.push('OPENAI_API_ENABLED must be false');
  if (config.openAiApiAutomationEnabled) violations.push('OPENAI_API_AUTOMATION_ENABLED must be false');
  if (config.openAiResponsesApiEnabled) violations.push('OPENAI_RESPONSES_API_ENABLED must be false');
  if (config.openAiAssistantsApiEnabled) violations.push('OPENAI_ASSISTANTS_API_ENABLED must be false');
  if (config.openAiChatCompletionsEnabled) violations.push('OPENAI_CHAT_COMPLETIONS_ENABLED must be false');
  if (config.externalLlmCallsEnabled) violations.push('EXTERNAL_LLM_CALLS_ENABLED must be false');
  if (config.localLlmEnabled) violations.push('LOCAL_LLM_ENABLED must be false');
  if (config.realDataWriteEnabled) violations.push('REAL_DATA_WRITE_ENABLED must be false');
  if (config.connectorWriteEnabled) violations.push('CONNECTOR_WRITE_ENABLED must be false');
  if (process.env.OPENAI_API_KEY) violations.push('OPENAI_API_KEY must not be present');
  if (config.publicEndpointEnabled && config.authMode !== 'oauth') {
    violations.push('Public MCP endpoints require OAuth');
  }
  if (!['bearer', 'oauth'].includes(config.authMode)) {
    violations.push('MCP_AUTH_MODE must be bearer or oauth');
  }
  if (config.authMode === 'oauth') {
    if (!config.publicEndpointEnabled) violations.push('OAuth mode requires MCP_PUBLIC_ENDPOINT_ENABLED=true');
    if (!config.publicBaseUrl?.startsWith('https://')) violations.push('OAuth mode requires an HTTPS MCP_PUBLIC_BASE_URL');
    if (!config.oauthIssuer?.startsWith('https://')) violations.push('OAuth mode requires an HTTPS MCP_OAUTH_ISSUER');
    if (!config.oauthAudience) violations.push('OAuth mode requires MCP_OAUTH_AUDIENCE');
    if (!config.oauthJwksUrl) violations.push('OAuth mode requires MCP_OAUTH_JWKS_URL');
    if (!config.oauthRequiredRole) violations.push('OAuth mode requires MCP_OAUTH_REQUIRED_ROLE');
  }
  if (config.rateLimitPerMinute < 1 || config.rateLimitPerMinute > 30) {
    violations.push('MCP_RATE_LIMIT_PER_MINUTE must be between 1 and 30');
  }
  if (config.toolTimeoutMs < 100 || config.toolTimeoutMs > 30_000) {
    violations.push('MCP_TOOL_TIMEOUT_MS must be between 100 and 30000');
  }
  if (config.maxResponseBytes < 1_024 || config.maxResponseBytes > 51_200) {
    violations.push('MCP_MAX_RESPONSE_BYTES must be between 1024 and 51200');
  }
  if (!['fixture', 'supabase', 'postgres'].includes(config.dataMode)) violations.push('MCP_DATA_MODE must be fixture, supabase or postgres');
  if (config.environment === 'production' && config.dataMode !== 'postgres') {
    violations.push('Production MCP_DATA_MODE must be postgres');
  }
  if (config.dataMode === 'postgres' && !config.databaseUrl?.startsWith('postgres')) {
    violations.push('Postgres shadow read connection is required');
  }
  if (config.dataMode === 'supabase') {
    if (!config.supabaseUrl || !config.supabaseReaderToken) {
      violations.push('Supabase staging read credentials are required');
    }
    if (!config.expectedStagingProjectRef || config.supabaseProjectRef !== config.expectedStagingProjectRef) {
      violations.push('Supabase project ref must match the approved staging project');
    }
  }
  if (config.authMode === 'bearer' && config.environment === 'production' && config.bearerToken.length < 32) {
    violations.push('MCP_STAGING_BEARER_TOKEN must contain at least 32 characters');
  }
  if (violations.length) {
    throw new Error(`Unsafe MCP configuration: ${violations.join('; ')}`);
  }
}
