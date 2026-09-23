import {randomUUID} from 'node:crypto';
import {NATIVE_ABSENT_TEMPLATE} from './recipient-absent-native-gate.mjs';
import {captureObservedAbsentCallbacks} from './integrations/chatby/absent-observed-callbacks.mjs';

export function verifyNativeAbsentNotice(claim,history,now=new Date()){
  if(history?.complete!==true || history.conversation_id!==claim.conversation_id)return {verified:false,reason:'NOTICE_HISTORY_NOT_VERIFIED'};
  const matches=history.messages.filter(m=>m.direction==='OUTBOUND'
    // Chatby timestamps have one-second precision; a send in the claim's
    // second must not disappear because Postgres recorded milliseconds.
    && Date.parse(m.at)+999>=Date.parse(claim.claimed_at)
    && ['dropea_incidencia_ausente_v2',NATIVE_ABSENT_TEMPLATE].includes(m.template_name));
  if(matches.some(m=>m.template_name!==NATIVE_ABSENT_TEMPLATE))return {verified:false,trip:true,reason:'V2_AFTER_CUTOVER'};
  if(matches.length>1)return {verified:false,trip:true,reason:'DUPLICATE_V3_NOTICE'};
  const m=matches[0];
  if(!m || !m.message_id || String(m.template_id)!=='1552419' || Date.parse(m.at)>+now
    || !Number.isFinite(Date.parse(m.at)) || m.delivery_failed===true)return {verified:false,reason:'NOTICE_NOT_OBSERVED'};
  return {verified:true,message_id:String(m.message_id),provider_message_id:m.provider_message_id || null,
    notification_at:new Date(m.at).toISOString(),timer:{timer_id:randomUUID(),message_id:String(m.message_id),
      policy_version:'RECIPIENT_ABSENT_POLICY_V1',timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',
      started_at:new Date(m.at).toISOString(),due_at:new Date(Date.parse(m.at)+48*3600000).toISOString()}};
}

// Only an independent provider history read may call this reconciler. An HTTP
// acknowledgement from the flow is not evidence that WhatsApp sent the message.
export async function reconcileNativeAbsentNotice({pool,claimId,readHistory,now=()=>new Date()}){
  const found=(await pool.query('SELECT * FROM operations.recipient_absent_native_notifications WHERE claim_id=$1',[claimId])).rows[0];
  if(!found)return {verified:false,reason:'CLAIM_NOT_FOUND'};
  const history=await readHistory(found);
  const result=verifyNativeAbsentNotice(found,history,new Date(now()));
  const callbacks=result.verified ? captureObservedAbsentCallbacks(history.callback_events || [],
    {verified:true,template_id:'1552419',message_id:result.message_id,provider_message_id:result.provider_message_id,
      conversation_id:found.conversation_id,notification_at:result.notification_at},new Date(now())):{samples:[],unknown:[]};
  if(callbacks.unknown.length){result.trip=true;result.reason='UNKNOWN_BOUND_V3_CALLBACK';}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT workflow FROM operations.recipient_absent_native_control WHERE workflow='RECIPIENT_ABSENT' FOR UPDATE");
    const current=(await client.query('SELECT * FROM operations.recipient_absent_native_notifications WHERE claim_id=$1 FOR UPDATE',[claimId])).rows[0];
    if(result.trip){
      await client.query("UPDATE operations.recipient_absent_native_control SET circuit_breaker_reason=$1,circuit_breaker_at=now() WHERE workflow='RECIPIENT_ABSENT'",[result.reason]);
      await client.query("UPDATE operations.recipient_absent_resolution_control SET circuit_breaker_reason=$1,circuit_breaker_at=now() WHERE workflow='RECIPIENT_ABSENT'",[result.reason]);
    }
    if(result.verified && current.status!=='VERIFIED'){
      await client.query("UPDATE operations.recipient_absent_native_notifications SET status='SENT',message_id=$2,notification_at=$3,outcome=$4::jsonb WHERE claim_id=$1",
        [claimId,result.message_id,result.notification_at,JSON.stringify({provider_message_id:result.provider_message_id})]);
      const t=result.timer;
      await client.query(`INSERT INTO operations.recipient_absent_native_timers
        (timer_id,canonical_issue_id,message_id,policy_version,timer_type,started_at,due_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [t.timer_id,current.canonical_issue_id,t.message_id,t.policy_version,t.timer_type,t.started_at,t.due_at]);
      await client.query("UPDATE operations.recipient_absent_native_notifications SET status='VERIFIED',verified_at=now() WHERE claim_id=$1",[claimId]);
    }
    await client.query(`UPDATE operations.recipient_absent_native_notifications
      SET outcome=coalesce(outcome,'{}'::jsonb)||$2::jsonb WHERE claim_id=$1`,
      [claimId,JSON.stringify({last_observed_at:new Date(now()).toISOString(),...(callbacks.samples.length?{observed_callbacks:callbacks.samples}:{})})]);
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
