import http from 'node:http';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getAppConfig } from './src/config.mjs';
import { findOrder, listOrders, loadState, saveState, upsertOrder } from './src/storage.mjs';
import { cancelDropeaOrder, getDropeaOrderById } from './src/clients/dropea.mjs';
import { getDropeaV2OrderActionReadiness } from './src/clients/dropea-v2-order-actions.mjs';
import {
  backfillTodayMissingInitialTemplates,
  backfillMissingPreparedTemplates,
  ingestPendingOrders,
  reconcileCriticalOrderTemplates,
  runAutoConfirm,
  handleDropeaWebhook,
  handleShopifyWebhook,
  runStoreAutomationCycle
} from './src/workflows/orders.mjs';
import { syncMetaDashboard } from './src/workflows/analytics.mjs';
import { runUnansweredCancellationSweep } from './src/workflows/unanswered-cancellations.mjs';
import { syncPendingIncidents } from './src/workflows/incidents.mjs';
import { syncOperationalOrders } from './src/workflows/operational-orders.mjs';
import { buildDashboard, requestBusinessManagerReport, saveAgentChat, saveAgentFeedback, saveFinanceSettings, saveIncidentFeedback } from './src/dashboard.mjs';
import { getTelegramMe, setTelegramWebhook } from './src/clients/telegram.mjs';
import { checkChatbyConnection } from './src/clients/chatby.mjs';
import { handleTelegramUpdate } from './src/workflows/telegram-agent.mjs';
import { backfillSupabaseFromLocal, ensureCoreAgentMemory, getSupabaseMirrorStatus, hydrateLocalStateFromSupabase, testSupabaseConnection } from './src/db/supabase-store.mjs';
import { createScheduledJobQueue } from './src/scheduled-job-queue.mjs';
import {
  previewIncidentDiscountTest,
  sendAuthorizedIncidentDiscountTest
} from './src/workflows/incident-discount-service.mjs';

const config = getAppConfig();
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.join(__dirname, 'dashboard');
const dashboardDirs = [...new Set([
  dashboardDir,
  path.resolve(process.cwd(), 'autoconfirm', 'dashboard'),
  path.resolve(process.cwd(), 'dashboard')
])];
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardSessionSecret = process.env.DASHBOARD_SESSION_SECRET || process.env.CRON_SECRET || 'suleia-dashboard-dev-secret';
const chatbyHealth = {
  provider: String(config.whatsappProvider || 'chatby').toLowerCase(),
  configured: Boolean(config.chatbyToken),
  ready: false,
  status: config.chatbyToken ? 'pending' : 'missing_credential',
  checkedAt: null,
  error: config.chatbyToken ? null : 'CHATBY_TOKEN is not configured'
};

async function refreshChatbyHealth() {
  chatbyHealth.provider = String(config.whatsappProvider || 'chatby').toLowerCase();
  chatbyHealth.configured = Boolean(config.chatbyToken);
  chatbyHealth.checkedAt = new Date().toISOString();

  if (!config.chatbyToken) {
    chatbyHealth.ready = false;
    chatbyHealth.status = 'missing_credential';
    chatbyHealth.error = 'CHATBY_TOKEN is not configured';
    return chatbyHealth;
  }

  try {
    await checkChatbyConnection();
    chatbyHealth.ready = true;
    chatbyHealth.status = 'connected';
    chatbyHealth.error = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    chatbyHealth.ready = false;
    chatbyHealth.status = /429|too many requests/i.test(message) ? 'rate_limited' : 'unavailable';
    chatbyHealth.error = message.slice(0, 300);
  }
  return chatbyHealth;
}

const staticTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function webhookLooksLikeIncident(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return text.includes('incidence_code')
    || text.includes('incidence')
    || text.includes('incidencia')
    || text.includes('"issues"');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        if (index < 0) return [item, ''];
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function signSession(value) {
  return crypto.createHmac('sha256', dashboardSessionSecret).update(value).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionCookie(req) {
  const value = `suleia:${Date.now()}`;
  const signed = `${value}.${signSession(value)}`;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `suleia_dashboard=${encodeURIComponent(signed)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 12}${secure}`;
}

function isDashboardAuthenticated(req) {
  if (!dashboardPassword) return false;
  const cookie = parseCookies(req).suleia_dashboard;
  if (!cookie || !cookie.includes('.')) return false;
  const index = cookie.lastIndexOf('.');
  const value = cookie.slice(0, index);
  const signature = cookie.slice(index + 1);
  return safeEqual(signature, signSession(value));
}

function sendDashboardLogin(res, message = '') {
  const body = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Suleia Dashboard Login</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#f6efe3,#d9f5ec);font-family:Georgia,"Times New Roman",serif;color:#17212b}
      form{width:min(420px,calc(100vw - 32px));padding:34px;border:1px solid rgba(23,33,43,.12);border-radius:30px;background:rgba(255,253,248,.88);box-shadow:0 24px 80px rgba(38,57,75,.16)}
      h1{margin:0 0 10px;font-size:44px;letter-spacing:-.05em}
      p{color:#65727f;line-height:1.5}
      label{display:grid;gap:8px;margin:22px 0 16px;font-family:"Trebuchet MS",Verdana,sans-serif;font-weight:900;color:#65727f}
      input{border:1px solid rgba(23,33,43,.16);border-radius:16px;padding:14px;font:inherit}
      button{width:100%;border:0;border-radius:16px;padding:14px 18px;color:white;background:#0d8b8f;font-family:"Trebuchet MS",Verdana,sans-serif;font-weight:900;cursor:pointer}
      .error{padding:12px 14px;border-radius:14px;color:#9c3525;background:rgba(232,109,87,.14);font-family:"Trebuchet MS",Verdana,sans-serif;font-weight:900}
    </style>
  </head>
  <body>
    <form method="post" action="/api/dashboard-login">
      <h1>Suleia</h1>
      <p>Acceso privado al Command Center.</p>
      ${message ? `<div class="error">${message}</div>` : ''}
      <label>Contraseña<input name="password" type="password" autofocus autocomplete="current-password"></label>
      <button type="submit">Entrar</button>
    </form>
  </body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(Object.fromEntries(new URLSearchParams(raw)));
    });
    req.on('error', reject);
  });
}

function requireDashboardAuth(req, res) {
  if (isDashboardAuthenticated(req)) return true;
  if (req.method === 'GET' && (req.url === '/dashboard' || req.url.startsWith('/dashboard/'))) {
    sendDashboardLogin(res);
  } else {
    sendJson(res, 401, { ok: false, error: 'dashboard_unauthorized' });
  }
  return false;
}

function isAuthorizedCron(req) {
  if (!config.cronSecret) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${config.cronSecret}`;
}

function isAuthorizedTelegramWebhook(req) {
  if (!config.telegramBotToken) return false;
  if (!config.telegramWebhookSecret) return true;
  const header = req.headers['x-telegram-bot-api-secret-token'] || '';
  return safeEqual(header, config.telegramWebhookSecret);
}

function isAuthorizedDashboardAction(req) {
  return isDashboardAuthenticated(req) || isAuthorizedCron(req);
}

function dashboardRelativePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  return cleanPath === '/dashboard' || cleanPath === '/dashboard/'
    ? 'index.html'
    : cleanPath.replace(/^\/dashboard\/?/, '');
}

async function sendDashboardFile(res, reqUrl) {
  const relativePath = dashboardRelativePath(reqUrl) || 'index.html';
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }

  const attempted = [];
  for (const baseDir of dashboardDirs) {
    const filePath = path.resolve(baseDir, relativePath);
    const relativeToBase = path.relative(baseDir, filePath);
    if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) continue;
    attempted.push(filePath);
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': staticTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error(`Dashboard asset read error (${filePath}):`, error);
      }
    }
  }

  console.error(`Dashboard asset not found (${relativePath}). Tried: ${attempted.join(', ')}`);
  return sendJson(res, 404, { ok: false, error: 'not_found' });
}

function storeSummary({ publicView = false } = {}) {
  const state = loadState();
  const actionReadiness = getDropeaV2OrderActionReadiness();
  const cancellationSummary = state.lastUnansweredCancellationSweepSummary || null;
  const publicCancellationSummary = cancellationSummary ? {
    checked: Number(cancellationSummary.checked || 0),
    cancelled: Number(cancellationSummary.cancelled || 0),
    skipped: Number(cancellationSummary.skipped || 0),
    dryRun: Number(cancellationSummary.dryRun || 0)
  } : null;
  const automaticCancellationHistory = Array.isArray(state.automaticUnansweredCancellations)
    ? state.automaticUnansweredCancellations.slice(-50)
    : [];
  return {
    store: config.defaultStore.name,
    webhookTokenSuffix: config.defaultStore.webhookToken?.slice(-6) || null,
    agentEnabled: config.defaultStore.agentEnabled,
    agentDryRun: config.defaultStore.agentDryRun,
    delayedConfirmRealEnabled: config.defaultStore.delayedConfirmRealEnabled,
    confirmationDelayHours: config.defaultStore.confirmationDelayHours,
    autoPollEnabled: config.defaultStore.autoPollEnabled,
    autoPollIntervalMinutes: config.defaultStore.autoPollIntervalMinutes,
    confidenceThreshold: config.defaultStore.confidenceThreshold,
    cooldownHours: config.defaultStore.cooldownHours,
    lastPollAt: state.lastPollAt,
    lastAutoConfirmAt: state.lastAutoConfirmAt,
    lastAutomationCycleAt: state.lastAutomationCycleAt,
    lastCriticalTemplateDeliveryAt: state.lastCriticalTemplateDeliveryAt,
    lastCriticalTemplateDeliveryCount: state.lastCriticalTemplateDeliveryCount,
    lastWebhookAt: state.lastWebhookAt,
    lastWebhookError: state.lastWebhookError,
    lastSheetSyncAt: state.lastSheetSyncAt,
    lastSheetSyncError: state.lastSheetSyncError,
    lastIngestError: state.lastIngestError,
    lastAutoConfirmError: state.lastAutoConfirmError,
    lastUnansweredCancellationSweepAt: state.lastUnansweredCancellationSweepAt,
    lastUnansweredCancellationSweepError: state.lastUnansweredCancellationSweepError,
    lastUnansweredCancellationSweepSummary: publicView ? publicCancellationSummary : cancellationSummary,
    automaticUnansweredCancellations: publicView
      ? { count: automaticCancellationHistory.length }
      : automaticCancellationHistory,
    lastIncidentsSyncAt: state.lastIncidentsSyncAt,
    lastIncidentsSyncError: state.lastIncidentsSyncError,
    lastIncidentsSyncCount: state.lastIncidentsSyncCount,
    lastOperationalOrdersSyncAt: state.lastOperationalOrdersSyncAt,
    lastOperationalOrdersSyncError: state.lastOperationalOrdersSyncError,
    lastOperationalOrdersSyncCount: state.lastOperationalOrdersSyncCount,
    unansweredCancellationIntervalMinutes: config.defaultStore.unansweredCancellationIntervalMinutes,
    unansweredRejectRealEnabled: config.defaultStore.unansweredRejectRealEnabled,
    dropeaV2Actions: actionReadiness,
    automationReadiness: {
      confirmation: {
        enabled: Boolean(config.defaultStore.agentEnabled && config.defaultStore.delayedConfirmRealEnabled),
        ready: Boolean(config.defaultStore.agentEnabled
          && config.defaultStore.delayedConfirmRealEnabled
          && chatbyHealth.ready
          && actionReadiness.ready
          && !state.lastIngestError)
      },
      unansweredCancellation: {
        enabled: Boolean(config.defaultStore.unansweredRejectRealEnabled),
        ready: Boolean(config.defaultStore.unansweredRejectRealEnabled
          && chatbyHealth.ready
          && actionReadiness.ready
          && !state.lastUnansweredCancellationSweepError)
      }
    },
    incidentsSyncIntervalMinutes: config.defaultStore.incidentsSyncIntervalMinutes,
    operationalDashboardIntervalMinutes: config.defaultStore.operationalDashboardIntervalMinutes,
    metaDashboardEnabled: config.metaDashboardEnabled,
    metaDashboardIntervalMinutes: config.metaDashboardIntervalMinutes,
    lastMetaDashboardAt: state.lastMetaDashboardAt,
    lastMetaDashboardError: state.lastMetaDashboardError,
    supabase: getSupabaseMirrorStatus(),
    orders: {
      total: listOrders({ storeId: config.defaultStore.id }).length,
      pending: listOrders({ storeId: config.defaultStore.id, status: 'PENDING' }).length
    }
  };
}

async function runAutomationAndUnansweredSweep(context = 'automation') {
  const cycle = await runStoreAutomationCycle({ store: config.defaultStore });
  const unanswered = await runUnansweredCancellationSweep({ store: config.defaultStore });
  return { context, cycle, unanswered };
}

async function runAutomationOnly(context = 'automation') {
  const cycle = await runStoreAutomationCycle({ store: config.defaultStore });
  return { context, cycle };
}

let criticalTemplateDeliveryInFlight = null;

async function runCriticalTemplateDeliverySweep(context = 'template_delivery') {
  if (criticalTemplateDeliveryInFlight) return criticalTemplateDeliveryInFlight;

  const sweep = (async () => {
    try {
      const delivery = await reconcileCriticalOrderTemplates({
        store: config.defaultStore,
        limit: 100,
        pages: 1,
        lookbackHours: 48
      });
      return { context, delivery, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${context}] Critical template sweep failed:`, error);
      return { context, delivery: null, error: message };
    }
  })();

  criticalTemplateDeliveryInFlight = sweep;
  try {
    return await sweep;
  } finally {
    if (criticalTemplateDeliveryInFlight === sweep) criticalTemplateDeliveryInFlight = null;
  }
}

