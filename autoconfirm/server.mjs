import http from 'node:http';
import { getAppConfig } from './src/config.mjs';
import { listOrders, loadState, saveState } from './src/storage.mjs';
import { ingestPendingOrders, runAutoConfirm, handleDropeaWebhook, runStoreAutomationCycle } from './src/workflows/orders.mjs';
import { syncMetaDashboard } from './src/workflows/analytics.mjs';

const config = getAppConfig();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
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

function isAuthorizedCron(req) {
  if (!config.cronSecret) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${config.cronSecret}`;
}

function storeSummary() {
  const state = loadState();
  return {
    store: config.defaultStore.name,
    webhookTokenSuffix: config.defaultStore.webhookToken?.slice(-6) || null,
    agentEnabled: config.defaultStore.agentEnabled,
    agentDryRun: config.defaultStore.agentDryRun,
    autoPollEnabled: config.defaultStore.autoPollEnabled,
    autoPollIntervalMinutes: config.defaultStore.autoPollIntervalMinutes,
    confidenceThreshold: config.defaultStore.confidenceThreshold,
    cooldownHours: config.defaultStore.cooldownHours,
    lastPollAt: state.lastPollAt,
    lastAutoConfirmAt: state.lastAutoConfirmAt,
    lastAutomationCycleAt: state.lastAutomationCycleAt,
    lastWebhookAt: state.lastWebhookAt,
    lastWebhookError: state.lastWebhookError,
    lastSheetSyncAt: state.lastSheetSyncAt,
    lastSheetSyncError: state.lastSheetSyncError,
    lastIngestError: state.lastIngestError,
    lastAutoConfirmError: state.lastAutoConfirmError,
    metaDashboardEnabled: config.metaDashboardEnabled,
    metaDashboardIntervalMinutes: config.metaDashboardIntervalMinutes,
    lastMetaDashboardAt: state.lastMetaDashboardAt,
    lastMetaDashboardError: state.lastMetaDashboardError,
    orders: {
      total: listOrders({ storeId: config.defaultStore.id }).length,
      pending: listOrders({ storeId: config.defaultStore.id, status: 'PENDING' }).length
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, ...storeSummary() });
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
          const cycleResult = await runStoreAutomationCycle({ store: config.defaultStore });
          console.log('Automation cycle processed:', JSON.stringify(cycleResult));
        } catch (error) {
          console.error('Automation cycle error:', error);
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/poll-orders') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await ingestPendingOrders({ store: config.defaultStore });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/cron/auto-confirm') {
      if (!isAuthorizedCron(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const result = await runAutoConfirm({ store: config.defaultStore });
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

async function runBackgroundPoll() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const result = await runStoreAutomationCycle({ store: config.defaultStore });
    const processed = result?.ingest?.processed ?? 0;
    if (processed) {
      console.log(`Background poll processed ${processed} orders.`);
    }
  } catch (error) {
    console.error('Background poll error:', error);
  } finally {
    pollRunning = false;
  }
}

function startBackgroundPoller() {
  const intervalMinutes = config.defaultStore.autoPollIntervalMinutes || 5;
  if (!(config.defaultStore.autoPollEnabled ?? true)) return;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    runBackgroundPoll();
    pollTimer = setInterval(runBackgroundPoll, intervalMs);
  }, 15000);
}

function startMetaDashboardSync() {
  const intervalMinutes = config.metaDashboardIntervalMinutes || 360;
  if (!config.metaDashboardEnabled) return;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setTimeout(() => {
    syncMetaDashboard({ store: config.defaultStore })
      .then((result) => {
        if (result?.ok) console.log(`Meta dashboard synced (${result.insights} campaign insights).`);
        if (result?.error) console.error('Meta dashboard sync error:', result.error);
      })
      .catch((error) => console.error('Meta dashboard sync error:', error));
    metaDashboardTimer = setInterval(() => {
      syncMetaDashboard({ store: config.defaultStore })
        .then((result) => {
          if (result?.ok) console.log(`Meta dashboard synced (${result.insights} campaign insights).`);
          if (result?.error) console.error('Meta dashboard sync error:', result.error);
        })
        .catch((error) => console.error('Meta dashboard sync error:', error));
    }, intervalMs);
  }, 45000);
}

server.listen(config.port, () => {
  console.log(`AutoConfirm listening on http://localhost:${config.port}`);
  console.log(`Webhook: /api/webhooks/dropea/${config.defaultStore.webhookToken}`);
  startBackgroundPoller();
  startMetaDashboardSync();
});
