import {currentCustomerIntent,resolutionHash,madridDate} from './incident-intent-v2.mjs';
import {addressResponseDecision} from './address-response-policy.mjs';
import {planDropeaResolution} from '../clients/dropea-v2-resolution-contract.mjs';

export const RESOLUTION_POLICY_VERSION='2026-10-03.1';
export const WORKFLOW_POLICY=Object.freeze({
  rejected_goods:{workflow:'REJECTED',discount:'PREPARED_CONTRACT_REQUIRED',silent_return:'EXISTING_LIVE',explicit_return:'CANARY_REQUIRED'},
  absent:{workflow:'ABSENT',discount:'POLICY_NOT_AUTHORIZED',silent_return:'DISABLED',explicit_return:'POLICY_NOT_AUTHORIZED'},
  address:{workflow:'ADDRESS',discount:'MANUAL_DISCOUNT_RECOVERY',silent_return:'EXISTING_POLICY',explicit_return:'EXISTING_POLICY'}
});
const iso=now=>new Date(now).toISOString();
const rawIssue=issue=>issue?.raw||issue||{};
const step=(action,dependency=null)=>({action,capability:action,dependency,status:'PREPARED',verification:'NOT_REQUESTED'});
const executed=p=>p?.steps?.some(s=>['REQUESTED','UNKNOWN','VERIFIED'].includes(s.status));

