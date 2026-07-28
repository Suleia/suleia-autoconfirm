import express from 'express';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRepository } from './data/repository.mjs';
import { createOperationsService } from './domain/service.mjs';
import { createMcpServer, MCP_TOOL_NAMES } from './mcp/server.mjs';
import { createAuditLogger } from './security/audit.mjs';
import { createBearerAuth, createRateLimiter } from './security/http-auth.mjs';

export function createHttpApp(config, options = {}) {
  const app = express();
  const repository = options.repository || createRepository(config);
  const service = options.service || createOperationsService(repository);
  const audit = options.audit || createAuditLogger(config);
  const auth = options.auth || createBearerAuth(config, audit);

  app.disable('x-powered-by');
  app.use(express.json({ limit: config.requestBodyLimit, strict: true }));
  app.use((req, res, next) => {
    req.correlationId = crypto.randomUUID();
    res.set('X-Correlation-Id', req.correlationId);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'suleia-operations-mcp',
      mode: config.dataMode,
      read_only: true,
      simulation_only: true,
      tool_count: MCP_TOOL_NAMES.length,
      actions_executed: 0
    });
  });

  app.post('/mcp', createRateLimiter(config, audit), auth, async (req, res) => {
    const server = createMcpServer({
      service,
      audit,
      authContext: req.authContext,
      config
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'MCP request failed' },
          id: null
        });
      }
    }
  });

  app.get('/mcp', auth, (req, res) => {
    res.status(405).set('Allow', 'POST').json({ ok: false, error: 'method_not_allowed' });
  });
  app.delete('/mcp', auth, (req, res) => {
    res.status(405).set('Allow', 'POST').json({ ok: false, error: 'method_not_allowed' });
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  return app;
}
