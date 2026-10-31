import test from'node:test';import assert from'node:assert/strict';
import{createChatbyReadGate,chatbyRetryDeadline,sharedChatbyReader}from'./read-gate.mjs';
test('shared read phases serialize, coalesce only in-flight requests and preserve independent response streams',async()=>{
 let at=1000,calls=0,active=0,peak=0;const scope={},fetchImpl=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return new Response('{"ok":true}');};
 const a=sharedChatbyReader(scope,{fetchImpl,now:()=>at,wait:async n=>{at+=n;},minRequestIntervalMs:1500}),b=sharedChatbyReader(scope,{fetchImpl});assert.equal(a,b);
 const both=await Promise.all([a('https://app.chatby.io/api/a'),b('https://app.chatby.io/api/a'),b('https://app.chatby.io/api/b')]);assert.equal(calls,2);assert.equal(peak,1);assert.deepEqual(await both[0].json(),await both[1].json());
 await a('https://app.chatby.io/api/a');assert.equal(calls,3);assert.ok(at>=4000);
});
test('a 235-second Retry-After blocks every queued phase without an early provider retry',async()=>{
 let at=100000,calls=0;const read=createChatbyReadGate({now:()=>at,minRequestIntervalMs:0,fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'235'}});}});
 assert.equal((await read('https://app.chatby.io/api/a')).status,429);
 for(const offset of[0,60000,120000,234999]){at=100000+offset;await assert.rejects(read('https://app.chatby.io/api/b'),e=>e.code==='CHATBY_READ_HTTP_429'&&e.retryNotBefore===335000);}
 assert.equal(calls,1);at=335000;await read('https://app.chatby.io/api/b');assert.equal(calls,2);
});
test('rate reset dates are respected and the gate cannot execute provider writes',async()=>{
 assert.equal(chatbyRetryDeadline(new Headers({'retry-after':'Thu, 01 Jan 1970 00:05:00 GMT'}),1000),300000);
 assert.equal(chatbyRetryDeadline(new Headers({'x-ratelimit-reset':'1700000400'}),1700000000000),1700000400000);
 const read=createChatbyReadGate({fetchImpl:()=>{throw Error('MUST_NOT_FETCH');}});assert.throws(()=>read('https://app.chatby.io/api/a',{method:'POST'}),/READ_ONLY_REQUIRED/);
});
