import test from 'node:test';
import assert from 'node:assert/strict';
import {manualDiscountPresentation} from '../src/incident/manual-discount.mjs';
import {buildIncidentDashboard} from '../src/incident/dashboard.mjs';
const item={canonical_issue_id:'synthetic-issue',created_at:'2026-09-20T00:00:00Z',interpreted_type:'REFUSED_BY_RECIPIENT',status:'PENDING',is_active:true,
 discount_recovery_response_status:'DISCOUNT_ACCEPTED',discount_delivery_verified:true,discount_signal_quality:'VERIFIED',discount_sent_at:'2026-09-20T10:00:00Z',discount_responded_at:'2026-09-20T11:00:00Z',discount_original_amount:35,discount_final_amount:30};
test('verified acceptance is manual even when older than the live decision freshness window',()=>{
 const p=manualDiscountPresentation(item);assert.equal(p.manual_discount.pending,true);assert.equal(p.autonomy.status,'HUMAN_REVIEW');assert.equal(p.manual_discount.final_amount,30);assert.equal(p.manual_discount.email_automatic,false);assert.equal(p.manual_discount.discount_applied_verified,false);
});
test('unverified, before offer or reused prior issue acceptance never enters manual queue',()=>{
 for(const change of [{discount_delivery_verified:false},{discount_responded_at:'2026-09-20T09:00:00Z'},{created_at:'2026-09-21T00:00:00Z'}])assert.equal(manualDiscountPresentation({...item,...change}).manual_discount,undefined);
});
test('later reply, closed case and verified return retain history without current manual pending',()=>{
 for(const change of [{latest_private_customer_message_at:'2026-09-20T12:00:00Z'},{status:'RESOLVED'},{rejected_observation:{return_verified:true}}]){const p=manualDiscountPresentation({...item,...change});assert.ok(p.manual_discount);assert.equal(p.manual_discount.pending,false);}
});
test('manual queue uses the same population and excludes historical cases',()=>{
 const d=buildIncidentDashboard([item,{...item,canonical_issue_id:'closed',status:'RESOLVED'}],{filters:{scope:'ALL',manual_discount:'pending'}});
 assert.equal(d.total,1);assert.equal(d.items[0].manual_discount.pending,true);assert.equal(d.summary.manual_discounts.accepted,2);
});
