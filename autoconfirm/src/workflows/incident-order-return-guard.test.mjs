import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPriorOrderReturn } from './incident-order-return-guard.mjs';
import { executeIncidentDiscountNoResponseReturn, reconcileIncidentDiscountReturnLedger, classifyIncident } from './incidents.mjs';
const incident={orderId:'61',incidenceId:'52',incidentType:'rejected_goods',chatbyReadVerified:true};
const row={order_id:'61',template_name:'dropea_issue_discount_no_response_return_v1:51',status:'verified'};
const resolved={id:51,order_id:61,status:'RESOLVED',resolution_status:'RETURN_REQUESTED'};
test('prior return must be re-read and match the exact order and resolution',async()=>{
  const value=await inspectPriorOrderReturn(incident,{list:async()=>[row],read:async()=>({issue:resolved})});
  assert.equal(value.verified,true);assert.equal(value.priorIncidenceId,'51');
  for(const issue of [{...resolved,order_id:62},{...resolved,id:50},{...resolved,resolution_status:'RETRY'}]){
    const result=await inspectPriorOrderReturn(incident,{list:async()=>[row],read:async()=>({issue})});
    assert.equal(result.blocked,true);assert.notEqual(result.verified,true);
  }
  for(const deps of [{list:async()=>{throw Error('db');}},{list:async()=>[row],read:async()=>{throw Error('network');}}])assert.equal((await inspectPriorOrderReturn(incident,deps)).blocked,true);
});
test('a new incident on an already returned order does not claim or write again',async()=>{
  let writes=0;
  const result=await executeIncidentDiscountNoResponseReturn(incident,{verified:true,sentAt:'2026-09-20T00:00:00Z',responseStatus:'NO_RESPONSE'},
    {now:Date.parse('2026-09-23T00:00:00Z'),realEnabled:true,automaticEnabled:true,credentialAvailable:true,
      inspectPrior:async()=>({verified:true,priorIncidenceId:'51'}),claimReturn:async()=>{writes++;},returnIssue:async()=>{writes++;}});
  assert.equal(result.status,'RETURN_ALREADY_REQUESTED_FOR_ORDER');assert.equal(result.priorIncidenceId,'51');assert.equal(writes,0);
});
test('reconciliation records prior-order return separately without resolving the new issue',async()=>{
  let saved;
  const result=await reconcileIncidentDiscountReturnLedger({list:async()=>[{...row,template_name:'dropea_issue_discount_no_response_return_v1:52',status:'manual_reconciliation_required'}],
    readCurrent:async()=>({issue:{id:52,order_id:61,status:'PENDING',is_active:true}}),
    inspectPrior:async()=>({verified:true,priorIncidenceId:'51'}),finish:async x=>{saved=x;}});
  assert.equal(result.orderAlreadyRequested,1);assert.equal(saved.status,'order_return_already_verified');
  assert.equal(saved.evidence.verified,false);assert.equal(saved.evidence.orderReturnVerified,true);assert.equal(saved.evidence.priorIncidenceId,'51');
});
test('official recipient rejection is not lost to the carrier description or legacy code',()=>{
  assert.equal(classifyIncident({type:'REFUSED_BY_RECIPIENT',incidence_code:'-30',description:'Rechazado por destinatario'},{}).type,'rejected_goods');
  assert.equal(classifyIncident({type:'REFUSED_BY_RECIPIENT',incidence_code:'AS',description:'Ausente anterior'},{}).type,'rejected_goods');
});
