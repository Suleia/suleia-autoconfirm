import http from 'node:http';
import { getAppConfig } from './src/config.mjs';
import { listOrders, loadState, saveState } from './src/storage.mjs';
import { ingestPendingOrders, runAutoConfirm, handleDropeaWebhook } from './src/workflows/orders.mjs';

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
    confidenceThreshold: config.defaultStore.confidenceThreshold,
    cooldownHours: config.defaultStore.cooldownHours,
    lastPollAt: state.lastPollAt,
    lastAutoConfirmAt: state.lastAutoConfirmAt,
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

      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, accepted: true });

      setImmediate(async () => {
        try {
          await handleDropeaWebhook({ store: config.defaultStore, payload });
        } catch (error) {
          console.error('Webhook error:', error);
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

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(config.port, () => {
  console.log(`AutoConfirm listening on http://localhost:${config.port}`);
  console.log(`Webhook: /api/webhooks/dropea/${config.defaultStore.webhookToken}`);
});