let dashboardBuildCache = null;
let dashboardBuildCacheAt = 0;
let dashboardBuildInFlight = null;
let dashboardBackgroundRefreshInFlight = false;

async function buildDashboardFast({ health = null, forceMeta = false, maxAgeMs = 60000 } = {}) {
  const now = Date.now();
  if (!forceMeta && dashboardBuildCache && now - dashboardBuildCacheAt <= maxAgeMs) {
    return {
      ...dashboardBuildCache,
      generatedAt: new Date().toISOString(),
      cache: { ...(dashboardBuildCache.cache || {}), dashboardBuild: 'memory', ageMs: now - dashboardBuildCacheAt }
    };
  }
  if (!forceMeta && dashboardBuildInFlight) return dashboardBuildInFlight;

  dashboardBuildInFlight = buildDashboard({ health, forceMeta })
    .then((dashboard) => {
      dashboardBuildCache = dashboard;
      dashboardBuildCacheAt = Date.now();
      return dashboard;
    })
    .finally(() => {
      dashboardBuildInFlight = null;
    });
  return dashboardBuildInFlight;
}

function queueDashboardBackgroundRefresh() {
  if (dashboardBackgroundRefreshInFlight) return;
  dashboardBackgroundRefreshInFlight = true;
  setTimeout(() => {
    Promise.allSettled([
      runScheduledOperationalOrdersSync()
        .catch((error) => console.error('Dashboard operational orders refresh error:', error)),
      runScheduledIncidentsSync()
        .catch((error) => console.error('Dashboard incidents refresh error:', error))
    ]).then(async () => {
      dashboardBuildCacheAt = 0;
      await buildDashboardFast({ health: storeSummary(), forceMeta: false, maxAgeMs: 0 });
    }).catch((error) => {
      console.error('Dashboard cache rebuild error:', error);
    }).finally(() => {
      dashboardBackgroundRefreshInFlight = false;
    });
  }, 250);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        operational: Boolean(chatbyHealth.ready
          && getDropeaV2OrderActionReadiness().ready
          && !loadState().lastIngestError),
        integrations: { chatby: { ...chatbyHealth } },
        ...storeSummary({ publicView: true })
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/webhook') {
      if (!isAuthorizedTelegramWebhook(req)) return sendJson(res, 401, { ok: false, error: 'telegram_unauthorized' });
      const update = await readBody(req);
      const result = await handleTelegramUpdate(update, { health: storeSummary() });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/setup-webhook') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      if (!config.telegramBotToken) return sendJson(res, 400, { ok: false, error: 'missing_telegram_bot_token' });
      const body = await readBody(req).catch(() => ({}));
      const baseUrl = String(body.publicBaseUrl || config.publicBaseUrl || '').replace(/\/+$/, '');
      const webhookUrl = body.webhookUrl || `${baseUrl}/api/telegram/webhook`;
      const bot = await getTelegramMe();
      const webhook = await setTelegramWebhook({
        url: webhookUrl,
        secretToken: config.telegramWebhookSecret
      });
      return sendJson(res, 200, {
        ok: true,
        bot: {
          id: bot.id,
          username: bot.username,
          firstName: bot.first_name
        },
        webhook: {
          url: webhookUrl,
          result: webhook
        }
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram/status') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      if (!config.telegramBotToken) return sendJson(res, 200, { ok: false, configured: false });
      const bot = await getTelegramMe();
      return sendJson(res, 200, {
        ok: true,
        configured: true,
        bot: {
          id: bot.id,
          username: bot.username,
          firstName: bot.first_name
        },
        allowedUsernames: config.telegramAllowedUsernames,
        allowedChatIdsConfigured: Boolean(config.telegramAllowedChatIds?.length)
      });
    }

    if (req.method === 'GET' && (url.pathname === '/dashboard-login' || url.pathname === '/api/dashboard-login')) {
      return sendDashboardLogin(res);
    }

    if (req.method === 'POST' && url.pathname === '/api/dashboard-login') {
      const body = await readFormBody(req);
      const valid = dashboardPassword && safeEqual(body.password, dashboardPassword);
      if (!valid) return sendDashboardLogin(res, 'Contraseña incorrecta.');
      res.writeHead(303, {
        Location: '/dashboard',
        'Set-Cookie': createSessionCookie(req),
        'Cache-Control': 'no-store'
      });
      return res.end();
    }

    if (req.method === 'GET' && (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/'))) {
      if (!requireDashboardAuth(req, res)) return;
      return sendDashboardFile(res, req.url);
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      if (!requireDashboardAuth(req, res)) return;
      return sendJson(res, 200, { ok: true, dashboard: await buildDashboardFast({ health: storeSummary() }) });
    }

    if (req.method === 'POST' && url.pathname === '/api/dashboard-refresh') {
      if (!requireDashboardAuth(req, res)) return;
      const dashboard = await buildDashboardFast({ health: storeSummary(), forceMeta: false, maxAgeMs: 120000 });
      queueDashboardBackgroundRefresh();

      return sendJson(res, 200, {
        ok: true,
        refresh: {
          operationalOrders: { queued: true, mode: 'background', target: 'cache_rapida' },
          incidents: { queued: true, mode: 'background', target: 'cache_rapida' }
        },
        dashboard
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/incident-discounts/preview-test') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const result = await previewIncidentDiscountTest({ phone: body.phone });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/incident-discounts/send-test') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const result = await sendAuthorizedIncidentDiscountTest({
        phone: body.phone,
        authorization: body.authorization
      });
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/agent-feedback') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const feedback = await saveAgentFeedback(body);
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: true, feedback });
    }

    if (req.method === 'POST' && url.pathname === '/api/incident-feedback') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const feedback = await saveIncidentFeedback(body);
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: true, feedback });
    }

    if (req.method === 'POST' && url.pathname === '/api/finance-settings') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const settings = await saveFinanceSettings(body);
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: true, settings });
    }

    if (req.method === 'POST' && url.pathname === '/api/agent-chat') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, ...(await saveAgentChat(body.message, storeSummary())) });
    }

    if (req.method === 'POST' && url.pathname === '/api/business-manager-report') {
      if (!requireDashboardAuth(req, res)) return;
      const body = await readBody(req);
      const request = await requestBusinessManagerReport(body);
      return sendJson(res, 200, {
        ok: true,
        request,
        dashboard: await buildDashboard({ health: storeSummary() })
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/logistics/cancel-dropea-order') {
      if (!isAuthorizedDashboardAction(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = await readBody(req);
      const orderId = String(body.orderId || body.order_id || '').trim();
      if (!/^\d+$/.test(orderId)) return sendJson(res, 400, { ok: false, error: 'invalid_order_id' });

      const before = await getDropeaOrderById(orderId).catch((error) => ({
        lookupError: error instanceof Error ? error.message : String(error)
      }));
      const cancellation = await cancelDropeaOrder(orderId);
      const after = await getDropeaOrderById(orderId).catch((error) => ({
        lookupError: error instanceof Error ? error.message : String(error)
      }));

      const existing = findOrder(config.defaultStore.id, orderId) || {};
      const updated = upsertOrder(config.defaultStore.id, {
        ...existing,
        orderId,
        status: 'CANCELLED',
        aiConfidence: 100,
        aiIntent: 'MANUAL_CANCEL_REQUEST',
        cancelledAt: new Date().toISOString(),
        operationalNote: 'Pedido cancelado manualmente desde endpoint logistico seguro en Render.',
        raw: {
          ...(existing.raw || {}),
          beforeDropeaStatus: before?.status || before?.lookupError || null,
          afterDropeaStatus: after?.status || after?.lookupError || null,
          manualCancellation: cancellation
        }
      });

      return sendJson(res, 200, {
        ok: true,
        orderId,
        before: before?.status || before?.lookupError || null,
        cancellation,
        after: after?.status || after?.lookupError || null,
        order: updated
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/logistics/repair-delayed-confirmation-timer') {
      if (!isAuthorizedDashboardAction(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = await readBody(req);
      const orderId = String(body.orderId || body.order_id || '').trim();
      const startedAt = new Date(body.startedAt || body.started_at || '');
      if (!/^\d+$/.test(orderId)) return sendJson(res, 400, { ok: false, error: 'invalid_order_id' });
      if (Number.isNaN(startedAt.getTime())) return sendJson(res, 400, { ok: false, error: 'invalid_started_at' });

      const existing = findOrder(config.defaultStore.id, orderId);
      if (!existing) return sendJson(res, 404, { ok: false, error: 'order_not_found' });
      if (String(existing.aiIntent || '').toUpperCase() !== 'CONFIRM_DELAY_PENDING') {
        return sendJson(res, 409, { ok: false, error: 'order_not_waiting_for_delayed_confirmation' });
      }

      const delayHours = Number(config.defaultStore.confirmationDelayHours || 1) || 1;
      const dueAt = new Date(startedAt.getTime() + delayHours * 60 * 60 * 1000);
      const repaired = upsertOrder(config.defaultStore.id, {
        ...existing,
        confirmationDelayStartedAt: startedAt.toISOString(),
        confirmationDueAt: dueAt.toISOString(),
        confirmationSource: existing.confirmationSource || 'chatby_customer_confirmation',
        operationalNote: 'Temporizador de confirmacion reconstruido tras corregir la persistencia. La decision se vuelve a validar en Chatby antes de actuar.'
      });

      const autoConfirm = await runAutoConfirm({ store: config.defaultStore });
      const order = findOrder(config.defaultStore.id, orderId);
      return sendJson(res, 200, {
        ok: true,
        repaired: {
          orderId,
          startedAt: repaired.confirmationDelayStartedAt,
          dueAt: repaired.confirmationDueAt
        },
        autoConfirm,
        order
      });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/webhooks/dropea/')) {
      const token = url.pathname.split('/').pop();
      if (token !== config.defaultStore.webhookToken) {
        return sendJson(res, 404, { ok: false, error: 'invalid_webhook_token' });
      }

      let payload = {};
      try {
        payload = await readBody(req);
      } catch (error) {
        const state = {
          ...loadState(),
          lastWebhookError: error instanceof Error ? error.message : String(error),
          lastWebhookAt: new Date().toISOString()
        };
        saveState(state);
        return sendJson(res, 200, { ok: true, accepted: false, error: 'invalid_json' });
      }

      sendJson(res, 200, { ok: true, accepted: true });

      setImmediate(async () => {
        try {
          const webhookResult = await handleDropeaWebhook({ store: config.defaultStore, payload });
          console.log('Dropea webhook processed:', JSON.stringify(webhookResult));
        } catch (error) {
          const state = { ...loadState(), lastWebhookError: error instanceof Error ? error.message : String(error), lastWebhookAt: new Date().toISOString() };
          saveState(state);
          console.error('Webhook processing error:', error);
        }

        try {
          const templateResult = await runCriticalTemplateDeliverySweep('dropea_webhook');
          console.log('Critical template delivery processed:', JSON.stringify(templateResult));
        } catch (error) {
          console.error('Critical template delivery error:', error);
        }

        try {
          const cycleResult = await runAutomationOnly('dropea_webhook');
          console.log('Automation cycle processed:', JSON.stringify(cycleResult));
        } catch (error) {
          console.error('Automation cycle error:', error);
        }

        runScheduledOperationalOrdersSync()
          .catch((error) => console.error('Operational orders sync after Dropea webhook error:', error));
        if (webhookLooksLikeIncident(payload)) {
          runScheduledIncidentsSync()
            .catch((error) => console.error('Incidents sync after Dropea webhook error:', error));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/webhooks/shopify/')) {
      const token = url.pathname.split('/').pop();
      if (token !== config.defaultStore.webhookToken) {
        return sendJson(res, 404, { ok: false, error: 'invalid_webhook_token' });
      }

      let payload = {};
      try {
        payload = await readBody(req);
      } catch (error) {
        const state = {
          ...loadState(),
          lastShopifyWebhookError: error instanceof Error ? error.message : String(error),
          lastShopifyWebhookAt: new Date().toISOString()
        };
        saveState(state);
        return sendJson(res, 200, { ok: true, accepted: false, error: 'invalid_json' });
      }

      sendJson(res, 200, { ok: true, accepted: true });

      setImmediate(async () => {
        try {
          const webhookResult = await handleShopifyWebhook({ store: config.defaultStore, payload });
          console.log('Shopify webhook processed:', JSON.stringify(webhookResult));
        } catch (error) {
          const state = {
            ...loadState(),
            lastShopifyWebhookError: error instanceof Error ? error.message : String(error),
            lastShopifyWebhookAt: new Date().toISOString()
          };
          saveState(state);
          console.error('Shopify webhook processing error:', error);
        }

        try {
          const cycleResult = await runAutomationOnly('shopify_webhook');
          console.log('Automation cycle processed after Shopify webhook:', JSON.stringify(cycleResult));
        } catch (error) {
          console.error('Automation cycle error after Shopify webhook:', error);
        }

        runScheduledOperationalOrdersSync()
          .catch((error) => console.error('Operational orders sync after Shopify webhook error:', error));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/poll-orders') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const poll = await ingestPendingOrders({ store: config.defaultStore });
      const templates = await runCriticalTemplateDeliverySweep('cron_poll_orders');
      const unanswered = await runUnansweredCancellationSweep({ store: config.defaultStore });
      const result = { poll, templates, unanswered };
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/template-delivery') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await runCriticalTemplateDeliverySweep('cron_template_delivery');
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/auto-confirm') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const autoConfirm = await runAutoConfirm({ store: config.defaultStore });
      const unanswered = await runUnansweredCancellationSweep({ store: config.defaultStore });
      const result = { autoConfirm, unanswered };
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/automation-cycle') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await runAutomationAndUnansweredSweep('cron_automation_cycle');
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/backfill-today-messages') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await backfillTodayMissingInitialTemplates({
        store: config.defaultStore,
        limit: Number(url.searchParams.get('limit') || 100),
        pages: Number(url.searchParams.get('pages') || 2)
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/backfill-prepared-messages') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await backfillMissingPreparedTemplates({
        store: config.defaultStore,
        limit: Number(url.searchParams.get('limit') || 100),
        pages: Number(url.searchParams.get('pages') || 2),
        targetDate: url.searchParams.get('date') || null
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/unanswered-cancellations') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const orderId = url.searchParams.get('orderId') || url.searchParams.get('order_id');
      const result = await runUnansweredCancellationSweep({
        store: config.defaultStore,
        orderIds: orderId ? [orderId] : []
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/logistics/run-unanswered-cancellation') {
      if (!isAuthorizedDashboardAction(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = await readBody(req);
      const orderId = String(body.orderId || body.order_id || url.searchParams.get('orderId') || '').trim();
      if (!/^\d+$/.test(orderId)) return sendJson(res, 400, { ok: false, error: 'invalid_order_id' });
      const result = await runUnansweredCancellationSweep({
        store: config.defaultStore,
        orderIds: [orderId],
        limit: 100,
        pages: 5
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/sync-sheet') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await ingestPendingOrders({ store: config.defaultStore });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/sync-meta-dashboard') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await syncMetaDashboard({ store: config.defaultStore });
      return sendJson(res, 200, { ok: Boolean(result?.ok), result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/sync-incidents') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await syncPendingIncidents();
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: Boolean(result?.ok), result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/sync-operational-orders') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await syncOperationalOrders();
      dashboardBuildCacheAt = 0;
      return sendJson(res, 200, { ok: Boolean(result?.ok), result });
    }

    if (req.method === 'GET' && url.pathname === '/api/cron/supabase-status') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await testSupabaseConnection();
      return sendJson(res, 200, { ok: Boolean(result?.ok), result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/supabase-backfill') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await backfillSupabaseFromLocal();
      return sendJson(res, 200, { ok: Boolean(result?.ok), result });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

let pollTimer = null;
let pollRunning = false;
let metaDashboardTimer = null;
let unansweredCancellationTimer = null;
let unansweredCancellationRunning = false;
let incidentsSyncTimer = null;
let incidentNotificationsTimer = null;
let incidentsSyncRunning = false;
let operationalOrdersSyncTimer = null;
let operationalOrdersSyncRunning = false;
let chatbyHealthTimer = null;
const scheduledNetworkJobs = createScheduledJobQueue({
  onEvent(event) {
    if (event.type === 'skipped') {
      console.log(`Scheduled network job skipped because it is already pending: ${event.name}`);
    } else if (event.type === 'failed') {
      console.error(`Scheduled network job failed (${event.name}):`, event.error);
    }
  }
});

function scheduleNetworkJob(name, work) {
  return scheduledNetworkJobs.schedule(name, work).catch(() => null);
}

function startChatbyHealthMonitor() {
  scheduleNetworkJob('chatby_health', refreshChatbyHealth);
  chatbyHealthTimer = setInterval(() => {
    scheduleNetworkJob('chatby_health', refreshChatbyHealth);
  }, 10 * 60 * 1000);
  chatbyHealthTimer.unref?.();
}

async function runBackgroundPoll() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const templates = await runCriticalTemplateDeliverySweep('background_poll');
    const sent = Number(templates?.delivery?.initialSent || 0) + Number(templates?.delivery?.preparedSent || 0);
    if (sent) {
      console.log(`Background template sweep sent ${sent} templates.`);
    }
  } catch (error) {
    console.error('Background critical template sweep error:', error);
  } finally {
    pollRunning = false;
  }

  try {
    const result = await runAutomationOnly('background_poll');
    const processed = result?.cycle?.ingest?.processed ?? 0;
    if (processed) console.log(`Background automation processed ${processed} orders.`);
  } catch (error) {
    console.error('Background automation error:', error);
  }
}

function startBackgroundPoller() {
  const intervalMinutes = config.defaultStore.autoPollIntervalMinutes || 5;
  if (!(config.defaultStore.autoPollEnabled ?? true)) return;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('background_poll', runBackgroundPoll);
    pollTimer = setInterval(
      () => scheduleNetworkJob('background_poll', runBackgroundPoll),
      intervalMs
    );
  }, 15000);
}

async function runScheduledUnansweredCancellationSweep() {
  if (unansweredCancellationRunning) return;
  unansweredCancellationRunning = true;
  try {
    const result = await runUnansweredCancellationSweep({ store: config.defaultStore });
    const cancelled = result?.results?.filter((item) => item.action === 'cancelled_unanswered').length ?? 0;
    const skipped = result?.results?.filter((item) => item.skipped).length ?? 0;
    if (cancelled || skipped) {
      console.log(`Unanswered cancellation sweep checked ${result.results.length} orders, cancelled ${cancelled}, skipped ${skipped}.`);
    }
  } catch (error) {
    console.error('Unanswered cancellation sweep error:', error);
  } finally {
    unansweredCancellationRunning = false;
  }
}

function startUnansweredCancellationScheduler() {
  const intervalMinutes = config.defaultStore.unansweredCancellationIntervalMinutes || 300;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('unanswered_cancellations', runScheduledUnansweredCancellationSweep);
    unansweredCancellationTimer = setInterval(
      () => scheduleNetworkJob('unanswered_cancellations', runScheduledUnansweredCancellationSweep),
      intervalMs
    );
  }, 30000);
}

async function runScheduledIncidentsSync() {
  if (incidentsSyncRunning) return;
  incidentsSyncRunning = true;
  try {
    const result = await syncPendingIncidents();
    console.log(`Incidents sync checked ${result.count || 0} pending incidents.`);
  } catch (error) {
    console.error('Incidents sync error:', error);
  } finally {
    incidentsSyncRunning = false;
  }
}

function startIncidentsScheduler() {
  const intervalMinutes = config.defaultStore.incidentsSyncIntervalMinutes || 360;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('incidents_sync', runScheduledIncidentsSync);
    incidentsSyncTimer = setInterval(
      () => scheduleNetworkJob('incidents_sync', runScheduledIncidentsSync),
      intervalMs
    );
  }, 60000);
}

function startIncidentNotificationsScheduler() {
  if (!config.defaultStore.incidentNotificationsEnabled) return;
  const intervalMinutes = config.defaultStore.incidentNotificationIntervalMinutes || 30;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('incidents_sync', runScheduledIncidentsSync);
    incidentNotificationsTimer = setInterval(
      () => scheduleNetworkJob('incidents_sync', runScheduledIncidentsSync),
      intervalMs
    );
  }, 90000);
}

async function runScheduledOperationalOrdersSync() {
  if (operationalOrdersSyncRunning) return;
  operationalOrdersSyncRunning = true;
  try {
    const result = await syncOperationalOrders();
    console.log(`Operational orders sync checked ${result.count || 0} pending orders.`);
  } catch (error) {
    console.error('Operational orders sync error:', error);
  } finally {
    operationalOrdersSyncRunning = false;
  }
}

function startOperationalOrdersScheduler() {
  const intervalMinutes = config.defaultStore.operationalDashboardIntervalMinutes || 15;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('operational_orders', runScheduledOperationalOrdersSync);
    operationalOrdersSyncTimer = setInterval(
      () => scheduleNetworkJob('operational_orders', runScheduledOperationalOrdersSync),
      intervalMs
    );
  }, 20000);
}

async function runScheduledMetaDashboardSync() {
  const result = await syncMetaDashboard({ store: config.defaultStore });
  if (result?.ok) console.log(`Meta dashboard synced (${result.insights} campaign insights).`);
  if (result?.error) console.error('Meta dashboard sync error:', result.error);
}

function startMetaDashboardSync() {
  const intervalMinutes = config.metaDashboardIntervalMinutes || 720;
  if (!config.metaDashboardEnabled) return;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    scheduleNetworkJob('meta_dashboard', runScheduledMetaDashboardSync);
    metaDashboardTimer = setInterval(() => {
      scheduleNetworkJob('meta_dashboard', runScheduledMetaDashboardSync);
    }, intervalMs);
  }, 45000);
}

server.listen(config.port, async () => {
  console.log(`AutoConfirm listening on http://localhost:${config.port}`);
  console.log(`Webhook: /api/webhooks/dropea/${config.defaultStore.webhookToken}`);
  console.log(`Shopify webhook: /api/webhooks/shopify/${config.defaultStore.webhookToken}`);
  try {
    const hydration = await hydrateLocalStateFromSupabase();
    if (!hydration?.skipped) console.log('Supabase startup hydration:', JSON.stringify(hydration.restored || {}));
    const coreMemory = await ensureCoreAgentMemory();
    if (!coreMemory?.skipped) console.log(`Core agent memory ready (${coreMemory.count} rules).`);
  } catch (error) {
    console.error('Supabase startup hydration error:', error instanceof Error ? error.message : String(error));
  }
  // Keep startup lightweight so Render health checks stay responsive. Dashboard
  // caches are hydrated from Supabase above and refreshed by the scheduled jobs.
  startChatbyHealthMonitor();
  startBackgroundPoller();
  startUnansweredCancellationScheduler();
  startOperationalOrdersScheduler();
  startIncidentsScheduler();
  startIncidentNotificationsScheduler();
  startMetaDashboardSync();
});
