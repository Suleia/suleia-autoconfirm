import {classifyAbsenceAttempt} from '../packages/platform-core/src/incident/absent-evidence.mjs';

export function createNativeAbsentFreshReader({pool,resolutionRuntime}){
  return async request=>{
    const rows=await pool.query(`SELECT canonical_issue_id,canonical_order_id FROM read_models.operations_incident_records
      WHERE dropea_issue_id=$1 AND dropea_order_id=$2 AND type='RECIPIENT_ABSENT'`,[String(request.issue_id),String(request.order_id)]);
    if(rows.rows.length!==1)throw new Error('EXACT_ISSUE_REQUIRED');
    const row=rows.rows[0],fresh=await resolutionRuntime.readFresh(row.canonical_issue_id);
    const {issue,order,chatby}=fresh;
    if(chatby.conversation_id!==request.user_ns || issue.canonical_order_id!==row.canonical_order_id
      || order.canonical_order_id!==row.canonical_order_id)throw new Error('EXACT_CONVERSATION_REQUIRED');
    return {canonical_issue_id:row.canonical_issue_id,canonical_order_id:row.canonical_order_id,
      conversation_id:chatby.conversation_id,exact_identity_verified:order.identity_status==='EXACT' && chatby.verified===true,
      type:issue.type,status:issue.status,is_active:issue.is_active,decision_currentness:fresh.decision_currentness,
      return_in_progress:fresh.return_in_progress,absence_classification:classifyAbsenceAttempt({issue}).status,
      issue_created_at:issue.created_at,history_complete:chatby.history_complete,
      previous_notification_count:chatby.notification_count,issue_read_at:issue.observed_at,
      order_read_at:order.observed_at,chatby_read_at:chatby.observed_at};
  };
}
