import test from 'node:test';import assert from 'node:assert/strict';
import {createMetaReadScheduler,retryAfterMs}from'./request-scheduler.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
test('one shared queue reserves capacity for fresh critical reads and prioritizes them',async()=>{
 const q=createMetaReadScheduler(),release=[],order=[];
 const task=name=>q.schedule(()=>{order.push(name);return new Promise(r=>release.push(r));},{priority:name.startsWith('critical')?0:10});
 const a=task('analysis1'),b=task('analysis2');await flush();assert.deepEqual(order,['analysis1']);
 const c=task('critical1'),d=task('critical2');await flush();assert.deepEqual(order,['analysis1','critical1']);
 release[1]('ok');await c;await flush();assert.equal(order[2],'critical2');release[2]('ok');await d;
 release[0]('ok');await a;await flush();assert.equal(order[3],'analysis2');release[3]('ok');await b;assert.equal(q.status().peakConcurrent,2);
});
test('provider code17 cools the entire client, respects provider delay and never sends queued reads',async()=>{
 let now=0,reads=0;const q=createMetaReadScheduler({now:()=>now,random:()=>0});
 await assert.rejects(q.schedule(()=>{reads++;throw Object.assign(Error(),{code:'META_RATE_LIMITED',providerCode:17,providerSubcode:2446079,retryAfterSeconds:180});}));
 await assert.rejects(q.schedule(()=>{reads++;}),e=>e.retryAfterSeconds===180&&e.providerCode===17);assert.equal(reads,1);
 now=181000;await q.schedule(()=>{reads++;return 'fresh';});assert.equal(reads,2);assert.equal(q.status().circuit,'CLOSED');
});
test('usage headers strip account identities and reserve headroom without caching critical facts',async()=>{
 let now=1000;const q=createMetaReadScheduler({now:()=>now});const h=new Headers({'x-business-use-case-usage':JSON.stringify({'private-id':[{type:'ads_insights',call_count:98,estimated_time_to_regain_access:2}]})});
 assert.equal(q.observe(h).regainMs,120000);await assert.rejects(q.schedule(()=>0,{priority:10}),e=>e.code==='META_QUOTA_RESERVED');
 let gets=0;await q.schedule(()=>++gets);await q.schedule(()=>++gets);assert.equal(gets,2);assert.doesNotMatch(JSON.stringify(q.status()),/private-id/);
 now+=31000;await q.schedule(()=>++gets,{priority:10});assert.equal(gets,3);
});
test('queued work is bounded and expires instead of hanging indefinitely',async()=>{
 const q=createMetaReadScheduler({maxConcurrent:1,maxQueued:1,queueTimeoutMs:15});let release;
 const running=q.schedule(()=>new Promise(r=>release=r));await flush();const waiting=q.schedule(()=>1);
 await assert.rejects(q.schedule(()=>2),e=>e.code==='META_QUEUE_FULL');await assert.rejects(waiting,e=>e.code==='META_QUEUE_TIMEOUT');release(0);await running;
 assert.equal(q.status().queued,0);
});
test('Retry-After seconds/date are parsed without truncating provider windows',()=>{assert.equal(retryAfterMs('123',0),123000);assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:03:00 GMT',0),180000);assert.equal(retryAfterMs('bad',0),0);});
