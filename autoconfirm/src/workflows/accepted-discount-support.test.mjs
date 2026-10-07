import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedDiscountPlan,runAcceptedDiscount,validateSupportEvidence,moneyCents} from './accepted-discount-support.mjs';
const now=Date.parse('2026-10-08T14:00:00Z'),options={now,activationAt:'2026-10-07T00:00:00Z'};
const input={orderId:'123456',issueId:'234567',ownerId:'1234',phone:'+34600000000',conversationPhone:'+34600000000',customerName:'Test Customer',conversationId:'test_user',exactOrder:true,readVerified:true,
 issueStatus:'PENDING',active:true,allowed:['PROVIDE_SOLUTION'],issueAt:'2026-10-07T10:00:00Z',offerAt:'2026-10-08T10:00:00Z',acceptedAt:'2026-10-08T11:00:00Z',intent:'ACCEPTS_DISCOUNT',offerVerified:true,offerMessageId:'101',acceptanceMessageId:'102',originalAmount:29.99,currentAmount:29.99,offeredAmount:24.99,currency:'EUR'};
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(2000)]);
function evidence(p){return {...p,source:'CHATBY_BROWSER_SCREENSHOT',capturedAt:new Date().toISOString(),visiblePhone:true,visibleDateTime:true,visibleAcceptance:true,visibleOffer:true,attachments:[{filename:'test-proof.png',mimeType:'image/png',bytes:image}]};}
test('computes exact customer-specific totals and support instruction',()=>{
 for(const [total,final] of [[29.99,24.99],[34.99,29.99],[42.99,37.99]]){
  const p=acceptedDiscountPlan({...input,originalAmount:total,currentAmount:total,offeredAmount:final},options);
  assert.equal(p.eligible,true);assert.equal(p.finalCents,Math.round(final*100));assert.equal(p.email.to,'soporte@dropea.com');
  assert.equal(p.email.subject,'Aplicar descuento en pedido ES123456');assert.match(p.email.text,/234567/);assert.match(p.solution,/600000000 antes de entregar/);assert.equal(p.discountApplied,false);
 }
});
test('rejects unverified identity, old/changed offer, cancellation and repeat discount',()=>{
 for(const patch of [{exactOrder:false},{readVerified:false},{offerVerified:false},{intent:'REQUESTS_RETURN'},{intent:'AMBIGUOUS'},
  {currentAmount:24.99},{currentAmount:30},{offeredAmount:20},{currency:'USD'},{phone:'+34611111111'},
  {issueStatus:'RESOLVED'},{active:false},{allowed:[]},{priorReturn:true},{pickupArranged:true},
  {acceptedAt:'2026-10-08T13:30:00Z'},{acceptedAt:'2026-10-06T12:00:00Z'},{offerAt:'2026-10-06T12:00:00Z'},{originalAmount:5,offeredAmount:0,currentAmount:5},{offerMessageId:null}]){
  assert.equal(acceptedDiscountPlan({...input,...patch},options).eligible,false,JSON.stringify(patch));
 }
 assert.equal(moneyCents('24,99'),2499);assert.equal(moneyCents('29.999'),null);assert.equal(moneyCents(''),null);
});
test('screenshot evidence rejects wrong case, missing phone/time and stale/fake content',()=>{
 const p=acceptedDiscountPlan(input,options),ev=evidence(p);assert.equal(validateSupportEvidence(p,ev),true);
 for(const patch of [{orderId:'99'},{phone:'+34611111111'},{acceptanceMessageId:'99'},{visibleDateTime:false},{visiblePhone:false},{visibleOffer:false},{source:'RENDERED_TRANSCRIPT'},{capturedAt:'2020-01-01'}, {attachments:[{filename:'test.png',mimeType:'image/png',bytes:Buffer.alloc(2000)}]}])assert.equal(validateSupportEvidence(p,{...ev,...patch}),false);
});
function fixture(overrides={}){
 const events=[],saved=[],plan=acceptedDiscountPlan(input,options);let claimed=false;
 const deps={ready:()=>true,read:async()=>input,get:async()=>null,capture:async p=>{events.push('capture');return evidence(p);},
  claim:async()=>{if(claimed)return {acquired:false,persistent:true};claimed=true;events.push('claim');return {acquired:true,persistent:true};},
  save:async(p,status,raw)=>{events.push(status);saved.push({status,raw});},send:async()=>{events.push('send');return 'mail1';},
  verifyMail:async()=>{events.push('verifyMail');return true;},solve:async()=>events.push('solve'),verifySolution:async()=>{events.push('verifySolution');return true;},...overrides};
 return {deps,events,saved,plan};
}
test('mail and exact attachments must verify before provider mutation',async()=>{
 const f=fixture();const r=await runAcceptedDiscount({},f.deps,options);assert.equal(r.status,'SUPPORT_SENT_SOLUTION_VERIFIED');assert.equal(r.discountApplied,false);
 assert.ok(f.events.indexOf('verifyMail')<f.events.indexOf('solve'));assert.equal(f.saved.at(-1).status,'verified');assert.ok(f.saved[0].raw.attachmentHashes[0].sha256);
});
test('missing connections perform no reads or writes',async()=>{
 const f=fixture({ready:()=>false,read:async()=>{throw Error('must not read');}});assert.equal((await runAcceptedDiscount({},f.deps,options)).status,'CONNECTIONS_REQUIRED');assert.deepEqual(f.events,[]);
});
test('uncertain email, missing attachment readback and uncertain solution never retry',async()=>{
 for(const overrides of [{send:async()=>{throw Error('timeout');}},{verifyMail:async()=>false},{solve:async()=>{throw Error('timeout');}},{verifySolution:async()=>false}]){
  const f=fixture(overrides),r=await runAcceptedDiscount({},f.deps,options);assert.equal(r.status,'RECONCILIATION_REQUIRED');assert.equal(f.saved.at(-1).status,'unknown');
  if(overrides.send||overrides.verifyMail)assert.ok(!f.events.includes('solve'));
 }
});
test('later customer correction after email blocks solution',async()=>{
 let n=0;const f=fixture({read:async()=>++n===4?{...input,intent:'REQUESTS_RETURN'}:input});
 const r=await runAcceptedDiscount({},f.deps,options);assert.equal(r.status,'EMAIL_SENT_SOLUTION_BLOCKED');assert.ok(!f.events.includes('solve'));
});
test('capture race and duplicate claim cannot send',async()=>{
 let n=0;const f=fixture({read:async()=>++n===2?{...input,currentAmount:40}:input});assert.equal((await runAcceptedDiscount({},f.deps,options)).status,'CUSTOMER_OR_ORDER_CHANGED');assert.ok(!f.events.includes('send'));
 const g=fixture({claim:async()=>({acquired:false,persistent:true})});await runAcceptedDiscount({},g.deps,options);assert.ok(!g.events.includes('send'));
});
test('durable prior claim across reopened issue or restart requires reconciliation',async()=>{
 const f=fixture({get:async()=>({status:'unknown'})});assert.equal((await runAcceptedDiscount({},f.deps,options)).status,'RECONCILIATION_REQUIRED');assert.deepEqual(f.events,[]);
 assert.equal(acceptedDiscountPlan(input,options).key,acceptedDiscountPlan({...input,issueId:'88888'},options).key);
});
test('concurrent workers claim once and never send twice',async()=>{
 const f=fixture();await Promise.all([runAcceptedDiscount({},f.deps,options),runAcceptedDiscount({},f.deps,options)]);assert.equal(f.events.filter(x=>x==='send').length,1);
});
