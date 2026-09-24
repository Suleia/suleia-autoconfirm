import {classifyAbsenceAttempt} from '../packages/platform-core/src/incident/absent-evidence.mjs';

export function createNativeAbsentFreshReader({pool,resolutionRuntime}){
  return async request=>{
    // Native Dropea notifications carry #Pedido but may not populate the
    // separate "Incidencia: Id" field. Resolve only the unique CURRENT active
    // issue of that exact order; an explicit caller issue ID can only narrow it.
    // Provider issue/order and the exact conversation are then read directly.
    const rows=await pool.query(`SELECT i.canonical_issue_id,i.canonical_order_id,i.dropea_issue_id
      FROM read_models.operations_incident_records i
      JOIN read_models.recipient_absent_current_context c USING(canonical_issue_id,canonical_order_id)
      WHERE i.dropea_order_id=$1 AND i.type='RECIPIENT_ABSENT' AND i.status='PENDING' AND i.is_active=true
        AND c.current=true AND ($2::text IS NULL OR i.dropea_issue_id=$2)`,
      [String(request.order_id),request.issue_id ? String(request.issue_id):null]);
    if(rows.rows.length!==1)throw new Error('EXACT_ISSUE_REQUIRED');
    const row=rows.rows[0],fresh=await resolutionRuntime.readFresh(row.canonical_issue_id);
    const {issue,order,chatby}=fresh;
    if(chatby.conversation_id!==request.user_ns || issue.canonical_order_id!==row.canonical_order_id
      || order.canonical_order_id!==row.canonical_order_id)throw new Error('EXACT_CONVERSATION_REQUIRED');
    if(String(issue.dropea_issue_id)!==String(row.dropea_issue_id))throw new Error('EXACT_ISSUE_REQUIRED');
    return {canonical_issue_id:row.canonical_issue_id,canonical_order_id:row.canonical_order_id,
      conversation_id:chatby.conversation_id,exact_identity_verified:order.identity_status==='EXACT' && chatby.verified===true,
      type:issue.type,status:issue.status,is_active:issue.is_active,decision_currentness:fresh.decision_currentness,
      return_in_progress:fresh.return_in_progress,absence_classification:classifyAbsenceAttempt({issue}).status,
      issue_created_at:issue.created_at,history_complete:chatby.history_complete,
      previous_notification_count:chatby.notification_count,issue_read_at:issue.observed_at,
      order_read_at:order.observed_at,chatby_read_at:chatby.observed_at};
  };
}
