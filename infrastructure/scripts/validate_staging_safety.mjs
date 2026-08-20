import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(content, pattern, message) {
  if (!pattern.test(content)) throw new Error(message);
}

function rejectMatch(content, pattern, message) {
  if (pattern.test(content)) throw new Error(message);
}

const compose = read('infrastructure/docker/compose.yaml');
const envExample = read('.env.vps.example');
const schema = read('migrations/002_platform_schema.sql');
const mcpViews = read('migrations/003_mcp_read_views.sql');
const completeness = read('migrations/004_platform_completeness.sql');
const eventStore = read('packages/platform-core/src/event-store.mjs');
const decisionEngine = read('packages/platform-core/src/decision-engine.mjs');
const ingestionPipeline = read('packages/platform-core/src/ingestion-pipeline.mjs');
const actionExecutor = read('services/action-executor.mjs');
const executionGateway = read('packages/platform-core/src/execution-gateway.mjs');
const executionMode = read('packages/platform-core/src/execution-mode.mjs');
const mcpConfig = read('packages/suleia-operations-mcp/src/config.mjs');

const requiredValues = new Map([
  ['APP_ENV', 'staging'],
  ['SULEIA_EXECUTION_MODE', 'READ_ONLY'],
  ['RUN_MODE', 'SHADOW_READ_ONLY'],
  ['SIMULATION_ONLY', 'true'],
  ['PRODUCTION_WRITES_ENABLED', 'false'],
  ['ACTION_EXECUTOR_ENABLED', 'false'],
  ['MCP_WRITE_TOOLS_ENABLED', 'false'],
  ['OPENAI_API_ENABLED', 'false'],
  ['OPENAI_API_AUTOMATION_ENABLED', 'false'],
  ['OPENAI_RESPONSES_API_ENABLED', 'false'],
  ['OPENAI_ASSISTANTS_API_ENABLED', 'false'],
  ['OPENAI_CHAT_COMPLETIONS_ENABLED', 'false'],
  ['EXTERNAL_LLM_CALLS_ENABLED', 'false'],
  ['LOCAL_LLM_ENABLED', 'false'],
  ['REAL_DATA_WRITE_ENABLED', 'false'],
  ['REAL_DATA_READ_ENABLED', 'true'],
  ['CONNECTOR_WRITE_ENABLED', 'false'],
  ['DROPEA_READ_ENABLED', 'true'],
  ['DROPEA_WRITE_ENABLED', 'false'],
  ['DROPEA_MUTATION_CLIENT_ENABLED', 'false'],
  ['CHATBY_READ_ENABLED', 'true'],
  ['CHATBY_WRITE_ENABLED', 'false'],
  ['GLS_WRITE_ENABLED', 'false'],
  ['INCIDENT_INTERPRETATION_ENABLED', 'true'],
  ['INCIDENT_DECISION_ENABLED', 'true'],
  ['INCIDENT_SIMULATION_ENABLED', 'true'],
  ['ISSUE_RESOLUTION_ENABLED', 'false'],
  ['RETURN_EXECUTION_ENABLED', 'false'],
  ['ADDRESS_UPDATE_ENABLED', 'false'],
  ['CUSTOMER_MESSAGES_ENABLED', 'false'],
  ['ORDER_CONFIRMATION_ENABLED', 'false'],
  ['ORDER_CANCELLATION_ENABLED', 'false'],
  ['TEMPLATE_SENDING_ENABLED', 'false'],
  ['DISCOUNT_SENDING_ENABLED', 'false'],
  ['EMAIL_SENDING_ENABLED', 'false'],
  ['EXTERNAL_AI_CALLS_ENABLED', 'false'],
  ['LIVE_WEBHOOKS_ENABLED', 'false'],
  ['LIVE_CRON_ENABLED', 'false'],
  ['LIVE_POLLING_ENABLED', 'false'],
  ['PII_MASKING_ENABLED', 'true'],
  ['AUDIT_LOGGING_ENABLED', 'true']
]);

for (const [name, value] of requiredValues) {
  requireMatch(
    envExample,
    new RegExp(`^${name}=${value}$`, 'm'),
    `.env.vps.example must set ${name}=${value}`
  );
  requireMatch(
    compose,
    new RegExp(`${name}: \\$\\{${name}:-${value}\\}`),
    `compose safety envelope must default ${name} to ${value}`
  );
}

const servicesWithPublishedPorts = [];
let currentService = '';
let insideServices = false;
for (const line of compose.split(/\r?\n/)) {
  if (line === 'services:') {
    insideServices = true;
    continue;
  }
  if (insideServices && /^[a-z]/.test(line)) break;
  const serviceMatch = insideServices ? line.match(/^  ([a-z0-9-]+):$/) : null;
  if (serviceMatch) currentService = serviceMatch[1];
  if (insideServices && /^    ports:$/.test(line)) servicesWithPublishedPorts.push(currentService);
}
if (
  servicesWithPublishedPorts.length !== 2
  || servicesWithPublishedPorts[0] !== 'reverse-proxy'
  || servicesWithPublishedPorts[1] !== 'mcp-edge'
) {
  throw new Error(`Only the private reverse proxy and MCP edge may publish ports; found: ${servicesWithPublishedPorts.join(', ')}`);
}

