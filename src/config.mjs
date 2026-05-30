import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, readJson, writeJson, ensureDir } from './lib/files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

loadEnvFile(path.join(root, '.env'));

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function defaultStoreFromEnv() {
  const webhookToken = process.env.WEBHOOK_TOKEN || randomToken();
  return {
    id: 'suleia',
    name: process.env.STORE_NAME || 'Suleia',
    webhookToken,
    googleSheetName: process.env.GOOGLE_SHEET_NAME || 'Pedidos',
    shopifyDomain: process.env.SHOPIFY_DOMAIN || null,
    agentEnabled: bool(process.env.AGENT_ENABLED, false),
    agentDryRun: bool(process.env.AGENT_DRY_RUN, true),
    confidenceThreshold: int(process.env.CONFIDENCE_THRESHOLD, 90),
    cooldownHours: int(process.env.COOLDOWN_HOURS, 1),
    activationCutoff: process.env.ACTIVATION_CUTOFF || null
  };
}

export function resolvePaths() {
  const dataDir = path.join(root, 'autoconfirm', 'data');
  ensureDir(dataDir);
  return {
    root,
    dataDir,
    storesPath: path.resolve(root, process.env.STORE_CONFIG_PATH || 'autoconfirm/data/stores.json'),
    statePath: path.resolve(root, process.env.STATE_PATH || 'autoconfirm/data/state.json'),
    webhookEventsPath: path.resolve(root, process.env.WEBHOOK_EVENTS_PATH || 'autoconfirm/data/webhook-events.json'),
    ordersPath: path.resolve(root, process.env.ORDERS_PATH || 'autoconfirm/data/orders.json')
  };
}

export function loadStoreConfigs() {
  const paths = resolvePaths();
  if (process.env.STORE_CONFIG_PATH && readJson(paths.storesPath, null)) {
    const loaded = readJson(paths.storesPath, []);
    return Array.isArray(loaded) ? loaded : [loaded];
  }

  if (readJson(paths.storesPath, null)) {
    const loaded = readJson(paths.storesPath, []);
    return Array.isArray(loaded) ? loaded : [loaded];
  }

  const store = defaultStoreFromEnv();
  writeJson(paths.storesPath, [store]);
  return [store];
}

export function getAppConfig() {
  const paths = resolvePaths();
  const stores = loadStoreConfigs();
  const primaryStore = stores[0] || defaultStoreFromEnv();

  return {
    ...paths,
    port: int(process.env.PORT, 8787),
    cronSecret: process.env.CRON_SECRET || null,
    timezone: process.env.AUTOCONFIRM_TIMEZONE || 'Europe/Madrid',
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    dropeaApiKey: process.env.DROPEA_API_KEY || null,
    chatbyToken: process.env.CHATBY_TOKEN || null,
    chatbyBaseUrl: process.env.CHATBY_BASE_URL || 'https://app.chatby.io/api',
    whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || null,
    shopifyDomain: process.env.SHOPIFY_DOMAIN || null,
    shopifyClientId: process.env.SHOPIFY_CLIENT_ID || null,
    shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET || null,
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
    googleSheetId: process.env.GOOGLE_SHEET_ID || null,
    googleSheetName: process.env.GOOGLE_SHEET_NAME || 'Pedidos',
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
    googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || null,
    defaultStore: primaryStore,
    stores
  };
}
