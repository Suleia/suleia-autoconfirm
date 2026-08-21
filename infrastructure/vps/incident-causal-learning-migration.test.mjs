import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/023_incident_causal_learning.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../../migrations/rollback/023_incident_causal_learning.down.sql', import.meta.url), 'utf8');

test('causal learning migration stores inbound and outbound context only in the encrypted Operations boundary', () => {
  assert.match(migration, /operations\.chatby_private_message_display/);
  assert.match(migration, /direction IN \('INBOUND','OUTBOUND'\)/);
  assert.doesNotMatch(migration, /GRANT .*suleia_mcp_readonly/i);
  assert.match(rollback, /DELETE FROM operations\.chatby_private_message_display WHERE direction='OUTBOUND'/);
  assert.match(rollback, /CHECK \(direction='INBOUND'\)/);
});
