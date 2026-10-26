import test from 'node:test';import assert from 'node:assert/strict';
import {createAdsRuntime} from '../runtime.mjs';
import {createV11GraphFixture} from '../../../tools/ads-v11-fixtures.mjs';
const pool={query:async q=>{assert.match(q,/^SELECT/);return {rows:[]};}};
const env={ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_REPORT_READ_ONLY:'true',ADS_REVIEW_V8_ENABLED:'true',META_ACCESS_TOKEN:'DEMO_NON_SECRET',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1'};
test('five parallel entity filters share one canonical selected-level read, never five history scans',async()=>{
 const graph=createV11GraphFixture({delayMs:5}),r=createAdsRuntime({env,pool,fetchImpl:graph.fetchImpl});
 const values=await Promise.all(Array.from({length:5},(_,i)=>r.review.report({period:'7d',level:'campaign',campaignId:String(101+i)})));
 assert.deepEqual(values.map(v=>v.rows[0].entityId),['101','102','103','104','105']);assert.ok(values.every(v=>v.rows.length===1));
 const insights=graph.calls.filter(c=>c.path.endsWith('/insights'));assert.equal(insights.filter(c=>c.level==='campaign').length,3);assert.equal(insights.filter(c=>c.level==='account').length,4);assert.equal(new Set(insights.map(c=>JSON.stringify([c.level,c.range,c.daily]))).size,7);assert.equal(graph.stats().mutations,0);assert.equal(graph.stats().externalConnections,0);
});
test('provider code17 pauses all report scopes and force cannot bypass the account quota gate',async()=>{
 const graph=createV11GraphFixture({delayMs:1,rateLimit:true}),r=createAdsRuntime({env,pool,fetchImpl:graph.fetchImpl});
 await assert.rejects(r.review.report({period:'7d',level:'campaign'}),e=>e.diagnostic.code==='META_RATE_LIMITED'&&e.diagnostic.providerCode===17);
 const count=graph.calls.length;await assert.rejects(r.review.report({period:'3d',level:'ad',force:true}),e=>e.diagnostic.code==='META_RATE_LIMITED');assert.equal(graph.calls.length,count);assert.equal(count,1);
});
test('partial purchase responses retain known campaign metrics and disclose a compatible cohort subtotal',async()=>{
 const graph=createV11GraphFixture({delayMs:1});const fetchImpl=async(...args)=>{const response=await graph.fetchImpl(...args),data=await response.json();if(Array.isArray(data.data))for(const row of data.data)if(row.campaign_id==='102'){delete row.actions;delete row.action_values;delete row.purchase_roas;delete row.website_purchase_roas;}return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});};
 const r=await createAdsRuntime({env,pool,fetchImpl}).review.report({period:'7d',level:'campaign'});
 assert.equal(r.totals.purchases,null);assert.equal(r.rows.find(x=>x.entityId==='102').purchases,null);assert.equal(r.subtotal.state,'PARTIAL');assert.equal(r.subtotal.included,4);assert.equal(r.subtotal.metrics.roas,r.subtotal.metrics.purchaseValue/r.subtotal.metrics.spend);assert.ok(r.rows.find(x=>x.entityId==='101').purchases>0);
});
test('ad assets remain available after scoped reads and their GET is shared across selections',async()=>{
 const graph=createV11GraphFixture({delayMs:1});let assets=0;
 const fetchImpl=async(url,...rest)=>{const response=await graph.fetchImpl(url,...rest);if(!new URL(url).searchParams.get('fields')?.includes('creative{'))return response;assets++;const data=await response.json();return new Response(JSON.stringify({...data,data:data.data.map(row=>({...row,creative:{thumbnail_url:'https://scontent.fbcdn.net/demo-'+row.id+'.jpg'}}))}),{status:200});};
 const r=createAdsRuntime({env,pool,fetchImpl}),q={period:'7d',level:'ad'};const a=await r.review.report(q,{optionalWaitMs:100});assert.ok(a.rows[0].creative?.thumbnail_url);await r.review.report({...q,campaignId:'101'},{optionalWaitMs:100});assert.equal(assets,1);assert.equal(graph.stats().mutations,0);
});
