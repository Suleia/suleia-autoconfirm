import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCustomerCareSignal} from './customer-care-signal.mjs';
const row=()=>({order_id:'101',incidence_id:'201',raw:{customerCare:{dropea_order_id:'101',active_issue_id:'201',mode:'SHADOW',status:'WAITING_CUSTOMER',updated_at:'2026-10-30T12:00:00Z',delivery_date:'2026-10-31',delivery_window:'AFTERNOON',latest_customer_intents:['WANTS_ORDER'],wants_order:true,missing_slots:[],owner:'existing_incident_action_gateway',next_best_action:'DELEGATE',conversation_version:2}}});
test('exact case projection whitelists structured context without customer text, contacts or address',()=>{
 const r=row();r.raw.customerCare.phone='private phone';r.raw.customerCare.address='private address';r.raw.customerCare.customer_text='private text';r.raw.customerCare.timeline=[{kind:'DECISION',reason:'SAFE_REASON',raw:'private text'}];
 const c=normalizeCustomerCareSignal(r);assert.equal(c.mode,'SHADOW');assert.equal(c.delivery_date,'2026-10-31');assert.equal(c.owner,'existing_incident_action_gateway');assert.doesNotMatch(JSON.stringify(c),/private/);
});
test('missing, wrong-order, wrong-issue or undated context is not projected',()=>{
 for(const mutate of [r=>{delete r.raw.customerCare;},r=>{r.raw.customerCare.dropea_order_id='102';},r=>{r.raw.customerCare.active_issue_id='202';},r=>{r.raw.customerCare.updated_at=null;}]){const r=row();mutate(r);assert.equal(normalizeCustomerCareSignal(r),null);}
});
test('unsafe values cannot become HTML, code labels, slots or times',()=>{
 const r=row();Object.assign(r.raw.customerCare,{owner:'<img src=x>',reason:'<script>',time_from:'25:99',delivery_date:'2026-02-30',missing_slots:['<script>','TIME_WINDOW'],latest_customer_intents:['<img>','WANTS_ORDER']});
 const c=normalizeCustomerCareSignal(r);assert.equal(c.owner,null);assert.equal(c.reason,null);assert.equal(c.time_from,null);assert.equal(c.delivery_date,null);assert.deepEqual(c.missing_slots,['TIME_WINDOW']);assert.deepEqual(c.intents,['WANTS_ORDER']);
});
