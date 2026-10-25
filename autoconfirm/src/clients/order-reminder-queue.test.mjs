import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.CHATBY_TOKEN='offline';process.env.CHATBY_BASE_URL='https://chatby.test/api';process.env.CHATBY_REQUEST_MIN_INTERVAL_MS='0.001';
const template=JSON.parse(fs.readFileSync(new URL('../workflows/order-reminder-template.fixture.json',import.meta.url)));
const subscriber={user_ns:'fixture-thread',phone:'+34600000000',user_fields:[{name:'#Pedido',value:'101'}]};
const configure=()=>Object.assign(process.env,{ORDER_REMINDER_ENABLED:'true',ORDER_REMINDER_REAL_SENDS:'false',ORDER_REMINDER_CANARY_ENABLED:'true',ORDER_REMINDER_CANARY_ORDER_ID:'101',ORDER_CONFIRMATION_REMINDER_OWNER:'render_order_reminder',ORDER_REMINDER_NATIVE_SENDERS_DISABLED:'true',ORDER_REMINDER_OWNER_REFERENCE:'fixture-owner'});
const payload=()=>({template,params:{'BODY_{{1}}':'39,90 €','BODY_{{2}}':'Calle de prueba 1','BODY_{{3}}':'Madrid','BODY_{{4}}':'28001'},subscriber,orderId:'101',canonicalOrderId:'dropea:16088:101',claimId:'00000000-0000-4000-8000-000000000001',checkedAt:new Date().toISOString(),expectedRecipient:subscriber.phone});
const reply=x=>new Response(JSON.stringify({data:x}),{status:200,headers:{'Content-Type':'application/json'}});
async function moduleFor(name){return import('./chatby.mjs?reserved-slot='+name);}

test('queued reminder performs real final reads inside the same existing queue, then exactly one POST before later work',async()=>{
 configure();const client=await moduleFor('contention');const originalFetch=fetch,originalNow=Date.now;const events=[];let release,started;
 const startedPromise=new Promise(r=>started=r),gate=new Promise(r=>release=r);const future=originalNow()+11000;
 globalThis.fetch=async(url,options)=>{const u=new URL(url),ns=u.searchParams.get('user_ns');
  if(ns==='blocking'){events.push('old-flow');started();await gate;return reply({user_ns:ns});}
  if(ns==='later'){events.push('later-flow');return reply({user_ns:ns});}
  if(u.pathname.endsWith('/whatsapp-template/list')){events.push('catalogue');return reply([template]);}
  if(u.pathname.endsWith('/subscriber/get-info')){events.push('subscriber');return reply(subscriber);}
  if(u.pathname.endsWith('/subscriber/chat-messages')){events.push('history');return reply([]);}
  if(u.pathname.endsWith('/subscriber/send-whatsapp-template')){events.push('post');assert.equal(JSON.parse(options.body).user_ns,subscriber.user_ns);return reply({mid:'wamid.offline'});}
  throw Error('unexpected route');
 };
 try{
  const old=client.getOrderReminderSubscriber('blocking');await startedPromise;
  const p=payload();p.refreshBeforeDispatch=async reads=>{await reads.readTemplate();const fresh=await reads.getSubscriber(subscriber.user_ns);await reads.getMessages(subscriber.user_ns,{sinceMs:future-7200000});return {...p,subscriber:fresh,checkedAt:new Date(Date.now()).toISOString()};};
  const sending=client.sendOrderConfirmationReminder(p);const later=client.getOrderReminderSubscriber('later');Date.now=()=>future;release();await Promise.all([old,sending,later]);
  assert.deepEqual(events,['old-flow','catalogue','subscriber','history','post','later-flow']);
 }finally{release?.();Date.now=originalNow;globalThis.fetch=originalFetch;}
});
test('failure of a reserved final read proves no message POST and releases the unchanged queue',async()=>{
 configure();const client=await moduleFor('failure'),original=fetch;let posts=0;
 globalThis.fetch=async url=>{if(String(url).includes('send-whatsapp-template'))posts++;return reply({user_ns:'later'});};
 try{const p=payload();p.refreshBeforeDispatch=async()=>{throw Object.assign(Error('unavailable'),{code:'REMINDER_HISTORY_INCOMPLETE'});};await assert.rejects(client.sendOrderConfirmationReminder(p),e=>e.notSent===true&&e.code==='REMINDER_HISTORY_INCOMPLETE');await client.getOrderReminderSubscriber('later');assert.equal(posts,0);}finally{globalThis.fetch=original;}
});
test('reserved queue window remains bounded and cannot extend the ten-second freshness guard',async()=>{
 configure();const client=await moduleFor('deadline'),original=fetch,originalNow=Date.now;let posts=0;const future=originalNow()+31000;
 globalThis.fetch=async url=>{if(String(url).includes('send-whatsapp-template'))posts++;return reply({user_ns:'later'});};
 try{const p=payload();p.refreshBeforeDispatch=async()=>{Date.now=()=>future;return {...p,checkedAt:new Date(future).toISOString()};};await assert.rejects(client.sendOrderConfirmationReminder(p),e=>e.notSent===true&&e.code==='REMINDER_QUEUE_WINDOW_EXPIRED');assert.equal(posts,0);}finally{Date.now=originalNow;globalThis.fetch=original;}
});
test('existing provider cooldown before queue entry proves no assigning POST',async()=>{
 configure();const client=await moduleFor('cooldown'),original=fetch;let posts=0;
 globalThis.fetch=async url=>{if(String(url).includes('send-whatsapp-template'))posts++;return new Response(JSON.stringify({message:'rate limited'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'60'}});};
 try{await assert.rejects(client.getOrderReminderSubscriber('fixture-thread'));await assert.rejects(client.sendOrderConfirmationReminder(payload()),e=>e.code==='CHATBY_RATE_LIMITED'&&e.notSent===true);assert.equal(posts,0);}finally{globalThis.fetch=original;}
});
