import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./ads-report-client.js',import.meta.url),'utf8');
function client(api){const c={api,URL,Date,DOMException,AbortController,setTimeout,clearTimeout,location:{origin:'https://local.test'}};vm.runInNewContext(source+';globalThis.client=AdsReportClient;',c);return c.client;}
test('provider quota failure does not trigger automatic polling even when provider diagnostic is retryable',async()=>{
 let calls=0,status;const c=client(async()=>{calls++;throw {diagnostic:{source:'META_MARKETING_API',state:'FAILED',code:'META_RATE_LIMITED',retryable:true,retryAfterSeconds:180}};});
 await assert.rejects(c.load('/report',{onStatus:d=>status=d}));assert.equal(calls,1);assert.equal(status.code,'META_RATE_LIMITED');assert.equal(status.retryAfterSeconds,180);
});
test('bounded progressive wait returns selected evidence instead of replacing it with an empty failure',async()=>{
 let calls=0,progress;const r={analysis:{entity:{id:'101'},row:{spend:196}},progress:{pending:true}};const c=client(async()=>{calls++;return r;});
 const out=await c.load('/growth',{maxAttempts:1,onProgress:r=>progress=r});assert.equal(out.clientWaitExpired,true);assert.equal(out.analysis.row.spend,196);assert.equal(progress.analysis.entity.id,'101');assert.equal(calls,1);
});
test('an actual request deadline becomes an explicit failure; user cancellation stays cancellation',async()=>{
 const c=client((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))));
 await assert.rejects(c.load('/slow',{deadlineMs:15}),e=>e.diagnostic?.code==='META_TIMEOUT');
 const controller=new AbortController(),job=c.load('/slow',{signal:controller.signal});controller.abort();await assert.rejects(job,e=>e.name==='AbortError');
});
test('a preparing retry keeps its exact context and removes force to avoid duplicate refresh jobs',async()=>{
 const urls=[];const c=client(async url=>{urls.push(url);if(urls.length===1)throw {diagnostic:{state:'PREPARING',code:'ADS_REPORT_PREPARING',retryable:true,retryAfterSeconds:1}};return {rows:[{entityId:'101'}]};});
 const r=await c.load('/review?level=campaign&campaignId=101&force=true',{deadlineMs:3000});assert.equal(r.rows[0].entityId,'101');assert.deepEqual(urls,['/review?level=campaign&campaignId=101&force=true','/review?level=campaign&campaignId=101']);
});

test('a stale successful preview refreshes to the current report without repeating force or retry',async()=>{
 const urls=[],progress=[],c=client(async url=>{urls.push(url);return urls.length===1?{freshness:'STALE',totals:{addToCart:90},diagnostic:{state:'PREPARING'}}:{freshness:'FRESH',totals:{addToCart:91}};});
 const out=await c.load('/review?level=campaign&force=true&retry=true',{deadlineMs:3000,onProgress:p=>progress.push(p)});
 assert.equal(progress[0].totals.addToCart,90);assert.equal(out.freshness,'FRESH');assert.equal(out.totals.addToCart,91);assert.deepEqual(urls,['/review?level=campaign&force=true&retry=true','/review?level=campaign']);
});
test('periodic refresh defers while the reader edits a filter or studies expanded evidence',async()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8'),start=app.indexOf('async function refresh('),end=app.indexOf('\nfunction setView(',start);let reads=0,open=true,editing=false;
 const root={querySelector:s=>s==='details[open]'&&open?{}:null,contains:()=>editing},button={},document={querySelector:()=>null,activeElement:{matches:()=>editing}};
 const c={document,state:{view:'ads',refreshing:false},$:id=>id==='ads-view'?root:button,AdsIntelligencePanel:{load:async()=>reads++},showNotice(){}};
 vm.runInNewContext(app.slice(start,end)+';globalThis.refreshPanel=refresh;',c);
 await c.refreshPanel({background:true});assert.equal(reads,0);open=false;editing=true;await c.refreshPanel({background:true});assert.equal(reads,0);
 editing=false;await c.refreshPanel({background:true});assert.equal(reads,1);open=true;await c.refreshPanel({background:false});assert.equal(reads,2);
});
