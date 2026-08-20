import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');

test('shadow runtime artifacts cannot inject a Supabase service-role credential', async () => {
  const [compose, example, provision] = await Promise.all([
    fs.readFile(path.join(repositoryRoot, 'infrastructure/docker/compose.yaml'), 'utf8'),
    fs.readFile(path.join(repositoryRoot, '.env.vps.example'), 'utf8'),
    fs.readFile(path.join(repositoryRoot, 'infrastructure/scripts/provision-shadow-source-secrets.ps1'), 'utf8')
  ]);
  const shadowService = compose.split('ingestion-worker:')[1].split('\n  scheduler:')[0];
  assert.match(shadowService, /^\s+SUPABASE_PUBLISHABLE_KEY:/m);
  assert.match(shadowService, /^\s+SUPABASE_SHADOW_READER_TOKEN:/m);
  assert.doesNotMatch(shadowService, /^\s+SUPABASE_SERVICE_ROLE_KEY:/m);
  assert.match(example, /^SUPABASE_PUBLISHABLE_KEY=$/m);
  assert.match(example, /^SUPABASE_SHADOW_READER_TOKEN=$/m);
  assert.doesNotMatch(example, /^SUPABASE_SERVICE_ROLE_KEY=/m);
  assert.match(provision, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(provision, /SUPABASE_SHADOW_READER_TOKEN/);
  assert.doesNotMatch(provision, /printf[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
});
