import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { businessDayBounds, isWithinBusinessDay } from '../packages/platform-core/src/business-day.mjs';
import { containsDirectPii } from '../packages/platform-core/src/masking.mjs';
import { runTodayBatch } from '../packages/platform-core/src/today-batch.mjs';
import {
  POST_ONLY_SOURCE_STATUS,
  readChatbySignals,
  readCurrentSystemDashboard,
  readShopifyOrdersToday
} from './today-readonly-connectors.mjs';

const REQUIRED_FLAGS = Object.freeze({
  APP_ENV: 'staging',
  RUN_MODE: 'SIMULATION',
  SIMULATION_ONLY: 'true',
  PRODUCTION_WRITES_ENABLED: 'false',
  ACTION_EXECUTOR_ENABLED: 'false',
  MCP_WRITE_TOOLS_ENABLED: 'false',
  OPENAI_API_ENABLED: 'false',
  OPENAI_API_AUTOMATION_ENABLED: 'false',
  EXTERNAL_LLM_CALLS_ENABLED: 'false',
  LIVE_WEBHOOKS_ENABLED: 'false',
  LIVE_CRON_ENABLED: 'false',
  LIVE_POLLING_ENABLED: 'false',
  PII_MASKING_ENABLED: 'true',
  AUDIT_LOGGING_ENABLED: 'true',
  REAL_DATA_READ_ENABLED: 'true',
  REAL_DATA_WRITE_ENABLED: 'false',
  MASK_BEFORE_PERSISTENCE: 'true',
  RAW_REAL_PAYLOAD_PERSISTENCE: 'false',
  CONNECTOR_READ_ONLY_ENFORCED: 'true',
  STAGING_PUBLIC_ACCESS_ENABLED: 'false',
  TODAY_BATCH_SIMULATION_ENABLED: 'true',
  BUSINESS_TIMEZONE: 'Europe/Madrid',
  ORDER_DATE_FIELD: 'created_at',
  ORDER_BATCH_SCOPE: 'TODAY',
  ORDER_IMPORT_LIMIT: 'UNLIMITED_WITHIN_DATE_RANGE'
});

export function assertTodayBatchEnvironment(env) {
  const violations = [];
  for (const [key, expected] of Object.entries(REQUIRED_FLAGS)) {
    if (String(env[key] ?? '') !== expected) violations.push(`${key} must equal ${expected}`);
  }
  if (env.OPENAI_API_KEY) violations.push('OPENAI_API_KEY must not be present');
  if (violations.length) throw new Error(`Unsafe today-batch environment: ${violations.join('; ')}`);
}

function mergeCurrentSemantics(orders, currentOrders) {
  return orders.map((order) => {
    const references = new Set((order.identity_references || []).map(String));
    const matches = currentOrders.filter((current) => (
      (current.identity_references || []).some((reference) => references.has(String(reference)))
    ));
    if (matches.length !== 1) return { ...order, identity_mismatch: matches.length > 1 };
    const current = matches[0];
    return {
      ...order,
      incident_present: current.incident_present,
      tracking_present: order.tracking_present || current.tracking_present,
      logistics_state: current.logistics_state
    };
  });
}

function safeSourceStatus(shopify, chatby, currentSystem) {
  return {
    shopify,
    chatby,
    dropea: POST_ONLY_SOURCE_STATUS.dropea,
    gls: POST_ONLY_SOURCE_STATUS.gls,
    current_system: currentSystem
  };
}

export function buildPreflight({ env = process.env, now = new Date() } = {}) {
  assertTodayBatchEnvironment(env);
  const bounds = businessDayBounds({
    businessDate: env.BUSINESS_DATE || null,
    now,
    timeZone: env.BUSINESS_TIMEZONE
  });
  return {
    ok: true,
    batch_type: 'TODAY_REAL_MASKED_SIMULATION',
    business_date: bounds.business_date,
    timezone: bounds.time_zone,
    local_start: bounds.local_start,
    local_end_exclusive: bounds.local_end_exclusive,
    utc_start: bounds.utc_start,
    utc_end_exclusive: bounds.utc_end_exclusive,
    order_date_field: 'created_at',
    write_methods_blocked: ['POST', 'PUT', 'PATCH', 'DELETE'],
    source_capabilities: {
      shopify: 'GET_ONLY_IF_ADMIN_ACCESS_TOKEN_PRESENT',
      chatby: 'GET_ONLY',
      dropea: 'BLOCKED_DIRECT_READ_REQUIRES_POST',
      gls: 'BLOCKED_DIRECT_READ_REQUIRES_POST',
      current_system: 'GET_ONLY_NON_AUTHORITATIVE_CACHE'
    },
    shopify_credential_bootstrap: env.SHOPIFY_CREDENTIAL_BOOTSTRAP || 'PREEXISTING_ACCESS_TOKEN',
    raw_payload_persistence: false,
    masking_before_persistence: true,
    actions_executed: 0,
    pii_persisted_count: 0
  };
}

