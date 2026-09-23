import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentInsight } from '../../suleia-operations-mcp/src/operations/incident-insight.mjs';
import { dashboardProjection } from '../src/incident/dashboard.mjs';

const now='2026-09-23T12:00:00Z';
const sample={canonical_issue_id:'synthetic-issue',canonical_order_id:'synthetic-order',
  status:'PENDING',is_active:true,interpreted_type:'REFUSED_BY_RECIPIENT',normalized_type:'UNKNOWN',
  created_at:'2026-09-22T11:00:00Z',conversation_status:'FOUND',chatby_sync_current:true,dropea_sync_current:true,
  incident_notified_at:null,scoped_response_status:'NOT_VERIFIABLE',scoped_response_reason:'INCIDENT_NOTIFICATION_NOT_OBSERVED',
  latest_private_customer_message_hash:'synthetic-message',latest_private_customer_message_at:'2026-09-22T11:01:00Z',
  latest_customer_message_relation:'AFTER_INCIDENT',latest_customer_incident_relevance:'NOTIFICATION_NOT_OBSERVED',
  latest_private_customer_message_type:'TEXT',latest_customer_message:'Necesito aclarar la entrega'};
const project=patch=>dashboardProjection(incidentInsight({...sample,...patch}),{now});

for(const type of ['TEXT','BUTTON'])test(`exact post-opening ${type} is visible without authorizing an action`,()=>{
  const row=project({latest_private_customer_message_type:type});
  assert.equal(row.customer_evidence.code,'OBSERVED_CUSTOMER_ACTIVITY');
  assert.equal(row.recovery.evidence.message,sample.latest_customer_message);
  assert.equal(row.recovery.evidence.response_at,sample.latest_private_customer_message_at);
  assert.equal(row.recovery.evidence.customer_interacted,true);
  assert.equal(row.dashboard.flow,'CUSTOMER_RESPONDED');
  assert.equal(row.recovery.evidence.valid_response,false);
  assert.equal(row.recovery.flags.RECOVERABLE_NOW,false);
  assert.equal(row.recovery.execution_enabled,false);
});
for(const [label,patch] of [
  ['older message',{latest_private_customer_message_at:'2026-09-21T11:00:00Z'}],
  ['future message',{latest_private_customer_message_at:'2099-09-21T11:00:00Z'}],
  ['different conversation',{conversation_status:'NONE'}],
  ['stale read',{chatby_sync_current:false}],
  ['missing binding',{latest_private_customer_message_hash:null}],
  ['lifecycle reply',{latest_customer_incident_relevance:'ORDER_LIFECYCLE_ONLY'}],
  ['order confirmation',{latest_customer_context_template:'dropea_pedido_nuevo_v1'}]
])test(`${label} is not current incident customer activity`,()=>{
  const row=project(patch);
  assert.equal(row.recovery.evidence.customer_interacted,false);
  assert.equal(row.recovery.evidence.message,null);
  assert.equal(row.recovery.evidence.valid_response,false);
});
