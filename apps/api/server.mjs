import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { OperationsRepository } from '../../packages/suleia-operations-mcp/src/operations/repository.mjs';
import { createOperationsAuth, OperationsAuthError } from '../../packages/suleia-operations-mcp/src/operations/auth.mjs';

function envBool(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : value === 'true';
}

export function loadOperationsConfig(overrides = {}) {
  const config = {
    port: Number(process.env.PORT || 3200),
    runMode: process.env.RUN_MODE || 'SIMULATION',
    simulationOnly: envBool('SIMULATION_ONLY', true),
    productionWritesEnabled: envBool('PRODUCTION_WRITES_ENABLED', false),
    actionExecutorEnabled: envBool('ACTION_EXECUTOR_ENABLED', false),
    databaseUrl: process.env.OPERATIONS_DATABASE_URL || '',
    oauthIssuer: process.env.OPERATIONS_OAUTH_ISSUER || '',
    oauthAudience: process.env.OPERATIONS_OAUTH_AUDIENCE || 'suleia-operations-center',
    oauthJwksUrl: process.env.OPERATIONS_OAUTH_JWKS_URL || '',
    oauthRequiredRole: process.env.OPERATIONS_OAUTH_REQUIRED_ROLE || 'operations_reader',
    oauthClientId: process.env.OPERATIONS_OAUTH_CLIENT_ID || 'suleia-operations-center',
    rateLimitPerMinute: Number(process.env.OPERATIONS_RATE_LIMIT_PER_MINUTE || 60),
    privateDataKey: process.env.OPERATIONS_PRIVATE_DATA_KEY || '',
    ...overrides
  };
  const violations = [];
  if (!['SIMULATION', 'SHADOW_READ_ONLY'].includes(config.runMode)) violations.push('unsafe run mode');
  if (!config.simulationOnly) violations.push('simulation-only must remain enabled');
  if (config.productionWritesEnabled || config.actionExecutorEnabled) violations.push('write/action execution is forbidden');
  if (!config.databaseUrl) violations.push('read-only database URL is required');
  if (typeof config.privateDataKey !== 'string' || config.privateDataKey.length < 32) violations.push('private display key is required');
  if (config.rateLimitPerMinute < 1 || config.rateLimitPerMinute > 120) violations.push('invalid rate limit');
  if (violations.length) throw new Error(`Unsafe Operations API configuration: ${violations.join('; ')}`);
  return Object.freeze(config);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.end(body);
}

