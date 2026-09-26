import {absentResolutionPreflight,ABSENT_RESOLUTION_POLICY} from '../packages/platform-core/src/incident/absent-resolution.mjs';

export function absentResolutionControlVerified(control){
  return Boolean(!control?.circuit_breaker_reason && ['CANARY','LIVE'].includes(control?.status) && control.activation_at && Number.isFinite(Date.parse(control.activation_at))
    && control.evidence?.template_mapping_verified===true && control.evidence?.approved_v3_verified===true
    && control.evidence?.single_sender_verified===true && control.evidence?.callback_contract_verified===true
    && control.evidence?.notification_timer_verified===true && control.evidence?.evidence_id
    && (control.status!=='LIVE' || control.evidence?.canary_verified===true));
}

export async function executeRecipientAbsentResolution({issueId,readFresh,readProviderIssue,writer,ledger,flags={},now=()=>new Date()}) {
  if(flags.AUSENTE_AUTOMATION_LIVE!==true || flags.AUSENTE_LOGISTICS_WRITES_ENABLED!==true)return {status:'HUMAN_REVIEW_REQUIRED',reason:'ABSENT_RESOLUTION_LIVE_DISABLED',writes:0};
  if(!writer)return {status:'HUMAN_REVIEW_REQUIRED',reason:'WRITE_PERMISSION_NOT_AVAILABLE',writes:0};
  return ledger.withIssueLock(issueId,async store=>{
    const control=await store.control();
    if(!absentResolutionControlVerified(control))
      return {status:'HUMAN_REVIEW_REQUIRED',reason:'ABSENT_ACTIVATION_GATES_NOT_VERIFIED',writes:0};
    const fresh=await readFresh(issueId), proposal=absentResolutionPreflight(fresh,now());
    if(fresh.decision_currentness!=='CURRENT')return {status:'HUMAN_REVIEW_REQUIRED',reason:'DECISION_NOT_CURRENT',writes:0};
    if(Date.parse(fresh.issue.created_at)<Date.parse(control.activation_at) || !Number.isFinite(Date.parse(fresh.issue.created_at)))return {status:'HUMAN_REVIEW_REQUIRED',reason:'HISTORICAL_CASE_NOT_ELIGIBLE',writes:0};
    const previous=await store.get(issueId);
    if(previous)return {status:previous.status==='APPLIED' && previous.idempotency_key===proposal.idempotency_key?'ALREADY_RESOLVED_WITH_SAME_EVIDENCE':'HUMAN_REVIEW_REQUIRED',reason:previous.status==='APPLIED'?'LATER_ACTION_ALREADY_EXISTS':'PREVIOUS_EXECUTION_REQUIRES_RECONCILIATION',writes:0};
    if(!proposal.can_execute)return {status:'HUMAN_REVIEW_REQUIRED',blocking_reasons:proposal.blocking_reasons,writes:0};
    // Re-read after lock acquisition and initial evaluation. Never send an old
    // morning choice when a later afternoon choice has arrived meanwhile.
    const latest=await readFresh(issueId), resolution=absentResolutionPreflight(latest,now());
    if(latest.decision_currentness!=='CURRENT')return {status:'HUMAN_REVIEW_REQUIRED',reason:'DECISION_NOT_CURRENT',writes:0};
    if(control.status==='CANARY' && (resolution.resolution_structured.interpretation_source!=='VERIFIED_BUTTON'
      || !['MORNING','AFTERNOON'].includes(resolution.resolution_structured.requested_time_window)))
      return {status:'HUMAN_REVIEW_REQUIRED',reason:'CANARY_VERIFIED_AM_PM_REQUIRED',writes:0};
    if(!resolution.can_execute)return {status:'HUMAN_REVIEW_REQUIRED',blocking_reasons:resolution.blocking_reasons,writes:0};
    if(latest.issue.canonical_issue_id!==issueId || latest.order.canonical_order_id!==fresh.order.canonical_order_id)return {status:'HUMAN_REVIEW_REQUIRED',reason:'EXACT_ORDER_IDENTITY_REQUIRED',writes:0};
    const audit={canonical_issue_id:issueId,canonical_order_id:latest.order.canonical_order_id,
      canary_quick_reply_verified:resolution.resolution_structured.interpretation_source==='VERIFIED_BUTTON' && ['MORNING','AFTERNOON'].includes(resolution.resolution_structured.requested_time_window),
      response_id:resolution.resolution_structured.source_message_id,idempotency_key:resolution.idempotency_key,
      resolution_hash:resolution.resolution_hash,structured:resolution.resolution_structured,policy_version:ABSENT_RESOLUTION_POLICY};
    if(!await store.claim(audit))return {status:'HUMAN_REVIEW_REQUIRED',reason:'PREVIOUS_EXECUTION_REQUIRES_RECONCILIATION',writes:0};
    // Claim persistence must not turn fresh input into a stale write.
    if(!absentResolutionPreflight(latest,now()).can_execute || !absentResolutionControlVerified(await store.control())){
      await store.finish(issueId,{status:'ABORTED',reason:'RESOLUTION_DATA_NOT_FRESH',provider_response:null});
      return {status:'HUMAN_REVIEW_REQUIRED',reason:'RESOLUTION_DATA_NOT_FRESH',writes:0};
    }
    let response;
    try {response=await writer.provideSolution({issueId:latest.issue.dropea_issue_id,resolution,idempotencyKey:resolution.idempotency_key});}
    catch {response={confirmed:false,reason:'PROVIDER_RESULT_UNVERIFIED'};}
    let verified=false,reconciliation=null;
    // Even after timeout, reconcile with GET before stopping. The provider does
    // not echo resolution_note, so an unacknowledged POST cannot be attributed
    // to this exact instruction merely because the issue is now resolved.
    try {
        const after=await readProviderIssue(latest.issue);
        const exact=String(after?.id)===String(latest.issue.dropea_issue_id) && String(after?.order_id)===String(latest.issue.dropea_order_id);
        reconciliation={exact_identity:exact,status:exact?after.status:null,resolution_status:exact?after.resolution_status:null};
        verified=response.confirmed===true && response.order_id===String(latest.issue.dropea_order_id) && exact
          && after.status==='RESOLVED' && after.resolution_status==='SOLUTION_PROVIDED'
          && Date.parse(after.resolution_changed_at)===Date.parse(response.resolution_changed_at);
    } catch { /* durable claim remains; never automatically repeat */ }
    const outcome={status:verified?'APPLIED':'UNVERIFIED',reason:verified?null:'PROVIDER_RESULT_UNVERIFIED',
      executed_at:new Date(now()).toISOString(),reconciliation,provider_response:{confirmed:response.confirmed===true,http_status:response.http_status || null,
        issue_id:response.issue_id || null,status:response.status || null,resolution_status:response.resolution_status || null,
        resolution_changed_at:response.resolution_changed_at || null}};
    if(!verified){try{await store.trip?.('PROVIDER_RESULT_UNVERIFIED');}catch{/* durable claim and runtime latch remain */}}
    try {await store.finish(issueId,outcome);}
    catch {try{await store.trip?.('AUDIT_FINALIZATION_FAILED');}catch{}return {status:'UNVERIFIED',reason:'AUDIT_FINALIZATION_FAILED',writes:1,idempotency_key:resolution.idempotency_key};}
    return {status:outcome.status,reason:outcome.reason,writes:1,idempotency_key:resolution.idempotency_key};
  });
}

