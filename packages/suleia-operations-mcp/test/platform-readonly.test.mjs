import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.mjs';
import { createRepository } from '../src/data/repository.mjs';
import { createOperationsService } from '../src/domain/service.mjs';
import { createMcpServer, MCP_TOOL_NAMES } from '../src/mcp/server.mjs';
import { createAuditLogger } from '../src/security/audit.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const originalEight = [
  'get_order', 'get_order_timeline', 'get_data_freshness', 'get_active_timers',
  'get_agent_decisions', 'preview_order_decision', 'compare_simulation_with_current_system',
  'list_orders_needing_ai_review'
];

async function harness(scopes = ['orders:read','timelines:read','decisions:read','reviews:read','platform:read','orders:simulate']) {
  const config = loadConfig({ dataMode: 'fixture' });
  const repository = createRepository(config, { anchor: new Date('2026-08-08T00:00:00Z') });
  const server = createMcpServer({
    service: createOperationsService(repository, config),
    audit: createAuditLogger(config, () => {}),
    authContext: { principal: 'platform-test', scopes },
    config
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'platform-test', version: '0.3.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test('definitive catalog has exactly sixteen unique tools and preserves the original eight', () => {
  assert.equal(MCP_TOOL_NAMES.length, 16);
  assert.equal(new Set(MCP_TOOL_NAMES).size, 16);
  for (const name of originalEight) assert.equal(MCP_TOOL_NAMES.includes(name), true);
});

test('platform tools require platform scope', async () => {
  const { client, server } = await harness(['orders:read','timelines:read','decisions:read','reviews:read','orders:simulate']);
  const result = await client.callTool({ name: 'get_platform_overview', arguments: { section: 'STATUS' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /INSUFFICIENT_SCOPE/);
  await client.close();
  await server.close();
});

test('catalog blocks SQL injection, file traversal, arbitrary paths and arbitrary commands at schema boundary', async () => {
  const { client, server } = await harness();
  for (const [name, args] of [
    ['get_database_catalog', { object_name: "x'; DROP TABLE orders; --" }],
    ['get_component_details', { component_id: '../../.env', component_type: 'DOCUMENT' }],
    ['get_runtime_inventory', { service: 'postgres', command: 'docker exec postgres sh' }],
    ['get_platform_overview', { section: 'ALL', file_path: '.env' }]
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name);
  }
  await client.close();
  await server.close();
});

test('platform database role has no write grants and MCP membership disables SET ROLE', async () => {
  const migration = await fs.readFile(path.join(repositoryRoot, 'migrations', '015_platform_audit_readonly.sql'), 'utf8');
  const provision = await fs.readFile(path.join(repositoryRoot, 'infrastructure', 'vps', 'provision-staging-db-logins.sh'), 'utf8');
  assert.match(migration, /suleia_platform_audit_readonly/);
  assert.match(migration, /default_transaction_read_only\s*=\s*on/);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/i);
  assert.match(provision, /suleia_mcp_readonly_login WITH INHERIT TRUE, SET FALSE/);
  assert.match(provision, /suleia_platform_audit_readonly TO suleia_mcp_readonly_login WITH INHERIT TRUE, SET FALSE/);
});

test('runtime inventory never mounts the Docker socket and collector uses an allowlisted output directory', async () => {
  const compose = await fs.readFile(path.join(repositoryRoot, 'infrastructure', 'docker', 'compose.yaml'), 'utf8');
  const collector = await fs.readFile(path.join(repositoryRoot, 'infrastructure', 'scripts', 'collect-platform-runtime-inventory.mjs'), 'utf8');
  const launcher = await fs.readFile(path.join(repositoryRoot, 'infrastructure', 'vps', 'collect-platform-runtime-inventory.sh'), 'utf8');
  assert.doesNotMatch(compose, /docker\.sock/i);
  assert.match(collector, /outputPath\.startsWith\(allowedOutputRoot\)/);
  assert.doesNotMatch(collector, /OPENAI_API_KEY|CHATBY_TOKEN|DROPEA_READ_JWT|SHOPIFY_ACCESS_TOKEN/);
  assert.match(launcher, /node:22\.22\.0-alpine/);
  assert.match(launcher, /--network none/);
  assert.match(launcher, /--read-only/);
  assert.doesNotMatch(launcher, /docker\.sock/i);
  assert.doesNotMatch(launcher, /^node\s/m);
});