rejectMatch(
  envExample,
  /^(?:SHOPIFY_ACCESS_TOKEN|DROPEA_ACCESS_TOKEN|CHATBY_TOKEN|GLS_TOKEN)=.+$/m,
  'External connector credentials must remain blank'
);
requireMatch(schema, /CHECK \(actions_executed = 0\)/, 'Database must enforce actions_executed=0');
requireMatch(schema, /CHECK \(run_mode = 'SIMULATION'\)/, 'Database must enforce SIMULATION mode');
requireMatch(schema, /CREATE TRIGGER order_events_immutable/, 'Database must protect immutable order events');
requireMatch(eventStore, /Object\.freeze/, 'Event Store must freeze accepted events');
requireMatch(decisionEngine, /actions_executed:\s*0/, 'Decision engine must return actions_executed=0');
requireMatch(mcpConfig, /MCP_WRITE_TOOLS_ENABLED must be false/, 'MCP must reject write tools');
requireMatch(mcpConfig, /PRODUCTION_WRITES_ENABLED must be false/, 'MCP must reject production writes');
requireMatch(mcpConfig, /OPENAI_API_KEY must not be present/, 'MCP must reject an OpenAI API key');
requireMatch(compose, /MCP_PUBLIC_ENDPOINT_ENABLED: "true"/, 'Public MCP must be explicitly enabled');
requireMatch(compose, /MCP_AUTH_MODE: oauth/, 'Public MCP must use OAuth');
requireMatch(compose, /MCP_OAUTH_REQUIRED_ROLE: mcp_reader/, 'Public MCP must require its private reader role');
requireMatch(
  compose,
  /MCP_OAUTH_JWKS_URL: http:\/\/keycloak:8080\/auth\/realms\/suleia\/protocol\/openid-connect\/certs/,
  'MCP must validate tokens against the internal identity service'
);
requireMatch(compose, /MCP_RATE_LIMIT_PER_MINUTE: 30/, 'MCP must enforce the 30 requests per minute limit');
requireMatch(
  mcpViews,
  /REVOKE ALL ON ALL TABLES IN SCHEMA core, events, decisions, configuration/,
  'MCP role must not retain direct access to internal tables'
);
requireMatch(
  mcpViews,
  /CREATE OR REPLACE VIEW mcp\.orders_read/,
  'MCP role must use allowlisted masked views'
);
requireMatch(
  completeness,
  /ALTER TABLE decisions\.ai_review_queue[\s\S]*actions_executed integer NOT NULL DEFAULT 0 CHECK \(actions_executed = 0\)/,
  'AI review queue must remain simulation-only'
);
requireMatch(
  completeness,
  /ALTER TABLE decisions\.human_review_queue[\s\S]*actions_executed integer NOT NULL DEFAULT 0 CHECK \(actions_executed = 0\)/,
  'Human review queue must remain simulation-only'
);
requireMatch(
  ingestionPipeline,
  /PII masking gate rejected the ingestion record/,
  'Ingestion must fail closed when direct PII remains'
);
requireMatch(
  ingestionPipeline,
  /actions_executed:\s*0/,
  'Ingestion must not execute actions'
);
requireMatch(
  actionExecutor,
  /ACTION_EXECUTOR_ENABLED = false/,
  'Action Executor must remain disabled'
);
requireMatch(
  actionExecutor,
  /ExecutionGateway/,
  'Action Executor must delegate to the Execution Gateway'
);
requireMatch(executionGateway, /PHASE_0_5_EXTERNAL_EXECUTION_DISABLED/, 'Execution Gateway must remain externally disabled');
requireMatch(executionGateway, /canonicalActionIdempotencyKey/, 'Execution Gateway must enforce canonical idempotency');
requireMatch(executionMode, /PRODUCTION_NOT_IMPLEMENTED/, 'Canonical PRODUCTION mode must remain unavailable');

const shadowService = compose.split('ingestion-worker:')[1]?.split('\n  scheduler:')[0] || '';
rejectMatch(shadowService, /SUPABASE_SERVICE_ROLE_KEY/, 'Shadow worker must not receive Supabase service-role');
requireMatch(shadowService, /SUPABASE_PUBLISHABLE_KEY/, 'Shadow worker requires a separate publishable API key');
requireMatch(shadowService, /SUPABASE_SHADOW_READER_TOKEN/, 'Shadow worker requires a dedicated reader bearer');
rejectMatch(envExample, /^SUPABASE_SERVICE_ROLE_KEY=/m, 'Shadow env template must not contain Supabase service-role');

const forbiddenImports = [];
for (const relativeDirectory of ['apps', 'services', 'packages/platform-core', 'packages/suleia-operations-mcp/src']) {
  const directory = path.join(root, relativeDirectory);
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (!entry.isFile() || !/\.(?:mjs|js)$/.test(entry.name)) continue;
      const source = fs.readFileSync(fullPath, 'utf8');
      if (/autoconfirm[\\/]src[\\/]clients/.test(source)) {
        forbiddenImports.push(path.relative(root, fullPath));
      }
    }
  }
}
if (forbiddenImports.length) {
  throw new Error(`Staging code imports production clients: ${forbiddenImports.join(', ')}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  environment: 'staging',
  run_mode: 'SHADOW_READ_ONLY',
  actions_executed: 0,
  published_services: servicesWithPublishedPorts,
  production_clients_imported: 0
}, null, 2));
process.stdout.write('\n');
