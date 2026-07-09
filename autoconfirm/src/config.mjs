import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, readJson, writeJson, ensureDir } from './lib/files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

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

function csv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
    autoPollEnabled: bool(process.env.AUTO_POLL_ENABLED, true),
    autoPollIntervalMinutes: int(process.env.AUTO_POLL_INTERVAL_MINUTES, 5),
    delayedConfirmRealEnabled: bool(process.env.DELAYED_CONFIRM_REAL_ENABLED, false),
    confirmationDelayHours: Number(process.env.CONFIRMATION_DELAY_HOURS ?? 1) || 1,
    unansweredCancelAfterHours: int(process.env.UNANSWERED_CANCEL_AFTER_HOURS, 36),
    unansweredRejectRealEnabled: bool(process.env.UNANSWERED_REJECT_REAL_ENABLED, true),
    unansweredCancellationIntervalMinutes: int(process.env.UNANSWERED_CANCELLATION_INTERVAL_MINUTES, 300),
    incidentsSyncIntervalMinutes: int(process.env.INCIDENTS_SYNC_INTERVAL_MINUTES, 240),
    operationalDashboardIntervalMinutes: int(process.env.OPERATIONAL_DASHBOARD_INTERVAL_MINUTES, 240),
    confidenceThreshold: int(process.env.CONFIDENCE_THRESHOLD, 90),
    cooldownHours: int(process.env.COOLDOWN_HOURS, 1),
    activationCutoff: process.env.ACTIVATION_CUTOFF || null
  };
}

function withEnvOverrides(store) {
  const envStore = defaultStoreFromEnv();
  return {
    ...store,
    webhookToken: process.env.WEBHOOK_TOKEN || store.webhookToken || envStore.webhookToken,
    googleSheetName: process.env.GOOGLE_SHEET_NAME || store.googleSheetName || envStore.googleSheetName,
    shopifyDomain: process.env.SHOPIFY_DOMAIN || store.shopifyDomain || envStore.shopifyDomain,
    agentEnabled: bool(process.env.AGENT_ENABLED, store.agentEnabled ?? envStore.agentEnabled),
    agentDryRun: bool(process.env.AGENT_DRY_RUN, store.agentDryRun ?? envStore.agentDryRun),
    autoPollEnabled: bool(process.env.AUTO_POLL_ENABLED, store.autoPollEnabled ?? envStore.autoPollEnabled),
    autoPollIntervalMinutes: int(process.env.AUTO_POLL_INTERVAL_MINUTES, store.autoPollIntervalMinutes ?? envStore.autoPollIntervalMinutes),
    delayedConfirmRealEnabled: bool(process.env.DELAYED_CONFIRM_REAL_ENABLED, store.delayedConfirmRealEnabled ?? envStore.delayedConfirmRealEnabled),
    confirmationDelayHours: Number(process.env.CONFIRMATION_DELAY_HOURS ?? store.confirmationDelayHours ?? envStore.confirmationDelayHours ?? 1) || 1,
    unansweredCancelAfterHours: int(process.env.UNANSWERED_CANCEL_AFTER_HOURS, store.unansweredCancelAfterHours ?? envStore.unansweredCancelAfterHours),
    unansweredRejectRealEnabled: bool(process.env.UNANSWERED_REJECT_REAL_ENABLED, store.unansweredRejectRealEnabled ?? envStore.unansweredRejectRealEnabled),
    unansweredCancellationIntervalMinutes: int(process.env.UNANSWERED_CANCELLATION_INTERVAL_MINUTES, store.unansweredCancellationIntervalMinutes ?? envStore.unansweredCancellationIntervalMinutes),
    incidentsSyncIntervalMinutes: int(process.env.INCIDENTS_SYNC_INTERVAL_MINUTES, store.incidentsSyncIntervalMinutes ?? envStore.incidentsSyncIntervalMinutes),
    operationalDashboardIntervalMinutes: int(process.env.OPERATIONAL_DASHBOARD_INTERVAL_MINUTES, store.operationalDashboardIntervalMinutes ?? envStore.operationalDashboardIntervalMinutes),
    confidenceThreshold: int(process.env.CONFIDENCE_THRESHOLD, store.confidenceThreshold ?? envStore.confidenceThreshold),
    cooldownHours: int(process.env.COOLDOWN_HOURS, store.cooldownHours ?? envStore.cooldownHours),
    activationCutoff: process.env.ACTIVATION_CUTOFF || store.activationCutoff || envStore.activationCutoff
  };
}

