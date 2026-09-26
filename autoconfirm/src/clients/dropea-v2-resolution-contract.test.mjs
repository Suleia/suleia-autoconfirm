import test from 'node:test';
import assert from 'node:assert/strict';
import {DROPEA_RESOLUTION_ACTIONS,buildDropeaResolutionBody,planDropeaResolution,verifyDropeaResolution} from './dropea-v2-resolution-contract.mjs';
const address={street:'Calle Ejemplo 12',postal_code:'48012',city:'Bilbao',state:'Bizkaia',country:'ES'};
const data={MANAGING_WITH_CUSTOMER:{finalStateAcknowledged:true},PROVIDE_SOLUTION:{note:'Entrega en dirección confirmada'},CHANGE_ADDRESS:{address},RETRY_DELIVERY:{date:'2026-09-28',time_window:'morning'}};
for(const [action,spec] of Object.entries(DROPEA_RESOLUTION_ACTIONS))test(`official ${action} validates current capability and exact result`,()=>{
 const issue={id:'11',order_id:'22',status:'PENDING',is_active:true,allowed_resolution_options:[spec.option]};
 const plan=planDropeaResolution(issue,action,data[action]);assert.equal(plan.allowed,true);
 assert.equal(plan.body.status,spec.status);assert.equal(plan.body.resolution_status,spec.resolution||undefined);
 assert.equal(planDropeaResolution({...issue,allowed_resolution_options:[]},action,data[action]).allowed,false);
 assert.equal(planDropeaResolution({...issue,status:'RESOLVED'},action,data[action]).allowed,false);
 const after={issue:{...issue,...plan.body}};
 assert.equal(verifyDropeaResolution(after,{issueId:'11',orderId:'22',action,body:plan.body}),true);
 assert.equal(verifyDropeaResolution(after,{issueId:'11',orderId:'23',action,body:plan.body}),false);
 if(['CHANGE_ADDRESS','RETRY_DELIVERY'].includes(action))assert.equal(verifyDropeaResolution({issue:{...after.issue,resolution_data:null}},{issueId:'11',orderId:'22',action,body:plan.body}),false);
});
test('final managing status cannot be used for provisional waiting; retry requires an actual slot',()=>{
 assert.throws(()=>buildDropeaResolutionBody('MANAGING_WITH_CUSTOMER'),/FINAL/);
 for(const x of [{},{date:'2026-02-30',time_window:'morning'},{date:'2026-09-28',time_window:'unknown'}])assert.throws(()=>buildDropeaResolutionBody('RETRY_DELIVERY',x),/SLOT/);
 assert.deepEqual(buildDropeaResolutionBody('PICKUP_AT_AGENCY',{note:'ignored',address}),{status:'RESOLVED',resolution_status:'PICKUP_AT_AGENCY'});
 assert.throws(()=>buildDropeaResolutionBody('CHANGE_ADDRESS',{address:{...address,state:null}}),/INCOMPLETE/);
});
