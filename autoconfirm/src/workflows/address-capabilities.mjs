import crypto from 'node:crypto';
import {addressResponseDecision,ADDRESS_POLICY} from './address-response-policy.mjs';
import {ADDRESS_CAPABILITIES,addressCapability,addressEffectiveMode,configuredAddressBreaker,addressExcluded,governedAddressIssue,addressPromotionAllowed} from './address-capability-policy.mjs';
import {addressCapabilityStore} from './address-capability-store.mjs';
import {claimTemplateDelivery,finishTemplateDelivery} from '../db/supabase-store.mjs';
import {readDropeaV2ReturnIssueState} from '../clients/dropea-v2-incidents.mjs';
import {getIncidentChatMessages} from '../clients/chatby.mjs';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
let cache={};
export const addressCapabilitiesSnapshot=()=>structuredClone(cache);
export async function refreshAddressCapabilities({store=addressCapabilityStore,env=process.env}={}){
 for(const stage of ADDRESS_CAPABILITIES){let row=await store.get(stage);
  if(!row)row=await store.initialize(stage,{revision:crypto.randomUUID(),mode:'CANARY',phase:'WAITING_ELIGIBLE_CASE',breaker:configuredAddressBreaker(stage,env),activated_at:env.ADDRESS_ACTIVATION_AT||null,promotion:null});
  cache[stage]={...row.value,effective_mode:addressEffectiveMode(stage,row.value,env),effective_breaker:configuredAddressBreaker(stage,env)==='OPEN'?'OPEN':row.value.breaker};
 }
 return addressCapabilitiesSnapshot();
}

