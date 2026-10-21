import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryReplyPlan,NON_DELIVERY_ACK} from './delivery-reply-policy.mjs';
import {executeDeliveryReply,sendDeliveryReplyOnce,verifiedDeliverySolution,solutionNoteHash} from './delivery-reply-executor.mjs';
import {readPersistedDetailProof} from './delivery-reply-runtime.mjs';
const now=Date.parse('2026-10-21T13:00:00Z');
function input(text='No me han entregado mi pedido'){
 return {incident:{orderId:'900001',incidenceId:'800001',incidentType:'absent',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'test',incidenceDate:'2026-10-21T07:00:00Z'},
  order:{orderId:'900001',status:'ERROR',createdAt:'2026-10-19T10:00:00Z',customerPhone:'600000001',customerName:'Example',raw:{shipping_address:{country:'ES',postal_code:'28001'}}},
  issue:{id:800001,order_id:900001,type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,allowed_resolution_options:['PROVIDE_SOLUTION','RETRY']},
  messages:[{id:'700001',type:'in',user_ns:'test',ts:Date.parse('2026-10-21T10:00:00Z')/1000,payload:{text}}],now};
}
function add(i,text,at='2026-10-21T10:00:30Z'){i.messages.push({id:String(700001+i.messages.length),type:'in',user_ns:'test',ts:Date.parse(at)/1000,payload:{text}});return i;}

test('explicit non-delivery gets the owner exact acknowledgement and a delivery solution, without invented dates',()=>{
 for(const text of ['No me ha llegado nada','No me a llegado el paquete','No han entregado mi pedido','El repartidor no ha pasado','No lo he rechazado','¿Cuándo he dicho yo que no?']){
  const p=deliveryReplyPlan(input(text));assert.equal(p.eligible,true,text);assert.equal(p.kind,'SOLUTION',text);
  assert.equal(p.acknowledgement,NON_DELIVERY_ACK);assert.match(p.note,/quiere recibir/);assert.equal(p.date,null);
 }
});
test('a factual follow-up does not erase the preceding explicit date/window',()=>{
 const i=add(input('Mañana por la tarde'),'Estoy trabajando');
 const p=deliveryReplyPlan(i);assert.equal(p.kind,'SOLUTION');assert.equal(p.date,'2026-10-22');assert.equal(p.time_window,'afternoon');
 assert.match(p.note,/Mañana por la tarde/);assert.equal(p.acknowledgement,null);
});
test('a precise hour refines the previous date, including hs and same-day future windows',()=>{
 const i=input('Mañana por la tarde');i.incident.incidenceDate='2026-10-20T07:00:00Z';
 i.messages[0].ts=Date.parse('2026-10-20T19:00:00Z')/1000;
 add(i,'Después de las 15hs, gracias','2026-10-20T19:00:30Z');
 const p=deliveryReplyPlan(i);assert.equal(p.kind,'SOLUTION');assert.equal(p.date,'2026-10-21');assert.equal(p.time_window,'afternoon');
 assert.match(p.note,/Después de las 15hs/);
});
test('recurring afternoon availability retains its literal lower bound',()=>{
 const p=deliveryReplyPlan(input('Cualquier día de la semana a partir de las 16h que es cuando termino'));
 assert.equal(p.kind,'SOLUTION');assert.equal(p.date,'2026-10-22');assert.match(p.note,/16h/);assert.equal(p.time_window,'afternoon');
 assert.equal(p.scheduleSource,'OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW');assert.match(p.note,/Proponemos próxima fecha hábil/);
});
test('punctuation does not erase a denial of refusal, but a pickup issue remains with its existing owner',()=>{
 const i=add(input('???????'),'¿Cuándo he dicho yo que no?');assert.equal(deliveryReplyPlan(i).kind,'SOLUTION');
 i.issue.type='PICKUP_AT_AGENCY';assert.equal(deliveryReplyPlan(i).reason,'EXISTING_PROVIDER_WORKFLOW_OWNER');
});
test('payment, ambiguous revisions and expired windows get one clarification, no transport decision',()=>{
 for(const text of ['No llevaba efectivo suficiente','Antes de las 16 horas o mejor esta tarde','Lo quiero el lunes por la tarde']){
  const i=input(text);if(text.includes('lunes'))i.now=Date.parse('2026-10-28T12:00:00Z');
  const p=deliveryReplyPlan(i);if(text.includes('lunes'))assert.equal(p.eligible,false);else{assert.equal(p.kind,'CLARIFY');assert.ok(p.content);assert.equal(p.note,undefined);}
 }
 const i=input('Esta tarde');i.now=Date.parse('2026-10-21T20:00:00Z');assert.equal(deliveryReplyPlan(i).kind,'CLARIFY');
});
test('current-order identity, one-hour settling and 24-hour message window remain required',()=>{
 for(const change of [i=>i.incident.chatbyOrderAssociation='PHONE_ONLY',i=>i.messages[0].user_ns='other',i=>i.messages[0].order_id='900002',i=>i.order.orderId='900002',i=>i.issue.status='RESOLVED',i=>i.order.status='DELIVERED',i=>i.incident.incidentType='address']){
  const i=input();change(i);assert.equal(deliveryReplyPlan(i).eligible,false);
 }
 const early=input();early.now=early.messages[0].ts*1000+100;assert.equal(deliveryReplyPlan(early).reason,'REPLY_SETTLING_WINDOW');
 const old=input();old.now=old.messages[0].ts*1000+86400000;assert.equal(deliveryReplyPlan(old).reason,'CUSTOMER_REPLY_WINDOW_EXPIRED');
});
test('later cancellations, address, agency and unknown conditions never become a delivery solution',()=>{
 for(const text of ['Ya no lo quiero','Quiero devolverlo','Prefiero recoger en agencia','Cambie la dirección','Solo si me hacen otro descuento']){
  const p=deliveryReplyPlan(add(input(),text));assert.ok(!p.eligible||p.kind==='CLARIFY',text);assert.equal(p.note,undefined);
 }
});
test('different-day old preferences cannot be silently erased by a new non-delivery complaint',()=>{
 const i=input('Lo quiero el viernes por la tarde');i.messages[0].ts=Date.parse('2026-10-21T08:00:00Z')/1000;
 add(i,'No han entregado nada','2026-10-21T10:00:00Z');assert.equal(deliveryReplyPlan(i).reason,'EARLIER_PREFERENCE_REQUIRES_RENEWAL');
});
test('a non-delivery complaint cannot resurrect an earlier cancellation outside the short reply cluster',()=>{
 const i=input('No quiero el pedido');i.messages[0].ts=Date.parse('2026-10-21T08:00:00Z')/1000;
 add(i,'No me han entregado nada','2026-10-21T10:00:00Z');assert.equal(deliveryReplyPlan(i).reason,'CANCELLATION_OR_RETURN_TAKES_PRECEDENCE');
});

