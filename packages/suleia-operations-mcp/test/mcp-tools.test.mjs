import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.mjs';
import { createRepository } from '../src/data/repository.mjs';
import { createOperationsService } from '../src/domain/service.mjs';
import { createMcpServer, MCP_TOOL_NAMES } from '../src/mcp/server.mjs';
import { createAuditLogger } from '../src/security/audit.mjs';
import { containsObviousPii } from '../src/security/pii.mjs';

const allScopes = [
  'orders:read',
  'timelines:read',
  'decisions:read',
  'reviews:read',
  'orders:simulate'
];

async function createHarness(scopes = allScopes) {
  const config = loadConfig({ dataMode: 'fixture' });
  const repository = createRepository(config, { anchor: new Date('2026-07-26T12:00:00Z') });
  const service = createOperationsService(repository);
  const lines = [];
  const audit = createAuditLogger(config, (line) => lines.push(line));
  const server = createMcpServer({
    service,
    audit,
    authContext: { principal: 'test-client', scopes },
    config
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, lines };
}

test('exposes exactly eight read-only tools with schemas', async () => {
  const { client, server } = await createHarness();
  const result = await client.listTools();
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [...MCP_TOOL_NAMES].sort());
  for (const tool of result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, 'object');
    assert.match(tool.description, /READ-ONLY/);
    assert.match(tool.description, /SIMULATION-ONLY/);
  }
  await client.close();
  await server.close();
});

test('all tools run against one masked order and never execute actions', async () => {
  const { client, server, lines } = await createHarness();
  const calls = [
    ['get_order', { order_id: 'STG-ORDER-0001' }],
    ['get_order_timeline', { order_id: 'STG-ORDER-0001' }],
    ['get_data_freshness', {}],
    ['get_active_timers', { order_id: 'STG-ORDER-0001' }],
    ['get_agent_decisions', { order_id: 'STG-ORDER-0001' }],
    ['preview_order_decision', { order_id: 'STG-ORDER-0001', as_of: '2026-07-26T12:00:00Z' }],
    ['compare_simulation_with_current_system', { order_id: 'STG-ORDER-0001', as_of: '2026-07-26T12:00:00Z' }],
    ['list_orders_needing_ai_review', {}]
  ];

  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.result.meta.actions_executed, 0);
    assert.equal(result.structuredContent.result.meta.run_mode, 'SHADOW_READ_ONLY');
    assert.equal(result.structuredContent.result.meta.pii_masked, true);
    assert.equal(containsObviousPii(result.structuredContent), false);
  }

  assert.equal(lines.length, 8);
  for (const line of lines) {
    const audit = JSON.parse(line);
    assert.equal(audit.pii_logged, false);
    assert.equal(audit.actions_executed, 0);
    assert.equal(containsObviousPii(line), false);
  }
  await client.close();
  await server.close();
});

test('simulation scope is enforced', async () => {
  const { client, server, lines } = await createHarness(['orders:read', 'timelines:read']);
  const result = await client.callTool({
    name: 'preview_order_decision',
    arguments: { order_id: 'STG-ORDER-0001' }
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /INSUFFICIENT_SCOPE/);
  assert.equal(lines.length, 1);
  await client.close();
  await server.close();
});