export async function executeTodayBatch({
  mode = 'preview',
  env = process.env,
  now = new Date(),
  fetchImpl = globalThis.fetch
} = {}) {
  const preflight = buildPreflight({ env, now });
  if (mode === 'preflight') return preflight;
  if (!['preview', 'execute'].includes(mode)) throw new Error('Mode must be preflight, preview or execute');

  const bounds = businessDayBounds({
    businessDate: env.BUSINESS_DATE || null,
    now,
    timeZone: env.BUSINESS_TIMEZONE
  });
  const cpuStart = process.cpuUsage();
  const memoryStart = process.memoryUsage().rss;
  const shopify = await readShopifyOrdersToday({
    domain: env.SHOPIFY_DOMAIN || env.SHOPIFY_SHOP,
    token: env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: env.SHOPIFY_API_VERSION || '2026-04',
    bounds,
    maxPages: Number(env.MAX_PAGES_PER_SOURCE || 200),
    maxRuntimeMs: Number(env.MAX_BATCH_RUNTIME || 600_000),
    fetchImpl
  });
  if (!shopify.status.complete) {
    return {
      ...preflight,
      status: 'ABORTED',
      abort_reason: shopify.status.error || 'SHOPIFY_PAGINATION_INCOMPLETE',
      source_status: safeSourceStatus(
        shopify.status,
        { consultable: Boolean(env.CHATBY_TOKEN), complete: false, error: 'NOT_QUERIED_AFTER_SHOPIFY_ABORT', page_count: 0 },
        { consultable: Boolean(env.DASHBOARD_SESSION_SECRET), complete: false, error: 'NOT_QUERIED_AFTER_SHOPIFY_ABORT', page_count: 0 }
      ),
      actions_executed: 0,
      pii_persisted_count: 0
    };
  }
  const outside = shopify.orders.filter((order) => !isWithinBusinessDay(order.created_at, bounds));
  if (outside.length) throw new Error('Shopify returned orders outside the exact business-day interval');

  const [currentSystem, chatby] = await Promise.all([
    readCurrentSystemDashboard({
      baseUrl: env.CURRENT_SYSTEM_BASE_URL || 'https://suleia-autoconfirm.onrender.com',
      sessionSecret: env.DASHBOARD_SESSION_SECRET,
      fetchImpl
    }),
    readChatbySignals({
      baseUrl: env.CHATBY_BASE_URL || 'https://app.chatby.io/api',
      token: env.CHATBY_TOKEN,
      orders: shopify.orders,
      maxPages: Number(env.MAX_PAGES_PER_SOURCE || 200),
      fetchImpl
    })
  ]);
  const orders = mergeCurrentSemantics(chatby.orders, currentSystem.orders);
  const sourceStatus = safeSourceStatus(shopify.status, chatby.status, currentSystem.status);
  const report = runTodayBatch({
    sourceOrders: orders,
    currentSystemOrders: currentSystem.orders,
    bounds,
    sourceStatus,
    now,
    preview: mode === 'preview'
  });
  const cpu = process.cpuUsage(cpuStart);
  const resources = {
    cpu_user_ms: Math.round(cpu.user / 1000),
    cpu_system_ms: Math.round(cpu.system / 1000),
    rss_start_bytes: memoryStart,
    rss_end_bytes: process.memoryUsage().rss
  };
  if (mode === 'preview') return { ...report, resource_usage: resources };

  report.batch.resource_usage = resources;
  if (containsDirectPii(report)) throw new Error('Final report contains direct PII');
  const output = env.TODAY_BATCH_OUTPUT;
  if (!output) throw new Error('TODAY_BATCH_OUTPUT is required for execute mode');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(output, 0o600).catch(() => {});
  return {
    batch: report.batch,
    output_written: true,
    output_contains_masked_data_only: true,
    actions_executed: 0,
    pii_persisted_count: 0
  };
}

async function main() {
  const modeArg = process.argv.find((argument) => argument.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'preflight';
  const result = await executeTodayBatch({ mode });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error_code: error?.code || 'TODAY_BATCH_FAILED',
      error: String(error?.message || error).replace(/https?:\/\/\S+/g, '[URL REDACTED]'),
      actions_executed: 0,
      pii_persisted_count: 0
    })}\n`);
    process.exitCode = 1;
  });
}

export { REQUIRED_FLAGS };
