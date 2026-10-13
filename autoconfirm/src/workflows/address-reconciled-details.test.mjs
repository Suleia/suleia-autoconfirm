import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverReconciledAddressDetails} from './address-reconciled-details.mjs';
const at='2026-10-13T11:00:00Z';
function fixture(){
 const incident={orderId:'123',incidenceId:'456'};
 const previous={last_execution:{status:'EXECUTION_UNKNOWN',capability:'DETAILS',action_id:'a'},history:[{state:'INCOMPLETE_ADDRESS'}]};
 const action={status:'verified',order_id:'123',raw:{action_id:'a',issue_id:'456',capability:'DETAILS',reconciliation:{source:'EXACT_CHATBY_OUTGOING_WAMID',resent:false,at},provider_result:{status:'DETAILS_REQUEST_SENT',verified:true,provider_receipt:true,message_id:'wamid.exact'}}};
 const message={status:'sent',order_id:'123',raw:{verified:true,message_id:'wamid.exact',last_required_field_request_at:at}};
 return {incident,previous,action,message,read:async({templateName})=>templateName.startsWith('address_capability')?action:message};
}
test('verified exact recovered receipt retires the cached uncertainty without a send',async()=>{
 const f=fixture(),r=await recoverReconciledAddressDetails(f.incident,f.previous,f.read);
 assert.equal(r.last_execution.status,'DETAILS_REQUEST_SENT');assert.equal(r.last_execution.verified,true);assert.equal(r.last_required_field_request_at,at);
 assert.deepEqual(r.history,f.previous.history);assert.equal(f.previous.last_execution.status,'EXECUTION_UNKNOWN');
});
test('other orders, actions and message receipts never unblock uncertainty',async()=>{
 for(const mutate of [f=>f.action.order_id='999',f=>f.action.raw.issue_id='999',f=>f.action.raw.action_id='other',f=>f.action.raw.capability='SOLUTION',f=>f.action.status='unknown',f=>f.action.raw.reconciliation.resent=true,f=>f.action.raw.provider_result.verified=false,f=>f.message.raw.message_id='wamid.other',f=>f.message.status='delivery_unverified',f=>f.message.order_id='999',f=>f.message.raw.last_required_field_request_at=null]){
  const f=fixture();mutate(f);assert.equal(await recoverReconciledAddressDetails(f.incident,f.previous,f.read),f.previous);
 }
});
test('other uncertain provider writes remain blocked without reading details receipts',async()=>{
 const f=fixture();f.previous.last_execution.capability='SOLUTION';
 assert.equal(await recoverReconciledAddressDetails(f.incident,f.previous,()=>assert.fail('unrelated receipt read')),f.previous);
});
test('receipt read failure is propagated rather than unblocking the case',async()=>{
 const f=fixture();await assert.rejects(recoverReconciledAddressDetails(f.incident,f.previous,async()=>{throw Error('unavailable');}),/unavailable/);
});
