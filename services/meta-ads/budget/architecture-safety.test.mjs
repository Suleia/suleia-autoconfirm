import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeFiles = fs.readdirSync(root).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));

test('budget runtime contains no external mutation transport, Telegram send or autonomous timer', () => {
  const source = runtimeFiles.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i);
  assert.doesNotMatch(source, /\b(?:setInterval|setTimeout|sendTelegram|genericCallMetaApi)\b/);
  assert.doesNotMatch(source, /graph\.facebook\.com/);
  assert.match(source, /BLOCKED_BY_SIMULATION_MODE/);
});

test('future Meta read interface is not registered in the public MCP tool catalog', () => {
  const mcpServer = fs.readFileSync(new URL('../../../packages/suleia-operations-mcp/src/mcp/server.mjs', import.meta.url), 'utf8');
  for (const name of ['list_meta_campaigns', 'get_meta_campaign', 'get_meta_budget_policy',
    'get_meta_budget_simulation', 'get_meta_budget_history', 'preview_meta_budget_change']) {
    assert.doesNotMatch(mcpServer, new RegExp(`name:\\s*['"]${name}['"]`));
  }
  assert.doesNotMatch(mcpServer, /generic_call_meta_api/);
});

