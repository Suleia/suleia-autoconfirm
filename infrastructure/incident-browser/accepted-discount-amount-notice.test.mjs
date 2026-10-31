import test from 'node:test';import assert from 'node:assert/strict';
import {acceptedDiscountPlan} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
import {deliveryReplyPlan} from './delivery-reply-policy.mjs';
import {INCIDENT_DISCOUNT_TEMPLATE_NAME} from '../../autoconfirm/src/workflows/incident-discount-template.mjs';
import {acceptedDiscountAmountContent,existingDiscountAmountNotice,sendAcceptedDiscountAmountOnce} from './accepted-discount-amount-notice.mjs';
const now=Date.parse('2026-10-26T15:00:00Z'),acceptedAt='2026-10-26T12:00:00Z';
const source={orderId:'900001',issueId:'800001',ownerId:'1234',phone:'+34600000000',conversationPhone:'+34600000000',customerName:'Fixture',conversationId:'fixture',exactOrder:true,readVerified:true,
 issueStatus:'PENDING',active:true,allowed:['PROVIDE_SOLUTION'],issueAt:'2026-10-26T08:00:00Z',offerAt:'2026-10-26T11:00:00Z',acceptedAt,intent:'ACCEPTS_DISCOUNT',offerVerified:true,offerMessageId:'700000',acceptanceMessageId:'700001',originalAmount:29.99,currentAmount:29.99,offeredAmount:24.99,currency:'EUR'};
