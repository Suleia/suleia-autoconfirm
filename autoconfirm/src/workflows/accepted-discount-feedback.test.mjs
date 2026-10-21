import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAcceptedDiscountFeedback} from './accepted-discount-feedback.mjs';
const now = Date.parse('2026-10-21T10:00:00Z');
const incident = () => ({orderId:'22',incidenceId:'33',incidentResolution:{current_owner:'PROVIDER',verification_status:'VERIFIED',customer_replied:false}});
const record = () => ({orderId:'22',currentIssueId:'33',supportIssueId:'11',supportVerified:true,checkedAt:new Date(now).toISOString(),needsHumanReview:true,customerResponseStatus:'DISCOUNT_ACCEPTED',customerResponseAt:'2026-10-19T10:00:00Z',discountApplied:false});
test('reopened support cannot inherit old incident verification or authorize a write',()=>{
  const i=incident();applyAcceptedDiscountFeedback([i],{cases:[{...record(),customerText:'private fixture'}]},now);
  assert.equal(i.incidentResolution.human_review_reason,'ACCEPTED_DISCOUNT_INCIDENT_REOPENED');
  assert.equal(i.incidentResolution.current_owner,'HUMAN');
  assert.equal(i.incidentResolution.verification_status,'NOT_VERIFIED');
  assert.equal(i.incidentResolution.action_prepared,false);
  assert.equal(i.acceptedDiscountSupport.discountApplied,false);
  assert.equal(i.acceptedDiscountSupport.customerText,undefined);
});
test('stale, future or mismatched observations never replace current incident evidence',()=>{
  for(const change of [{currentIssueId:'44'},{orderId:'23'},{checkedAt:new Date(now-46*60_000).toISOString()},{checkedAt:new Date(now+1).toISOString()}]){
    const i=incident();applyAcceptedDiscountFeedback([i],{cases:[{...record(),...change}]},now);
    assert.equal(i.incidentResolution.verification_status,'VERIFIED');assert.equal(i.acceptedDiscountSupport,undefined);
  }
});
test('a same-issue reconciliation failure is visible and never fabricates a customer reply',()=>{
  const i=incident();applyAcceptedDiscountFeedback([i],{cases:[{...record(),supportIssueId:'33',customerResponseStatus:'UNKNOWN'}]},now);
  assert.equal(i.incidentResolution.human_review_reason,'ACCEPTED_DISCOUNT_SUPPORT_RECONCILIATION_REQUIRED');
  assert.equal(i.incidentResolution.customer_replied,false);
});
test('an uncertain support claim never becomes a claimed reopened incident',()=>{
  const i=incident();applyAcceptedDiscountFeedback([i],{cases:[{...record(),supportIssueId:null,supportVerified:false}]},now);
  assert.equal(i.incidentResolution.human_review_reason,'ACCEPTED_DISCOUNT_SUPPORT_RECONCILIATION_REQUIRED');
});
