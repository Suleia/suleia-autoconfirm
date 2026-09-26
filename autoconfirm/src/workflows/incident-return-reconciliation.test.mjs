import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticIncidentReturnReconciliationDue, executeIncidentDiscountNoResponseReturn, verifyExactIncidentReturn, reconcileIncidentDiscountReturnLedger } from './incidents.mjs';

test('only explicit transient provider failures are eligible for a new automatic write', () => {
  const current = Date.parse('2026-07-16T17:00:00.000Z');
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:45:00.000Z' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'reconciliation_claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_503' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_429' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_400' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'applied_unverified', attempted_at: '2026-07-16T16:00:00.000Z' }, { now: current }), false);
});

test('verifies only the exact owned issue with the actual RETURN_REQUESTED resolution', async () => {
  const incident={incidenceId:'51',orderId:'61'};
  for(const issue of [null,{id:51,order_id:61,status:'PENDING',is_active:false},
    {id:51,order_id:61,status:'RESOLVED',resolution_status:'RETRY'},
    {id:52,order_id:61,status:'RESOLVED',resolution_status:'RETURN_REQUESTED'},
    {id:51,order_id:62,status:'RESOLVED',resolution_status:'RETURN_REQUESTED'}]) {
    assert.equal((await verifyExactIncidentReturn(incident,{attempts:1,readCurrent:async()=>({issue})})).verified,false);
  }
  assert.equal((await verifyExactIncidentReturn(incident,{attempts:1,readCurrent:async()=>({issue:{id:51,order_id:61,status:'RESOLVED',resolution_status:'RETURN_REQUESTED'}})})).verified,true);
  assert.equal((await verifyExactIncidentReturn(incident,{attempts:1,readCurrent:async()=>{throw Error('offline')}})).verified,false);
});

test('reconciles ambiguous applied actions without a POST and separates carrier closure from a return', async () => {
  const writes=[];const rows=[1,2,3,4,5].map(id=>({order_id:'61',template_name:`dropea_issue_discount_no_response_return_v1:${id}`,status:'manual_reconciliation_required',attempted_at:'2026-09-16T12:00:00Z',raw:{ruleId:'fixture'}}));
  const states={1:{status:'RESOLVED',resolution_status:'RETURN_REQUESTED',is_active:false},2:{status:'PENDING',is_active:false},3:{status:'MANAGING_WITH_CLIENT',is_active:true},4:{status:'PENDING',is_active:true}};
  const result=await reconcileIncidentDiscountReturnLedger({list:async()=>rows, inspectPrior:async()=>({verified:false,blocked:false}),
    readCurrent:async i=>{if(i.incidenceId==='5')throw Error('read failed');return {issue:{id:Number(i.incidenceId),order_id:61,...states[i.incidenceId]}};},
    finish:async row=>writes.push(row)});
  assert.deepEqual(result,{checked:5,verified:1,closedWithoutReturn:1,finalWorkflowBlocked:1,retryable:1,readFailed:1});
  assert.deepEqual(writes.map(r=>r.status),['verified','closed_without_return_request','blocked_final_workflow_state']);
  assert.equal(writes[1].evidence.verified,false);
});

test('ambiguous network outcomes never replay automatically', async () => {
  const now=Date.parse('2026-09-17T17:00:00Z');
  const original='2026-09-17T16:00:00Z';
  const existing={status:'manual_reconciliation_required',attempted_at:original,last_error:'DROPEA_V2_ISSUE_ACTION_NETWORK_UNKNOWN',raw:{requestNonce:original}};
  assert.equal(automaticIncidentReturnReconciliationDue(existing,{now}),false);
  assert.equal(automaticIncidentReturnReconciliationDue(existing,{now:now+24*3600000}),false);
  let nonce;
  const result=await executeIncidentDiscountNoResponseReturn({incidenceId:'51',orderId:'61',incidentType:'rejected_goods',chatbyUserNs:'fixture',chatbyReadVerified:true},
    {templateName:'fixture',sentAt:'2026-09-15T12:00:00Z',verified:true,responseStatus:'NO_RESPONSE'},
    {now,realEnabled:true,inspectPrior:async()=>({verified:false,blocked:false}),automaticEnabled:true,credentialAvailable:true,
      readCurrent:async()=>({issue:{status:'PENDING',is_active:true,allowed_resolution_options:['RETURN_REQUESTED']}}),readMessages:async()=>[],
      claimReturn:async()=>({acquired:false,persistent:true,reason:'already_claimed',existing}),reclaimReturn:async()=>({acquired:true,persistent:true,row:{attempted_at:'2026-09-17T17:00:00Z'}}),
      returnIssue:async(_id,opts)=>{nonce=opts.idempotencyNonce;return {};},verifyReturn:async()=>({verified:true}),finishReturn:async()=>null,auditReturn:async()=>null});
  assert.equal(result.status,'ALREADY_CLAIMED');assert.equal(nonce,undefined);
});

test('a stale claim requires read reconciliation and never another POST', async () => {
  let reclaimed = 0;
  let returned = 0;
  const result = await executeIncidentDiscountNoResponseReturn({
    incidenceId: 'fixture-stale-claim',
    orderId: 'fixture-order',
    incidentType: 'rejected_goods',
    chatbyUserNs: 'fixture-chat',
    chatbyReadVerified: true
  }, {
    templateName: 'fixture-discount',
    sentAt: '2026-07-14T16:00:00.000Z',
    verified: true,
    responseStatus: 'NO_RESPONSE'
  }, {
    now: Date.parse('2026-07-16T17:00:00.000Z'),
    realEnabled: true, inspectPrior: async () => ({ verified: false, blocked: false }),
    automaticEnabled: true,
    credentialAvailable: true,
    readCurrent: async () => ({ issue: { status: 'PENDING', raw: { status: 'PENDING', is_active: true, allowed_resolution_options: ['RETURN_REQUESTED'] } } }),
    readMessages: async () => [],
    claimReturn: async () => ({ acquired: false, persistent: true, reason: 'already_claimed', existing: { status: 'claimed', attempted_at: '2026-07-16T16:29:00.000Z' } }),
    reclaimReturn: async ({ expectedStatus }) => { reclaimed += 1; assert.equal(expectedStatus, 'claimed'); return { acquired: true, persistent: true }; },
    returnIssue: async () => { returned += 1; return { status: 'RESOLVED', resolution_status: 'RETURN_REQUESTED' }; },
    verifyReturn: async () => ({ verified: true }),
    finishReturn: async () => null,
    auditReturn: async () => null
  });
  assert.equal(result.status, 'ALREADY_CLAIMED');
  assert.equal(reclaimed, 0);
  assert.equal(returned, 0);
});

