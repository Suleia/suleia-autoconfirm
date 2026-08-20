import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('./provision-shadow-source-secrets.ps1', import.meta.url), 'utf8');

test('secret bridge requires a separately provisioned technical reader and removes service-role material', () => {
  assert.match(script, /ShadowReaderTokenSecureFile/);
  assert.match(script, /PublishableKeySecureFile/);
  assert.match(script, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(script, /SUPABASE_SHADOW_READER_TOKEN/);
  assert.match(script, /awk[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script, /Invoke-RestMethod|RenderServiceId|RenderTokenSecureFile/);
  assert.doesNotMatch(script, /printf[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script, /Write-Output.*readerToken|Write-Host.*readerToken/);
});

test('secret bridge uses strict host verification and protects the VPS env file', () => {
  assert.match(script, /StrictHostKeyChecking=yes/);
  assert.match(script, /chmod 0600/);
  assert.match(script, /umask 077/);
});
