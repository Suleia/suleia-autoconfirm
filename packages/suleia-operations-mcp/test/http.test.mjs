import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('Streamable HTTP requires bearer auth and serves tools when authorized', async () => {
  const token = 'test-token-with-more-than-thirty-two-characters';
  const config = loadConfig({
    environment: 'test',
    dataMode: 'fixture',
    bearerToken: token
  });
  const server = await listen(createHttpApp(config));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  let client;

  try {
    const unauthorized = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });
    assert.equal(unauthorized.status, 401);

    client = new Client({ name: 'http-test', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` }
      }
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 8);
    const simulation = await client.callTool({
      name: 'simulate_order_decision',
      arguments: { order_id: 'STG-ORDER-0001' }
    });
    assert.equal(simulation.structuredContent.result.data.actions_executed, 0);
  } finally {
    await client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
