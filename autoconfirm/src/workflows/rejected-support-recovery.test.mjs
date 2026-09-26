import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectedSupportRecoveryPlan as plan } from './rejected-support-recovery.mjs';
const valid = {orderId:'ES123456',issueId:'654321',originalCents:3499,offeredFinalCents:2999,currentCents:3499,currency:'EUR',latestIntent:'ACCEPTS_DISCOUNT',offerVerified:true,readVerified:true};
test('support email and solution share the exact accepted amount without claiming execution',()=>{
 const p=plan(valid);assert.equal(p.eligible,true);assert.equal(p.finalCents,2999);
 assert.equal(p.email.to,'soporte@dropea.com');assert.match(p.email.text,/29,99 EUR/);assert.match(p.solution,/29,99 EUR/);
 assert.equal(p.discountApplied,false);assert.equal(p.deliveryRequested,false);
 assert.equal(plan({...valid,issueId:'654322'}).idempotencyKey,p.idempotencyKey);
});
test('a later return, ambiguity, unverified read or prior attempt blocks the support request',()=>{
 for(const patch of [{latestIntent:'REQUESTS_RETURN'},{latestIntent:'AMBIGUOUS'},{readVerified:false},{offerVerified:false},{priorReturn:true},{priorRecovery:true}])assert.equal(plan({...valid,...patch}).eligible,false);
});
test('never deducts twice or changes the accepted offer amount',()=>{
 for(const patch of [{currentCents:2999},{currentCents:4000},{offeredFinalCents:2499},{originalCents:499},{currency:'USD'},{currentCents:34.99},{orderId:'123\nInjected'}])assert.equal(plan({...valid,...patch}).eligible,false);
});
