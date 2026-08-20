import http from 'node:http';
import { resolveExecutionMode } from '../packages/platform-core/src/execution-mode.mjs';
import { evaluateScheduledRun } from '../packages/platform-core/src/scheduler-safety.mjs';

const role = process.argv[2] || 'unknown';
const port = Number(process.env.PORT || 3300);
const allowedRoles = new Set(['decision-engine', 'ingestion-worker', 'scheduler']);
if (!allowedRoles.has(role)) throw new Error(`Unsupported process role: ${role}`);
const executionModeResolution = resolveExecutionMode(process.env);

const disabled = {
  'decision-engine': process.env.ACTION_EXECUTOR_ENABLED !== 'true',
  'ingestion-worker': process.env.LIVE_POLLING_ENABLED !== 'true' && process.env.LIVE_WEBHOOKS_ENABLED !== 'true',
  scheduler: process.env.LIVE_CRON_ENABLED !== 'true'
};
const implemented = role === 'ingestion-worker';
const schedulerSafety = role === 'scheduler' ? evaluateScheduledRun({}) : null;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && req.url === '/health') {
    if (!implemented) res.statusCode = 501;
    res.end(JSON.stringify({
      ok: implemented,
      service: role,
      mode: 'SIMULATION',
      execution_mode: executionModeResolution.mode,
      scheduler_disposition: schedulerSafety?.disposition || null,
      scheduler_blockers: schedulerSafety?.blockers || [],
      health_status: implemented ? 'UNKNOWN' : 'NOT_IMPLEMENTED',
      functional_cycle_available: false,
      last_completed_cycle_at: null,
      production_activity_disabled: disabled[role],
      actions_executed: 0,
      production_writes: 0
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(port, '0.0.0.0');
process.on('SIGTERM', () => server.close());
