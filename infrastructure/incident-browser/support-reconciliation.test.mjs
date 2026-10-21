import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileVerifiedSupport,selectSupportCandidates,sameSpanishSupportPhone,supportCaseKey,supportFeedbackProjection} from './support-reconciliation.mjs';

const now=Date.parse('2026-10-21T12:00:00Z');
function fixture(){
 const incident={orderId:'123',incidenceId:'92',chatbyUserNs:'fixture-only',incidentDiscountResponseStatus:'DISCOUNT_ACCEPTED'};
 const receipt={store_id:'suleia',order_id:'123',provider:'gmail_then_dropea',template_name:'accepted_discount_support_v1',chatby_user_ns:'fixture-only',status:'verified',
  raw:{workflow:'accepted_discount_support_v1',orderId:'123',issueId:'91',phase:'SOLUTION_VERIFIED',mailId:'fixture-mail',snapshot:'a'.repeat(64),
   originalCents:2999,finalCents:2499,acceptanceMessageId:'fixture-acceptance',acceptedAt:'2026-10-19T06:00:00Z',verifiedAt:'2026-10-19T08:00:00Z',attachmentHashes:[{sha256:'b'.repeat(64)}]}};
 const current={issue:{raw:{id:'92',order_id:'123',owner_id:'42',status:'PENDING',is_active:true,created_at:'2026-10-19T09:00:00Z',updated_at:'2026-10-19T09:00:00Z'}},
  order:{orderId:'123',orderAmount:24.99,currencyCode:'EUR',raw:{id:123,total_amount:'24.99',currency:'EUR'}}};
 const messages=[{id:'fixture-acceptance',direction:'inbound',text:'Acepto el descuento',created_at:receipt.raw.acceptedAt}];
 const conversation={exactOrder:true,sameConversation:true,samePhone:true,messages};
 const deps={readCurrent:async()=>current,readShared:async()=>null,readConversation:async()=>conversation};
 return {incident,receipt,current,messages,conversation,deps};
}
const run=f=>reconcileVerifiedSupport(f.incident,f.receipt,f.deps,{now,ownerId:'42'});

test('a reduced order and a reopened issue are independent outcomes; old acceptance is not new permission',async()=>{
 const f=fixture(),r=await run(f);
 assert.equal(r.supportVerified,true);assert.equal(r.supportIssueId,'91');assert.equal(r.currentIssueId,'92');
 assert.equal(r.orderAmountStatus,'ORDER_AMOUNT_DISCOUNT_VERIFIED');assert.equal(r.orderDiscountApplied,true);
 assert.equal(r.currentAmountCents,2499);assert.equal(r.expectedAmountCents,2499);
 assert.equal(r.reopened,true);assert.equal(r.needsHumanReview,true);assert.equal(r.reason,'INCIDENT_REOPENED_REVIEW_REQUIRED');
 assert.equal(r.customerResponseStatus,'ORIGINAL_ACCEPTANCE');assert.equal(r.customerResponseAfterCurrentIssue,false);
 assert.equal(r.discountApplied,false);assert.equal(r.carrierCodApplied,null);
});

test('closed original issue reconciles without claiming carrier COD or physical delivery',async()=>{
 const f=fixture();f.incident.incidenceId='91';Object.assign(f.current.issue.raw,{id:'91',status:'RESOLVED',is_active:false});
 const r=await run(f);assert.equal(r.status,'SUPPORT_RECONCILED');assert.equal(r.needsHumanReview,false);
 assert.equal(r.reason,'CARRIER_COD_NOT_VERIFIED');assert.equal(r.discountApplied,false);assert.equal(r.carrierCodApplied,null);
});

test('unknown or inactive pending issue cannot become a reconciled closed case',async()=>{
 for(const patch of [{status:'UNKNOWN',is_active:false},{status:'PENDING',is_active:false}]){
  const f=fixture();Object.assign(f.current.issue.raw,patch);const r=await run(f);
  assert.equal(r.reason,'CURRENT_ISSUE_STATE_UNVERIFIED');assert.equal(r.needsHumanReview,true);
 }
});

test('Spanish phone formatting tolerates local and international forms without matching foreign prefixes',()=>{
 for(const phone of ['600000000','34600000000','+34 600 000 000','0034600000000'])assert.equal(sameSpanishSupportPhone(phone,'+34600000000'),true);
 for(const phone of ['+33600000000','+1600000000','00600000000','abc','','34611111111'])assert.equal(sameSpanishSupportPhone(phone,'+34600000000'),false);
});