function harness(){
 const plan=deliveryReplyPlan(input());const calls=[],messages=[];let claimed=false;
 const deps={now:()=>now,revalidate:async()=>plan,readMessages:async()=>messages,
  claimMessage:async()=>claimed?{acquired:false,persistent:true,existing:{status:'sent'}}:(claimed=true,{acquired:true,persistent:true}),
  finishMessage:async x=>{calls.push('message:'+x.status);return {};},
  send:async({content})=>{calls.push('send');messages.push({type:'agent',user_ns:'test',ts:now/1000,mid:'wamid.example',payload:{text:content}});return {message_id:'wamid.example'};},
  claimSolution:async()=>({acquired:true,persistent:true}),finishSolution:async s=>calls.push('solution:'+s),
  journal:async()=>calls.push('journal'),clearJournal:async()=>calls.push('clear'),
  writeSolution:async()=>calls.push('write'),verifySolution:async()=>true};
 return {plan,calls,messages,deps};
}
test('acknowledgement is read back and persisted once, then a shared claimed solution is verified',async()=>{
 const h=harness();const r=await executeDeliveryReply(h.plan,h.deps);
 assert.equal(r.status,'VERIFIED');assert.deepEqual(h.calls,['message:delivery_unverified','send','message:sent','solution:applied_unverified','journal','write','solution:verified','clear']);
 await sendDeliveryReplyOnce(h.plan,NON_DELIVERY_ACK,'ack',h.deps);assert.equal(h.calls.filter(x=>x==='send').length,1);
});
test('an uncertain Chatby send is reconciled without resending or reporting unverified delivery',async()=>{
 const h=harness();h.deps.send=async()=>{h.calls.push('send');throw Error('timeout');};
 const r=await executeDeliveryReply(h.plan,h.deps);assert.equal(r.status,'RECONCILE');assert.equal(h.calls.includes('write'),false);
 const g=harness();g.deps.claimMessage=async()=>({acquired:false,persistent:true,existing:{status:'delivery_unverified',attempted_at:new Date(now).toISOString()}});
 assert.equal((await executeDeliveryReply(g.plan,g.deps)).status,'RECONCILE');assert.deepEqual(g.calls,[]);
});
test('late changes, unavailable durable storage and existing issue claims prohibit mutation',async()=>{
 const h=harness();let reads=0;h.deps.revalidate=async()=>++reads<3?h.plan:{eligible:false};
 assert.equal((await executeDeliveryReply(h.plan,h.deps)).status,'BLOCKED');assert.equal(h.calls.includes('send'),false);assert.equal(h.calls.includes('write'),false);
 const g=harness();g.plan={...g.plan,acknowledgement:null};g.deps.revalidate=async()=>g.plan;
 g.deps.claimSolution=async()=>({acquired:false,persistent:true});
 assert.equal((await executeDeliveryReply(g.plan,g.deps)).status,'RECONCILE');assert.equal(g.calls.includes('write'),false);
 const n=harness();n.deps.claimMessage=async()=>({acquired:true,persistent:false});assert.equal((await executeDeliveryReply(n.plan,n.deps)).status,'BLOCKED');assert.deepEqual(n.calls,[]);
});
test('an unknown provider write is attempted once with the inflight journal retained',async()=>{
 const h=harness();h.deps.writeSolution=async()=>{h.calls.push('write');throw Error('timeout');};h.deps.verifySolution=async()=>false;
 const r=await executeDeliveryReply(h.plan,h.deps);assert.equal(r.status,'RECONCILE');assert.equal(h.calls.filter(x=>x==='write').length,1);assert.equal(h.calls.includes('clear'),false);
});
test('provider readback requires the exact solution note, numeric identities and fresh timestamp',()=>{
 const h=harness(),at=new Date(now).toISOString();
 const raw={id:800001,order_id:900001,status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_note:h.plan.note,resolution_changed_at:at};
 assert.equal(verifiedDeliverySolution(raw,h.plan,at),true);
 for(const d of [{id:800002},{order_id:900002},{resolution_note:'Different'},{resolution_note:null},{resolution_changed_at:'2020-01-01T00:00:00Z'}])assert.equal(verifiedDeliverySolution({...raw,...d},h.plan,at),false);
});
test('an API omission requires bound fresh persisted-detail evidence, never an HTTP receipt alone',()=>{
 const h=harness(),at=new Date(now).toISOString();
 const raw={id:800001,order_id:900001,status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_changed_at:at};
 const proof={provider:'DROPEA_PERSISTED_DETAIL',verified:true,orderId:'900001',issueId:'800001',noteHash:solutionNoteHash(h.plan.note),observedAt:at};
 assert.equal(verifiedDeliverySolution(raw,h.plan,at),false);assert.equal(verifiedDeliverySolution(raw,h.plan,at,proof),true);
 for(const d of [{orderId:'900002'},{issueId:'800002'},{noteHash:'wrong'},{observedAt:'2020-01-01T00:00:00Z'},{verified:false},{provider:'HTTP_RECEIPT'}])assert.equal(verifiedDeliverySolution(raw,h.plan,at,{...proof,...d}),false);
});
test('persisted detail waits for the note and reads fresh modal content, never the loading snapshot',async()=>{
 const h=harness(),events=[];let ready=false;
 const named={waitFor:async()=>events.push('dialog'),count:async()=>1};
 const dialog={getByText:(text)=>text==='Cerrar'?{click:async()=>events.push('close')}:{waitFor:async()=>{ready=true;events.push('note');}},
  innerText:async()=>{assert.equal(ready,true);events.push('fresh text');return `Detalle de Incidencia ES900001 ${h.plan.note}`;}};
 const page={getByRole:()=>named,screenshot:async()=>events.push('screenshot')};
 const proof=await readPersistedDetailProof({},h.plan,{read:async()=>({page,dialog,text:'Loading...'}),write:async()=>events.push('proof')});
 assert.equal(proof.verified,true);assert.equal(proof.noteHash,solutionNoteHash(h.plan.note));
 assert.deepEqual(events,['dialog','note','fresh text','screenshot','proof','close']);
});
