import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsRuntime} from './runtime.mjs';
import {createAlgorithmOrdersReader} from './algorithm-orders.mjs';
import {createAlgorithmOperationsReader} from './algorithm-operations.mjs';
import {commercialCohorts,traceOrders} from './algorithm.mjs';
import {adsCommand} from './command-service.mjs';
import {createShopifyReadAuth} from '../../autoconfirm/src/clients/shopify-read-auth.mjs';

test('shared V4 runtime coalesces all reads, caches and simulates without an HTTP writer',async()=>{
 const calls=[],queries=[],env={ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_ALGORITHM_ENABLED:'true',ADS_INTELLIGENCE_MODE:'SHADOW',META_ACCESS_TOKEN:'fixture-not-real',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1',META_MAX_DAILY_BUDGET_EUR:'100',META_MAX_BUDGET_CHANGE_PERCENT:'10'};
 const fetchImpl=async(url,options)=>{assert.equal(options.method,'GET');const u=new URL(url);assert.equal(u.hostname,'graph.facebook.com');assert.equal(u.searchParams.has('access_token'),false);calls.push(u.pathname);let data=[];
  if(u.pathname.endsWith('/act_9'))return new Response(JSON.stringify({id:'act_9',account_status:1,currency:'EUR',timezone_name:'Europe/Madrid'}));
  if(u.pathname.endsWith('/campaigns'))data=[{id:'10',account_id:'9',name:'Fixture NIDA',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'5000',created_time:'2026-01-01T00:00Z'}];
  if(u.pathname.endsWith('/adsets'))data=[{id:'20',campaign_id:'10',name:'Fixture set'}];
  if(u.pathname.endsWith('/ads'))data=[{id:'30',campaign_id:'10',adset_id:'20',name:'Fixture ad'}];
  return new Response(JSON.stringify({data}));
 };
 const runtime=createAdsRuntime({env,pool:{query:async(...q)=>{queries.push(q);return {rows:[],rowCount:0};}},fetchImpl,readOrders:async()=>[{id:'source',createdAt:'2026-10-20T12:00Z',attributes:[{name:'UTM medium',value:'30'},{name:'UTM source',value:'facebook'}]}]});
 const [a,b]=await Promise.all([runtime.algorithm(),runtime.algorithm()]);assert.equal(a,b);assert.equal(calls.filter(x=>x.endsWith('/activities')).length,2);assert.equal(a.commercial.attributedOrders,1);const count=calls.length;
 const simulated=await runtime.simulate({campaignId:'10',newBudgetCents:6000,days:7});assert.equal(calls.length,count);assert.ok(simulated.reasons.includes('MAX_CHANGE_PERCENT'));assert.equal(simulated.externalWrites,0);assert.equal(queries.length,0);
 const response=await adsCommand(runtime,{action:'request',text:'¿Por qué hoy entran pedidos en bloques?',actor:{user:'1',chat:'1'}});assert.match(response.text,/EVIDENCIA/);
});
test('Shopify Ads extraction requests only selected fields and never contacts or mutates orders',async()=>{
 const methods=[];const read=createAlgorithmOrdersReader({env:{SHOPIFY_DOMAIN:'fixture.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'fixture'},fetchImpl:async(url,opts)=>{methods.push(opts.method);const fields=new URL(url).searchParams.get('fields');for(const f of ['customer','shipping_address','billing_address','email','phone'])assert.ok(!fields.split(',').includes(f));return new Response(JSON.stringify({orders:[{id:1,name:'#1',created_at:'2026-10-20T12:00Z',note_attributes:[],line_items:[]}]}));}});
 const r=await read({since:'2026-09-21',until:'2026-10-20'});assert.equal(r[0].reference,'#1');assert.deepEqual(methods,['GET']);assert.equal(createAlgorithmOrdersReader({env:{SHOPIFY_DOMAIN:'fixture.myshopify.com'}}),null);
});
test('operation linkage is parameterized, exact, READ ONLY and fails closed',async()=>{
 const queries=[],client={query:async(sql,args)=>{queries.push([sql,args]);return {rows:[]};},release(){}};
 const reader=createAlgorithmOperationsReader({pool:{connect:async()=>client},hashKey:'fixture-hmac-key-not-real-long-enough'});await reader({},[{id:'1',reference:'#1'}]);assert.equal(queries[0][0],'BEGIN READ ONLY');assert.equal(queries.at(-1)[0],'COMMIT');assert.ok(!queries[1][0].includes('#1'));assert.match(queries[1][1][2][0],/^[a-f0-9]{64}$/);assert.equal(createAlgorithmOperationsReader({pool:{}}),null);
});
test('existing Shopify client credentials refresh via auth only; no order mutation is possible',async()=>{
 const calls=[],fetchImpl=async(url,opts)=>{calls.push([new URL(url).pathname,opts.method]);return new Response(JSON.stringify(url.includes('/oauth/')?{access_token:'fixture-only-token',expires_in:3600}:{orders:[]}));},authenticatedRead=createShopifyReadAuth({shopifyDomain:'fixture.myshopify.com',shopifyClientId:'fixture-id',shopifyClientSecret:'fixture-secret'},{fetchImpl}),read=createAlgorithmOrdersReader({env:{SHOPIFY_DOMAIN:'fixture.myshopify.com'},authenticatedRead});
 await read({since:'2026-09-21',until:'2026-10-20'});assert.equal(calls[0][0],'/admin/oauth/access_token');assert.equal(calls[0][1],'POST');assert.equal(calls[1][1],'GET');
});
test('mature COD cohorts use exact source IDs and never convert delivery to profit',()=>{
 const traced=traceOrders([{id:'1',createdAt:'2026-09-22T12:00Z',attributes:[{name:'UTM medium',value:'30'},{name:'UTM source',value:'facebook'}]},{id:'2',createdAt:'2026-10-20T12:00Z'}],{ad:[{id:'30',campaign_id:'10'}]});
 const r=commercialCohorts(traced,[{sourceId:'1',state:'DELIVERED',confirmedAt:'2026-09-22',deliveredAt:'2026-09-25'}],{until:'2026-10-20'});assert.equal(r.groups.find(g=>g.campaignId==='10').delivered,1);assert.equal(r.groups.find(g=>g.campaignId==='10').netProfit,null);assert.equal(r.groups.find(g=>g.campaignId==='NO_ATRIBUIDOS').immature,1);
});

test('bounded HTTP preparation does not replace the full coalesced Algorithm promise used by Telegram',async()=>{
 let accountReads=0;const env={ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_ALGORITHM_ENABLED:'true',ADS_INTELLIGENCE_MODE:'SHADOW',META_ACCESS_TOKEN:'fixture-not-real',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1'};
 const runtime=createAdsRuntime({env,pool:{query:async()=>({rows:[]})},fetchImpl:async(url,options)=>{assert.equal(options.method,'GET');if(new URL(url).pathname.endsWith('/act_9')){accountReads++;await new Promise(r=>setTimeout(r,4200));return new Response(JSON.stringify({id:'9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}));}return new Response(JSON.stringify({data:[]}));}});
 const full=runtime.algorithm();await assert.rejects(runtime.algorithm({bounded:true}),e=>e.status===202&&e.diagnostic.state==='PREPARING');const report=await full;assert.equal(report.version,'ADS_ALGORITHM_V4');assert.equal(accountReads,1);assert.equal(report.externalWrites,0);
});
