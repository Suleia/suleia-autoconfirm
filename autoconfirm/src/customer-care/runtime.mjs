import {buildCustomerCase,hash} from './context.mjs';
import {careFlags,routeCustomerCase,applyCarePlan,responseForPlan} from './policy.mjs';
import {createCustomerCareStore} from './store.mjs';
import {readDropeaV2ReturnIssueState} from '../clients/dropea-v2-incidents.mjs';

export function carePolicyFor({incident,order,issue}){
 const raw=issue?.raw||issue||{};
 const verifiedReturn=incident?.incidentDiscountReturnVerified===true;
 const verifiedAction=verifiedReturn?{action:'RETURN_REQUESTED',status:'VERIFIED',at:incident.incidentDiscountReturnCompletedAt||incident.incidentDiscountReturnAttemptedAt}:incident?.operationalActionVerified===true?{action:incident.operationalAction||'EXISTING_PROVIDER_ACTION',status:'VERIFIED',at:incident.operationalActionVerifiedAt}:null;
 return {requireDeliveryDate:true,requireDeliveryWindow:true,ownerProvidesDefaultSchedule:['absent','rejected_goods'].includes(incident?.incidentType),ownerProvidesDefaultDate:['absent','rejected_goods'].includes(incident?.incidentType),
  irreversibleAction:verifiedReturn||raw.resolution_status==='RETURN_REQUESTED'?'RETURN_REQUESTED':raw.resolution_status==='CANCELLED'?'CANCELLATION_APPLIED':null,
  lastVerifiedAction:verifiedAction,
  // An amount alone does not prove the payment contract or card availability.
  paymentVerified:false,paymentMethod:null,amountDue:null,allowedPaymentMethods:[],
  providerReadVerified:false,providerReadAt:null,
  discountAppliedVerified:incident?.acceptedDiscountSupportFeedback?.orderDiscountApplied===true,
  addressVerified:false};
}
export function interpretCustomerCase(input,previous=null){
 const policy=input.policy||carePolicyFor(input);
 const built=buildCustomerCase({...input,policy},previous);
 built.context_hash=hash([input.binding,input.order?.status,input.issue?.raw?.status,input.issue?.raw?.resolution_status,policy]);
 return applyCarePlan(built,routeCustomerCase(built,policy));
}
export function customerCareMetrics(cases){
 const total=cases.length,withReply=cases.filter(c=>c.has_current_reply),verified=cases.filter(c=>c.last_verified_action?.status==='VERIFIED'&&Number.isFinite(Date.parse(c.last_verified_action.at))&&Date.parse(c.last_verified_action.at)>=Date.parse(c.latest_intent_at));
 const outcome=cases.filter(c=>['DELIVERED','RETURNED'].includes(c.current_order_state)&&c.last_verified_action?.status==='VERIFIED');
 const clarificationCount=cases.reduce((n,c)=>n+(c.clarifications||[]).length,0);
 const times=outcome.map(c=>Date.parse(c.updated_at)-Date.parse(c.latest_intent_at)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 return {cohort:'CURRENT_EXACT_ORDER_CASES',cases:total,customer_messages_processed:cases.reduce((n,c)=>n+Object.keys(c.event_versions||{}).length,0),intent_high_confidence:cases.filter(c=>c.confidence>=0.9).length,intent_medium_confidence:cases.filter(c=>c.confidence>=0.65&&c.confidence<0.9).length,intent_low_confidence:cases.filter(c=>c.confidence<0.65).length,
  customer_reply_resolution_rate:withReply.length?verified.filter(c=>c.has_current_reply).length/withReply.length:null,autonomous_resolution_rate:withReply.length?outcome.filter(c=>c.has_current_reply).length/withReply.length:null,
  clarifications_sent:clarificationCount,repeated_clarifications:cases.reduce((n,c)=>n+(c.findings||[]).filter(f=>f.code==='REPEATED_CLARIFICATION').length,0),average_clarifications_per_case:total?clarificationCount/total:null,human_escalations:cases.filter(c=>c.next_best_action==='HUMAN_REVIEW').length,actions_verified:verified.length,
  stale_plans_prevented:cases.reduce((n,c)=>n+(c.stale_plans_prevented||0),0),change_of_mind_detected:cases.filter(c=>c.change_of_mind_detected>0).length,delivery_after_recovery:outcome.filter(c=>c.current_order_state==='DELIVERED').length,return_after_recovery:outcome.filter(c=>c.current_order_state==='RETURNED').length,median_resolution_time:times.length?times[Math.floor(times.length/2)]:null};
}

// Observation only: no action client/sender is imported or supplied. The owner
// loops have already run, and failures here cannot interrupt their behaviour.
export async function followCustomerCare(previous,currentItems,{readCurrent=readDropeaV2ReturnIssueState,store,now=Date.now()}={}){
 const old=previous.value,caseState=structuredClone(old);
 const read=await readCurrent({orderId:old.dropea_order_id,incidenceId:old.active_issue_id},{includeOrder:true});
 if(String(read.order?.orderId)!==old.dropea_order_id||String((read.issue?.raw||read.issue)?.id)!==old.active_issue_id)throw Error('CARE_FOLLOWUP_IDENTITY');
 const next=currentItems.find(i=>String(i.order?.orderId)===old.dropea_order_id&&String(i.incident?.incidenceId)!==old.active_issue_id);
 caseState.current_order_state=read.order.status;caseState.updated_at=new Date(now).toISOString();
 if(next){caseState.status='HUMAN_REVIEW';caseState.next_best_action='HUMAN_REVIEW';caseState.reason='NEW_INCIDENT';caseState.linked_next_issue_id=String(next.incident.incidenceId);}
 else if(['DELIVERED','RETURNED','CANCELLED'].includes(read.order.status)){caseState.status='CLOSED';caseState.logistics_outcome=read.order.status;caseState.next_best_action='WAITING_PROVIDER';caseState.reason='PROVIDER_OUTCOME_VERIFIED';caseState.waiting_for_provider=false;caseState.waiting_for_customer=false;}
 else {caseState.status='WAITING_PROVIDER';caseState.next_best_action='WAITING_PROVIDER';caseState.reason='PROVIDER_OUTCOME_PENDING';caseState.waiting_for_provider=true;}
 caseState.timeline=[...caseState.timeline,{kind:'PROVIDER_FOLLOWUP',at:caseState.updated_at,outcome:caseState.logistics_outcome||'PENDING',provider_issue_status:(read.issue?.raw||read.issue).status}].slice(-100);
 await store.save(caseState,previous);return caseState;
}
export async function observeCustomerCare(items,{env=process.env,store=createCustomerCareStore(),now=Date.now(),policyFor=carePolicyFor,readCurrent=readDropeaV2ReturnIssueState}={}){
 const flags=careFlags(env);if(!flags.enabled||!flags.context)return {enabled:false};
 const cases=[];let failures=0,next=0;
 const worker=async()=>{while(next<items.length){const item=items[next++];try{
  const identity={canonical_order_id:String(item.order?.orderId||''),active_issue_id:item.incident?.incidenceId?String(item.incident.incidenceId):null};
  const previous=await store.load(identity);
  const binding={verified:item.incident?.chatbyReadVerified===true&&item.incident?.chatbyOrderAssociation==='EXACT_ORDER',orderId:String(item.order?.orderId),issueId:String(item.incident?.incidenceId),conversationId:item.incident?.chatbyUserNs};
  const care=interpretCustomerCase({...item,binding,policy:policyFor(item),now},previous?.value);
  care.mode=flags.mode;care.proposed_response=responseForPlan(care,care,policyFor(item));
  await store.save(care,previous);item.incident.customerCare=care;cases.push(care);
 }catch{failures++;item.incident.customerCare={mode:flags.mode,status:'HUMAN_REVIEW',next_best_action:'HUMAN_REVIEW',reason:'CUSTOMER_CARE_OBSERVATION_UNAVAILABLE',owner:'HUMAN'};}}};
 await Promise.all(Array.from({length:Math.min(3,items.length)},worker));
 let followed=0;
 if(store.listOpen){
  try{const active=new Set(cases.map(c=>`${c.dropea_order_id}:${c.active_issue_id}`));
   const prior=(await store.listOpen()).filter(r=>!active.has(`${r.value.dropea_order_id}:${r.value.active_issue_id}`)&&r.value.active_issue_id).slice(0,3);
   for(const previous of prior){try{await followCustomerCare(previous,items,{readCurrent,store,now});followed++;}catch{failures++;}}
  }catch{failures++;}
 }
 return {enabled:true,mode:flags.mode,provider_writes:0,failures,followed,metrics:customerCareMetrics(cases)};
}

export function compareCareReplay(rows){
 const report={cases_reviewed:rows.length,same_decision:0,improved_decision:0,changed_other:0,fewer_clarification_opportunities:0,change_of_mind_detected:0,wrong_question_avoided:0,human_review_changed:0,unverified_context:0};
 for(const {care,baseline}of rows){
  const clarifies=baseline?.kind==='CLARIFY',suppressed=clarifies&&care.next_best_action!=='RESPOND';
  if(!care.input_hash)report.unverified_context++;
  const baselineAction=baseline?.next_best_action||(baseline?.kind==='CLARIFY'?'RESPOND':baseline?.kind==='SOLUTION'?'DELEGATE':/NO_CURRENT_DELIVERY_REPLY/.test(baseline?.reason||'')?'WAITING_CUSTOMER':'HUMAN_REVIEW');
  const improves=clarifies&&['WAITING_CUSTOMER','DELEGATE'].includes(care.next_best_action);
  if(suppressed)report.fewer_clarification_opportunities++;
  if(improves)report.improved_decision++;else if(baselineAction===care.next_best_action)report.same_decision++;else report.changed_other++;
  if(clarifies&&(baseline?.reason==='PAYMENT_OR_PRICE_NEEDS_CONFIRMATION'||care.wants_order&&care.missing_slots?.length<2))report.wrong_question_avoided++;
  if(care.change_of_mind_detected)report.change_of_mind_detected++;
  if((baseline?.status==='HUMAN_REVIEW')!==(care.next_best_action==='HUMAN_REVIEW'))report.human_review_changed++;
 }
 return report;
}
