import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportCache,ReportReadError,reportDependencyError} from './report-cache.mjs';
const value=at=>({observedAt:new Date(at).toISOString(),dataset:{current:{campaign:[]},prior:{campaign:[]},daily:{campaign:[]}}});
test('HTTP400 remains a distinct rejection with allowlisted numeric evidence and no automatic retry',async()=>{
 const cache=createReportCache({read:async()=>{throw Object.assign(Error('private provider message'),{code:'META_HTTP_400',providerCode:100,providerSubcode:33,transient:false});}});
 await assert.rejects(cache.snapshot('range',{},90),e=>{assert.equal(e.diagnostic.code,'META_HTTP_400');assert.equal(e.diagnostic.providerCode,100);assert.equal(e.diagnostic.providerSubcode,33);assert.equal(e.diagnostic.retryable,false);assert.doesNotMatch(JSON.stringify(e),/private provider/);return true;});
});
test('Meta code17 HTTP400 shares the explicit sixty-second rate cooldown',async()=>{
 let now=Date.now(),reads=0;const cache=createReportCache({now:()=>now,read:async()=>{reads++;throw Object.assign(Error(),{code:'META_RATE_LIMITED',providerCode:17,providerSubcode:2446079});}});
 await assert.rejects(cache.snapshot('range',{},90),e=>e.diagnostic.retryAfterSeconds===60&&e.diagnostic.connection==='RATE_LIMITED');
 await assert.rejects(cache.snapshot('range',{},90));assert.equal(reads,1);now+=61000;await assert.rejects(cache.snapshot('range',{},90));assert.equal(reads,2);
 await assert.rejects(cache.snapshot('different-range',{},90),e=>e.diagnostic.providerCode===17&&e.diagnostic.code==='META_RATE_LIMITED');assert.equal(reads,2);
});
test('database failures are identified separately without returning SQL, hosts or credentials',()=>{
 const e=reportDependencyError({code:'42501',message:'private SELECT and postgres credential'});assert.equal(e.diagnostic.source,'POSTGRESQL');assert.equal(e.diagnostic.code,'ADS_DATABASE_UNAVAILABLE');assert.equal(e.diagnostic.retryable,false);assert.doesNotMatch(JSON.stringify(e),/private SELECT|credential/);
});
test('cold paginated read returns PREPARING, retry reuses one task and eventually returns the original verified cut',async()=>{
 let resolve,calls=0;const now=Date.now(),cache=createReportCache({read:()=>{calls++;return new Promise(r=>resolve=r);},waitMs:2});
 await assert.rejects(cache.snapshot('range',{},31),e=>e instanceof ReportReadError&&e.status===202&&e.diagnostic.state==='PREPARING'&&e.diagnostic.code==='ADS_REPORT_PREPARING');
 await assert.rejects(cache.snapshot('range',{},31),e=>e.status===202);assert.equal(calls,1);resolve(value(now));await new Promise(r=>setImmediate(r));
 const result=await cache.snapshot('range',{},31);assert.equal(result.observedAt,new Date(now).toISOString());assert.equal(result.readFailed,false);assert.equal(calls,1);
});
for(const code of ['META_HTTP_401','META_HTTP_403','META_HTTP_429','INSIGHTS_IDENTITY_INVALID','META_PAGINATION_INCOMPLETE'])test(`${code} is distinct from preparing and never exposes secrets`,async()=>{
 const cache=createReportCache({read:async()=>{throw Object.assign(Error('URL?access_token=secret'),{code});},waitMs:20});
 await assert.rejects(cache.snapshot('range',{},31),e=>{assert.equal(e.status,503);assert.equal(e.diagnostic.code,code);assert.doesNotMatch(JSON.stringify(e.diagnostic),/access_token|secret/);assert.equal(e.diagnostic.retryable,!['META_HTTP_401','META_HTTP_403','INSIGHTS_IDENTITY_INVALID'].includes(code));return true;});
});
test('failed refresh retains historical cut, no fabricated freshness, then recovers from the same range',async()=>{
 let now=Date.now(),fail=false;const original=now,cache=createReportCache({now:()=>now,waitMs:20,read:async()=>{if(fail)throw Object.assign(Error(),{code:'META_HTTP_429'});return value(now);}});
 await cache.snapshot('range',{},31);now+=121000;fail=true;let r=await cache.snapshot('range',{},31);assert.equal(r.readFailed,true);assert.equal(r.observedAt,new Date(original).toISOString());assert.equal(r.diagnostic.cache,'HISTORICAL');
 fail=false;now+=61000;r=await cache.snapshot('range',{},31);assert.equal(r.readFailed,false);assert.equal(r.observedAt,new Date(now).toISOString());
});
test('rate limits enforce cooldown; parallel ranges remain bounded',async()=>{
 let reads=0;const cache=createReportCache({read:async()=>{reads++;throw Object.assign(Error(),{code:'META_HTTP_429'});}});
 await assert.rejects(cache.snapshot('range',{},31));await assert.rejects(cache.snapshot('range',{},31));assert.equal(reads,1);
 let resolve;const bounded=createReportCache({read:()=>new Promise(r=>resolve=r),waitMs:2,maxConcurrent:1});await assert.rejects(bounded.snapshot('one',{},31));await assert.rejects(bounded.snapshot('two',{},31),e=>e.diagnostic.code==='ADS_REPORT_BUSY');resolve(value(Date.now()));await new Promise(r=>setImmediate(r));
});