test('EUR fallback and normalized amount cannot establish authoritative order discount',async()=>{
 for(const patch of [{currency:undefined},{currency:'USD'},{currency:null},{total_amount:undefined},{total_amount:'24.999'}]){
  const f=fixture();Object.assign(f.current.order.raw,patch);const r=await run(f);
  assert.equal(r.orderAmountStatus,'ORDER_AMOUNT_UNVERIFIED');assert.equal(r.orderDiscountApplied,null);assert.equal(r.needsHumanReview,true);
 }
});

test('original and unexpected provider amounts remain distinct from a verified discount',async()=>{
 for(const [amount,status]of [['29.99','ORDER_AMOUNT_CHANGE_PENDING'],['19.99','ORDER_AMOUNT_CHANGED']]){
  const f=fixture();f.current.order.raw.total_amount=amount;const r=await run(f);
  assert.equal(r.orderAmountStatus,status);assert.equal(r.orderDiscountApplied,false);assert.equal(r.reason,status);
 }
});

test('tampered or incomplete historical receipts never trigger a provider read',async()=>{
 for(const change of [f=>f.receipt.status='unknown',f=>f.receipt.order_id='124',f=>f.receipt.raw.orderId='124',
  f=>f.receipt.provider='other',f=>f.receipt.raw.issueId='bad',f=>f.receipt.raw.phase='EMAIL_VERIFIED',
  f=>f.receipt.raw.finalCents=2000,f=>f.receipt.raw.mailId='',f=>f.receipt.raw.snapshot='bad',
  f=>f.receipt.raw.attachmentHashes=[],f=>f.receipt.raw.attachmentHashes[0].sha256='bad',
  f=>f.receipt.raw.verifiedAt='2026-10-22T00:00:00Z',f=>f.receipt.chatby_user_ns='different']){
  const f=fixture();change(f);let reads=0;f.deps.readCurrent=async()=>{reads++;throw Error('should not read');};
  const r=await run(f);assert.equal(r.reason,'SUPPORT_RECEIPT_UNVERIFIED');assert.equal(r.supportVerified,false);assert.equal(reads,0);
 }
});

test('fresh provider issue/order/owner identity must match',async()=>{
 for(const change of [f=>f.current.issue.raw.id='999',f=>f.current.issue.raw.order_id='999',
  f=>f.current.order.orderId='999',f=>f.current.issue.raw.owner_id='999']){
  const f=fixture();change(f);const r=await run(f);assert.equal(r.reason,'CURRENT_IDENTITY_UNVERIFIED');assert.equal(r.currentAmountCents,null);
 }
});

test('fresh exact-order conversation, namespace and phone association are all required',async()=>{
 for(const field of ['exactOrder','sameConversation','samePhone']){
  const f=fixture();f.conversation[field]=false;
  assert.equal((await run(f)).reason,'FRESH_CONVERSATION_ASSOCIATION_UNVERIFIED');
 }
});

test('a legacy receipt without namespace binds only to its valid recorded phone and fresh exact evidence',async()=>{
 const f=fixture();f.receipt.chatby_user_ns=null;f.receipt.raw.phone='+34600000000';f.current.order.customerPhone='600000000';
 const r=await run(f);assert.equal(r.supportVerified,true);assert.equal(r.reason,'INCIDENT_REOPENED_REVIEW_REQUIRED');
 assert.equal(r.orderDiscountApplied,true);assert.equal(r.discountApplied,false);
});

test('legacy receipt cannot bind a different phone, foreign phone, missing phone, wrong subscriber or missing acceptance',async()=>{
 for(const change of [f=>f.receipt.raw.phone='+34611111111',f=>f.receipt.raw.phone='+33600000000',f=>delete f.receipt.raw.phone,
  f=>f.conversation.sameConversation=false,f=>f.conversation.exactOrder=false,f=>f.conversation.samePhone=false,f=>f.messages.length=0]){
  const f=fixture();f.receipt.chatby_user_ns=null;f.receipt.raw.phone='+34600000000';f.current.order.customerPhone='+34600000000';change(f);
  const r=await run(f);assert.equal(r.supportVerified,false);assert.equal(r.needsHumanReview,true);
 }
});

test('a later cancellation, address correction, agency request or ambiguous response blocks reuse',async()=>{
 for(const [text,intent]of [['No quiero el pedido','REQUESTS_RETURN'],['Recoger en agencia','REQUESTS_AGENCY'],['Mi dirección ahora es otra','AMBIGUOUS'],['Sí','AMBIGUOUS']]){
  const f=fixture();f.messages.push({id:'new',direction:'inbound',text,created_at:'2026-10-20T10:00:00Z'});
  const r=await run(f);assert.equal(r.reason,'CUSTOMER_RESPONSE_CHANGED');assert.equal(r.customerResponseStatus,intent);
  assert.equal(r.customerResponseAfterCurrentIssue,true);assert.equal(r.needsHumanReview,true);
 }
});