const options={now,activationAt:'2026-10-01T00:00:00Z'};
const plan=()=>acceptedDiscountPlan(source,options);
const outgoing=(text,at=now)=>({type:'agent',user_ns:'fixture',mid:'wamid.fixture',ts:at/1000,payload:{text}});
function delivery(text){return {incident:{orderId:'900001',incidenceId:'800001',incidentType:'absent',chatbyUserNs:'fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',incidenceDate:source.issueAt},
 order:{orderId:'900001',status:'ERROR',createdAt:'2026-10-24T08:00:00Z',orderAmount:29.99,currencyCode:'EUR'},issue:{id:800001,order_id:900001,type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION']},
 messages:[{id:'700001',type:'in',user_ns:'fixture',ts:Date.parse(acceptedAt)/1000,payload:{text}}],now};}

test('discount acceptance and negotiation never enter generic cash/day/window clarification',()=>{
 for(const text of ['Quiero el descuento','Acepto el descuento de 5 euros','Sí, con el descuento quiero recibirlo','Quiero recibirlo con la rebaja','Quiero cambiar el precio']){
  const p=deliveryReplyPlan(delivery(text));assert.equal(p.eligible,false,text);assert.equal(p.reason,'DISCOUNT_REQUIRES_EXISTING_OWNER',text);assert.equal(p.content,undefined);
 }
 const i=delivery('Acepto');i.messages.unshift({...outgoing(INCIDENT_DISCOUNT_TEMPLATE_NAME,Date.parse(source.offerAt)),name:INCIDENT_DISCOUNT_TEMPLATE_NAME});
 assert.equal(deliveryReplyPlan(i).reason,'DISCOUNT_REQUIRES_EXISTING_OWNER');
 i.messages.push({id:'700002',type:'in',user_ns:'fixture',ts:Date.parse(acceptedAt)/1000+30,payload:{text:'Mañana por la tarde'}});
 assert.equal(deliveryReplyPlan(i).reason,'DISCOUNT_REQUIRES_EXISTING_OWNER');
});
test('unrelated cash constraints and existing no-discount delivery behavior remain owned by their current paths',()=>{
 assert.equal(deliveryReplyPlan(delivery('No tenía efectivo, mañana por la tarde')).kind,'CLARIFY');
 assert.equal(deliveryReplyPlan(delivery('Quiero recibir el pedido')).kind,'SOLUTION');
 const i=delivery('Ya no quiero el pedido');assert.equal(deliveryReplyPlan(i).eligible,false);
 const old=delivery('Quiero recibir el pedido');old.messages.unshift(outgoing(INCIDENT_DISCOUNT_TEMPLATE_NAME,Date.parse('2026-10-20T11:00:00Z')));
 assert.equal(deliveryReplyPlan(old).kind,'SOLUTION');
});
test('notice computes only original minus five with no further payment or scheduling question',()=>{
 for(const [original,final] of [[29.99,24.99],[34.99,29.99],[44.99,39.99]]){
  const p=acceptedDiscountPlan({...source,originalAmount:original,currentAmount:original,offeredAmount:final},options),text=acceptedDiscountAmountContent(p);
  assert.ok(text.includes(final.toFixed(2).replace('.',',')));assert.doesNotMatch(text,/efectivo|confirme|franja|horario|qué día|\?/i);
 }
 for(const patch of [{eligible:false},{finalCents:1999},{originalCents:2499},{finalCents:NaN}])assert.equal(acceptedDiscountAmountContent({...plan(),...patch}),null);
 assert.equal(acceptedDiscountPlan({...source,currentAmount:24.99},options).reason,'ALREADY_DISCOUNTED_RECONCILE');
});
test('existing verified human amount notification avoids a duplicate while wrong amounts/inbound/stale text do not',()=>{
 const correct=outgoing('Hola, disculpe el error. Se aplica el descuento de 5€. El importe final de su pedido es de 24,99€.');
 assert.ok(existingDiscountAmountNotice([correct],plan()));
 for(const m of [{...correct,type:'in'}, {...correct,user_ns:'other'},outgoing(correct.payload.text,Date.parse(acceptedAt)-1000),outgoing(correct.payload.text.replace('24,99','29,99')),
  outgoing('El importe final es de 24,99€ sin descuento de 5€'),outgoing('El importe final no es 24,99€. Descuento de 5€')])assert.equal(existingDiscountAmountNotice([m],plan()),null);
});
function harness(){
 const p=plan(),messages=[],events=[],rows=new Map();let sends=0;
 const deps={now:()=>now,readMessages:async()=>messages,revalidate:async()=>({eligible:true,hash:p.snapshot}),
  claimMessage:async key=>{const k=key.templateName;if(rows.has(k))return {persistent:true,acquired:false,existing:rows.get(k)};rows.set(k,{status:'claimed'});return {persistent:true,acquired:true};},
  finishMessage:async row=>{rows.set(row.templateName,{status:row.status,attempted_at:row.attemptedAt});events.push(row.status);return {};},
  send:async({content})=>{sends++;messages.push(outgoing(content));return {mid:'wamid.fixture'};}};
 return {p,deps,messages,events,rows,sends:()=>sends};
}
test('same existing sender journals one per-order notice, verifies it, and does not resend after reopening',async()=>{
 const h=harness();assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'VERIFIED');
 assert.deepEqual(h.events,['delivery_unverified','sent']);assert.ok(h.rows.has('accepted_discount_amount_notice_v1'));
 await sendAcceptedDiscountAmountOnce({...h.p,issueId:'800002'},h.deps);assert.equal(h.sends(),1);
});
test('uncertain send retains the durable claim and is never retried',async()=>{
 const h=harness();h.deps.send=async()=>{h.events.push('send');throw Error('uncertain');};
 assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'RECONCILE');
 assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'RECONCILE');assert.equal(h.events.filter(x=>x==='send').length,1);
});
test('concurrent callers share one existing durable message reservation',async()=>{
 const h=harness();await Promise.all([sendAcceptedDiscountAmountOnce(h.p,h.deps),sendAcceptedDiscountAmountOnce(h.p,h.deps)]);assert.equal(h.sends(),1);
});
test('later cancellation, wrong snapshot, settling, stale window and failed durable journal all block sends',async()=>{
 for(const override of [{eligible:false},{eligible:true,hash:'changed'}]){const h=harness();h.deps.revalidate=async()=>override;assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'BLOCKED');assert.equal(h.sends(),0);}
 for(const t of [now-30*60000,now-24*3600000,now+1000]){const h=harness();assert.equal((await sendAcceptedDiscountAmountOnce({...h.p,acceptedAt:new Date(t).toISOString()},h.deps)).status,'BLOCKED');assert.equal(h.sends(),0);}
 const h=harness();h.deps.finishMessage=async()=>({skipped:true});await assert.rejects(sendAcceptedDiscountAmountOnce(h.p,h.deps),/DURABLE_JOURNAL/);assert.equal(h.sends(),0);
});

test('production applied-amount gate blocks original, stale, wrong-order and unavailable totals; fresh final amount alone proceeds',async()=>{
 const correct={verified:true,orderId:'900001',currency:'EUR',amount:24.99,readAt:new Date(now).toISOString()};
 for(const patch of [{amount:29.99},{verified:false},{orderId:'900002'},{currency:'USD'},{readAt:new Date(now-61000).toISOString()},{amount:null}]){
  const h=harness();h.deps.requireAppliedAmount=true;h.deps.readCurrentAmount=async()=>({...correct,...patch});
  assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).reason,'WAIT_VERIFIED_DISCOUNT_AMOUNT');assert.equal(h.sends(),0);
 }
 const h=harness();h.deps.requireAppliedAmount=true;h.deps.readCurrentAmount=async()=>{throw Error('429');};
 assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'BLOCKED');assert.equal(h.sends(),0);
 h.deps.readCurrentAmount=async()=>correct;assert.equal((await sendAcceptedDiscountAmountOnce(h.p,h.deps)).status,'VERIFIED');assert.equal(h.sends(),1);
});