export function resolutionCandidate({incident,order,issue,messages=[],previous=null,now=Date.now()}) {
  const raw=rawIssue(issue), policy=WORKFLOW_POLICY[incident.incidentType];
  const response=currentCustomerIntent({incident,order,messages,now});
  const t={incident_id:String(incident.incidenceId),order_id:String(incident.orderId),workflow:policy?.workflow||'UNKNOWN',
    issue_state:raw.status||incident.issueStatus||'UNKNOWN',current_policy:policy||null,policy_version:RESOLUTION_POLICY_VERSION,
    customer_contact_status:response.notice_at?'VERIFIED':'NOT_VERIFIED',customer_response_status:response.status,
    customer_intents:response.intents,customer_replied:response.has_reply,customer_event_hash:response.event_hash,
    customer_event_at:response.at||null,notification_at:response.notice_at||null,
    next_best_action:null,explicit_wait_until:null,human_review_reason:null,current_owner:'AUTOMATION',timer_state:null,
    execution_status:'NOT_REQUESTED',verification_status:'NOT_REQUESTED',logistics_outcome:'STILL_PENDING',
    resolution_plan:null,plan_history:previous?.plan_history||[],observed_at:iso(now),is_active:raw.is_active===true&&raw.status==='PENDING',
    prior_incident_id:previous&&previous.incident_id!==String(incident.incidenceId)?previous.incident_id:null,
    previous_plan_id:previous?.previous_plan_id||null};
  let action=null, data={}, steps=[], reason=null;
  const review=r=>{reason=r;t.current_owner='HUMAN';};
  const wait=(deadline,waitingFor,since,onTimeout)=>{
    if(!Number.isFinite(Date.parse(deadline)))return review('WAIT_DEADLINE_UNVERIFIABLE');
    t.explicit_wait_until=deadline;t.current_owner=waitingFor==='CUSTOMER'?'CUSTOMER':'PROVIDER';
    t.timer_state={waiting_for:waitingFor,waiting_since:since,deadline,on_timeout_action:onTimeout};
    if(Date.parse(deadline)<=now){t.explicit_wait_until=null;action=onTimeout;t.current_owner='AUTOMATION';}
  };
  if(!policy)review('WORKFLOW_POLICY_NOT_AVAILABLE');
  else if(String(raw.id)!==t.incident_id||String(raw.order_id)!==t.order_id||String(order?.orderId)!==t.order_id)review('CURRENT_IDENTITY_CONFLICT');
  else if(!t.is_active)review('CURRENT_ISSUE_NOT_PENDING');
  else if(response.status==='NOT_VERIFIABLE')review(response.reason);
  else if(response.has_reply){
    const intents=response.intents||[];
    if(intents.includes('AMBIGUOUS')||intents.includes('ASKS_QUESTION')||!intents.length)review('CUSTOMER_RESPONSE_REQUIRES_REVIEW');
    else if(intents.includes('WANTS_RETURN')){
      action='REQUEST_RETURN';steps=[step(action)];
      if(incident.incidentType!=='rejected_goods')review('EXPLICIT_RETURN_POLICY_NOT_AUTHORIZED');
    }else if(intents.includes('ACCEPTS_DISCOUNT')){
      steps=[step('APPLY_DISCOUNT'),step('VERIFY_DISCOUNT','APPLY_DISCOUNT'),step('RETRY_DELIVERY','VERIFY_DISCOUNT'),step('VERIFY_RETRY','RETRY_DELIVERY'),step('WAIT_LOGISTICS_OUTCOME','VERIFY_RETRY')];
      action='APPLY_DISCOUNT';data={discount_cents:500};
      // Neither a support email nor a Shopify price edit proves the COD amount
      // collected by the carrier changed. No such adapter is presently verified.
      review(incident.incidentType==='address'?'MANUAL_DISCOUNT_RECOVERY':incident.incidentType==='absent'?'ABSENT_DISCOUNT_APPLICATION_POLICY_REQUIRED':'DISCOUNT_ECONOMIC_MUTATION_CONTRACT_UNAVAILABLE');
    }else if(incident.incidentType==='address'&&(intents.includes('PROVIDES_ADDRESS')||intents.includes('CONFIRMS_ADDRESS'))){
      const d=addressResponseDecision({incident,order,issue,messages,now,previous:incident.addressWorkflow});
      if(intents.includes('CONFIRMS_ADDRESS')){
        const original=order.raw?.shipping_address||{},phone=String(order.customerPhone||'').replace(/\D/g,'');
        const street=original.address_line_1||original.address||original.address1;
        const postal=original.postal_code||original.zip;
        if(street&&postal&&original.city&&/^(?:34)?[67]\d{8}$/.test(phone)){
          d.action='PROVIDE_ADDRESS_SOLUTION';d.solution=`Cliente confirma la dirección original: ${street}, ${postal} ${original.city}. Llamar antes al ${phone}.`;
          d.provider_plan=planDropeaResolution(issue,'PROVIDE_SOLUTION',{note:d.solution});
        }
      }
      action=d.action==='PROVIDE_ADDRESS_SOLUTION'?'PROVIDE_SOLUTION':d.action;
      if(d.provider_plan?.allowed){data=action==='CHANGE_ADDRESS'?{address:d.provider_plan.body.resolution_data.address}:{note:d.solution};steps=[step(action),step('VERIFY_PROVIDER',action),step('WAIT_LOGISTICS_OUTCOME','VERIFY_PROVIDER')];}
      else if(action==='ASK_MISSING_FIELDS'){steps=[step(action)];review('EXISTING_ADDRESS_DETAILS_OWNER');}
      else review(d.state||'ADDRESS_REQUIRES_REVIEW');
    }else if(intents.includes('REQUESTS_AGENCY')){action='PICKUP_AT_AGENCY';steps=[step(action),step('VERIFY_PROVIDER',action),step('WAIT_LOGISTICS_OUTCOME','VERIFY_PROVIDER')];}
    else if(intents.includes('WANTS_ORDER')||intents.includes('REQUESTS_RETRY')){
      action='RETRY_DELIVERY';data=response.slot||{};steps=[step(action),step('VERIFY_PROVIDER',action),step('WAIT_LOGISTICS_OUTCOME','VERIFY_PROVIDER')];
      if(!data.date||!data.time_window)review('DELIVERY_DATE_AND_WINDOW_REQUIRED');
      else if(data.date<madridDate(now))review('REQUESTED_DELIVERY_DATE_EXPIRED');
    }else review('CUSTOMER_RESPONSE_REQUIRES_REVIEW');
  }else if(!response.notice_at){review('INITIAL_NOTIFICATION_NOT_VERIFIED');
  }else{
    const deadline=incident.incidentDiscountReturnDueAt||incident.incidentDiscountDueAt||incident.incidentResponseDeadlineAt;
    wait(deadline,'CUSTOMER',response.notice_at||incident.incidenceDate,'HUMAN_REVIEW');
    if(action==='HUMAN_REVIEW'){action=null;review('CUSTOMER_WAIT_DEADLINE_PASSED_EXISTING_POLICY_OWNER');}
  }
  let providerPlan=null;
  if(action&&['RETRY_DELIVERY','PICKUP_AT_AGENCY','REQUEST_RETURN','PROVIDE_SOLUTION','CHANGE_ADDRESS'].includes(action)){
    providerPlan=planDropeaResolution(issue,action,data);
    if(!providerPlan.allowed&&!reason)review(providerPlan.reason);
  }
  const input={issue:t.incident_id,order:t.order_id,workflow:t.workflow,policy:RESOLUTION_POLICY_VERSION,event:response.event_hash,
    intents:response.intents,action,body:providerPlan?.body||data,capabilities:raw.allowed_resolution_options||[],issue_state:raw.status};
  const inputHash=resolutionHash(input);
  if(steps.length){
    const planId=resolutionHash([t.incident_id,inputHash]);
    const old=previous?.resolution_plan;
    t.resolution_plan={plan_id:planId,issue_id:t.incident_id,order_id:t.order_id,policy_version:RESOLUTION_POLICY_VERSION,input_hash:inputHash,
      steps,created_at:iso(now),superseded_at:null,status:'PREPARED',parameters_hash:resolutionHash(data),
      expected_resolution:providerPlan?.allowed?{status:providerPlan.body.status,resolution_status:providerPlan.body.resolution_status,data_hash:resolutionHash(providerPlan.body.resolution_data||null)}:null};
    if(old?.plan_id===planId)t.resolution_plan=structuredClone(old);
    else if(old){
      t.previous_plan_id=old.plan_id;
      t.plan_history=[...t.plan_history,{...old,status:'SUPERSEDED',superseded_at:iso(now)}];
      if(executed(old))review('INTENT_CHANGED_AFTER_ACTION_RECONCILE');
    }
    const first=t.resolution_plan.steps.find(s=>s.status==='UNKNOWN'||s.status==='REQUESTED');
    if(first&&!reason){action='RECONCILE_PROVIDER';t.current_owner='PROVIDER';t.execution_status='UNKNOWN';t.verification_status='UNKNOWN';}
    if(t.resolution_plan.status==='VERIFIED'){
      action=null;reason=null;t.execution_status='VERIFIED';t.verification_status='VERIFIED';
      wait(previous?.timer_state?.deadline||iso(now+24*3600000),'PROVIDER',previous?.timer_state?.waiting_since||iso(now),'VERIFY_PROVIDER');
    }
  }
  if(!steps.length&&previous?.resolution_plan){
    const old=previous.resolution_plan;
    t.previous_plan_id=old.plan_id;
    t.plan_history=[...t.plan_history,{...old,status:'SUPERSEDED',superseded_at:iso(now)}];
    if(executed(old)){t.resolution_plan=structuredClone(old);review('INTENT_CHANGED_AFTER_ACTION_RECONCILE');}
  }
  if(reason){t.human_review_reason=reason;t.explicit_wait_until=null;t.next_best_action=null;t.current_owner='HUMAN';}
  else t.next_best_action=action;
  if(!t.next_best_action&&!t.explicit_wait_until&&!t.human_review_reason){t.human_review_reason='NEXT_ACTION_UNAVAILABLE';t.current_owner='HUMAN';}
  t.action_prepared=!!t.resolution_plan&&t.resolution_plan.status==='PREPARED';
  t.customer_replied_but_unresolved=!!t.customer_replied&&t.verification_status!=='VERIFIED';
  t.findings=stuckFindings(t,now);
  return {twin:t,response,action,data,providerPlan};
}

