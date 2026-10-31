import test from 'node:test';import assert from 'node:assert/strict';import{getFinanceMetaSpend}from './finance-meta.mjs';
const config={metaAdAccountId:'123',metaApiVersion:'v25.0',metaAccessToken:'test-token'};
const call=payload=>async(url,options)=>{assert.equal(options.method,'GET');assert.equal(url.searchParams.has('access_token'),false);assert.equal(options.headers.Authorization,'Bearer test-token');return Response.json(url.pathname.endsWith('/insights')?payload:{id:'act_123',currency:'EUR',timezone_name:'Europe/Madrid'});};
test('finance reads monetary account spend once, preserving complete no-activity days',async()=>{
 const r=await getFinanceMetaSpend({since:'2026-10-01',until:'2026-10-03'},{config,fetchImpl:call({data:[{account_id:'123',date_start:'2026-10-02',date_stop:'2026-10-02',spend:'10.13'}]})});
 assert.equal(r.length,3);assert.equal(r[0].sourceState,'NO_ACTIVITY_COMPLETE_ACCOUNT_QUERY');assert.equal(r[1].spend,'10.13');assert.equal(r.financeEvidence.currency,'EUR');assert.equal(r.financeEvidence.complete,true);
});
test('duplicate days, missing spend and wrong account are rejected instead of guessed',async()=>{
 const row={account_id:'123',date_start:'2026-10-01',date_stop:'2026-10-01',spend:'1.00'};
 for(const data of [[row,row],[{...row,spend:null}],[{...row,account_id:'456'}]])await assert.rejects(()=>getFinanceMetaSpend({since:'2026-10-01',until:'2026-10-03'},{config,fetchImpl:call({data})}),/FINANCE_META_DAY_INVALID/);
});
test('finance rejects another currency or timezone and untrusted pagination',async()=>{
 await assert.rejects(()=>getFinanceMetaSpend({since:'2026-10-01',until:'2026-10-03'},{config,fetchImpl:async()=>Response.json({currency:'USD',timezone_name:'UTC'})}),/CURRENCY_TIMEZONE/);
 await assert.rejects(()=>getFinanceMetaSpend({since:'2026-10-01',until:'2026-10-03'},{config,fetchImpl:call({data:[],paging:{next:'https://untrusted.invalid/x'}})}),/HOST_BLOCKED/);
});
