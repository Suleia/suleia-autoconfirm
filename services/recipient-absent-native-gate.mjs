import {randomUUID} from 'node:crypto';

export const NATIVE_ABSENT_TEMPLATE='dropea_ausente_v3';
const validDate=value=>Number.isFinite(Date.parse(value));
const requiredEvidence=['mapping_snapshot_verified','rollback_verified','render_blocker_verified','approved_v3_verified','native_route_verified'];

export function nativeAbsentControlReady(control){
  return Boolean(control?.automation_live===true && control.native_send_enabled===true
    && control.template_sends_enabled===true && !control.circuit_breaker_reason
    && ['CANARY','LIVE'].includes(control.status) && validDate(control.recipient_absent_template_cutover_at)
    && requiredEvidence.every(key=>control.evidence?.[key]===true)
    && control.evidence?.evidence_id
    && (control.status==='CANARY' || control.evidence.notification_canary_verified===true));
}

export function nativeAbsentEligibility(input,control,now=new Date()){
  if(!nativeAbsentControlReady(control))return 'NATIVE_SEND_DISABLED';
  if(!input?.canonical_issue_id || !input.canonical_order_id || !input.conversation_id
    || input.exact_identity_verified!==true)return 'EXACT_IDENTITY_REQUIRED';
  if(input.type!=='RECIPIENT_ABSENT' || input.status!=='PENDING' || input.is_active!==true
    || input.decision_currentness!=='CURRENT' || input.return_in_progress!==false)return 'CURRENT_PENDING_ABSENCE_REQUIRED';
  // Owner-authorized exception for one exact second-absence canary, never a
  // blanket policy change or an exception for UNKNOWN/conflicting attempts.
  const secondCanary=control.status==='CANARY' && input.absence_classification==='SECOND_ABSENCE'
    && control.canary_issue_id===input.canonical_issue_id
    && control.evidence?.second_absence_canary_issue_id===input.canonical_issue_id
    && control.evidence?.second_absence_canary_authorized===true;
  const secondNotice=control.evidence?.second_absence_notice_authorized===true
    && input.notice_stage==='SECOND_ABSENCE' && input.second_notice?.previous_claim_id
    && input.second_notice.previous_issue_id!==input.canonical_issue_id
    && validDate(input.second_notice.previous_notification_at)
    && Date.parse(input.second_notice.previous_notification_at)<Date.parse(input.issue_created_at)
    && input.absence_classification==='SECOND_ABSENCE' && input.order_notification_count===1;
  const repeatedNotice=control.evidence?.repeated_absence_notice_authorized===true
    && input.notice_stage==='REPEATED_ABSENCE' && input.second_notice?.previous_claim_id
    && input.second_notice.previous_issue_id!==input.canonical_issue_id
    && validDate(input.second_notice.previous_notification_at)
    && Date.parse(input.second_notice.previous_notification_at)<Date.parse(input.issue_created_at)
    && Number.isInteger(input.order_notification_count) && input.order_notification_count>=2
    && input.second_notice.previous_count===input.order_notification_count
    && input.notice_sequence===input.order_notification_count+1
    && input.absence_classification==='SECOND_ABSENCE';
  const contactRecovery=control.evidence?.notification_recovery_authorized===true
    && control.evidence?.notification_owner==='CONTROLLER_TEMPLATE_API'
    && ['FIRST_ABSENCE','SECOND_ABSENCE','ABSENCE_ATTEMPT_UNKNOWN'].includes(input.absence_classification)
    && input.contact_cause==='RECIPIENT_ABSENT' && (input.order_notification_count===0 || secondNotice || repeatedNotice)
    && input.customer_activity_after_issue===false && input.order_in_incidence===true;
  if(control.evidence?.notification_owner==='CONTROLLER_TEMPLATE_API' && !contactRecovery)return 'CONTACT_RECOVERY_EVIDENCE_REQUIRED';
  if(input.absence_classification!=='FIRST_ABSENCE' && !secondCanary && !contactRecovery)return 'SECOND_OR_UNKNOWN_REQUIRES_POLICY_REVIEW';
  if(!validDate(input.issue_created_at) || Date.parse(input.issue_created_at)<Date.parse(control.recipient_absent_template_cutover_at)
    || Date.parse(input.issue_created_at)>+now)return 'HISTORICAL_OR_INVALID_ISSUE';
  if(input.history_complete!==true || input.previous_notification_count!==0)return 'PRIOR_NOTICE_OR_INCOMPLETE_HISTORY';
  if(!['issue_read_at','order_read_at','chatby_read_at'].every(key=>validDate(input[key])
    && +now-Date.parse(input[key])>=0 && +now-Date.parse(input[key])<=15000))return 'DIRECT_READ_NOT_FRESH';
  if(control.status==='CANARY' && control.canary_issue_id && control.canary_issue_id!==input.canonical_issue_id)return 'CANARY_SLOT_RESERVED';
  return null;
}

