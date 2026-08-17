import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('private customer display is restricted to the Operations API and explicitly denied to MCP and backup', () => {
  const migration = fs.readFileSync(new URL('../../migrations/019_operations_private_order_display.sql', import.meta.url), 'utf8');
  const compose = fs.readFileSync(new URL('../../infrastructure/docker/compose.yaml', import.meta.url), 'utf8');
  const deploy = fs.readFileSync(new URL('../../infrastructure/vps/deploy-private-staging.sh', import.meta.url), 'utf8');
  assert.match(migration, /operations_private_order_display/);
  assert.match(migration, /REVOKE ALL[^;]+suleia_mcp_readonly,suleia_backup/i);
  assert.match(migration, /GRANT SELECT[^;]+suleia_operations_readonly/i);
  assert.doesNotMatch(migration, /GRANT SELECT[^;]+(?:suleia_mcp_readonly|suleia_backup)/i);
  assert.match(compose, /OPERATIONS_PRIVATE_DATA_KEY: \$\{MIGRATION_HASH_KEY\}/);
  const mcpBlock = compose.split('mcp-server:')[1].split('ingestion-worker:')[0];
  assert.doesNotMatch(mcpBlock, /OPERATIONS_PRIVATE_DATA_KEY|MIGRATION_HASH_KEY/);
  assert.ok(deploy.indexOf('run-operations-private-order-display-rollback-drill.sh')
    < deploy.indexOf('apply-operations-private-order-display-migration.sh'));
  assert.ok(deploy.indexOf('apply-order-chatby-signal-projection-migration.sh')
    < deploy.indexOf('apply-operations-private-order-display-migration.sh'));
});