export function stuckFindings(twin,now=Date.now()){
  const reasons=[];
  if(twin.customer_replied&&!twin.next_best_action&&!twin.explicit_wait_until)reasons.push('CUSTOMER_REPLIED_WITHOUT_EXECUTABLE_ACTION');
  if(['UNKNOWN','REQUESTED'].includes(twin.execution_status)&&twin.verification_status!=='VERIFIED')reasons.push('ACTION_WITHOUT_VERIFICATION');
  if(twin.timer_state?.deadline&&Date.parse(twin.timer_state.deadline)<=now)reasons.push('WAIT_DEADLINE_PASSED');
  return reasons.length?[{code:'INCIDENT_STUCK',reasons,priority:'P0'}]:[];
}

export function resolutionMetrics(twins){
  const rows=twins.filter(Boolean),active=rows.filter(t=>t.is_active),replied=rows.filter(t=>t.customer_replied),resolved=rows.filter(t=>t.resolved_at&&t.verification_status==='VERIFIED'),actions=rows.flatMap(t=>t.resolution_plan?.steps||[]).filter(s=>['REQUESTED','VERIFIED','UNKNOWN','FAILED'].includes(s.status));
  const ratio=(n,d)=>d?n/d:null;
  const times=resolved.map(t=>Date.parse(t.resolved_at)-Date.parse(t.resolution_plan?.created_at)).filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
  const median=times.length?times.length%2?times[(times.length-1)/2]:(times[times.length/2-1]+times[times.length/2])/2:null;
  return {cohort:'PERSISTED_ORCHESTRATOR_CASES',observed:rows.length,active:active.length,
    customer_replied_unresolved:active.filter(t=>t.customer_replied_but_unresolved).length,
    stuck:active.filter(t=>t.findings?.some(f=>f.code==='INCIDENT_STUCK')).length,
    stuck_incident_rate:ratio(active.filter(t=>t.findings?.some(f=>f.code==='INCIDENT_STUCK')).length,active.length),
    autonomous_resolution_rate:ratio(resolved.filter(t=>t.resolution_actor==='AUTOMATION').length,rows.length),
    human_touch_rate:ratio(rows.filter(t=>t.human_touched===true).length,rows.length),
    human_review_required:active.filter(t=>t.current_owner==='HUMAN').length,
    customer_reply_resolution_rate:ratio(resolved.filter(t=>t.customer_replied).length,replied.length),
    verified_action_rate:ratio(actions.filter(s=>s.status==='VERIFIED').length,actions.length),
    median_time_to_resolution_ms:median,
    delivery_after_incident_rate:ratio(rows.filter(t=>t.logistics_outcome==='DELIVERED').length,rows.length),
    return_after_incident_rate:ratio(rows.filter(t=>t.logistics_outcome==='RETURNED').length,rows.length)};
}

