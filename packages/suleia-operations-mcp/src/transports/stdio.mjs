import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.mjs';
import { createRepository } from '../data/repository.mjs';
import { createOperationsService } from '../domain/service.mjs';
import { createMcpServer } from '../mcp/server.mjs';
import { createAuditLogger } from '../security/audit.mjs';

const config = loadConfig({ dataMode: 'fixture' });
const repository = createRepository(config);
const service = createOperationsService(repository);
const audit = createAuditLogger(config);
const server = createMcpServer({
  service,
  audit,
  authContext: {
    principal: 'local-stdio-client',
    scopes: ['orders:read', 'orders:simulate']
  }
});

await server.connect(new StdioServerTransport());
