import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, {after} from 'node:test';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'suleia-reminder-reply-'));
Object.assign(process.env,{ORDERS_PATH:path.join(temp,'orders.json'),STATE_PATH:path.join(temp,'state.json'),STORE_CONFIG_PATH:path.join(temp,'stores.json'),SUPABASE_ENABLED:'false',GOOGLE_SHEETS_ENABLED:'false'});
const {normalizeChatMessages,customerConversationIntentForOrder,scheduleDelayedConfirmation,processDelayedConfirmation}=await import('../src/workflows/orders.mjs');
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
// Entirely synthetic conversation. The template title matches the approved
// catalogue; no callback, field/tag write or reminder receipt grants consent.
const now=Date.now(),created=now-4*3600000,reminded=now-2*3600000,confirmed=now-70*60000;
const order={orderId:'900001',status:'PENDING',chatbyUserNs:'fixture-thread',orderAmount:29.95,raw:{created_at:new Date(created).toISOString(),external_order_id:'#5001'}};
const store={id:'fixture',agentDryRun:false,delayedConfirmRealEnabled:true,confirmationDelayHours:1};
const reminder={type:'agent',msg_type:'template',ts:reminded/1000,payload:{name:'dropea_pedido_reminder_v1',body:'Confirma tu pedido',title:'CONFIRMAR MI PEDIDO'}};
const reply=(payload,kind='postback',at=confirmed)=>({type:'in',msg_type:kind,ts:at/1000,payload});
const intent=rows=>customerConversationIntentForOrder(normalizeChatMessages(rows),order);

for(const [label,message] of [
 ['existing top-level text',{type:'in',content:'Deseo recibirlo',ts:confirmed/1000}],
 ['existing top-level button',{type:'in',msg_type:'postback',content:'CONFIRMAR MI PEDIDO',ts:confirmed/1000}],
 ['payload button',reply({title:'CONFIRMAR MI PEDIDO',payload:'opaque-route'})],
 ['payload text',reply({text:'Sí, quiero que me entreguen el pedido'},'text')],
 ['payload body',reply({body:'Deseo recibirlo'},'text')]
]) test(`${label} after reminder enters the existing consent evaluator`,()=>{
 const actual=intent([reminder,message]);
 assert.equal(actual.intent,'CONFIRM');
 assert.equal(Date.parse(actual.occurred_at),confirmed);
 assert.equal(actual.source,message.msg_type==='postback'?'chatby_button':'customer_text');
});

for(const [label,message] of [
 ['outbound reminder alone',reminder],
 ['agent payload',{...reply({title:'CONFIRMAR MI PEDIDO'}),type:'agent'}],
 ['echo payload',{...reply({title:'CONFIRMAR MI PEDIDO'}),is_echo:true}],
 ['contradictory outgoing',{...reply({title:'CONFIRMAR MI PEDIDO'}),direction:'out'}],
 ['opaque callback',reply({payload:'confirm_order',id:'confirm'})],
 ['quoted template',reply({title:'CONFIRMAR MI PEDIDO'},'template')],
 ['other order',reply({text:'Confirmo el pedido ES999999'},'text')],
 ['old response',reply({title:'CONFIRMAR MI PEDIDO'},'postback',created-60000)],
 ['undated response',{type:'in',msg_type:'postback',payload:{title:'CONFIRMAR MI PEDIDO'}}]
]) test(`${label} cannot authorize a reminder confirmation`,()=>assert.notEqual(intent([message])?.intent,'CONFIRM'));

for(const [text,expected] of [['Ya no lo quiero','CANCEL'],['CAMBIAR DATOS DE ENVÍO','ADDRESS_CHANGE'],['Lo quiero solo si llega mañana','REVIEW'],['¿Cuánto cuesta?','REVIEW']]){
 test(`later structured reply supersedes reminder consent: ${text}`,()=>assert.equal(intent([reminder,reply({title:'CONFIRMAR MI PEDIDO'}),reply({text},'text',now-60000)]).intent,expected));
}

function dependencies(fresh){
 const events=[];
 return {events,dependencies:{
  duplicateGuard:async()=>{events.push('duplicate');return null;},
  resolveSubscriber:async()=>{events.push('identity');return {user_fields:[{name:'Dropea: Número',value:'900001'}]};},
  readOrder:async()=>{events.push('order');return order;},
  readMessages:async()=>{events.push('messages');return fresh;},
  confirmOrder:async()=>{events.push('confirm');return {accepted:true};},
  cancelOrder:async()=>{events.push('cancel');return {accepted:true};},
  verifyConfirmation:async()=>{events.push('verify');return {verified:true};}
 }};
}
const pending={...order,aiIntent:'CONFIRM_DELAY_PENDING',confirmationSource:'chatby_button',confirmationDelayStartedAt:new Date(confirmed).toISOString(),confirmationDueAt:new Date(confirmed+3600000).toISOString()};

test('reminder confirmation starts the full hour from the client reply, never from reminder delivery',async()=>{
 const recent=reply({title:'CONFIRMAR MI PEDIDO'},'postback',now-60000);
 const messages=normalizeChatMessages([reminder,recent]),signal=customerConversationIntentForOrder(messages,order);
 const result=await scheduleDelayedConfirmation(order,store,signal,signal.source,signal.occurred_at,messages);
 assert.equal(result.action,'confirmation_scheduled');
 assert.equal(Date.parse(result.dueAt),now-60000+3600000);
 const f=dependencies(messages);
 const result2=await processDelayedConfirmation({...pending,confirmationDueAt:result.dueAt},store,messages,f);
 assert.equal(result2.reason,'confirmation_delay_waiting');assert.deepEqual(f.events,[]);
});

test('due reminder reply rereads payload-only consent and verifies the same provider write',async()=>{
 const f=dependencies([reminder,reply({title:'CONFIRMAR MI PEDIDO'})]);
 const result=await processDelayedConfirmation(pending,store,normalizeChatMessages([reply({title:'CONFIRMAR MI PEDIDO'})]),f);
 assert.equal(result.action,'confirmed_after_delay');
 assert.deepEqual(f.events,['duplicate','identity','order','messages','confirm','verify']);
});

for(const [text,action] of [['Ya no lo quiero','rejected_after_confirmation_cancel'],['Necesito cambiar la dirección','hold_after_confirmation_address_change'],['Lo quiero solo si llega mañana','confirmation_review_required']]){
 test(`final fresh structured reply prevents confirmation: ${text}`,async()=>{
  const f=dependencies([reminder,reply({title:'CONFIRMAR MI PEDIDO'}),reply({text},'text',now-60000)]);
  const result=await processDelayedConfirmation(pending,store,normalizeChatMessages([reply({title:'CONFIRMAR MI PEDIDO'})]),f);
  assert.equal(result.action,action);assert.ok(!f.events.includes('confirm'));
 });
}

test('legacy top-level representation is preserved exactly',()=>{
 for(const content of ['CONFIRMAR MI PEDIDO','No lo quiero','Necesito cambiar la dirección']){
  const m={type:'in',content,ts:confirmed/1000,payload:{text:'ignored fallback'}};
  assert.equal(normalizeChatMessages([m])[0].content,content);
  assert.equal(normalizeChatMessages([m])[0].raw,m);
 }
});
