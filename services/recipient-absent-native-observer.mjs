import {createReadOnlyTransport} from '../packages/platform-core/src/read-only-transport.mjs';
import {readAbsentMessageHistory} from './integrations/chatby/absent-message-history.mjs';
import {reconcileNativeAbsentNotice} from './recipient-absent-native-verification.mjs';

export function normalizeNativeAbsentHistory(history,conversationId){
  return {complete:history.complete===true,conversation_id:conversationId,
    callback_events:history.items.filter(m=>['in','inbound','customer'].includes(String(m.type || m.direction).toLowerCase()))
      .map(m=>({...m,user_ns:conversationId})),messages:history.items.map(m=>{
    const value=m.ts ?? m.created_at ?? m.timestamp,n=Number(value);
    const date=Number.isFinite(n) && n>0 ? new Date(n>1e12?n:n*1000):new Date(value);
    const name=m.template_name || m.template?.name || m.payload?.template_name || m.payload?.template?.name || m.payload?.name;
    return {direction:['out','outbound','bot','sent'].includes(String(m.type || m.direction).toLowerCase())?'OUTBOUND':'OTHER',
      at:Number.isFinite(+date)?date.toISOString():null,message_id:m.id || m.mid || null,
      provider_message_id:m.wamid || m.payload?.wamid || null,template_name:name,
      // The approved catalog establishes this name's stable Chatby ID. If the
      // provider supplies an explicit contradictory ID, preserve it and fail.
      template_id:m.template_id || m.payload?.template_id || (name==='dropea_ausente_v3'?'1552419':null),
      delivery_failed:m.status==='failed' || m.delivery_status==='failed'};
  })};
}

// Observes only persisted native claims, never all customers. This loop cannot
// send a message, retry a claim, publish a callback contract or enable writes.
export function createNativeAbsentObserver({pool,token,fetchImpl=fetch,now=()=>new Date()}){
  const transport=createReadOnlyTransport({fetchImpl,allowedHosts:['app.chatby.io'],maxRetries:0,minRequestIntervalMs:3500});
  let running=false,cooldownUntil=0;
  return {async run(){
    if(running || +new Date(now())<cooldownUntil)return {observed:0,deferred:true};
    running=true;
    try{
      const rows=await pool.query(`SELECT claim_id FROM operations.recipient_absent_native_notifications
        WHERE status IN ('CLAIMED','SENT','VERIFIED') AND claimed_at>now()-interval '72 hours'
        ORDER BY (outcome->>'last_observed_at')::timestamptz NULLS FIRST,claimed_at LIMIT 5`);
      let observed=0,failed=false;
      for(const row of rows.rows){
        try{
          await reconcileNativeAbsentNotice({pool,claimId:row.claim_id,now,readHistory:async claim=>{
            const result=await readAbsentMessageHistory({transport,base:new URL('https://app.chatby.io'),token,userNs:claim.conversation_id});
            return normalizeNativeAbsentHistory(result,claim.conversation_id);
          }});observed++;
        }catch(error){
          // Respect provider cooldown globally for this observer. No immediate
          // retries, even if several other claims are waiting.
          failed=true;cooldownUntil=Math.max(+new Date(now())+120000,error.retryNotBefore || 0);break;
        }
      }
      return {observed,...(failed?{failed:true}:{})};
    }finally{running=false;}
  }};
}
