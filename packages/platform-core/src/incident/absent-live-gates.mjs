import {ABSENT_TEMPLATE_NAME,ABSENT_TEMPLATE_BODY,ABSENT_TEMPLATE_BUTTONS,absentHash} from './absent-template.mjs';
import {absentSourceFreshness,classifyAbsenceAttempt,classifyAbsentCause,ABSENT_POLICY_HASH} from './absent-evidence.mjs';

export function absentLiveFlags(env={}) {
 const on=key=>env[key]===true || env[key]==='true';
 return Object.fromEntries(['AUSENTE_AUTOMATION_LIVE','AUSENTE_TEMPLATE_SENDS_ENABLED','AUSENTE_RESPONSE_INTERPRETATION_ENABLED',
  'AUSENTE_LOGISTICS_WRITES_ENABLED','AUSENTE_PICKUP_WRITES_ENABLED','AUSENTE_RETURN_WRITES_ENABLED'].map(k=>[k,on(k)]));
}
export function absentContactGate({issue={},order={},chatby={},template={},control={},policy={},flags={},timeline=[],now=new Date()}={}) {
 const reasons=[];
 if(issue.type!=='RECIPIENT_ABSENT')reasons.push('WORKFLOW_OUT_OF_SCOPE');
 if(!flags.AUSENTE_AUTOMATION_LIVE || !flags.AUSENTE_TEMPLATE_SENDS_ENABLED)reasons.push('ABSENT_SENDS_DISABLED');
 if(control.circuit_breaker!=='CLOSED')reasons.push('ABSENT_CIRCUIT_NOT_CLOSED');
 if(control.native_sender_disabled!==true || control.ownership_scope!=='RECIPIENT_ABSENT' || !control.ownership_evidence_id)reasons.push('NATIVE_ABSENT_OWNER_NOT_VERIFIED_DISABLED');
 if(!control.rollback_snapshot_id)reasons.push('ABSENT_ROLLBACK_NOT_PERSISTED');
 if(!control.activation_at || !Number.isFinite(Date.parse(control.activation_at)) || !Number.isFinite(Date.parse(issue.created_at)) || Date.parse(issue.created_at)<Date.parse(control.activation_at))reasons.push('HISTORICAL_CASE_NOT_ELIGIBLE');
 if(!issue.canonical_issue_id || issue.canonical_order_id!==order.canonical_order_id || order.identity_status!=='EXACT')reasons.push('EXACT_ORDER_IDENTITY_REQUIRED');
 if(issue.status!=='PENDING' || issue.is_active!==true || ['DELIVERED','RETURNED','CANCELLED','FINISHED','PAID'].includes(order.canonical_state))reasons.push('INCIDENT_NOT_CURRENT');
 if(classifyAbsentCause(issue).interpreted_type!=='RECIPIENT_ABSENT')reasons.push('ABSENT_TYPE_OVERRIDE');
 const attempt=classifyAbsenceAttempt({issue,timeline});
 if(attempt.status!=='FIRST_ABSENCE')reasons.push(attempt.status==='SECOND_ABSENCE'?'SECOND_ABSENCE_POLICY_REVIEW':attempt.status);
 if(absentSourceFreshness(issue.last_successful_sync_at || issue.observed_at,now,600)!=='FRESH')reasons.push('DROPEA_NOT_FRESH');
 if(chatby.verified!==true || absentSourceFreshness(chatby.observed_at,now,300)!=='FRESH'
  || chatby.issue_id!==issue.canonical_issue_id || chatby.order_id!==order.canonical_order_id || !chatby.conversation_id)reasons.push('EXACT_CURRENT_CHATBY_REQUIRED');
 if(chatby.notification_observed || chatby.delivery_claim_exists)reasons.push('ALREADY_NOTIFIED_OR_CLAIMED');
 if(policy.policy_snapshot_hash!==ABSENT_POLICY_HASH || !policy.policy_id)reasons.push('POLICY_NOT_CURRENT');
 if(template.name!==ABSENT_TEMPLATE_NAME || String(template.id)!=='1552419' || String(template.meta_id)!=='1123671516755556'
   || template.language!=='es_ES' || template.category!=='UTILITY' || template.status!=='APPROVED'
   || template.body!==ABSENT_TEMPLATE_BODY || JSON.stringify(template.buttons)!==JSON.stringify(ABSENT_TEMPLATE_BUTTONS.map(x=>({type:'QUICK_REPLY',text:x.text}))))reasons.push('APPROVED_V3_CONTENT_NOT_VERIFIED');
 if(control.callback_contract_verified!==true || !control.callback_contract_evidence_id)reasons.push('REAL_BUTTON_CALLBACK_CONTRACT_NOT_VERIFIED');
 if(control.atomic_claim_store_verified!==true || control.notification_timer_transaction_verified!==true)reasons.push('PERSISTENT_DELIVERY_TRANSACTION_NOT_VERIFIED');
 if(control.canary_slot_available!==true && control.canary_verified!==true)reasons.push('CANARY_NOT_READY');
 return {allowed:reasons.length===0,reasons,idempotency_key:absentHash(['RECIPIENT_ABSENT',issue.canonical_issue_id,ABSENT_TEMPLATE_NAME]),template_name:ABSENT_TEMPLATE_NAME,template_id:'1552419'};
}

// No official time-window writer has been proven for this deployment. A
// generic PROVIDE_SOLUTION option is not a contract accepting a delivery slot.
// Keep a conceptual proposal, never fabricate a provider payload or execute.
export function absentLogisticsExecutionGate({shadow={},previousExecution=null}={}) {
 const type={RESCHEDULE_DELIVERY:'REQUEST_NEW_DELIVERY',PICKUP_AT_AGENCY:'REQUEST_AGENCY_PICKUP',RETURN_REQUEST:'RETURN_TO_ORIGIN',ADDRESS_CHANGE:'REQUEST_ADDRESS_CHANGE'}[shadow.customer_intent] || null;
 return {allowed:false,execution_mode:'HUMAN_LOGISTICS_EXECUTION_REQUIRED',
  reason:previousExecution?'PREVIOUS_EXECUTION_REQUIRES_RECONCILIATION':'OFFICIAL_ACTION_CONTRACT_NOT_VERIFIED',
  proposal:type?{action:type,requested_date:shadow.requested_date || null,requested_window:shadow.requested_time_window || null,time_from:shadow.time_from || null,time_to:shadow.time_to || null}:null,
  provider_payload:null,executed:false};
}
