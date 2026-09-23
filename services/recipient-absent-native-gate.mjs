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
  if(input.absence_classification!=='FIRST_ABSENCE')return 'SECOND_OR_UNKNOWN_REQUIRES_POLICY_REVIEW';
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
export async function authorizeNativeAbsent({readFresh,ledger,request,now=()=>new Date()}){
  const input=await readFresh(request);
  return ledger.transaction(async store=>{
    const control=await store.controlForUpdate();
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
          (canonical_issue_id,template_version,canonical_order_id,conversation_id,claim_id,status)
          VALUES($1,$2,$3,$4,$5,'CLAIMED') ON CONFLICT DO NOTHING RETURNING claim_id`,
          [a.canonical_issue_id,a.template_version,a.canonical_order_id,a.conversation_id,a.claim_id])).rowCount===1;},
        async reserveCanary(id){await client.query("UPDATE operations.recipient_absent_native_control SET canary_issue_id=$1 WHERE workflow='RECIPIENT_ABSENT'",[id]);}
      });
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}
