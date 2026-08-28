import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Meta analytics mirror requests the provider daily breakdown', async () => {
  const source = await readFile(new URL('../src/workflows/analytics.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /getCampaignInsights\(\{\s*since,\s*until,\s*timeIncrement:\s*1\s*\}\)/,
    'rolling Meta periods must never be projected as daily spend'
  );
  assert.match(source, /syncMetaInsightsToSupabase\(\{\s*account,\s*campaigns,\s*insights,\s*coverage:\s*\{\s*since,\s*until\s*\}\s*\}\)/);
});