export function createAbsentResolutionLedger(pool){
  return {async withIssueLock(issueId,fn){
    const client=await pool.connect();
    try {
      const lock=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[`absent-resolution:${issueId}`]);
      if(!lock.rows[0]?.acquired)return {status:'IN_PROGRESS',writes:0};
      const store={
        async control(){return (await client.query("SELECT status,activation_at,evidence,circuit_breaker_reason FROM operations.recipient_absent_resolution_control WHERE workflow='RECIPIENT_ABSENT' AND EXISTS (SELECT 1 FROM operations.recipient_absent_native_control n WHERE n.workflow='RECIPIENT_ABSENT' AND n.automation_live=true AND n.circuit_breaker_reason IS NULL)")).rows[0] || null;},
        async trip(reason){await client.query("UPDATE operations.recipient_absent_resolution_control SET circuit_breaker_reason=$1,circuit_breaker_at=now() WHERE workflow='RECIPIENT_ABSENT'",[reason]);},
        async get(id){return (await client.query('SELECT status,idempotency_key FROM operations.recipient_absent_resolutions WHERE canonical_issue_id=$1',[id])).rows[0] || null;},
        async claim(a){
          await client.query('BEGIN');
          try {
          const control=(await client.query("SELECT status,activation_at,evidence,canary_issue_id,circuit_breaker_reason FROM operations.recipient_absent_resolution_control WHERE workflow='RECIPIENT_ABSENT' AND EXISTS (SELECT 1 FROM operations.recipient_absent_native_control n WHERE n.workflow='RECIPIENT_ABSENT' AND n.automation_live=true AND n.circuit_breaker_reason IS NULL) FOR UPDATE")).rows[0];
          if(!absentResolutionControlVerified(control) || control.status==='CANARY' && control.canary_issue_id && control.canary_issue_id!==a.canonical_issue_id){await client.query('ROLLBACK');return false;}
          if(control.status==='CANARY' && a.canary_quick_reply_verified!==true){await client.query('ROLLBACK');return false;}
          const r=await client.query(`INSERT INTO operations.recipient_absent_resolutions
          (canonical_issue_id,canonical_order_id,response_id,idempotency_key,resolution_hash,structured,policy_version,status)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'CLAIMED') ON CONFLICT DO NOTHING RETURNING idempotency_key`,
          [a.canonical_issue_id,a.canonical_order_id,a.response_id,a.idempotency_key,a.resolution_hash,JSON.stringify(a.structured),a.policy_version]);
          if(r.rowCount===1 && control.status==='CANARY')await client.query("UPDATE operations.recipient_absent_resolution_control SET canary_issue_id=$1 WHERE workflow='RECIPIENT_ABSENT'",[a.canonical_issue_id]);
          await client.query('COMMIT');return r.rowCount===1;
          }catch(error){await client.query('ROLLBACK');throw error;}
        },
        async finish(id,outcome){await client.query(`UPDATE operations.recipient_absent_resolutions SET status=$2,outcome=$3::jsonb,updated_at=now() WHERE canonical_issue_id=$1 AND status='CLAIMED'`,[id,outcome.status,JSON.stringify(outcome)]);}
      };
      return await fn(store);
    } finally {try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`absent-resolution:${issueId}`]);}finally{client.release();}}
  }};
}
