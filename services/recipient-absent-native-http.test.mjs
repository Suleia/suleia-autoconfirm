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
});
