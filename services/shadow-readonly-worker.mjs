import http from 'node:http';
import { loadShadowConfig } from '../packages/suleia-operations-mcp/src/shadow/config.mjs';
import { ShadowRepository } from '../packages/suleia-operations-mcp/src/shadow/repository.mjs';
import { SupabaseReadSource } from '../packages/suleia-operations-mcp/src/shadow/source.mjs';
import { syncShadow } from '../packages/suleia-operations-mcp/src/shadow/sync.mjs';
import { OperationsProjector } from '../packages/suleia-operations-mcp/src/operations/projector.mjs';
import { createDropeaPublicApiClient } from './integrations/dropea/public-api-client.mjs';
import { syncDropeaPublicApi } from './integrations/dropea/shadow-sync.mjs';
import { loadDropeaStoreConfigs } from './integrations/dropea/store-config.mjs';
import { prepareDropeaV2Webhook } from './integrations/webhooks/dropea-v2-ingress.mjs';
import { syncIncidentSimulations } from './incident-simulation-sync.mjs';

const config = loadShadowConfig();
const repository = new ShadowRepository(config.databaseUrl);
const source = new SupabaseReadSource(config);
const audit = (event) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), run_mode: 'SHADOW_READ_ONLY', ...event, actions_executed: 0, production_writes: 0 })}\n`);
const dropeaEnabled = String(process.env.DROPEA_PUBLIC_API_ENABLED || 'false').toLowerCase() === 'true';
const dropeaDryRun = String(process.env.DROPEA_INGESTION_DRY_RUN || 'false').toLowerCase() === 'true';
const dropeaStores = dropeaEnabled ? loadDropeaStoreConfigs(process.env) : [];
const dropeaClients = dropeaStores.map((store) => ({ store, client: createDropeaPublicApiClient({
  token: store.token,
  market: store.market,
  rateLimitPerMinute: Number(process.env.DROPEA_PUBLIC_API_RATE_LIMIT || 45),
  audit: (event) => audit({ event: 'dropea_public_api_read', market: store.market, store_id: store.store_id, ...event })
}) }));
const operationsProjector = new OperationsProjector(repository.pool);
let running = false, lastResult = null, lastError = null;
const webhookRate = new Map();

function webhookRateAllowed(key, now = Date.now()) {
  const values = (webhookRate.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (values.length >= 30) return false;
  values.push(now); webhookRate.set(key, values); return true;
}

async function receiveWebhook(req, res) {
  const parts = String(req.url || '').split('?')[0].split('/').filter(Boolean);
  if (parts.length !== 6 || parts.slice(0, 3).join('/') !== 'webhooks/dropea/v2') return false;
  const [, , , market, storeId, pathToken] = parts;
  const store = dropeaStores.find((item) => item.market === String(market).toUpperCase() && item.store_id === String(storeId));
  if (!store) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'not_found' })); return true; }
  const rateKey = `${req.socket.remoteAddress || 'unknown'}:${store.market}:${store.store_id}`;
  if (!webhookRateAllowed(rateKey)) { res.statusCode = 429; res.end(JSON.stringify({ ok: false, error: 'rate_limited' })); return true; }
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1_048_576) { res.statusCode = 413; res.end(JSON.stringify({ ok: false, error: 'body_too_large' })); return true; }
      chunks.push(chunk);
    }
    const event = prepareDropeaV2Webhook({
      rawBody: Buffer.concat(chunks), headers: req.headers, market: store.market, storeId: store.store_id,
      pathToken, authMode: process.env.DROPEA_WEBHOOK_AUTH_MODE || 'HMAC_ONLY',
      hmacSecret: process.env.DROPEA_WEBHOOK_HMAC_SECRET,
      pathTokenSha256: process.env.DROPEA_WEBHOOK_PATH_TOKEN_SHA256
    });
    const result = await operationsProjector.recordDropeaWebhook(event);
    if (result.inserted) queueMicrotask(() => audit({ event: 'dropea_webhook_queued', market: store.market, store_id: store.store_id, topic: event.topic, auth_status: event.auth_status }));
    res.statusCode = 202;
    res.end(JSON.stringify({ accepted: true, duplicate: !result.inserted, process_async: result.inserted, actions_executed: 0, production_writes: 0 }));
  } catch (error) {
    res.statusCode = Number(error.status || 400);
    res.end(JSON.stringify({ accepted: false, error: error.code || 'WEBHOOK_REJECTED', actions_executed: 0, production_writes: 0 }));
  }
  return true;
}

async function run() {
  if (running) return;
  running = true;
  try {
    const legacy = await syncShadow({ source, repository, hashKey: config.hashKey, pageSize: config.pageSize, audit });
    const dropeaResults = [];
    for (const { store, client } of dropeaClients) {
      if (!dropeaDryRun) await operationsProjector.upsertStoreConfig(store);
      dropeaResults.push(await syncDropeaPublicApi({
        client, storeConfig: store,
        phase: process.env.DROPEA_INGESTION_PHASE || 'INCREMENTAL',
        dryRun: dropeaDryRun,
        projector: operationsProjector,
        hmacKey: config.hashKey,
        testPhoneNormalized: process.env.TEST_PHONE_NORMALIZED || null,
        maxPages: Number(process.env.DROPEA_PUBLIC_API_MAX_PAGES || 200),
        maxRecords: Number(process.env.DROPEA_PUBLIC_API_MAX_RECORDS || 20000)
      }));
    }
    const dropea = dropeaResults.length ? {
      enabled: true, stores: dropeaResults,
      ok: dropeaResults.every((result) => result.ok), actions_executed: 0, production_writes: 0
    } : { enabled: false, actions_executed: 0, production_writes: 0 };
    const incidents = await syncIncidentSimulations({
      pool: repository.pool,
      projector: operationsProjector,
      maxRecords: Number(process.env.INCIDENT_SIMULATION_MAX_RECORDS || 500)
    });
    lastResult = { ok: legacy.ok && (dropea.ok ?? true) && incidents.ok, legacy, dropea, incidents,
      actions_executed: 0, production_writes: 0 };
    lastError = null;
  }
  catch (error) { lastError = error.message; audit({ event: 'sync_failed', reason: error.message }); }
  finally { running = false; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'POST' && await receiveWebhook(req, res)) return;
  if (req.method === 'GET' && req.url === '/health') {
    res.statusCode = lastError ? 503 : 200;
    res.end(JSON.stringify({ ok: !lastError, service: 'shadow-readonly-worker', run_mode: 'SHADOW_READ_ONLY', running,
      last_sync_ok: lastResult?.ok ?? null, last_error: lastError, actions_executed: 0, production_writes: 0 })); return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(Number(process.env.PORT || 3302), '0.0.0.0');
run();
const timer = setInterval(run, config.pollIntervalMs); timer.unref();
process.on('SIGTERM', async () => { clearInterval(timer); server.close(); await repository.close(); });
