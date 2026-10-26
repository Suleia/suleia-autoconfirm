import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaAdsReadClient, MetaAdsReadError } from './meta-ads-client.mjs';

test('provider rejection retains numeric diagnostics without provider text, credentials or URLs',async()=>{
 const reader=client(async()=>response({error:{code:100,error_subcode:33,is_transient:false,message:'private account data access_token=secret'}},400));
 await assert.rejects(reader.readEntities('adset'),error=>{assert.equal(error.code,'META_HTTP_400');assert.equal(error.providerCode,100);assert.equal(error.providerSubcode,33);assert.equal(error.transient,false);assert.doesNotMatch(JSON.stringify(error),/private account|access_token|secret/);return true;});
});
test('observed Meta HTTP400 code17 is a rate limit, never an invalid token or a silent generic failure',async()=>{
 const reader=client(async()=>response({error:{code:17,error_subcode:2446079,message:'private provider text'}},400));
 await assert.rejects(reader.readEntities('ad'),e=>{assert.equal(e.code,'META_RATE_LIMITED');assert.equal(e.status,400);assert.equal(e.providerCode,17);assert.doesNotMatch(JSON.stringify(e),/private provider/);return true;});
});

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

test('account reporting requests native unique metrics with the same attribution and GET queue',async()=>{
 let calls=0;const api=client(async(url,options)=>{calls++;const u=new URL(url);assert.equal(options.method,'GET');assert.equal(u.searchParams.get('level'),'account');assert.equal(u.searchParams.get('time_increment'),'1');assert.match(u.searchParams.get('fields'),/account_id/);assert.doesNotMatch(u.searchParams.get('fields'),/campaign_id|adset_id/);assert.equal(u.searchParams.get('action_report_time'),'conversion');assert.equal(u.searchParams.get('action_attribution_windows'),'["7d_click","1d_view"]');return response({data:[]});});
 await api.withPriority(10).readAccountInsights({since:'2026-10-19',until:'2026-10-25',daily:true});assert.equal(calls,1);
});

test('reporting facade shares the same quota gate and does not cache a critical read',async()=>{
 let calls=0;const api=client(async()=>{calls++;return response({id:'123',currency:'EUR'});}),view=api.withPriority(10);
 assert.equal((await view.readAccount()).id,'123');await api.readAccount();assert.equal(calls,2);
 assert.equal(view.requestStats().requests,api.requestStats().requests);assert.throws(()=>api.withPriority(999),/priority/);
});
test('account daily spending and category minimums are GET-only and identity bound',async()=>{
 const calls=[],api=client(async(url,options)=>{calls.push({url:new URL(url),options});return response(new URL(url).pathname.endsWith('/minimum_budgets')?{data:[{currency:'EUR',min_daily_budget_imp:90}]}:{data:[{account_id:'123',date_start:'2026-10-22',date_stop:'2026-10-22',spend:'20.22'}]});});
 const spend=await api.readAccountDaySpend({since:'2026-10-22',until:'2026-10-22'});assert.equal(spend.spendCents,2022);assert.equal(spend.complete,true);assert.equal((await api.readMinimumBudgets())[0].currency,'EUR');assert.ok(calls.every(c=>c.options.method==='GET'&&!c.options.body));assert.equal(calls[0].url.searchParams.get('level'),'account');
 const missing=client(async()=>response({data:[]}));assert.equal((await missing.readAccountDaySpend({since:'2026-10-22',until:'2026-10-22'})).spendCents,null);
 const wrong=client(async()=>response({data:[{account_id:'99',date_start:'2026-10-22',date_stop:'2026-10-22',spend:'0'}]}));await assert.rejects(wrong.readAccountDaySpend({since:'2026-10-22',until:'2026-10-22'}),/identity/);
});

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
