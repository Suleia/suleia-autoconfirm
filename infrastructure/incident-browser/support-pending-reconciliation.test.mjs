import test from 'node:test';import assert from 'node:assert/strict';
import {reconcilePendingSupport} from './support-pending-reconciliation.mjs';
import {acceptedDiscountPlan} from '../../autoconfirm/src/workflows/accepted-discount-support.mjs';
function fixture(){
 const incident={orderId:'900001',incidenceId:'800001',chatbyUserNs:'fixture'};
 const candidate={orderId:'900001',issueId:'800001',ownerId:'42',exactOrder:true,readVerified:true,phone:'+34600000000',conversationPhone:'+34600000000',conversationId:'fixture',customerName:'Fixture',
  issueStatus:'PENDING',active:true,allowed:['PROVIDE_SOLUTION'],issueAt:'2026-10-24T09:00:00Z',offerAt:'2026-10-24T10:00:00Z',acceptedAt:'2026-10-24T11:00:00Z',intent:'ACCEPTS_DISCOUNT',offerVerified:true,offerMessageId:'101',acceptanceMessageId:'102',originalAmount:24.99,offeredAmount:19.99,currentAmount:24.99,currency:'EUR'};
 const plan=acceptedDiscountPlan(candidate,{now:Date.parse('2026-10-24T13:00:00Z'),activationAt:'2026-10-01T00:00:00Z'});
 const receipt={store_id:'suleia',order_id:'900001',provider:'gmail_then_dropea',template_name:'accepted_discount_support_v1',chatby_user_ns:'fixture',status:'unknown',
  raw:{workflow:'accepted_discount_support_v1',orderId:'900001',issueId:'800001',phase:'SOLUTION_REQUESTED',mailId:'fixture-mail',snapshot:plan.snapshot,originalCents:2499,finalCents:1999,acceptanceMessageId:'102',acceptedAt:candidate.acceptedAt,requestedAt:'2026-10-24T12:30:00Z',attachmentHashes:[{filename:'fixture.png',sha256:'a'.repeat(64)}]}};
 const calls=[];
 const deps={readPlan:async()=>({candidate,plan}),verifyMail:async()=>{calls.push('mail read');return true;},
  readOperation:async()=>{calls.push('operation read');return {status:'failed',errorCode:'GLS_INCIDENCE_ALREADY_SOLVED'};},
  verifySolution:async()=>{calls.push('solution read');return true;},finishVerified:async()=>calls.push('verified receipt')};
 return {incident,candidate,plan,receipt,calls,deps};
}
const run=f=>reconcilePendingSupport(f.incident,f.receipt,f.deps);
test('verified email plus definitive carrier rejection becomes a visible support blocker without another action',async()=>{
 const f=fixture(),r=await run(f);assert.equal(r.status,'SUPPORT_SENT_PROVIDER_REJECTED');assert.equal(r.reason,'GLS_INCIDENCE_ALREADY_SOLVED');
 assert.equal(r.emailVerified,true);assert.equal(r.providerSolutionVerified,false);assert.equal(r.expectedAmountCents,1999);
 assert.equal(r.needsHumanReview,true);assert.equal(r.discountApplied,false);assert.equal(r.carrierCodApplied,null);
 assert.deepEqual(f.calls,['mail read','operation read']);
});
test('completed operation requires independent provider state before updating the original receipt',async()=>{
 const f=fixture();f.deps.readOperation=async()=>({status:'completed'});const r=await run(f);
 assert.equal(r.status,'SUPPORT_SENT_SOLUTION_VERIFIED');assert.equal(r.providerSolutionVerified,true);assert.equal(r.discountApplied,false);
 assert.deepEqual(f.calls,['mail read','solution read','verified receipt']);
 const g=fixture();g.deps.readOperation=async()=>({status:'completed'});g.deps.verifySolution=async()=>false;
 assert.equal((await run(g)).reason,'SUPPORT_CURRENT_SOLUTION_NOT_VERIFIED');assert.equal(g.calls.includes('verified receipt'),false);
});
test('unknown, expired or pending operation remains held and never replays a POST',async()=>{
 for(const op of [null,{status:'pending'},{status:'failed'},{status:'failed',errorCode:'private error response'}]){
  const f=fixture();f.deps.readOperation=async()=>op;const r=await run(f);
  assert.equal(r.status,'RECONCILIATION_REQUIRED');assert.equal(f.calls.includes('verified receipt'),false);
 }
});
test('changed current conversation, offer, acceptance or amount cannot reconcile another request',async()=>{
 for(const patch of [{exactOrder:false},{readVerified:false},{orderId:'900002'},{issueId:'800002'},{ownerId:'43'},
  {conversationId:'other'},{phone:'+34611111111'},{conversationPhone:'+34611111111'}, {acceptanceMessageId:'103'},
  {acceptedAt:'2026-10-24T11:01:00Z'},{offerMessageId:'99'},{offerAt:'2026-10-23T10:00:00Z'},
  {intent:'REQUESTS_RETURN'},{offerVerified:false},{originalAmount:29.99},{offeredAmount:15}]){
  const f=fixture();Object.assign(f.candidate,patch);assert.equal((await run(f)).reason,'SUPPORT_CURRENT_EVIDENCE_CHANGED');assert.deepEqual(f.calls,[]);
 }
});
test('wrong or incomplete receipt cannot initiate even a mail read',async()=>{
 for(const change of [f=>f.receipt.order_id='900002',f=>f.receipt.provider='other',f=>f.receipt.store_id='other',
  f=>f.receipt.chatby_user_ns='other',f=>f.receipt.raw.phase='EMAIL_REQUESTED',f=>f.receipt.raw.issueId='800002',
  f=>f.receipt.raw.mailId=null,f=>f.receipt.raw.snapshot='invalid',f=>f.receipt.raw.requestedAt='invalid',
  f=>f.receipt.raw.acceptanceMessageId='wrong',f=>f.receipt.raw.finalCents=1499]){
  const f=fixture();change(f);assert.equal((await run(f)).status,'RECONCILIATION_REQUIRED');assert.deepEqual(f.calls,[]);
 }
});
test('failed mail verification, provider reads and receipt persistence retain the hold without leaking details',async()=>{
 for(const fn of ['readPlan','verifyMail','readOperation','verifySolution','finishVerified']){
  const f=fixture();f.deps.readOperation=async()=>({status:'completed'});f.deps[fn]=async()=>{throw Error('private provider details');};
  const r=await run(f);assert.equal(r.status,'RECONCILIATION_REQUIRED');assert.equal(JSON.stringify(r).includes('private'),false);
 }
 const f=fixture();f.deps.verifyMail=async()=>false;assert.equal((await run(f)).reason,'SUPPORT_SENT_MAIL_NOT_VERIFIED');assert.deepEqual(f.calls,[]);
});
