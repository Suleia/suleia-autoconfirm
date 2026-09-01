import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { businessDateInTimezone, previousBusinessDateInTimezone, runMetaAdsFinanceSpendReadCycle, runMetaAdsReadCycle } from './read-cycle.mjs';

const config = Object.freeze({
  executionMode: 'SIMULATION',
  writesEnabled: false,
  expectedCurrency: 'EUR',
  expectedTimezone: 'Europe/Madrid'
});
function fakeClient(overrides = {}) {
  let reads = 0;
  const read = (value) => async () => { reads += 1; return structuredClone(value); };
  return {
    readAccount: read({ account_status: 1, currency: 'EUR', timezone_name: 'Europe/Madrid', timezone_offset_hours_utc: 2 }),
    readPermissions: read([{ permission: 'ads_read', status: 'granted' }]),
    readActiveCampaigns: read([
      { id: '1', name: 'Fixture CBO', effective_status: 'ACTIVE', daily_budget: '3000' },
      { id: '2', name: 'Fixture ABO', effective_status: 'ACTIVE' }
    ]),
    readCampaignInsights: read([
      {
        campaign_id: '1', spend: '5.39',
        actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }],
        action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '29.10' }],
        website_purchase_roas: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '5.4' }]
      }
    ]),
    readActiveAdSets: read([{ id: '20', effective_status: 'ACTIVE', daily_budget: '2000' }]),
    requestCount: () => reads,
    ...overrides
  };
}

test('read cycle returns CBO/ABO ownership and exact Purchase metrics with zero writes', async () => {
  const result = await runMetaAdsReadCycle({
    config,
    client: fakeClient(),
    now: new Date('2026-08-22T07:00:00Z')
  });
  assert.equal(result.business_date, '2026-08-22');
  assert.equal(result.active_campaign_count, 2);
  assert.equal(result.campaigns[0].budget_owner, 'CAMPAIGN');
  assert.equal(result.campaigns[0].budget_eur, 30);
  assert.equal(result.campaigns[0].purchase_roas, 5.4);
  assert.equal(result.campaigns[0].purchases, 2);
  assert.equal(result.campaigns[1].budget_owner, 'AD_SET');
  assert.equal(result.campaigns[1].purchase_roas, null);
  assert.equal(result.campaigns[1].purchase_roas_status, 'NO_DATA');
  assert.equal(result.meta_budget_writes, 0);
  assert.equal(result.telegram_messages, 0);
});

test('read cycle blocks missing read scope, non-EUR, timezone drift and inactive account', async () => {
  await assert.rejects(() => runMetaAdsReadCycle({
    config, client: fakeClient({ readPermissions: async () => [] })
  }), /READ_PERMISSION_MISSING/);
  await assert.rejects(() => runMetaAdsReadCycle({
    config, client: fakeClient({ readAccount: async () => ({ account_status: 1, currency: 'USD', timezone_name: 'Europe\/Madrid' }) })
  }), /CURRENCY_MISMATCH/);
  await assert.rejects(() => runMetaAdsReadCycle({
    config, client: fakeClient({ readAccount: async () => ({ account_status: 1, currency: 'EUR', timezone_name: 'UTC' }) })
  }), /TIMEZONE_MISMATCH/);
  await assert.rejects(() => runMetaAdsReadCycle({
    config, client: fakeClient({ readAccount: async () => ({ account_status: 2, currency: 'EUR', timezone_name: 'Europe\/Madrid' }) })
  }), /ACCOUNT_NOT_ACTIVE/);
});

test('finance spend cycle counts every campaign returned by daily insights, even if it is not currently active', async () => {
  let requestedDate = null;
  const client = fakeClient({
    readActiveCampaigns: async () => [{ id: '1', name: 'Currently active' }],
    readCampaignInsights: async ({ businessDate }) => {
      requestedDate = businessDate;
      return [
      { campaign_id: '1', spend: '5.39' },
      { campaign_id: '9', spend: '12.50', actions: [{ action_type: 'purchase', value: '1' }] }
      ];
    }
  });
  const result = await runMetaAdsFinanceSpendReadCycle({ config, client, now: new Date('2026-08-22T07:00:00Z') });
  assert.equal(requestedDate, '2026-08-21');
  assert.equal(result.business_date, '2026-08-21');
  assert.equal(result.campaign_count, 2);
  assert.equal(result.campaigns.reduce((sum, row) => sum + row.spend, 0), 17.89);
  assert.deepEqual(result.campaigns.map((row) => row.campaign_id), ['1', '9']);
  assert.equal(result.meta_budget_writes, 0);
  assert.equal(result.telegram_messages, 0);
});

test('Europe/Madrid business date is correct across midnight and daylight-saving seasons', () => {
  assert.equal(businessDateInTimezone(new Date('2026-08-21T22:30:00Z')), '2026-08-22');
  assert.equal(businessDateInTimezone(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(previousBusinessDateInTimezone(new Date('2026-08-21T22:30:00Z')), '2026-08-21');
  assert.equal(previousBusinessDateInTimezone(new Date('2026-01-01T08:00:00Z')), '2025-12-31');
});

test('finance spend backfill accepts a closed explicit date and rejects today or future', async () => {
  let requestedDate = null;
  const client = fakeClient({ readCampaignInsights: async ({ businessDate }) => { requestedDate = businessDate; return []; } });
  const now = new Date('2026-09-01T12:00:00Z');
  const result = await runMetaAdsFinanceSpendReadCycle({ config, client, now, businessDate: '2026-08-30' });
  assert.equal(requestedDate, '2026-08-30');
  assert.equal(result.business_date, '2026-08-30');
  await assert.rejects(() => runMetaAdsFinanceSpendReadCycle({ config, client, now, businessDate: '2026-09-01' }), /NOT_CLOSED/);
});

test('Meta Ads package is isolated from order, Dropea, GLS, Chatby and incident modules', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const sources = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => fs.readFileSync(`${directory}/${name}`, 'utf8'))
    .join('\n');
  assert.doesNotMatch(sources, /autoconfirm|dropea|chatby|shopify|gls|incident/i);
  assert.doesNotMatch(sources, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});
