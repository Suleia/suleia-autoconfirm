import {resolutionCandidate} from './incident-resolution-plan.mjs';
import {verifyDropeaResolution} from '../clients/dropea-v2-resolution-contract.mjs';

export function resolutionCapabilityMode(workflow,action,issueId,env=process.env){
  const prefix=`INCIDENT_E2E_${workflow}_${action}`;
  if(env[`${prefix}_BREAKER`]!=='CLOSED')return 'SHADOW';
  const mode=env[`${prefix}_MODE`];
  if(mode==='CANARY'&&String(env[`${prefix}_ISSUE_ID`]||'')===String(issueId))return 'CANARY';
  // Promotion is a separate, audited configuration action after real evidence.
  if(mode==='LIVE'&&env[`${prefix}_CANARY_VERIFIED`]==='true')return 'LIVE';
  return 'SHADOW';
}

// The only side-effect boundary of new resolution capabilities. Runtime adapters
// are explicit; unavailable economic contracts cannot be replaced by a 200/email.
export async function executeResolutionCandidate(input,candidate,deps){
  const {twin,action,providerPlan}=candidate;
  const blocked=reason=>({status:'PREPARED',verified:false,reason});
  if(input.historical===true)return blocked('HISTORICAL_EXECUTION_FORBIDDEN');
  if(!action||twin.human_review_reason)return blocked(twin.human_review_reason||'NO_ACTION');
  if(!providerPlan?.allowed)return blocked('PROVIDER_CONTRACT_UNAVAILABLE');
  if(!['RETRY_DELIVERY','PICKUP_AT_AGENCY','REQUEST_RETURN','CHANGE_ADDRESS','PROVIDE_SOLUTION'].includes(action))return blocked('CAPABILITY_NOT_IMPLEMENTED');
  if(resolutionCapabilityMode(twin.workflow,action,twin.incident_id,deps.env)==='SHADOW')return blocked('CAPABILITY_SHADOW');
  const plan=twin.resolution_plan;
  const args={orderId:twin.order_id,issueId:twin.incident_id,action,planId:plan.plan_id};
  async function gate(){
    const current=await deps.readCurrent(input.incident);
    const issue=current.issue?.raw||current.issue;
    if(String(issue?.id)!==twin.incident_id||String(issue?.order_id)!==twin.order_id||String(current.order?.orderId)!==twin.order_id||issue.status!=='PENDING'||issue.is_active!==true)return null;
    if(!['ERROR','INCIDENCE'].includes(current.order.status))return null;
    if(await deps.priorConflict(input.incident))return null;
    if(!await deps.verifyConversation(input.incident,current.order))return null;
    const messages=await deps.readMessages(input.incident.chatbyUserNs);
    const fresh=resolutionCandidate({...input,order:current.order,issue:current.issue,messages,previous:null,now:deps.now?.()||Date.now()});
    if(fresh.twin.human_review_reason||fresh.twin.resolution_plan?.input_hash!==plan.input_hash||fresh.action!==action)return null;
    return fresh;
  }
  let fresh;
  try{fresh=await gate();}catch{return blocked('PRE_ACTION_READ_FAILED');}
  if(!fresh)return blocked('CURRENT_EVIDENCE_CHANGED');
  const claim=await deps.claim(args);
  if(!claim?.acquired||claim.persistent!==true)return {status:'UNKNOWN',verified:false,reason:'CLAIM_EXISTS_RECONCILE_ONLY'};
  try{fresh=await gate();}catch{fresh=null;}
  if(!fresh || resolutionCapabilityMode(twin.workflow,action,twin.incident_id,deps.env)==='SHADOW'){
    await deps.finish(args,{status:'aborted',reason:'LATE_EVIDENCE_OR_BREAKER_CHANGE'});
    return blocked('LATE_EVIDENCE_OR_BREAKER_CHANGE');
  }
  const attemptedAt=new Date(deps.now?.()||Date.now()).toISOString();
  // Persist before issuing POST so process death also reconciles, never resends.
  await deps.finish(args,{status:'requested',attemptedAt,inputHash:plan.input_hash});
  let receipt=false;
  try{await deps.write(twin.incident_id,action,fresh.data,{idempotencyNonce:plan.plan_id});receipt=true;}catch{/* One POST maximum. */}
  let after=null;
  try{after=await deps.readCurrent(input.incident);}catch{/* Unknown is not failure or success. */}
  const verified=String(after?.order?.orderId)===twin.order_id&&verifyDropeaResolution(after,{issueId:twin.incident_id,orderId:twin.order_id,action,body:providerPlan.body});
  const result={status:verified?'VERIFIED':'UNKNOWN',verified,provider_receipt:receipt,action,attemptedAt,verifiedAt:verified?new Date(deps.now?.()||Date.now()).toISOString():null,reason:verified?null:'PROVIDER_STATE_REQUIRES_RECONCILIATION'};
  await deps.finish(args,result);
  return result;
}

export function recordResolutionExecution(twin,result){
  const t=structuredClone(twin);
  if(result.status==='PREPARED')return {...t,capability_blocker:result.reason,human_review_reason:result.reason,next_best_action:null,explicit_wait_until:null,current_owner:'HUMAN'};
  t.execution_status=result.status;t.verification_status=result.verified?'VERIFIED':'UNKNOWN';
  if(t.resolution_plan){t.resolution_plan.status=result.verified?'VERIFIED':'UNKNOWN';
    t.resolution_plan.steps=t.resolution_plan.steps.map((s,i)=>i===0?{...s,status:result.status,verification:t.verification_status,attempted_at:result.attemptedAt||null,verified_at:result.verifiedAt||null}:s);}
  t.next_best_action=result.verified?'VERIFY_PROVIDER':'RECONCILE_PROVIDER';t.explicit_wait_until=null;t.human_review_reason=null;t.current_owner='PROVIDER';
  t.customer_replied_but_unresolved=!result.verified&&t.customer_replied;
  return t;
}
