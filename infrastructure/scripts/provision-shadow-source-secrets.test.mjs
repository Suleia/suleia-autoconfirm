import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('./provision-shadow-source-secrets.ps1', import.meta.url), 'utf8');

test('secret bridge allowlists only the two Supabase source values', () => {
  assert.match(script, /@\('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.doesNotMatch(script, /Write-Output.*sourceValues|Write-Host.*sourceValues/);
});

test('secret bridge uses strict host verification and protects the VPS env file', () => {
  assert.match(script, /StrictHostKeyChecking=yes/);
  assert.match(script, /chmod 0600/);
  assert.match(script, /umask 077/);
});
