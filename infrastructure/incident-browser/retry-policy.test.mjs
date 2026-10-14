import test from 'node:test';
import assert from 'node:assert/strict';
import {preciseRetrySlot,executeEvidenceRetry,retryEvidencePlan,requestedWindowWithoutDate} from './retry-policy.mjs';
import {nextBusinessMorning} from './business-day.mjs';
const at=Date.parse('2026-10-13T13:02:09Z');
test('owner example anchors Thursday to the message and preserves morning',()=>{
 assert.deepEqual(preciseRetrySlot('De 11 :30 ha 13:30 jueves si puede ser gracias',at),{date:'2026-10-15',time_window:'morning'});
});
test('ambiguous days and invalid or unmapped ranges do not execute',()=>{
 for(const text of ['De 11:30 a 13:30 jueves o viernes','De 11:90 a 13:30 jueves','De 17:30 a 20:30 jueves','De 13:30 a 11:30 jueves']){
  const p=preciseRetrySlot(text,at);assert.ok(!p.date||!p.time_window,text);
 }
});
function harness(){
 const calls=[],plan={eligible:true,hash:'same'};
 return {calls,plan,deps:{revalidate:async()=>plan,capture:async()=>({verified:true,path:'/private/proof.png'}),
  claim:async()=>({acquired:true,persistent:true}),finish:async s=>calls.push(s),
  write:async()=>calls.push('write'),verify:async()=>true}};
}
test('late cancellation after claim prevents provider mutation',async()=>{
 const h=harness();let reads=0;h.deps.revalidate=async()=>++reads===1?h.plan:{eligible:false};
 assert.equal((await executeEvidenceRetry(h.plan,h.deps)).reason,'LATE_REPLY');assert.deepEqual(h.calls,['aborted']);
});
test('unknown write is attempted once and remains reserved',async()=>{
 const h=harness();h.deps.write=async()=>{h.calls.push('write');throw Error('timeout');};h.deps.verify=async()=>false;
 assert.equal((await executeEvidenceRetry(h.plan,h.deps)).status,'RECONCILE');assert.deepEqual(h.calls,['applied_unverified','write','applied_unverified']);
});
test('existing claim and missing evidence prohibit writes',async()=>{
 const h=harness();h.deps.claim=async()=>({acquired:false,persistent:true});
 assert.equal((await executeEvidenceRetry(h.plan,h.deps)).status,'RECONCILE');assert.deepEqual(h.calls,[]);
 h.deps.capture=async()=>({verified:false});assert.equal((await executeEvidenceRetry(h.plan,h.deps)).reason,'PROOF_REQUIRED');assert.deepEqual(h.calls,[]);
});
function caseInput(){return {
 incident:{orderId:'900001',incidenceId:'800001',incidentType:'rejected_goods',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'testns',incidenceDate:'2026-10-13T10:00:00Z'},
 order:{orderId:'900001',status:'INCIDENCE',createdAt:'2026-10-12T10:00:00Z',customerPhone:'600000001',customerName:'Test Customer'},
 issue:{id:800001,order_id:900001,status:'PENDING',is_active:true,resolution_status:null,allowed_resolution_options:['RETRY']},
 messages:[{id:700001,direction:'incoming',created_at:new Date(at).toISOString(),text:'De 11 :30 ha 13:30 jueves si puede ser gracias'}],now:at+3600001};}
test('complete exact-order example produces a future retry with evidence identity',()=>{
 const p=retryEvidencePlan(caseInput());assert.equal(p.eligible,true);assert.equal(p.date,'2026-10-15');assert.equal(p.time_window,'morning');
});
test('later cancellation, question, pickup and stale association block retry',()=>{
 for(const text of ['ya no lo quiero','¿dónde está?','recoger en agencia']){
  const i=caseInput();i.messages.push({id:700002,direction:'incoming',created_at:new Date(at+1000).toISOString(),text});assert.equal(retryEvidencePlan(i).eligible,false,text);
 }
 const i=caseInput();i.incident.chatbyOrderAssociation='PHONE_ONLY';assert.equal(retryEvidencePlan(i).eligible,false);
});
test('already resolved cases, unsettled replies and elapsed dates cannot execute',()=>{
 const i=caseInput();i.issue.status='RESOLVED';assert.equal(retryEvidencePlan(i).eligible,false);
 const j=caseInput();j.now=at+500;assert.equal(retryEvidencePlan(j).reason,'REPLY_SETTLING_WINDOW');
 const k=caseInput();k.now=Date.parse('2026-10-16T10:00:00Z');assert.equal(retryEvidencePlan(k).eligible,false);
});