function limiter(limit) {
  const windows = new Map();
  return (req) => {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.started >= 60_000) {
      windows.set(key, { started: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

async function jsonBody(req, maxBytes = 2048) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

export function createOperationsServer({ config, repository, authenticate, audit = () => {} }) {
  const allowRequest = limiter(config.rateLimitPerMinute);
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://operations.internal');
    const feedbackMatch = requestUrl.pathname.match(/^\/api\/operations\/incidents\/([^/]+)\/feedback$/);
    const fixedExpenseCreate = requestUrl.pathname === '/api/operations/finance/fixed-expenses';
    const fixedExpenseUpdate = requestUrl.pathname.match(/^\/api\/operations\/finance\/fixed-expenses\/([^/]+)$/);
    const internalWrite = (req.method === 'POST' && (feedbackMatch || fixedExpenseCreate)) || (req.method === 'PATCH' && fixedExpenseUpdate);
    if (req.method !== 'GET' && !internalWrite) return json(res, 405, { ok: false, error: 'method_not_allowed' });
    if (!allowRequest(req)) return json(res, 429, { ok: false, error: 'rate_limited' });
    if (requestUrl.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'suleia-operations-api', run_mode: config.runMode, actions_executed: 0, production_writes: 0 });
    }
    if (requestUrl.pathname === '/version') {
      return json(res, 200, {
        revision: process.env.SULEIA_BUILD_REVISION || 'UNKNOWN',
        source: process.env.SULEIA_BUILD_SOURCE || 'UNKNOWN',
        created: process.env.SULEIA_BUILD_CREATED || 'UNKNOWN',
        version: process.env.SULEIA_BUILD_VERSION || 'UNKNOWN',
        branch: process.env.SULEIA_BUILD_BRANCH || 'UNKNOWN',
        run_mode: config.runMode,
        actions_executed: 0,
        production_writes: 0
      });
    }
    if (requestUrl.pathname === '/api/config') {
      return json(res, 200, {
        oauth: { issuer: config.oauthIssuer, client_id: config.oauthClientId, audience: config.oauthAudience, scope: 'openid operations:read' },
        refresh_interval_seconds: 45,
        run_mode: 'SHADOW_READ_ONLY'
      });
    }
    let principal;
    try {
      principal = await authenticate(req);
    } catch (error) {
      const status = error instanceof OperationsAuthError ? error.status : 401;
      audit({ event: 'operations_auth_blocked', status, code: error.code || 'UNAUTHORIZED' });
      return json(res, status, { ok: false, error: status === 403 ? 'insufficient_scope' : 'unauthorized' });
    }
    try {
      let data;
      if ((req.method === 'POST' && fixedExpenseCreate) || (req.method === 'PATCH' && fixedExpenseUpdate)) {
        const body = await jsonBody(req, 4096);
        data = await repository.saveFixedExpense(fixedExpenseUpdate ? decodeURIComponent(fixedExpenseUpdate[1]) : null, body, principal.principal_hash);
        if (data === null) return json(res, 404, { ok: false, error: 'not_found' });
        audit({ event: 'finance_fixed_expense_saved', principal_hash: principal.principal_hash,
          expense_id: data.expense_id, outcome: fixedExpenseUpdate ? 'updated' : 'created', external_actions: 0 });
        return json(res, fixedExpenseUpdate ? 200 : 201, { ok: true, data, actions_executed: 0,
          production_writes: 0, external_writes: 0, internal_configuration_writes: 1 });
      } else if (req.method === 'POST' && feedbackMatch) {
        const body = await jsonBody(req);
        data = await repository.recordIncidentFeedback(decodeURIComponent(feedbackMatch[1]), {
          feedbackType: body.feedback_type,
          reasonCode: body.reason_code,
          recommendationCode: body.recommendation_code,
          principalHash: principal.principal_hash
        });
        if (data === null) return json(res, 404, { ok: false, error: 'not_found' });
        audit({ event: 'incident_recommendation_feedback', principal_hash: principal.principal_hash, path: requestUrl.pathname, outcome: 'recorded' });
        return json(res, 201, { ok: true, data, actions_executed: 0, production_writes: 0, internal_feedback_writes: 1 });
      } else if (requestUrl.pathname === '/api/operations/summary') data = await repository.summary(requestUrl.searchParams);
      else if (requestUrl.pathname === '/api/operations/finance') data = await repository.financialSummary(requestUrl.searchParams);
      else if (requestUrl.pathname === '/api/operations/orders') data = await repository.listOrders(requestUrl.searchParams);
      else if (/^\/api\/operations\/orders\/[^/]+$/.test(requestUrl.pathname)) data = await repository.orderDetail(decodeURIComponent(requestUrl.pathname.split('/').at(-1)));
      else if (requestUrl.pathname === '/api/operations/incidents') data = await repository.listIncidents(requestUrl.searchParams);
      else if (requestUrl.pathname === '/api/operations/incidents/overview') data = await repository.incidentOverview(requestUrl.searchParams);
      else if (/^\/api\/operations\/incidents\/[^/]+$/.test(requestUrl.pathname)) data = await repository.incidentDetail(decodeURIComponent(requestUrl.pathname.split('/').at(-1)));
      else return json(res, 404, { ok: false, error: 'not_found' });
      if (data === null) return json(res, 404, { ok: false, error: 'not_found' });
      audit({ event: 'operations_read', principal_hash: principal.principal_hash, path: requestUrl.pathname, outcome: 'ok' });
      return json(res, 200, { ok: true, data, actions_executed: 0, production_writes: 0 });
    } catch (error) {
      if (error?.status === 400 || error?.status === 413 || error?.code === 'INVALID_FEEDBACK' || error?.code === 'INVALID_FIXED_EXPENSE') {
        return json(res, error.status || 400, { ok: false, error: error.message || 'invalid_feedback' });
      }
      audit({ event: 'operations_read_failed', principal_hash: principal.principal_hash, path: requestUrl.pathname, outcome: 'error' });
      return json(res, 503, { ok: false, error: 'read_temporarily_unavailable' });
    }
  });
}

export async function startOperationsServer() {
  const config = loadOperationsConfig();
  const repository = await OperationsRepository.connect(config.databaseUrl, { privateDataKey: config.privateDataKey });
  const authenticate = createOperationsAuth({
    issuer: config.oauthIssuer,
    audience: config.oauthAudience,
    jwksUrl: config.oauthJwksUrl,
    requiredRole: config.oauthRequiredRole
  });
  const server = createOperationsServer({
    config,
    repository,
    authenticate,
    audit: (event) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
  });
  server.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', async () => { server.close(); await repository.close(); });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await startOperationsServer();
