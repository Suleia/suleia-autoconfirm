import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Render dashboard exposes its login form on both the page and API GET URL', () => {
  const server = read('autoconfirm/server.mjs');
  assert.match(server, /url\.pathname === '\/dashboard-login' \|\| url\.pathname === '\/api\/dashboard-login'/);
  assert.match(server, /req\.method === 'POST' && url\.pathname === '\/api\/dashboard-login'/);
});

test('Operations Center requests only scopes required by its read-only API', () => {
  const server = read('apps/api/server.mjs');
  assert.match(server, /scope: 'openid operations:read'/);
  assert.doesNotMatch(server, /scope: 'openid profile operations:read'/);
});

test('Operations provisioning keeps operations read default and profile optional', () => {
  const provision = read('infrastructure/vps/provision-operations-keycloak.sh');
  assert.match(provision, /default-client-scopes\/\$\{scope_id\}/);
  assert.match(provision, /optional-client-scopes\/\$\{profile_scope_id\}/);
  assert.match(provision, /operations-realm-roles/);
  assert.match(provision, /scope-mappings\/realm/);
});

test('Operations owner provisioning consumes a temporary private file and removes it', () => {
  const provision = read('infrastructure/vps/provision-operations-owner.sh');
  const apply = read('infrastructure/vps/apply-operations-owner.sh');
  assert.match(provision, /OPERATIONS_CENTER_PASSWORD/);
  assert.match(provision, /OPERATIONS_CENTER_PASSWORD\} >= 9/);
  assert.match(provision, /@suleia\.invalid/);
  assert.match(provision, /operations_reader/);
  assert.match(provision, /temporary=false/);
  assert.doesNotMatch(provision, /echo.*OPERATIONS_CENTER_PASSWORD/);
  assert.match(apply, /rm -f -- "\$\{OWNER_FILE\}"/);
  assert.match(apply, /cleanup-keycloak-config-service\.sh/);
});
