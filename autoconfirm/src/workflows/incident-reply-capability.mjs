import {randomUUID} from 'node:crypto';
import {selectRows,insertRows,updateRows} from '../clients/supabase.mjs';
import {executeResolutionCandidate} from './incident-resolution-executor.mjs';

const actions={ABSENT:['RETRY_DELIVERY','PICKUP_AT_AGENCY','REQUEST_RETURN'],ADDRESS:['RETRY_DELIVERY','PICKUP_AT_AGENCY','REQUEST_RETURN','PROVIDE_SOLUTION']};
export function automaticReplyCapability(candidate,env=process.env){
  const {twin,action}=candidate;
  const prefix=`INCIDENT_E2E_${twin.workflow}_${action}`;
  return actions[twin.workflow]?.includes(action)&&env[`${prefix}_MODE`]==='AUTO_CANARY'&&env[`${prefix}_BREAKER`]==='CLOSED';
}
const store={
  async get(key){return (await selectRows('app_state',{query:{key:`eq.${key}`},limit:1}))[0]||null;},
  async initialize(key,value){try{return (await insertRows('app_state',{key,value,updated_at:new Date().toISOString()},{returning:'representation'}))[0];}catch(e){if(!/409|23505/.test(String(e.message)))throw e;return this.get(key);}},
  async cas(row,value){return (await updateRows('app_state',{value,updated_at:new Date().toISOString()},{query:{key:`eq.${row.key}`,updated_at:`eq.${row.updated_at}`,'value->>revision':`eq.${row.value.revision}`},returning:'representation'}))[0]||null;}
};

// One durable reservation per capability. A crash or uncertain provider result
// leaves the capability blocked; only a verified real action promotes it.
export async function executeAutomaticReply(input,candidate,deps,{state=store,execute=executeResolutionCandidate}={}){
  const env=deps.env||process.env,{twin,action}=candidate;
  const blocked=reason=>({status:'PREPARED',verified:false,reason});
  if(!automaticReplyCapability(candidate,env))return blocked('CAPABILITY_SHADOW');
  if(twin.human_review_reason||!candidate.providerPlan?.allowed)return blocked(twin.human_review_reason||'PROVIDER_CONTRACT_UNAVAILABLE');
  if(!/^[a-f0-9]{40}$/.test(env.INCIDENT_REPLY_REGRESSION_GATE_REVISION||'')||env.INCIDENT_REPLY_REGRESSION_GATE_REVISION!==env.RENDER_GIT_COMMIT)return blocked('CAPABILITY_RELEASE_GATE');
  const key=`incident_reply_capability_v1:${twin.workflow}:${action}`;
  let row=await state.get(key)||await state.initialize(key,{revision:randomUUID(),phase:'WAITING_ELIGIBLE_CASE',mode:'CANARY'});
  if(!row||!['WAITING_ELIGIBLE_CASE','VERIFIED'].includes(row.value.phase))return blocked('CAPABILITY_RESERVED_OR_UNCERTAIN');
  const mode=row.value.mode==='LIVE'&&row.value.promotion?.verified===true?'LIVE':'CANARY';
  row=await state.cas(row,{...row.value,revision:randomUUID(),phase:'RESERVED',reservation:{order_id:twin.order_id,issue_id:twin.incident_id,plan_id:twin.resolution_plan.plan_id,at:new Date().toISOString()}});
  if(!row)return blocked('CAPABILITY_ALREADY_RESERVED');
  const prefix=`INCIDENT_E2E_${twin.workflow}_${action}`;
  const runEnv={...env,[`${prefix}_MODE`]:mode,[`${prefix}_ISSUE_ID`]:twin.incident_id,[`${prefix}_CANARY_VERIFIED`]:String(mode==='LIVE')};
  let result;
  try{result=await execute(input,candidate,{...deps,env:runEnv});}catch{result={status:'UNKNOWN',verified:false,reason:'EXECUTION_OR_PERSISTENCE_UNKNOWN'};}
  const verified=result.status==='VERIFIED'&&result.verified===true;
  const next={...row.value,revision:randomUUID(),phase:verified?'VERIFIED':result.status==='PREPARED'?'WAITING_ELIGIBLE_CASE':'HUMAN_REVIEW',mode:verified?'LIVE':mode,
    last_result:{status:result.status,reason:result.reason||null,at:new Date().toISOString()},
    ...(verified?{promotion:{verified:true,issue_id:twin.incident_id,order_id:twin.order_id,release:env.RENDER_GIT_COMMIT,at:result.verifiedAt}}:{})};
  if(!await state.cas(row,next))throw Error('REPLY_CAPABILITY_PERSISTENCE_CONFLICT');
  return {...result,capability_mode:mode,promoted:verified&&mode==='CANARY'};
}
