import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_NAMES } from '../src/mcp/server.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(packageRoot, relativePath), 'utf8');
}

test('package remains isolated from production integrations and write clients', async () => {
  const sourceFiles = [
    'src/app.mjs',
    'src/config.mjs',
    'src/data/repository.mjs',
    'src/data/supabase-read-repository.mjs',
    'src/domain/service.mjs',
    'src/domain/simulator.mjs',
    'src/mcp/server.mjs',
    'src/security/audit.mjs',
    'src/security/http-auth.mjs',
    'src/security/pii.mjs',
    'src/security/scopes.mjs',
    'src/transports/http.mjs',
    'src/transports/stdio.mjs'
  ];
  const source = (await Promise.all(sourceFiles.map(read))).join('\n');

  assert.doesNotMatch(source, /(?:from|import)\s+['"][^'"]*autoconfirm/i);
  assert.doesNotMatch(source, /\b(?:DROPEA|CHATBY|SHOPIFY|META_ACCESS_TOKEN)\b/);

  const repositorySource = await read('src/data/supabase-read-repository.mjs');
  assert.doesNotMatch(repositorySource, /\bmethod:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(repositorySource, /\.(?:insert|update|upsert|delete|rpc)\s*\(/i);
});

test('fixture contains exactly one fictitious masked order', async () => {
  const fixture = JSON.parse(await read('fixtures/order.masked.json'));
  assert.equal(fixture.order.order_id, 'STG-ORDER-0001');
  assert.equal(Array.isArray(fixture.orders), false);
  assert.match(fixture.order.customer_ref, /^customer_hash_/);
  assert.match(fixture.order.phone_token, /^phone_hash_/);
  assert.match(fixture.order.email_token, /^email_hash_/);
});

test('tool surface is frozen to the eight approved read and simulation tools', () => {
  assert.deepEqual(MCP_TOOL_NAMES, [
    'get_order',
    'get_order_timeline',
    'get_data_freshness',
    'get_active_timers',
    'get_agent_decisions',
    'simulate_order_decision',
    'compare_simulation_with_current_system',
    'list_orders_requiring_review'
  ]);
});
