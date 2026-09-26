import crypto from 'node:crypto';

export const ADDRESS_CANONICAL_POLICY = Object.freeze({id:'ADDRESS_INCORRECT_POLICY_V1',response_policy:'ADDRESS_INCORRECT_RESPONSE_V1',version:'2026-09-26.2',offer_hours:24,return_hours:48,anchor:'REAL_INITIAL_TEMPLATE_SEND',partial_response:'WAIT_DETAILS_THEN_MANUAL_REVIEW',discount_application:'MANUAL_ONLY',owner:'render_incident_automation'});
export const addressHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ADDRESS_POLICY_HASH = addressHash(ADDRESS_CANONICAL_POLICY);
const sameTime=(a,b)=>Boolean(a&&b)&&new Date(a).getTime()===new Date(b).getTime();

// This materializes the existing owner's decision; it cannot execute an action.
// Timer identity deliberately excludes issue version and observation event.
export function materializeAddress({issue,observation:d={},policy,previous={},now=new Date()}) {
 const time=+new Date(now),age=time-Date.parse(d.read_at);
 const verified=d.read_verified===true&&age>=0&&age<=20*60000;
 const versionMatches=sameTime(d.issue_version,issue.updated_at);
 const anchor=d.template_name==='dropea_incidencia_direccion_v1'&&d.notification_message_id
   &&Number.isFinite(Date.parse(d.notification_at))&&Date.parse(d.notification_at)>=new Date(issue.created_at).getTime()
   &&Date.parse(d.notification_at)<=time;
 const conflict=d.execution?.provider_error_code==='GLS_INCIDENCE_ALREADY_SOLVED'||previous.provider_conflict===true;
 const uncertain=conflict||['MANUAL_RECONCILIATION_REQUIRED','EXECUTION_UNKNOWN','RETURN_REQUESTED_UNVERIFIED','ALREADY_CLAIMED_RECONCILE'].includes(d.execution?.status);
 const superseded=d.initial_milestones==='SUPERSEDED_BY_CUSTOMER_RESPONSE'||previous.milestones_superseded===true;
 const milestone=at=>!anchor?'NO_ANCHOR':at>=Date.parse(d.notification_at)+48*3600000?'RETURN_DUE':at>=Date.parse(d.notification_at)+24*3600000?'OFFER_DUE':'WAIT';
 const milestoneChanged=!superseded&&milestone(time)!==milestone(Date.parse(d.read_at));
 const anchorConflict=Boolean(previous.notification_message_id&&d.notification_message_id!==previous.notification_message_id);
 const registered=Boolean(policy?.policy_id&&policy.policy_snapshot_hash===ADDRESS_POLICY_HASH);
 const ownerPolicyMatches=d.policy_snapshot_hash===ADDRESS_POLICY_HASH;
 const blockers=[...(issue.type!=='ADDRESS_INCORRECT'?['ADDRESS_MAPPING_NOT_GOVERNED']:[]),...(!verified?['CHATBY_CURRENT_READ_NOT_VERIFIED']:[]),...(!versionMatches?['OWNER_ISSUE_VERSION_MISMATCH']:[]),
   ...(!anchor?['INITIAL_NOTIFICATION_NOT_VERIFIED']:[]),...(anchorConflict?['NOTIFICATION_CONFLICT']:[]),
   ...(!registered?['POLICY_NOT_PERSISTED']:[]),...(!ownerPolicyMatches?['OWNER_POLICY_NOT_VERIFIED']:[]),...(milestoneChanged?['OWNER_MILESTONE_STALE']:[]),...(uncertain?['PROVIDER_STATE_CONFLICT']:[])];
 const timer=anchor&&!anchorConflict?{
   timer_id:`timer-${addressHash([issue.canonical_issue_id,d.notification_message_id,ADDRESS_CANONICAL_POLICY.response_policy]).slice(0,24)}`,
   timer_type:'CUSTOMER_INITIAL_RESPONSE_48H',policy_version:ADDRESS_CANONICAL_POLICY.response_policy,
   notification_message_id:d.notification_message_id,started_at:new Date(d.notification_at).toISOString(),
   due_at:new Date(Date.parse(d.notification_at)+48*3600000).toISOString(),
   offer_due_at:new Date(Date.parse(d.notification_at)+24*3600000).toISOString(),
   status:superseded?'SUPERSEDED':Date.parse(d.notification_at)+48*3600000<=time?'EXPIRED':'ACTIVE'
 }:null;
 const historical_blockers=[...new Set([...(previous.historical_blockers||[]),...(issue.blocking_reasons||[])])]
   .filter(reason=>!blockers.includes(reason));
 const input={issue_version:new Date(issue.updated_at).toISOString(),issue_status:issue.status,issue_active:issue.is_active,
   canonical_type:issue.type,validation_blockers:blockers,
   owner_input_hash:d.input_snapshot_hash||null,read_at:d.read_at||null,notification_message_id:d.notification_message_id||null,
   notification_at:d.notification_at||null,last_customer_at:d.last_customer_at||null,intent:d.intent||'UNKNOWN',
   milestones_superseded:superseded,provider_conflict:conflict,execution:d.execution||null,
   milestone:timer?(time>=Date.parse(timer.due_at)?'RETURN_DUE':time>=Date.parse(timer.offer_due_at)?'OFFER_DUE':'WAIT'):'NO_ANCHOR'};
 const input_snapshot_hash=addressHash(input);
 const action=blockers.length||superseded&&!d.initial_milestones?'HUMAN_REVIEW':d.action||'HUMAN_REVIEW';
 return {policy_id:registered?policy.policy_id:null,policy_version:ADDRESS_CANONICAL_POLICY.id,
   policy_snapshot_hash:ADDRESS_POLICY_HASH,input_snapshot_hash,
   decision_id:addressHash([issue.canonical_issue_id,ADDRESS_POLICY_HASH,input_snapshot_hash,action]),
   snapshot_status:registered?'PERSISTED':'NOT_PERSISTED',current:registered&&ownerPolicyMatches&&verified&&versionMatches&&!anchorConflict&&!milestoneChanged,
   state:uncertain?'PROVIDER_RECONCILIATION_REQUIRED':action==='HUMAN_REVIEW'?'HUMAN_REVIEW':d.state,
   action,blocking_reasons:blockers,current_blockers:blockers,historical_blockers,timer,input,
   milestones_superseded:superseded,provider_conflict:conflict,
   notification_message_id:d.notification_message_id||null,
   finding:conflict?{type:'PROVIDER_STATE_CONFLICT',DROPEA_STATE:issue.status,
     GLS_OPERATION_STATE:d.execution?.provider_error_code||'GLS_INCIDENCE_ALREADY_SOLVED',
     last_checked_at:d.read_at||null,manual_reconciliation_required:true,canary_excluded:true}:null,
   executed:false,external_action:false,production_write:false};
}
