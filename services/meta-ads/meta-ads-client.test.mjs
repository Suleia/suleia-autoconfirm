import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaAdsReadClient, MetaAdsReadError } from './meta-ads-client.mjs';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function client(fetchImpl) {
  return createMetaAdsReadClient({
    accessToken: 'fixture-token',
    accountId: '123',
    apiVersion: 'v25.0',
    fetchImpl,
    maxRetries: 0
  });
}

test('active campaigns are discovered dynamically with GET and ACTIVE filtering', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response({ data: [
      { id: '1', name: 'Fixture A', effective_status: 'ACTIVE' },
      { id: '2', name: 'Fixture B', effective_status: 'PAUSED' }
    ] });
  });
  const campaigns = await api.readActiveCampaigns();
  assert.deepEqual(campaigns.map((row) => row.id), ['1']);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].url.pathname, '/v25.0/act_123/campaigns');
  assert.match(calls[0].url.searchParams.get('filtering'), /ACTIVE/);
  assert.equal(calls[0].url.searchParams.has('access_token'), false);
});
test('pagination follows only the same Meta host/version and strips query tokens', async () => {
  let page = 0;
  const urls = [];
  const api = client(async (url) => {
    urls.push(new URL(url));
    page += 1;
    return page === 1
      ? response({ data: [{ id: '1', effective_status: 'ACTIVE' }], paging: {
        next: 'https://graph.facebook.com/v25.0/act_123/campaigns?after=cursor&access_token=leak'
      } })
      : response({ data: [{ id: '2', effective_status: 'ACTIVE' }] });
  });
  assert.equal((await api.readActiveCampaigns()).length, 2);
  assert.equal(urls[1].searchParams.has('access_token'), false);
});

test('pagination blocks a different host or API version', async () => {
  for (const next of [
    'https://example.com/v25.0/campaigns?after=x',
    'https://graph.facebook.com/v26.0/campaigns?after=x'
  ]) {
    const api = client(async () => response({ data: [{ id: '1', effective_status: 'ACTIVE' }], paging: { next } }));
    await assert.rejects(() => api.readActiveCampaigns(), MetaAdsReadError);
  }
});

test('insights request binds purchase fields, account attribution, conversion time and business date', async () => {
  let requestUrl;
  const api = client(async (url) => {
    requestUrl = new URL(url);
    return response({ data: [] });
  });
  await api.readCampaignInsights({ businessDate: '2026-08-22' });
  assert.equal(requestUrl.pathname, '/v25.0/act_123/insights');
  assert.match(requestUrl.searchParams.get('fields'), /purchase_roas/);
  assert.match(requestUrl.searchParams.get('fields'), /website_purchase_roas/);
  assert.equal(requestUrl.searchParams.get('action_report_time'), 'conversion');
  assert.equal(requestUrl.searchParams.get('use_account_attribution_setting'), 'true');
  assert.deepEqual(JSON.parse(requestUrl.searchParams.get('time_range')), {
    since: '2026-08-22', until: '2026-08-22'
  });
});

test('client exposes no mutation method and sanitizes HTTP errors', async () => {
  const api = client(async () => response({ error: { message: 'secret provider detail' } }, 401));
  assert.equal(api.createCampaign, undefined);
  assert.equal(api.updateBudget, undefined);
  await assert.rejects(() => api.readAccount(), (error) => {
    assert.equal(error.code, 'META_HTTP_401');
    assert.doesNotMatch(error.message, /secret provider detail/);
    return true;
  });
});
