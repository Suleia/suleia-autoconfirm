// Execute only in the trusted private API runtime. Emits no case identifiers,
// customer texts, identity data, ciphertexts or credentials. GET/read-only.
import assert from 'node:assert/strict';
import { OperationsRepository } from '../packages/suleia-operations-mcp/src/operations/repository.mjs';
const repo=await OperationsRepository.connect(process.env.OPERATIONS_DATABASE_URL,
  {privateDataKey:process.env.OPERATIONS_PRIVATE_DATA_KEY});
try {
  const checks=(await repo.pool.query(`SELECT
    count(*) FILTER(WHERE customer_replied_after_issue AND (scoped_response_status<>'VALID_RESPONSE'
      OR scoped_customer_activity_at<=incident_notified_at OR incident_notified_at IS NULL))::integer AS invalid_response_attributions,
    count(*) FILTER(WHERE NOT notification_decision_current AND
      (effective_decision_status<>'REVIEW' OR effective_qa_status<>'REVIEW' OR NOT effective_human_review
        OR effective_simulated_action_type IS NOT NULL))::integer AS invalid_decision_projections,
    count(*) FILTER(WHERE status='PENDING' AND is_active)::integer AS active_cases
    FROM read_models.operations_incident_evidence_context`)).rows[0];
  assert.equal(checks.invalid_response_attributions,0);
  assert.equal(checks.invalid_decision_projections,0);
  const overview=await repo.incidentOverview(new URLSearchParams({limit:'100',scope:'ACTIVE'}));
  assert.equal(overview.summary.pending,overview.total);
  assert.equal(overview.items.length,Math.min(overview.total,100));
  for(const item of overview.items) {
    if(item.customer_evidence.code==='NOT_VERIFIABLE') assert.equal(item.customer_evidence.latest_message,null);
    if(item.interpreted_type==='RECIPIENT_ABSENT') assert.equal(item.tailored_recommendation.resolution_option,null);
  }
  console.log(JSON.stringify({verification:'GLOBAL_NOTIFICATION_SCOPE',...checks,
    active_response_states:overview.summary,customer_messages_sent:0,dropea_actions_executed:0}));
  if(process.env.AUDIT_ISSUE_ID) {
    const detail=await repo.incidentDetail(process.env.AUDIT_ISSUE_ID);
    const item=detail.incident || detail.item || detail;
    assert.equal(item.customer_replied_after_issue,false);
    assert.equal(item.customer_evidence.latest_message,null);
    assert.equal(item.customer_evidence.code,'NOT_VERIFIABLE');
    assert.equal(item.tailored_recommendation.resolution_option,null);
    console.log(JSON.stringify({verification:'OWNER_REPORTED_CASE',issue_created_at:item.created_at,
      response_status:item.operational_response_status,evidence_code:item.customer_evidence.code,
      notification_at:item.incident_notified_at,reason:item.scoped_response_reason,
      recommendation:item.tailored_recommendation.code,current_action:item.effective_simulated_action_type,
      human_review:item.effective_human_review,decision_status:item.decision_record_status}));
  }
} finally {await repo.pool.end();}
