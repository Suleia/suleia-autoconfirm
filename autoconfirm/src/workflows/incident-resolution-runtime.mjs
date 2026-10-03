import {createResolutionStore} from './incident-resolution-store.mjs';
import {resolutionCandidate,resolutionMetrics,logisticsFollowUp,stuckFindings} from './incident-resolution-plan.mjs';
import {executeResolutionCandidate,recordResolutionExecution,resolutionCapabilityMode} from './incident-resolution-executor.mjs';
import {readDropeaV2ReturnIssueState} from '../clients/dropea-v2-incidents.mjs';
import {executeDropeaV2Resolution} from '../clients/dropea-v2-issue-actions.mjs';
import {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder} from '../clients/chatby.mjs';
import {inspectPriorOrderReturn} from './incident-order-return-guard.mjs';
import {claimIncidentDiscountReturn,finishIncidentDiscountReturn,claimIncidentAddressResolution,finishIncidentAddressResolution,claimTemplateDelivery,finishTemplateDelivery} from '../db/supabase-store.mjs';

function ledgerArgs(a){return {storeId:'suleia',orderId:a.orderId,incidenceId:a.issueId,templateName:`incident_resolution_v1:${a.issueId}`,provider:'dropea'};}
const adapters={
  readCurrent:i=>readDropeaV2ReturnIssueState(i,{includeOrder:true}),readMessages:getIncidentChatMessages,
  priorConflict:async i=>{const p=await inspectPriorOrderReturn(i);return p.verified||p.blocked;},
  verifyConversation:async(i,o)=>{const index=await loadSubscriberIndex({maxPages:30,force:true});const s=findSubscriberInIndexForExactOrder(index,{phone:o.customerPhone,orderId:i.orderId});return !!s&&s.user_ns===i.chatbyUserNs;},
  // Reuse legacy claims for overlapping return/address writers.
  claim:a=>a.action==='REQUEST_RETURN'?claimIncidentDiscountReturn(ledgerArgs(a)):['CHANGE_ADDRESS','PROVIDE_SOLUTION'].includes(a.action)?claimIncidentAddressResolution(ledgerArgs(a)):claimTemplateDelivery(ledgerArgs(a)),
  finish:(a,r)=>{const args={...ledgerArgs(a),status:r.verified?'verified':r.status==='aborted'?'aborted':'applied_unverified',attemptedAt:r.attemptedAt,completedAt:r.verifiedAt,sentAt:r.verifiedAt,raw:r,evidence:r};return a.action==='REQUEST_RETURN'?finishIncidentDiscountReturn(args):['CHANGE_ADDRESS','PROVIDE_SOLUTION'].includes(a.action)?finishIncidentAddressResolution(args):finishTemplateDelivery(args);},
  write:executeDropeaV2Resolution
};

// Additive observer; legacy lanes run first. All new write modes default SHADOW.
// Failures here are isolated from confirmation, contact, offer and return loops.
export async function runIncidentResolutionCycle(items,{store=createResolutionStore(),env=process.env,readCurrent=adapters.readCurrent,executorAdapters=adapters,now=Date.now(),execute=true}={}){
  if(env.INCIDENT_E2E_OBSERVER_ENABLED==='false')return {enabled:false};
  const previous=await store.load(),byIssue=new Map(previous.map(t=>[`${t.order_id}:${t.incident_id}`,t]));
  const byOrder=new Map([...previous].sort((a,b)=>String(a.observed_at).localeCompare(String(b.observed_at))).map(t=>[t.order_id,t]));
  const observed=new Map(previous.map(t=>[`${t.order_id}:${t.incident_id}`,t]));
  let failures=0;
  for(const item of items){
    try{
      const id=`${item.incident.orderId}:${item.incident.incidenceId}`,prior=byIssue.get(id)||byOrder.get(String(item.incident.orderId));
      const input={...item,previous:prior,now};
      const candidate=resolutionCandidate(input);let twin=candidate.twin;
      if(execute&&resolutionCapabilityMode(twin.workflow,candidate.action,twin.incident_id,env)!=='SHADOW'){
        // Persist prepared intent before reserving or executing any provider write.
        await store.save(twin);
        const result=await executeResolutionCandidate(input,candidate,{...executorAdapters,env});
        twin=recordResolutionExecution(twin,result);
      }else if(twin.action_prepared&&!twin.human_review_reason){twin.capability_blocker='CAPABILITY_SHADOW';twin.human_review_reason='CAPABILITY_SHADOW';twin.next_best_action=null;twin.explicit_wait_until=null;twin.current_owner='HUMAN';}
      // Mirror existing verified writes, without claiming this new observer did them.
      if(item.incident.incidentDiscountReturnVerified===true||item.incident.operationalActionVerified===true){
        twin.next_best_action='VERIFY_PROVIDER';twin.explicit_wait_until=null;twin.human_review_reason=null;twin.current_owner='PROVIDER';
        twin.execution_status='VERIFIED';twin.verification_status='VERIFIED';twin.resolution_actor='EXISTING_AUTOMATION';twin.customer_replied_but_unresolved=false;
      }
      twin.findings=stuckFindings(twin,now);await store.save(twin);item.incident.incidentResolution=twin;observed.set(id,twin);
    }catch{failures++;item.incident.incidentResolution={incident_id:String(item.incident.incidenceId),order_id:String(item.incident.orderId),current_owner:'HUMAN',human_review_reason:'RESOLUTION_OBSERVER_FAILED',next_best_action:null,explicit_wait_until:null};}
  }
  // Cases leaving the PENDING list are NOT assumed resolved. Follow up via GET.
  // Round-robin oldest observation, bounded to avoid starving live provider reads.
  const activeIds=new Set(items.map(i=>`${i.incident.orderId}:${i.incident.incidenceId}`));
  const follow=previous.filter(t=>!activeIds.has(`${t.order_id}:${t.incident_id}`)&&t.logistics_outcome!=='DELIVERED'&&t.logistics_outcome!=='RETURNED'&&!t.linked_next_incident_id)
    .sort((a,b)=>String(a.observed_at).localeCompare(String(b.observed_at))).slice(0,3);
  for(const prior of follow){
    try{
      const current=await readCurrent({orderId:prior.order_id,incidenceId:prior.incident_id});
      const next=items.find(i=>String(i.incident.orderId)===prior.order_id);
      const twin=logisticsFollowUp(prior,current,{newIssueId:next?.incident.incidenceId,now});
      await store.save(twin);observed.set(`${twin.order_id}:${twin.incident_id}`,twin);
    }catch{failures++;}
  }
  const twins=[...observed.values()];
  return {enabled:true,new_write_default:'SHADOW',observed_at:new Date(now).toISOString(),failures,metrics:resolutionMetrics(twins),
    customer_replied_unresolved_incidents:twins.filter(t=>t.is_active&&t.customer_replied_but_unresolved).map(t=>({incident_id:t.incident_id,order_id:t.order_id,current_owner:t.current_owner,next_best_action:t.next_best_action,human_review_reason:t.human_review_reason})),
    stuck_incidents:twins.filter(t=>t.is_active&&t.findings?.length).map(t=>({incident_id:t.incident_id,order_id:t.order_id,findings:t.findings}))};
}
