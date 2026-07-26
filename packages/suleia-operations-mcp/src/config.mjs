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
    authMode: process.env.MCP_AUTH_MODE || 'bearer',
    bearerToken: process.env.MCP_STAGING_BEARER_TOKEN || '',
    grantedScopes: list('MCP_GRANTED_SCOPES', ['orders:read', 'orders:simulate']),
    allowedOrigins: list('MCP_ALLOWED_ORIGINS'),
    rateLimitPerMinute: integer('MCP_RATE_LIMIT_PER_MINUTE', 60),
    auditMode: process.env.MCP_AUDIT_MODE || 'stderr',
    auditLogPath: process.env.MCP_AUDIT_LOG_PATH || '',
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
  if (!['fixture', 'supabase'].includes(config.dataMode)) violations.push('MCP_DATA_MODE must be fixture or supabase');
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
