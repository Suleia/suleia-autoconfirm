import test from 'node:test';import assert from 'node:assert/strict';
import {readAbsentMessageHistory} from './absent-message-history.mjs';
const options={base:new URL('https://chatby.test/api'),token:'synthetic',userNs:'case'};
test('absent reads bot history with inclusive time cursor instead of unsupported page',async()=>{
 let calls=0;const head=Array.from({length:100},(_,i)=>({mid:`id${i}`,ts:1800000000-i,type:'out'}));
 const transport=async url=>{calls++;assert.equal(url.searchParams.get('include_bot'),'1');assert.equal(url.searchParams.has('page'),false);
  if(calls===2)assert.equal(url.searchParams.get('end_time'),String(head.at(-1).ts));
  return new Response(JSON.stringify({data:calls===1?head:[head.at(-1),{mid:'notice',ts:1799999000,type:'out'}]}));};
 const result=await readAbsentMessageHistory({...options,transport});assert.equal(result.complete,true);assert.equal(result.items.length,101);
});
test('saturated same-second history cannot be treated as complete',async()=>{
 const transport=async()=>new Response(JSON.stringify({data:Array.from({length:100},(_,i)=>({mid:`id${i}`,ts:1800000000}))}));
 await assert.rejects(readAbsentMessageHistory({...options,transport}),{code:'CHATBY_ABSENT_HISTORY_INCOMPLETE'});
});
test('absence provider cooldown is preserved without retries',async()=>{
 let calls=0;const transport=async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'386'}})};
 const at=Date.now();await assert.rejects(readAbsentMessageHistory({...options,transport}),e=>e.code==='CHATBY_MESSAGES_HTTP_429' && e.retryNotBefore>=at+386000);assert.equal(calls,1);
});
