import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_ENABLED='false';
const {createReminderDeliveryStore,loadReminderConfig,REMINDER_STATUS_KEY}=await import('./order-reminder-runtime.mjs');
test('reminder uses its own exact primary key and cannot modify other template rows',async()=>{
 const calls=[],key='ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1';
 const store=createReminderDeliveryStore({request:async(path,options)=>{calls.push({path,...options});return [{raw:{claim_id:'claim'},status:options.body?.status||'CLAIMED'}];}});
 await store.claim(key,{claim_id:'claim',dropea_order_id:'101'});await store.finish(key,'claim','SENDING',{claim_id:'claim'});
 assert.equal(calls[0].body[0].template_key,key);assert.equal(calls[0].body[0].template_name,'dropea_pedido_reminder_v1');
 assert.deepEqual(calls[1].query,{template_key:'eq.'+key,template_name:'eq.dropea_pedido_reminder_v1','raw->>claim_id':'eq.claim',status:'in.(CLAIMED,SENDING,SEND_UNKNOWN,PRE_SEND_BLOCKED)'});
 assert.ok(calls.every(c=>c.path==='/rest/v1/template_delivery_ledger'));
 const schema=fs.readFileSync(new URL('../../supabase/schema.sql',import.meta.url),'utf8');assert.match(schema,/template_delivery_ledger\s*\(\s*template_key text primary key/);
});
test('a lost successful insert reconciles its own UUID without another insertion',async()=>{
 let inserts=0;const key='ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1';
 const store=createReminderDeliveryStore({request:async(_path,options)=>{if(options.method==='POST'){inserts++;throw Error('timeout');}return [{status:'CLAIMED',raw:{claim_id:'same-claim'}}];}});
 assert.deepEqual(await store.claim(key,{claim_id:'same-claim',dropea_order_id:'101'}),{acquired:true,persistent:true});assert.equal(inserts,1);
});
test('an existing unknown message cannot be reclaimed as a new send',async()=>{
 let updates=0;const store=createReminderDeliveryStore({request:async(_path,options)=>{if(options.method==='POST')throw Error('conflict');if(options.method==='PATCH')updates++;return [{status:'SEND_UNKNOWN',raw:{claim_id:'old',send_started_at:'2026-10-25T12:00:00Z'}}];}});
 assert.equal((await store.claim('ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',{claim_id:'new',dropea_order_id:'101'})).acquired,false);assert.equal(updates,0);
});
test('only proven pre-send failures can be conditionally reclaimed',async()=>{
 const calls=[];const store=createReminderDeliveryStore({request:async(_path,options)=>{calls.push(options);if(options.method==='POST')throw Error('conflict');if(options.method==='PATCH')return [{status:'CLAIMED',raw:{claim_id:'new'}}];return [{status:'PRE_SEND_BLOCKED',raw:{claim_id:'old',send_started_at:null}}];}});
 assert.equal((await store.claim('ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',{claim_id:'new',dropea_order_id:'101'})).acquired,true);
 const patch=calls.find(x=>x.method==='PATCH');assert.equal(patch.query.status,'eq.PRE_SEND_BLOCKED');assert.equal(patch.query['raw->>send_started_at'],'is.null');
});
test('reminder lookback respects the real cancellation policy and flags default off',()=>{const c=loadReminderConfig({UNANSWERED_CANCEL_AFTER_HOURS:'48'});assert.equal(c.enabled,false);assert.equal(c.realSends,false);assert.equal(c.lookbackHours,48);assert.equal(c.owner,'unassigned');assert.equal(REMINDER_STATUS_KEY,'order_confirmation_reminder_v1');});
test('storage refuses an initial/prepared/incident key before any database operation',async()=>{let calls=0;const store=createReminderDeliveryStore({request:async()=>{calls++;return [];}});for(const key of ['suleia|101|es_es_dropea_pedido_nuevo_v1','suleia|101|es_es_dropea_pedido_preparado_v1','incident:101']){await assert.rejects(store.get(key),/REMINDER_LEDGER_NAMESPACE_REQUIRED/);await assert.rejects(store.claim(key,{}),/REMINDER_LEDGER_NAMESPACE_REQUIRED/);await assert.rejects(store.finish(key,'id','SENDING',{}),/REMINDER_LEDGER_NAMESPACE_REQUIRED/);}assert.equal(calls,0);});
test('status route retains existing authentication and no reminder-specific interval',()=>{const server=fs.readFileSync(new URL('../../server.mjs',import.meta.url),'utf8');assert.doesNotMatch(server,/setInterval\([^\n]*[Rr]eminder/);assert.match(server,/!isDashboardAuthenticated\(req\)&&\(!config.cronSecret\|\|!isAuthorizedCron\(req\)\)/);});
const {includeReminderReconciliation}=await import('./order-reminder-runtime.mjs');
test('retained uncertainty remains in the read-only reconciliation cohort after leaving pending orders',()=>{const row={order_id:'101',template_key:'ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',status:'SEND_UNKNOWN',raw:{canonical_order_id:'dropea:16088:101'}};const result=includeReminderReconciliation([], [row],16088);assert.equal(result[0].reconciliationOnly,true);assert.equal(result[0].orderId,'101');const existing={orderId:'101',canonicalOrderId:'dropea:16088:101'};assert.deepEqual(includeReminderReconciliation([existing],[row],16088),[existing]);});
test('reconciliation never accepts another store, template key or an unbounded backlog',()=>{const row={order_id:'101',template_key:'ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',status:'SEND_UNKNOWN',raw:{canonical_order_id:'dropea:16088:101'}};assert.throws(()=>includeReminderReconciliation([],[row],16089),/IDENTITY_UNVERIFIED/);assert.throws(()=>includeReminderReconciliation([],[{...row,template_key:'initial:101'}],16088),/IDENTITY_UNVERIFIED/);assert.throws(()=>includeReminderReconciliation([],Array(21).fill(row),16088),/COVERAGE_INCOMPLETE/);});
const {excludeTerminalReminders}=await import('./order-reminder-runtime.mjs');
test('already verified reminders cannot occupy scarce dispatch slots ahead of new due orders',()=>{const orders=['101','102','103'].map(id=>({orderId:id,canonicalOrderId:'dropea:16088:'+id}));const terminal={order_id:'101',template_key:'ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',status:'VERIFIED',raw:{canonical_order_id:'dropea:16088:101'}};assert.deepEqual(excludeTerminalReminders(orders,[terminal],16088),orders.slice(1));assert.deepEqual(excludeTerminalReminders(orders,[],16088),orders);});
test('terminal filtering remains exact to the selected order, store and reminder ledger',()=>{const orders=[{orderId:'101',canonicalOrderId:'dropea:16088:101'}],row={order_id:'101',template_key:'ORDER_REMINDER:dropea:16088:101:dropea_pedido_reminder_v1',status:'VERIFIED',raw:{canonical_order_id:'dropea:16088:101'}};assert.throws(()=>excludeTerminalReminders(orders,[row],16089),/IDENTITY_UNVERIFIED/);assert.throws(()=>excludeTerminalReminders(orders,[{...row,template_key:'initial:101'}],16088),/IDENTITY_UNVERIFIED/);assert.throws(()=>excludeTerminalReminders([],[row],16088),/IDENTITY_UNVERIFIED/);assert.throws(()=>excludeTerminalReminders(orders,Array(301).fill(row),16088),/COVERAGE_INCOMPLETE/);});