function defaultInput(){const i=caseInput();i.messages[0].text='Yo si lo quiero';i.order.raw={shipping_address:{country:'ES',postal_code:'30420'}};return i;}
test('owner default schedules plain desire for next business morning',()=>{
 const p=retryEvidencePlan(defaultInput());assert.equal(p.eligible,true);assert.equal(p.date,'2026-10-14');assert.equal(p.time_window,'morning');assert.equal(p.scheduleSource,'OWNER_NEXT_BUSINESS_MORNING');
 const i=defaultInput();i.now=at+100;assert.equal(retryEvidencePlan(i).reason,'REPLY_SETTLING_WINDOW');
});
test('default never replaces partial, precise, conditional or older preferences',()=>{
 for(const text of ['Lo quiero el jueves','Lo quiero de 17:30 a 20:30','Lo quiero si me llaman','Lo quiero con descuento','Lo quiero en otra dirección']){
  const i=defaultInput();i.messages[0].text=text;assert.equal(retryEvidencePlan(i).eligible,false,text);
 }
 const i=defaultInput();i.messages.unshift({id:699999,direction:'incoming',created_at:new Date(at-1000).toISOString(),text:'El jueves por la tarde'});
 assert.equal(retryEvidencePlan(i).reason,'PRIOR_CUSTOMER_PREFERENCE_REQUIRES_REVIEW');
});

test('missing date preserves the requested window on the next business day',()=>{
 for(const [text,window] of [['Lo quiero por la tarde','afternoon'],['Quiero recibirlo por la mañana','morning'],['No estaba en casa. Por favor, podrían entregármelo por la tarde.','afternoon'],['No me encontraba en casa, si por favor en la tarde pueden entregármelo','afternoon']]){
  const i=defaultInput();i.messages[0].text=text;i.now=Date.parse('2026-10-13T16:00:00Z');
  const p=retryEvidencePlan(i);assert.equal(p.eligible,true,text);assert.equal(p.date,'2026-10-14');assert.equal(p.time_window,window);assert.equal(p.scheduleSource,'OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW');
 }
});

test('missing-date rule does not discard any other customer condition',()=>{
 for(const text of ['No lo quiero por la tarde','Lo quiero por la tarde mañana','Lo quiero por la tarde el jueves','Lo quiero por la tarde a las 17:30','Lo quiero por la mañana o por la tarde','Lo quiero por la tarde si me llaman','Lo quiero por la tarde con descuento','Lo quiero por la tarde en otra dirección','Lo quiero por la tarde pero no mañana','Lo quiero por la tarde?','No estaba en casa pero no lo quiero por la tarde','Por la tarde','Quizás lo quiero por la tarde']){
  assert.equal(requestedWindowWithoutDate(text),null,text);
 }
});

test('missing-date rule retains evidence, settling, expiry and calendar gates',()=>{
 const make=()=>{const i=defaultInput();i.messages[0].text='Lo quiero por la tarde';return i;};
 const early=make();early.now=at+100;assert.equal(retryEvidencePlan(early).reason,'REPLY_SETTLING_WINDOW');
 const old=make();old.now=at+86400000;assert.equal(retryEvidencePlan(old).reason,'MISSING_DATE_RESPONSE_EXPIRED');
 const geo=make();geo.order.raw={};assert.equal(retryEvidencePlan(geo).reason,'BUSINESS_CALENDAR_REQUIRED');
 const wrong=make();wrong.incident.chatbyOrderAssociation='PHONE_ONLY';assert.equal(retryEvidencePlan(wrong).eligible,false);
 for(const text of ['El viernes por la mañana','Acepto el descuento','Cambiar la dirección']){
  const i=make();i.messages.unshift({id:699999,direction:'incoming',created_at:new Date(at-1000).toISOString(),text});assert.equal(retryEvidencePlan(i).reason,'PRIOR_CUSTOMER_PREFERENCE_REQUIRES_REVIEW');
 }
 for(const text of ['Ya no lo quiero','¿Dónde está mi pedido?','Recoger en agencia']){
  const i=make();i.messages.push({id:700002,direction:'incoming',created_at:new Date(at+1000).toISOString(),text});assert.equal(retryEvidencePlan(i).eligible,false);
 }
 const holiday=make();holiday.messages[0].created_at='2026-10-09T16:00:00Z';holiday.incident.incidenceDate='2026-10-09T10:00:00Z';holiday.order.createdAt='2026-10-08T10:00:00Z';holiday.now=Date.parse('2026-10-09T18:00:00Z');
 const p=retryEvidencePlan(holiday);assert.equal(p.date,'2026-10-13');assert.equal(p.time_window,'afternoon');
});
test('business-day default skips weekends and national/regional holidays',()=>{
 const order=defaultInput().order;
 assert.equal(nextBusinessMorning(Date.parse('2026-10-09T18:00:00Z'),order).date,'2026-10-13');
 assert.equal(nextBusinessMorning(Date.parse('2026-12-04T18:00:00Z'),order).date,'2026-12-09');
 assert.equal(nextBusinessMorning(Date.parse('2026-12-31T18:00:00Z'),order).date,'2027-01-04');
 assert.equal(nextBusinessMorning(Date.parse('2026-06-08T18:00:00Z'),order).date,'2026-06-10');
 assert.equal(nextBusinessMorning(Date.parse('2027-12-31T18:00:00Z'),order),null);
 assert.equal(nextBusinessMorning(at,{}),null);
});
