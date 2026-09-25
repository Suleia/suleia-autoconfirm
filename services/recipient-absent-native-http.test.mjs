import test from 'node:test';import assert from 'node:assert/strict';
import {createAbsentNativeHttpServer} from './recipient-absent-native-http.mjs';
test('native HTTP never grants on bad auth, missing identity, lookup error or disabled control',async t=>{
 const token='synthetic-fixture-token-32-characters';let reads=0;
 const server=createAbsentNativeHttpServer({token,readFresh:async()=>{reads++;throw new Error('provider unavailable');},ledger:{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/absent/native/authorize`;
 const post=(body,auth=`Bearer ${token}`)=>fetch(url,{method:'POST',headers:{Authorization:auth},body:JSON.stringify(body)});
 assert.equal((await post({},'wrong')).status,401);assert.equal(reads,0);
 assert.equal((await post({})).status,400);assert.equal(reads,0);
 const result=await post({issue_id:'1',order_id:'2',user_ns:'test'});
 assert.equal(result.status,503);assert.equal((await result.json()).allow,false);assert.equal(reads,1);
 assert.equal((await post({order_id:'2',user_ns:'test',issue_id:''})).status,503);assert.equal(reads,2);
 assert.equal((await post({order_id:'2',user_ns:'test',issue_id:'malformed'})).status,400);assert.equal(reads,2);
});

test('rate limit denies before provider access and health fails closed without leaking secrets',async t=>{
 const token='synthetic-fixture-token-32-characters',events=[];let reads=0;
 const server=createAbsentNativeHttpServer({token,rateLimit:1,audit:event=>events.push(event),
 health:async()=>{throw Error('private database URL');},readFresh:async()=>{reads++;throw Error('private provider message');},ledger:{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}`;
 const post=()=>fetch(`${url}/absent/native/authorize`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({issue_id:'1',order_id:'2',user_ns:'private-conversation'})});
 assert.equal((await post()).status,503);
 const denied=await post();assert.equal(denied.status,429);assert.equal(denied.headers.get('Retry-After'),'60');assert.equal(reads,1);
 assert.equal((await fetch(`${url}/health`)).status,503);
 assert.deepEqual(events.map(e=>e.status),[503,429,503]);
 assert.equal(/private|synthetic/.test(JSON.stringify(events)),false);
});
