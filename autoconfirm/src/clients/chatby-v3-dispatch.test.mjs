import test from 'node:test';import assert from 'node:assert/strict';
let instance=0;
async function client(){
 process.env.CHATBY_TOKEN='synthetic-test-token';process.env.CHATBY_BASE_URL='https://chatby.invalid/api';process.env.CHATBY_REQUEST_MIN_INTERVAL_MS='0';process.env.CHATBY_READ_RETRY_BASE_MS='0';
 return import('./chatby.mjs?dispatch-test='+ ++instance);
}
const response=(data,status=200)=>new Response(JSON.stringify({data}),{status,headers:{'Content-Type':'application/json'}});
test('reserved final reads and one send reuse the existing queue without an intervening unrelated request',async()=>{
 const original=globalThis.fetch,events=[];globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.hostname,'chatby.invalid');events.push(u.pathname);return response(u.pathname.endsWith('get-info')?{user_ns:'fixture',user_fields:[]}:u.pathname.endsWith('send-text')?{mid:'wamid.synthetic',user_ns:'fixture'}:[]);};
 try{const c=await client();const send=c.sendTextMessage({user_ns:'fixture',content:'Synthetic status',beforeDispatch:async reads=>{await reads.readSubscriber('fixture');await reads.readMessages('fixture');return {expiresAt:Date.now()+60000};}});const other=c.listSubscribers();
 const result=await send;await other;assert.equal(result.v3_dispatch_verified,true);assert.equal(events.filter(p=>p.endsWith('send-text')).length,1);assert.ok(events.findIndex(p=>p.endsWith('subscribers'))>events.findIndex(p=>p.endsWith('send-text')));
 }finally{globalThis.fetch=original;}
});
test('late evidence change or a read429 aborts before the POST and never retries it',async()=>{
 const original=globalThis.fetch;
 try{for(const reason of ['CHANGED','RATE_LIMIT']){let posts=0;const c=await client();globalThis.fetch=async(_,o={})=>{if(o.method==='POST')posts++;return response([],429);};
  await assert.rejects(()=>c.sendTextMessage({user_ns:'fixture',content:'Synthetic status',beforeDispatch:async reads=>{if(reason==='CHANGED')throw Error('STALE_PLAN');await reads.readMessages('fixture');return {expiresAt:Date.now()+60000};}}),e=>e.notSent===true);assert.equal(posts,0);
 }}finally{globalThis.fetch=original;}
});
test('an uncertain send response makes exactly one POST; the ordinary sender contract is preserved',async()=>{
 const original=globalThis.fetch;let posts=0;
 try{const c=await client();globalThis.fetch=async(_,o={})=>{if(o.method==='POST'){posts++;assert.deepEqual(JSON.parse(o.body),{user_ns:'fixture',content:'Synthetic status'});throw Error('network timeout');}return response([]);};
  await assert.rejects(()=>c.sendTextMessage({user_ns:'fixture',content:'Synthetic status',beforeDispatch:async()=>({expiresAt:Date.now()+60000})}),e=>e.notSent!==true);assert.equal(posts,1);
  const ordinary=await client();globalThis.fetch=async(_,o)=>{assert.deepEqual(JSON.parse(o.body),{user_ns:'fixture',content:'ordinary'});return response({mid:'wamid.ordinary'});};
  assert.ok(await ordinary.sendTextMessage({user_ns:'fixture',content:' ordinary '}));
 }finally{globalThis.fetch=original;}
});