export function logisticsFollowUp(twin,current,{newIssueId=null,now=Date.now()}={}){
  if(String(current?.order?.orderId)!==twin.order_id)return {...twin,next_best_action:null,explicit_wait_until:null,current_owner:'HUMAN',human_review_reason:'FOLLOWUP_IDENTITY_UNVERIFIED'};
  const t=structuredClone(twin),status=String(current.order.status||'').toUpperCase();
  t.observed_at=iso(now);
  const issue=rawIssue(current.issue),expected=t.resolution_plan?.expected_resolution;
  if(['UNKNOWN','REQUESTED'].includes(t.execution_status)){
    const same=String(issue.id)===t.incident_id&&String(issue.order_id)===t.order_id;
    if(same&&expected&&issue.status===expected.status&&issue.resolution_status===expected.resolution_status&&resolutionHash(issue.resolution_data||null)===expected.data_hash){
      t.execution_status='VERIFIED';t.verification_status='VERIFIED';t.resolution_plan.status='VERIFIED';
      t.resolution_plan.steps[0]={...t.resolution_plan.steps[0],status:'VERIFIED',verification:'VERIFIED',verified_at:iso(now)};
      t.customer_replied_but_unresolved=false;
    }else if(!['DELIVERED','RETURNED'].includes(status)){
      t.next_best_action='RECONCILE_PROVIDER';t.explicit_wait_until=null;t.human_review_reason=null;t.current_owner='PROVIDER';t.findings=stuckFindings(t,now);return t;
    }
  }
  if(['DELIVERED','RETURNED'].includes(status)){
    t.logistics_outcome=status;t.resolved_at=t.resolved_at||iso(now);t.verification_status='VERIFIED';t.is_active=false;t.customer_replied_but_unresolved=false;
    t.resolution_actor=t.resolution_plan?.status==='VERIFIED'?'AUTOMATION':'PROVIDER';
    t.next_best_action=null;t.explicit_wait_until=null;t.human_review_reason=null;t.current_owner='PROVIDER';t.findings=[];
  }else if(newIssueId&&String(newIssueId)!==t.incident_id){t.logistics_outcome='NEW_INCIDENT';t.linked_next_incident_id=String(newIssueId);t.is_active=false;t.next_best_action=null;t.explicit_wait_until=null;t.current_owner='AUTOMATION';t.human_review_reason='SUPERSEDED_BY_NEW_INCIDENT';}
  else {t.logistics_outcome='STILL_PENDING';t.current_owner='PROVIDER';t.next_best_action=null;t.explicit_wait_until=iso(now+24*3600000);t.human_review_reason=null;t.timer_state={waiting_for:'LOGISTICS_OUTCOME',waiting_since:t.timer_state?.waiting_since||iso(now),deadline:t.explicit_wait_until,on_timeout_action:'VERIFY_PROVIDER'};}
  return t;
}