// A successful answer is consumed once. Lost HTTP responses and abandoned claims
// are reconciled, never granted again. No remote send occurs in this service.
export async function authorizeNativeAbsent({readFresh,ledger,request,source='CHATBY_NATIVE',now=()=>new Date()}){
  const input=await readFresh(request);
  return ledger.transaction(async store=>{
    const control=await store.controlForUpdate();
    const owner=control?.evidence?.notification_owner || 'CHATBY_NATIVE';
    if(source!==owner)return {allow:false,reason:'NOTIFICATION_OWNER_MISMATCH'};
    const reason=nativeAbsentEligibility(input,control,new Date(now()));
    if(reason)return {allow:false,reason};
    const claim={...input,claim_id:randomUUID(),template_version:NATIVE_ABSENT_TEMPLATE};
    if(!await store.claim(claim))return {allow:false,reason:'NOTICE_ALREADY_CLAIMED'};
    if(control.status==='CANARY')await store.reserveCanary(input.canonical_issue_id);
    return {allow:true,claim_id:claim.claim_id,template_version:NATIVE_ABSENT_TEMPLATE};
  });
}

export function createNativeAbsentLedger(pool){
  return {async transaction(fn){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const result=await fn({
        async controlForUpdate(){return (await client.query("SELECT * FROM operations.recipient_absent_native_control WHERE workflow='RECIPIENT_ABSENT' FOR UPDATE")).rows[0];},
        async claim(a){return (await client.query(`INSERT INTO operations.recipient_absent_native_notifications
          (canonical_issue_id,template_version,canonical_order_id,conversation_id,claim_id,status,outcome)
          SELECT $1,$2,$3,$4,$5,'CLAIMED',$6::jsonb WHERE
          (NOT EXISTS(SELECT 1 FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3)
            AND $7::text='INITIAL') OR ($7::text='SECOND_ABSENCE'
            AND (SELECT count(*) FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3)=1
            AND EXISTS(SELECT 1 FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3
              AND claim_id=$8::uuid AND status='VERIFIED' AND canonical_issue_id<>$1
              AND coalesce(outcome->>'notice_stage','INITIAL')='INITIAL'))
          OR ($7::text='REPEATED_ABSENCE' AND $9::int>=2
            AND (SELECT evidence->>'repeated_absence_notice_authorized' FROM operations.recipient_absent_native_control WHERE workflow='RECIPIENT_ABSENT')='true'
            AND (SELECT count(*) FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3)=$9::int
            AND NOT EXISTS(SELECT 1 FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3 AND status<>'VERIFIED')
            AND EXISTS(SELECT 1 FROM operations.recipient_absent_native_notifications n WHERE n.canonical_order_id=$3
              AND n.claim_id=$8::uuid AND n.status='VERIFIED' AND n.canonical_issue_id<>$1 AND n.conversation_id=$4
              AND n.notification_at<$10::timestamptz
              AND n.claim_id=(SELECT claim_id FROM operations.recipient_absent_native_notifications WHERE canonical_order_id=$3 ORDER BY claimed_at DESC,claim_id DESC LIMIT 1)
              AND n.outcome->>'notice_stage' IN ('SECOND_ABSENCE','REPEATED_ABSENCE')))
          ON CONFLICT DO NOTHING RETURNING claim_id`,
          [a.canonical_issue_id,a.template_version,a.canonical_order_id,a.conversation_id,a.claim_id,
            JSON.stringify({notice_stage:a.notice_stage || 'INITIAL',notice_sequence:a.notice_sequence || (a.notice_stage==='SECOND_ABSENCE'?2:1),absence_classification:a.absence_classification,
              ...(a.second_notice?{previous_claim_id:a.second_notice.previous_claim_id}: {})}),
            a.notice_stage || 'INITIAL',a.second_notice?.previous_claim_id || null,
            a.second_notice?.previous_count || 0,a.issue_created_at || null])).rowCount===1;},
        async reserveCanary(id){await client.query("UPDATE operations.recipient_absent_native_control SET canary_issue_id=$1 WHERE workflow='RECIPIENT_ABSENT'",[id]);}
      });
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}
