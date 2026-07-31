import http from 'node:http';
import { loadShadowConfig } from '../packages/suleia-operations-mcp/src/shadow/config.mjs';
import { ShadowRepository } from '../packages/suleia-operations-mcp/src/shadow/repository.mjs';
import { SupabaseReadSource } from '../packages/suleia-operations-mcp/src/shadow/source.mjs';
import { syncShadow } from '../packages/suleia-operations-mcp/src/shadow/sync.mjs';

const config = loadShadowConfig();
const repository = new ShadowRepository(config.databaseUrl);
const source = new SupabaseReadSource(config);
let running = false, lastResult = null, lastError = null;
const audit = (event) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), run_mode: 'SHADOW_READ_ONLY', ...event, actions_executed: 0, production_writes: 0 })}\n`);

async function run() {
  if (running) return;
  running = true;
  try { lastResult = await syncShadow({ source, repository, hashKey: config.hashKey, pageSize: config.pageSize, audit }); lastError = null; }
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
