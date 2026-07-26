import http from 'node:http';

const port = Number(process.env.PORT || 3200);
const safety = {
  app_env: process.env.APP_ENV || 'staging',
  run_mode: process.env.RUN_MODE || 'SIMULATION',
  simulation_only: process.env.SIMULATION_ONLY !== 'false',
  production_writes_enabled: process.env.PRODUCTION_WRITES_ENABLED === 'true',
  action_executor_enabled: process.env.ACTION_EXECUTOR_ENABLED === 'true'
};

if (safety.run_mode !== 'SIMULATION'
  || !safety.simulation_only
  || safety.production_writes_enabled
  || safety.action_executor_enabled) {
  throw new Error('Unsafe API configuration: staging prototype must remain simulation-only');
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, service: 'suleia-api', ...safety, actions_executed: 0 }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(port, '0.0.0.0');
process.on('SIGTERM', () => server.close());
