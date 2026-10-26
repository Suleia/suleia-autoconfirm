const stamp=x=>Date.parse(x);
const deny=reason=>({acquired:false,persistent:true,reason});

export function preSaveRecoveryProof(plan,row,{events,cycles,journalPresent,now=Date.now()}){
 const r=row?.raw,attempt=stamp(row?.attempted_at);
 if(plan?.kind!=='SOLUTION'||!/^\d+$/.test(plan.orderId)||!/^\d+$/.test(plan.issueId)
  ||!row?.template_key||row.store_id!=='suleia'||row.provider!=='dropea'||String(row.order_id)!==plan.orderId
  ||row.template_name!==`incident_resolution_v1:${plan.issueId}`||row.status!=='applied_unverified'||row.sent_at
  ||r?.owner!=='vps_retry_evidence'||r.status!=='applied_unverified'||r.reason!=='EXACT_ORDER_FUTURE_RETRY_WITH_SCREENSHOT'
  ||String(r.orderId)!==plan.orderId||String(r.issueId)!==plan.issueId||r.date!==plan.date||r.time_window!==plan.time_window
  ||!Number.isFinite(attempt)||attempt>now||journalPresent||!Array.isArray(events)||!Array.isArray(cycles))return null;
 const matching=events.filter(e=>String(e.orderId)===plan.orderId&&String(e.issueId)===plan.issueId&&stamp(e.at)>=attempt);
 if(matching.length!==1)return null;
 const event=matching[0];
 if(event.status!=='FAILED_PRE_SAVE'||event.reason!=='PREPARATION_FAILED_CLAIM_RETAINED'||event.saveAttempted===true
   ||!Number.isFinite(stamp(event.at))||stamp(event.at)>now)return null;
 const complete=cycles.filter(c=>Number.isFinite(stamp(c.startedAt))&&Number.isFinite(stamp(c.completedAt))
  &&stamp(c.startedAt)<=attempt&&stamp(c.completedAt)>=stamp(event.at)&&stamp(c.completedAt)<=now
  &&c.results?.some(x=>String(x.orderId)===plan.orderId&&String(x.issueId)===plan.issueId
    &&x.saveAttempted===false&&x.status==='FAILED_PRE_SAVE'&&x.reason===event.reason));
 if(complete.length!==1)return null;
 return {previousAttemptAt:row.attempted_at,failedBeforeSaveAt:event.at,originalCycleCompletedAt:complete[0].completedAt,
  saveAttempted:false,previousOwner:r.owner,previousDate:r.date,previousWindow:r.time_window};
}

// Retain and atomically advance the SAME reservation only with positive proof
// from both original audit and completed cycle that Save was never attempted.
// An absent journal alone, an unknown result, or another owner never suffices.
export async function recoverPreSaveClaim(plan,row,{readEvidence,compareAndSet,now=Date.now()}){
 let proof;try{proof=preSaveRecoveryProof(plan,row,{...await readEvidence(),now});}catch{return deny('PRE_SAVE_PROOF_UNAVAILABLE');}
 if(!proof)return deny('PRE_SAVE_RECOVERY_NOT_PROVEN');
 const at=new Date(now).toISOString();
 try{
  const changed=await compareAndSet({status:'claimed',attempted_at:at,updated_at:at,
   raw:{owner:'vps_delivery_reply',orderId:plan.orderId,issueId:plan.issueId,preSaveRecovery:proof}},
   {template_key:`eq.${row.template_key}`,store_id:'eq.suleia',order_id:`eq.${plan.orderId}`,provider:'eq.dropea',
    template_name:`eq.incident_resolution_v1:${plan.issueId}`,status:'eq.applied_unverified',attempted_at:`eq.${row.attempted_at}`,'raw->>owner':'eq.vps_retry_evidence'});
  if(!Array.isArray(changed)||changed.length!==1||changed[0].template_key!==row.template_key||changed[0].status!=='claimed')return deny('PRE_SAVE_RESERVATION_NOT_ACQUIRED');
  return {acquired:true,persistent:true,recovered:true,proof,row:changed[0]};
 }catch{return deny('PRE_SAVE_RESERVATION_UNCERTAIN');}
}
