import { createHttpApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';

const config = loadConfig();
const app = createHttpApp(config);
const server = app.listen(config.port, '0.0.0.0', () => {
  process.stderr.write(`Suleia Operations MCP listening on port ${config.port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
