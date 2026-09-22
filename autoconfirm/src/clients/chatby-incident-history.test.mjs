import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CHATBY_TOKEN = 'synthetic-token';
process.env.CHATBY_BASE_URL = 'https://chatby.test/api';
process.env.CHATBY_REQUEST_MIN_INTERVAL_MS = '0';
const { getIncidentChatMessages, getChatMessages } = await import('./chatby.mjs');
const { incidentDiscountPolicy } = await import('../workflows/incident-discount-policy.mjs');
const now = Date.parse('2026-09-22T17:00:00Z');
const initial = { mid:'wamid.INITIAL', type:'out', ts:Math.floor((now-26*3600000)/1000), content:'dropea_incidencia_mercancia_v1', payload:{ name:'dropea_incidencia_mercancia_v1' } };
const incident = { incidentType:'rejected_goods', issueStatus:'PENDING', chatbyReadVerified:true, chatbyUserNs:'synthetic-case', incidenceDate:new Date(now-25*3600000).toISOString() };
const evaluate = messages => incidentDiscountPolicy({incident,messages,now,discountTemplateName:'dropea_incidencia_descuento_5_v1'});
function response(data) { return new Response(JSON.stringify({data}), {status:200}); }

test('native bot evidence unblocks a due discount while confirmation reader remains unchanged', async () => {
 const original=globalThis.fetch;
 globalThis.fetch=async url=>response(new URL(url).searchParams.get('include_bot')==='1'?[initial]:[]);
 try {
  assert.equal(evaluate(await getChatMessages('synthetic-case')).reason,'merchandise_template_not_verified');
  assert.equal(evaluate(await getIncidentChatMessages('synthetic-case')).eligible,true);
 } finally {globalThis.fetch=original;}
});

test('native discount and any subsequent customer activity still prevent sending', async () => {
 const original=globalThis.fetch;
 try {
  for(const [message,reason] of [
   [{mid:'wamid.DISCOUNT',type:'out',ts:now/1000-600,content:'dropea_incidencia_descuento_5_v1'},'discount_template_already_sent'],
   [{mid:'wamid.REPLY',type:'in',ts:now/1000-600,content:'synthetic reply'},'customer_interaction_after_merchandise_template']
  ]) {
   globalThis.fetch=async()=>response([message,initial]);
   assert.equal(evaluate(await getIncidentChatMessages('synthetic-case')).reason,reason);
  }
 } finally {globalThis.fetch=original;}
});

test('reads beyond 100 recent bot messages using inclusive time overlap and deduplicates', async () => {
 const original=globalThis.fetch;let calls=0;
 const recent=Array.from({length:100},(_,n)=>({mid:`wamid.BOT${n}`,type:'out',ts:now/1000-n,content:'synthetic'}));
 globalThis.fetch=async url=>{
  const q=new URL(url).searchParams;assert.equal(q.get('include_bot'),'1');assert.equal(q.get('limit'),'100');
  calls++;
  if(calls===1)return response(recent);
  assert.equal(q.get('end_time'),String(recent.at(-1).ts));
  return response([recent.at(-1),initial]);
 };
 try {const messages=await getIncidentChatMessages('synthetic-case');assert.equal(messages.length,101);assert.equal(evaluate(messages).eligible,true);}
 finally {globalThis.fetch=original;}
});

test('saturated timestamp and malformed history fail closed rather than authorizing a discount', async () => {
 const original=globalThis.fetch;
 try {
  for(const ts of [now/1000,undefined]) {
   globalThis.fetch=async()=>response(Array.from({length:100},(_,n)=>({mid:`wamid.${n}`,ts,type:'out'})));
   await assert.rejects(getIncidentChatMessages('synthetic-case'),{code:'CHATBY_INCIDENT_HISTORY_INCOMPLETE'});
  }
  globalThis.fetch=async()=>response({unexpected:true});
  await assert.rejects(getIncidentChatMessages('synthetic-case'),/CHATBY_INCIDENT_MESSAGES_INVALID/);
 } finally {globalThis.fetch=original;}
});