test('new explicit acceptance is evidence for review and still cannot solve a reopened issue',async()=>{
 const f=fixture();f.messages.push({id:'new',direction:'inbound',button_text:'Quiero el descuento',created_at:'2026-10-20T10:00:00Z'});
 const r=await run(f);assert.equal(r.customerResponseStatus,'ACCEPTS_DISCOUNT');assert.equal(r.reason,'INCIDENT_REOPENED_REVIEW_REQUIRED');
 assert.equal(r.needsHumanReview,true);assert.equal(r.discountApplied,false);
});

test('missing original acceptance, malformed/future times and simultaneous conflicting replies remain unverified',async()=>{
 const missing=fixture();missing.messages.length=0;assert.equal((await run(missing)).reason,'ORIGINAL_ACCEPTANCE_NOT_OBSERVED');
 for(const created_at of ['invalid','2026-10-22T00:00:00Z']){
  const f=fixture();f.messages.push({id:'bad',direction:'inbound',text:'acepto',created_at});assert.equal((await run(f)).reason,'CUSTOMER_EVIDENCE_UNVERIFIED');
 }
 const tied=fixture();tied.messages.push({...tied.messages[0],id:'conflict',text:'no quiero el pedido'});
 assert.equal((await run(tied)).reason,'CUSTOMER_MESSAGE_ORDER_AMBIGUOUS');
});

test('any uncertain shared issue claim requires review instead of authorizing another action',async()=>{
 for(const status of ['claimed','requested','unknown','applied_unverified']){
  const f=fixture();f.deps.readShared=async()=>({status});const r=await run(f);
  assert.equal(r.reason,'SHARED_ACTION_UNCERTAIN');assert.equal(r.sharedActionStatus,'UNVERIFIED');assert.equal(r.needsHumanReview,true);
 }
});

test('read failures produce review observations without throwing or leaking provider details',async()=>{
 for(const fn of ['readCurrent','readShared','readConversation']){
  const f=fixture();f.deps[fn]=async()=>{throw Error('private provider response');};const r=await run(f);
  assert.equal(r.reason,'FRESH_SUPPORT_READ_FAILED');assert.equal(JSON.stringify(r).includes('private'),false);
 }
});

test('candidate selection includes changed replies only with a prior support claim and keeps new send eligibility unchanged',async()=>{
 const cases=[{orderId:'1',incidenceId:'11',incidentDiscountResponseStatus:'OTHER_RESPONSE'},
  {orderId:'2',incidenceId:'12',incidentDiscountResponseStatus:'OTHER_RESPONSE'},
  {orderId:'3',incidenceId:'13',incidentDiscountResponseStatus:'DISCOUNT_ACCEPTED'},
  {orderId:'4',incidenceId:'14',incidentDiscountResponseStatus:'OTHER_RESPONSE'}];
 const selected=await selectSupportCandidates(cases,[],async i=>i.orderId==='1'?{status:'verified'}:i.orderId==='4'?{status:'unknown'}:null);
 assert.deepEqual(selected.candidates.map(i=>i.orderId),['1','3','4']);assert.equal(selected.knownByCase.get('2:12'),null);
 assert.equal(selected.knownByCase.get('1:11').status,'verified');
});

test('bounded reconciliation rotates stale cases without changing the original cache',async()=>{
 const cases=Array.from({length:12},(_,i)=>({orderId:String(i+1),incidenceId:String(i+101)}));
 const first=await selectSupportCandidates(cases,[],async()=>({status:'verified'}));assert.equal(first.candidates.length,10);
 const previous=first.candidates.map(i=>({...i,checkedAt:new Date(now).toISOString()}));
 const next=await selectSupportCandidates(cases,previous,async()=>({status:'verified'}));assert.deepEqual(next.candidates.slice(0,2).map(supportCaseKey),['11:111','12:112']);
 assert.equal(cases[0].orderId,'1');let reads=0;
 await assert.rejects(selectSupportCandidates(Array(201).fill(cases[0]),[],async()=>{reads++;}),/SUPPORT_CANDIDATE_LIMIT/);assert.equal(reads,0);
});

test('feedback projection excludes contacts, conversations, message ids, mail ids and notes',async()=>{
 const r=await run(fixture());const projected=supportFeedbackProjection({...r,phone:'fixture-private',email:'fixture-private',text:'fixture-private',
  raw:{phone:'fixture-private'},mailId:'fixture-private',chatbyUserNs:'fixture-private',acceptanceMessageId:'fixture-private',solution:'fixture-private'});
 assert.equal(JSON.stringify(projected).includes('fixture-private'),false);assert.equal(projected.currentIssueId,'92');
 assert.equal(projected.carrierCodApplied,null);assert.equal(projected.orderDiscountApplied,true);
});