export function resolvePaths() {
  const dataDir = path.join(root, 'data');
  ensureDir(dataDir);
  return {
    root,
    dataDir,
    storesPath: path.resolve(root, process.env.STORE_CONFIG_PATH || 'data/stores.json'),
    statePath: path.resolve(root, process.env.STATE_PATH || 'data/state.json'),
    webhookEventsPath: path.resolve(root, process.env.WEBHOOK_EVENTS_PATH || 'data/webhook-events.json'),
    ordersPath: path.resolve(root, process.env.ORDERS_PATH || 'data/orders.json')
  };
}

export function loadStoreConfigs() {
  const paths = resolvePaths();
  if (process.env.STORE_CONFIG_PATH && readJson(paths.storesPath, null)) {
    const loaded = readJson(paths.storesPath, []);
    return (Array.isArray(loaded) ? loaded : [loaded]).map(withEnvOverrides);
  }

  if (readJson(paths.storesPath, null)) {
    const loaded = readJson(paths.storesPath, []);
    return (Array.isArray(loaded) ? loaded : [loaded]).map(withEnvOverrides);
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
    openaiAssistantId: process.env.OPENAI_ASSISTANT_ID || null,
    openaiAssistantEnabled: bool(process.env.OPENAI_ASSISTANT_ENABLED, Boolean(process.env.OPENAI_ASSISTANT_ID)),
    dropeaApiKey: process.env.DROPEA_API_KEY || null,
    chatbyToken: process.env.CHATBY_TOKEN || null,
    chatbyBaseUrl: process.env.CHATBY_BASE_URL || 'https://app.chatby.io/api',
    whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || null,
    whatsappProvider: process.env.WHATSAPP_PROVIDER || 'meta',
    metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || null,
    metaWhatsappLanguage: process.env.META_WHATSAPP_LANGUAGE || 'es_ES',
    shopifyDomain: process.env.SHOPIFY_DOMAIN || process.env.SHOPIFY_SHOP || null,
    shopifyClientId: process.env.SHOPIFY_CLIENT_ID || null,
    shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET || null,
    shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || null,
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
    googleSheetsEnabled: bool(process.env.GOOGLE_SHEETS_ENABLED, false),
    googleSheetsLegacyReadEnabled: bool(process.env.GOOGLE_SHEETS_LEGACY_READ_ENABLED, Boolean(process.env.GOOGLE_SHEET_ID)),
    googleSheetId: process.env.GOOGLE_SHEET_ID || null,
    googleSheetName: process.env.GOOGLE_SHEET_NAME || 'Pedidos',
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
    googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || null,
    metaAccessToken: process.env.META_ACCESS_TOKEN || null,
    metaBusinessId: process.env.META_BUSINESS_ID || null,
    metaAdAccountId: process.env.META_AD_ACCOUNT_ID || process.env.META_ACT_ID || null,
    metaApiVersion: process.env.META_API_VERSION || 'v25.0',
    metaDashboardEnabled: bool(process.env.META_DASHBOARD_ENABLED, Boolean(process.env.META_ACCESS_TOKEN && (process.env.META_AD_ACCOUNT_ID || process.env.META_ACT_ID))),
    metaDashboardIntervalMinutes: int(process.env.META_DASHBOARD_INTERVAL_MINUTES, 720),
    metaDashboardLookbackDays: int(process.env.META_DASHBOARD_LOOKBACK_DAYS, 30),
    metaDashboardSheetPrefix: process.env.META_DASHBOARD_SHEET_PREFIX || 'Meta',
    metaAttributionFields: csv(process.env.META_ATTRIBUTION_FIELDS || 'utm_campaign,campaign_id,fb_campaign_id,campaign_name,meta_campaign_id'),
    defaultStore: primaryStore,
    stores
  };
}
