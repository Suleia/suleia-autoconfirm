import http from 'node:http';
import { loadShadowConfig } from '../packages/suleia-operations-mcp/src/shadow/config.mjs';
import { ShadowRepository } from '../packages/suleia-operations-mcp/src/shadow/repository.mjs';
import { SupabaseReadSource } from '../packages/suleia-operations-mcp/src/shadow/source.mjs';
import { syncShadow } from '../packages/suleia-operations-mcp/src/shadow/sync.mjs';
import { OperationsProjector } from '../packages/suleia-operations-mcp/src/operations/projector.mjs';
import { createDropeaPublicApiClient } from './integrations/dropea/public-api-client.mjs';
import { syncDropeaPublicApi } from './integrations/dropea/shadow-sync.mjs';
import { syncIncidentSimulations } from './incident-simulation-sync.mjs';

const config = loadShadowConfig();
const repository = new ShadowRepository(config.databaseUrl);
const source = new SupabaseReadSource(config);
const audit = (event) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), run_mode: 'SHADOW_READ_ONLY', ...event, actions_executed: 0, production_writes: 0 })}\n`);
const dropeaEnabled = String(process.env.DROPEA_PUBLIC_API_ENABLED || 'false').toLowerCase() === 'true';
const dropeaClient = dropeaEnabled ? createDropeaPublicApiClient({
  token: process.env.DROPEA_PUBLIC_API_TOKEN,
  market: process.env.DROPEA_PUBLIC_API_MARKET || 'ES',
  rateLimitPerMinute: Number(process.env.DROPEA_PUBLIC_API_RATE_LIMIT || 45),
  audit: (event) => audit({ event: 'dropea_public_api_read', ...event })
}) : null;
const operationsProjector = new OperationsProjector(repository.pool);
let running = false, lastResult = null, lastError = null;

async function run() {
  if (running) return;
  running = true;
  try {
    const legacy = await syncShadow({ source, repository, hashKey: config.hashKey, pageSize: config.pageSize, audit });
    const dropea = dropeaClient ? await syncDropeaPublicApi({
      client: dropeaClient,
      projector: operationsProjector,
      hmacKey: config.hashKey,
      testPhoneNormalized: process.env.TEST_PHONE_NORMALIZED || null,
      maxPages: Number(process.env.DROPEA_PUBLIC_API_MAX_PAGES || 200),
      maxRecords: Number(process.env.DROPEA_PUBLIC_API_MAX_RECORDS || 20000)
    }) : { enabled: false, actions_executed: 0, production_writes: 0 };
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

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
