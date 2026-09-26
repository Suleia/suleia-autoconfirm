import test from 'node:test';
import assert from 'node:assert/strict';
import {addressResponseDecision} from './address-response-policy.mjs';
import {executeObservedAddress} from './address-observed-executor.mjs';
import {executeIncidentDiscountNoResponseReturn} from './incidents.mjs';
const now=Date.now(),t=now-50*3600000;
const incident={incidentType:'address',incidenceId:'11',orderId:'22',phone:'600000000',incidenceDate:new Date(t-3600000).toISOString(),chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'fixture'};
const order={orderId:'22',status:'ERROR',customerPhone:'600000000'};
const issue={id:'11',order_id:'22',type:'ADDRESS_INCORRECT',status:'PENDING',is_active:true,allowed_resolution_options:['RETURN_REQUESTED','SOLUTION_PROVIDED']};
const notice={type:'out',mid:'wamid.fixture',ts:t/1000,payload:{name:'dropea_incidencia_direccion_v1'}};
const reply=text=>({type:'in',mid:'wamid.reply',ts:(now-3600000)/1000,text});
const partial=reply('Calle Mayor 25');
const full=reply('Calle Mayor 25, 48012 Bilbao');
const env={ADDRESS_AUTOMATION_ENABLED:'true',ADDRESS_SOLUTION_MODE:'CANARY',ADDRESS_SOLUTION_CANARY_ISSUE_ID:'11',ADDRESS_DETAILS_MODE:'CANARY',ADDRESS_DETAILS_CANARY_ISSUE_ID:'11'};
const expected=messages=>addressResponseDecision({incident,order,messages,now});

test('I late partial response cancels a reserved return before the provider write',async()=>{
 const saved={...process.env};Object.assign(process.env,{ADDRESS_AUTOMATION_ENABLED:'true',ADDRESS_RETURN_MODE:'CANARY',ADDRESS_RETURN_CANARY_ISSUE_ID:'11'});
 try{
  let reads=0,writes=0;const finished=[];
  const result=await executeIncidentDiscountNoResponseReturn(incident,{}, {
   now,addressMessages:[notice],credentialAvailable:true,inspectPrior:async()=>({}),
   readCurrent:async()=>({issue,order}),readMessages:async()=>++reads===1?[notice]:[notice,partial],
   claimReturn:async()=>({acquired:true,persistent:true}),finishReturn:async row=>finished.push(row),returnIssue:async()=>writes++
  });
  assert.equal(result.status,'BLOCKED_CUSTOMER_ACTIVITY');assert.equal(writes,0);assert.equal(finished[0].status,'aborted');
 }finally{for(const k of ['ADDRESS_AUTOMATION_ENABLED','ADDRESS_RETURN_MODE','ADDRESS_RETURN_CANARY_ISSUE_ID'])saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];}
});
test('partial details send has a persistent once-only claim',async()=>{
 let sent=0,claimed=false;const deps={env,prior:async()=>({}),readCurrent:async()=>({issue,order}),readMessages:async()=>[notice,partial],
  claimMessage:async()=>claimed?{acquired:false,persistent:true}:(claimed=true,{acquired:true,persistent:true}),
  send:async()=>{sent++;return {message_id:'wamid.details'};},finishMessage:async()=>{}};
 const first=await executeObservedAddress(incident,expected([notice,partial]),deps);
 const second=await executeObservedAddress(incident,expected([notice,partial]),deps);
 assert.equal(first.verified,true);assert.equal(second.verified,false);assert.equal(sent,1);
});
test('N timeout after accepted solution is reconciled without another provider write',async()=>{
 let reads=0,writes=0;const finished=[];
 const deps={env,prior:async()=>({}),readCurrent:async()=>++reads===1?{issue,order}:{issue:{...issue,status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED'}},readMessages:async()=>[notice,full],claim:async()=>({acquired:true,persistent:true}),finish:async row=>finished.push(row),write:async()=>{writes++;throw Error('timeout');}};
 const r=await executeObservedAddress(incident,expected([notice,full]),deps);
 assert.equal(writes,1);assert.equal(r.verified,true);assert.equal(finished[0].status,'verified');
});
test('N uncertain solution, durable claim failure and late cancellation never produce a blind second write',async()=>{
 for(const mode of ['claim','unknown','late']){
  let reads=0,writes=0;const deps={env,prior:async()=>({}),readCurrent:async()=>({issue,order}),
   readMessages:async()=>++reads>1&&mode==='late'?[notice,reply('No quiero el pedido')]:[notice,full],
   claim:async()=>({acquired:mode!=='claim',persistent:true}),finish:async()=>{},write:async()=>{writes++;throw Error('timeout');}};
  const r=await executeObservedAddress(incident,expected([notice,full]),deps);
  assert.equal(r.verified,false);assert.equal(writes,mode==='unknown'?1:0);
 }
});