// Uses the existing owner, provider clients and persistent delivery/action ledger.
// A CAS reserves exactly one real canary per capability across processes/restarts.
export async function runAddressCapability(item,expected,{stage=addressCapability(expected.action),execute,env=process.env,store=addressCapabilityStore,readCurrent=readDropeaV2ReturnIssueState,readMessages=getIncidentChatMessages,claim=claimTemplateDelivery,finish=finishTemplateDelivery,now=()=>Date.now()}={}){
 const incident=item.incident,id=String(incident.incidenceId);
 const blocked=reason=>({status:reason,verified:false,external_write_attempted:false});
 if(!stage||addressExcluded(id,env))return blocked('PROVIDER_RECONCILIATION_REQUIRED');
 if(['PICKUP','RETRY'].includes(stage))return blocked('CAPABILITY_SHADOW');
 let row=await store.get(stage);if(!row)return blocked('CAPABILITY_STATE_UNAVAILABLE');
 const mode=addressEffectiveMode(stage,row.value,env);
 if(!['CANARY','LIVE'].includes(mode)||configuredAddressBreaker(stage,env)==='OPEN'||row.value.breaker==='OPEN')return blocked('CAPABILITY_BLOCKED');
 const regressionPassed=/^[a-f0-9]{40}$/.test(env.ADDRESS_REGRESSION_GATE_REVISION||'')&&env.ADDRESS_REGRESSION_GATE_REVISION===env.RENDER_GIT_COMMIT;
 if(!regressionPassed||env.ADDRESS_POLICY_REGISTRY_HASH!==hash(ADDRESS_POLICY))return blocked('CAPABILITY_RELEASE_GATE');
 if(mode==='CANARY'&&row.value.phase!=='WAITING_ELIGIBLE_CASE')return blocked('CANARY_ALREADY_RESERVED');
 if(stage==='RETURN'){
  // This path cannot close its own breaker. Both persisted and configured
  // breakers require an authorized operator change before a future canary.
  for(const recovery of ['INTERPRETATION','DETAILS','CHANGE_ADDRESS','SOLUTION','OFFER']){
   const state=await store.get(recovery);
   if(!state?.value.promotion?.verified||state.value.breaker!=='CLOSED'||configuredAddressBreaker(recovery,env)==='OPEN')return blocked('WAITING_RECOVERY_CANARIES');
  }
 }
 const fresh=await readCurrent(incident,{includeOrder:true}).catch(()=>null),issue=fresh?.issue?.raw||fresh?.issue;
 if(!issue||!governedAddressIssue(issue)||issue.status!=='PENDING'||issue.is_active!==true||String(issue.id)!==id||String(issue.order_id)!==String(incident.orderId)||String(fresh.order?.orderId)!==String(incident.orderId))return blocked('BLOCKED_CURRENT_IDENTITY_OR_MAPPING');
 if(!Number.isFinite(Date.parse(row.value.activated_at))||!Number.isFinite(Date.parse(issue.created_at))||Date.parse(issue.created_at)<Date.parse(row.value.activated_at))return blocked('HISTORICAL_ACTION_EXCLUDED');
 if(incident.chatbyReadVerified!==true||incident.chatbyOrderAssociation!=='EXACT_ORDER'||!incident.chatbyUserNs)return blocked('BLOCKED_EXACT_CONVERSATION');
 const messages=await readMessages(incident.chatbyUserNs).catch(()=>null);if(!messages)return blocked('BLOCKED_CHATBY_READ');
 const d=addressResponseDecision({incident,messages,order:fresh.order,issue,previous:expected,now:now()});
 if(!d.read_verified||!d.message_id||!d.issue_version||d.decision_status!=='CURRENT'||d.input_snapshot_hash!==expected.input_snapshot_hash)return blocked('DECISION_SUPERSEDED');
 if(stage==='INTERPRETATION'){
  if(!['VALID_ADDRESS','INCOMPLETE_ADDRESS','ADDRESS_CONFIRMED','AMBIGUOUS_ADDRESS','RETURN_REQUEST','AGENCY_REQUEST','OTHER_RESPONSE'].includes(d.intent)||!d.customer_message_present)return blocked('WAITING_REAL_INTERPRETATION_CASE');
 }else if(!d.eligible||addressCapability(d.action)!==stage)return blocked('CAPABILITY_NOT_ELIGIBLE');
 if(stage==='RETURN'&&(d.customer_message_present||d.initial_milestones||now()<Date.parse(d.return_due_at)||!issue.allowed_resolution_options?.includes('RETURN_REQUESTED')))return blocked('RETURN_CANARY_NOT_ELIGIBLE');
 const action_id=hash([stage,id,incident.orderId,d.decision_id]);
 if(mode==='CANARY'){
  const reserved=await store.cas(stage,row,{...row.value,revision:crypto.randomUUID(),phase:'RESERVED',canary:{issue_id:id,order_id:String(incident.orderId),action_id,decision_id:d.decision_id,reserved_at:new Date(now()).toISOString()}});
  if(!reserved)return blocked('CANARY_ALREADY_RESERVED');row=reserved;
 }
 const args={storeId:'suleia',orderId:incident.orderId,templateName:`address_capability_action_v1:${stage}:${id}`,provider:'address_owner'};
 const acquired=await claim(args);
 if(!acquired?.acquired||acquired.persistent!==true){
  if(acquired?.persistent===true&&['verified','aborted'].includes(acquired.existing?.status)){
    if(mode==='CANARY')await store.cas(stage,row,{...row.value,revision:crypto.randomUUID(),phase:'WAITING_ELIGIBLE_CASE'});
    return blocked(acquired.existing.status==='verified'?'ALREADY_VERIFIED':'ALREADY_ABORTED');
  }
  await store.cas(stage,row,{...row.value,revision:crypto.randomUUID(),breaker:'OPEN',phase:'HUMAN_REVIEW',reason:'ACTION_CLAIM_UNAVAILABLE'});
  return blocked('ACTION_CLAIM_UNAVAILABLE');
 }
 const at=new Date(now()).toISOString();let writes=0,result;
 const audit={action_id,workflow:'ADDRESS_INCORRECT',issue_id:id,order_id:String(incident.orderId),decision_id:d.decision_id,policy:ADDRESS_POLICY,capability:stage,mode,claim:acquired.templateKey||args.templateName,requested_at:at,policy_snapshot_hash:d.policy_snapshot_hash,input_snapshot_hash:d.input_snapshot_hash,issue_version:d.issue_version,snapshot_status:'PERSISTED'};
 // A durable pre-write snapshot must succeed before the provider is called.
 await finish({...args,status:'requested',attemptedAt:at,raw:{...audit,status:'REQUESTED'}});
 const stageEnv={...env,[`ADDRESS_${stage}_MODE`]:mode,[`ADDRESS_${stage}_CANARY_ISSUE_ID`]:id};
 if(stage==='CHANGE_ADDRESS')stageEnv.ADDRESS_CHANGE_MODE=mode;
 if(stage==='OFFER')stageEnv.ADDRESS_DISCOUNT_OFFER_MODE=mode;
 const onWrite=()=>{if(++writes>1)throw Error('ADDRESS_ONE_WRITE_LIMIT');};
 try{result=stage==='INTERPRETATION'?{status:'VERIFIED',verified:true,real_read_verified:true,identity_verified:true}:await execute({...fresh,incident,messages,decision:d,env:stageEnv,onWrite});}
 catch{result={status:'EXECUTION_UNKNOWN',verified:false};}
 const proof={...result,identity_verified:true,post_write_verified:result.verified===true&&writes===1};
 const promote=addressPromotionAllowed(stage,proof,{writes,regressionPassed,breaker:row.value.breaker});
 const uncertain=writes>0&&!promote||/UNKNOWN|ALREADY_CLAIMED_RECONCILE|UNVERIFIED/.test(result.status||'');
 const breaker=uncertain?'OPEN':row.value.breaker;
 const status=promote?'VERIFIED':uncertain?'UNKNOWN':'ABORTED';
 const completed_at=new Date(now()).toISOString();
 await finish({...args,status:status.toLowerCase(),attemptedAt:at,sentAt:promote?completed_at:null,raw:{...audit,status,executed_at:writes?completed_at:null,verified_at:promote?completed_at:null,intended_writes:writes,provider_result:{status:result.status,verified:result.verified===true,provider_receipt:result.provider_receipt===true},breaker_effect:breaker}});
 const next={...row.value,revision:crypto.randomUUID(),breaker,phase:promote?'VERIFIED':uncertain?'HUMAN_REVIEW':'WAITING_ELIGIBLE_CASE',mode:promote?'LIVE':row.value.mode,
  ...(promote?{promotion:{verified:true,at:completed_at,action_id,issue_id:id,order_id:String(incident.orderId),writes,release:env.RENDER_GIT_COMMIT,from:mode,to:'LIVE'}}:{})};
 if(!await store.cas(stage,row,next)){
  if(uncertain){
    let opened=false;
    for(let n=0;n<3&&!opened;n++){const latest=await store.get(stage);opened=!!await store.cas(stage,latest,{...latest.value,revision:crypto.randomUUID(),breaker:'OPEN',phase:'HUMAN_REVIEW',reason:'PROVIDER_UNCERTAINTY'});}
    if(!opened)throw Error('ADDRESS_BREAKER_PERSISTENCE_FAILED');
  }else throw Error('ADDRESS_STATE_CAS_CONFLICT');
 }
 cache[stage]={...next,effective_mode:addressEffectiveMode(stage,next,env),effective_breaker:breaker};
 return {...result,capability:stage,mode,status:result.status,action_id,external_write_attempted:writes>0,intended_writes:writes,promoted:promote&&mode==='CANARY',breaker};
}
