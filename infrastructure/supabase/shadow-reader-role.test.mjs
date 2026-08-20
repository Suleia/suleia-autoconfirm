import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const roleSql = await fs.readFile(new URL('./shadow-reader-role.sql', import.meta.url), 'utf8');
const verifySql = await fs.readFile(new URL('./verify-shadow-reader-role.sql', import.meta.url), 'utf8');
const rollbackSql = await fs.readFile(new URL('./rollback-shadow-reader-role.sql', import.meta.url), 'utf8');

const tables = [
  'app_state', 'orders', 'operational_orders', 'incidents',
  'incident_carrier_history', 'agent_feedback', 'agent_memory_events',
  'telegram_messages', 'webhook_events', 'template_delivery_ledger',
  'meta_campaign_insights'
];

test('reader-role proposal grants only SELECT on the explicit source allowlist', () => {
  assert.match(roleSql, /DESIGN ARTIFACT ONLY/);
  assert.match(roleSql, /NOBYPASSRLS/);
  assert.match(roleSql, /FOR SELECT TO suleia_shadow_reader/);
  assert.doesNotMatch(roleSql, /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE)/i);
  for (const table of tables) assert.match(roleSql, new RegExp(`\\b${table}\\b`));
});

test('verification checks every mutating table privilege and rollback removes the role', () => {
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
    assert.match(verifySql, new RegExp(`'${privilege}'`));
  }
  assert.match(verifySql, /pg_policies/);
  assert.match(verifySql, /has_function_privilege/);
  assert.match(verifySql, /has_schema_privilege/);
  assert.match(verifySql, /pg_auth_members/);
  assert.match(verifySql, /allowlisted/);
  assert.match(verifySql, /has_sequence_privilege/);
  for (const attribute of [
    'rolsuper', 'rolinherit', 'rolcreatedb', 'rolcreaterole',
    'rolcanlogin', 'rolreplication', 'rolbypassrls'
  ]) assert.match(verifySql, new RegExp(`reader_role\\.${attribute}`));
  assert.match(verifySql, /NOT pg_has_role\('authenticator', 'suleia_shadow_reader', 'MEMBER'\)/);
  assert.match(verifySql, /NOT has_schema_privilege\('suleia_shadow_reader', 'public', 'USAGE'\)/);
  assert.match(verifySql, /SELECT table_name FROM allowlist EXCEPT SELECT table_name FROM policy_tables/);
  assert.match(verifySql, /SELECT table_name FROM policy_tables EXCEPT SELECT table_name FROM allowlist/);
  assert.match(verifySql, /RAISE EXCEPTION 'shadow reader table\/RLS capability gate failed/);
  assert.match(verifySql, /RAISE EXCEPTION 'shadow reader function\/RPC capability gate failed/);
  assert.match(verifySql, /RAISE EXCEPTION 'shadow reader RLS policy table-set gate failed/);
  assert.match(rollbackSql, /DROP ROLE suleia_shadow_reader/);
  assert.match(rollbackSql, /REVOKE suleia_shadow_reader FROM authenticator/);
});
