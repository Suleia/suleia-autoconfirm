import {classifyAbsenceAttempt} from '../packages/platform-core/src/incident/absent-evidence.mjs';
import {interpretAbsentResponse} from '../packages/platform-core/src/incident/recipient-absent-policy.mjs';

function protectedReply(fresh,after){
  const replies=(fresh.events || []).filter(e=>e.direction==='INBOUND'
    && e.canonical_order_id===fresh.issue.canonical_order_id && Date.parse(e.created_at)>=Date.parse(after))
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  const interpretations=replies.map(interpretAbsentResponse);
  if(interpretations[0]?.reason_code==='NEGATED_OR_CORRECTED_CUSTOMER_REQUEST')return true;
  const intent=interpretations.find(i=>i.customer_intent!=='UNCLEAR')?.customer_intent;
  return ['RETURN_REQUEST','PICKUP_AT_AGENCY','ADDRESS_CHANGE','ADDRESS_DATA_REQUEST','CONTRADICTORY'].includes(intent);
}

// A second notice is a separate, owner-authorized lifecycle stage. It is not a
// retry of the first send, nor permission to notify every provider update.
export function secondAbsenceNoticeEvidence(fresh){
  const {issue,chatby}=fresh;
  if(classifyAbsenceAttempt({issue}).status!=='SECOND_ABSENCE'
    || chatby.order_notification_count!==1 || chatby.notification_count!==0
    || chatby.unverifiable_customer_activity!==false || chatby.order_recovery_offer_count!==0)return null;
  const previous=(fresh.notification_history || []).filter(n=>n.canonical_issue_id!==issue.canonical_issue_id);
  if(previous.length!==1)return null;
  const n=previous[0];
  if(n.status!=='VERIFIED' || n.outcome?.notice_stage==='SECOND_ABSENCE'
    || n.canonical_order_id!==issue.canonical_order_id || n.conversation_id!==chatby.conversation_id
    || !n.claim_id || !n.message_id || !Number.isFinite(Date.parse(n.notification_at))
    || Date.parse(n.notification_at)>=Date.parse(issue.created_at)
    || classifyAbsenceAttempt({issue:n.prior_issue || {}}).status==='SECOND_ABSENCE')return null;
  const observed=(chatby.order_absent_notices || []).filter(m=>m.template_name==='dropea_ausente_v3'
    && String(m.message_id)===String(n.message_id) && m.provider_message_id
    && m.provider_message_id===n.outcome?.provider_message_id
    && Date.parse(m.at)===Date.parse(n.notification_at));
  if(observed.length!==1)return null;
  // A cancellation/pickup/address request must be handled by its current owner.
  // Old scheduling replies do not suppress notice of a genuinely new failure.
  if(protectedReply(fresh,n.notification_at))return null;
  return {previous_claim_id:n.claim_id,previous_issue_id:n.canonical_issue_id,previous_notification_at:n.notification_at};
}

// Owner-authorized 26 October: a new primary failed-attempt issue may follow
// earlier verified notices. The sequence counts notices, not carrier attempts.
// Every predecessor must match the complete fresh conversation and form one
// durable chain; no unknown send or update of the same issue can advance it.
export function repeatedAbsenceNoticeEvidence(fresh){
  const {issue,chatby}=fresh,count=chatby.order_notification_count;
  if(classifyAbsenceAttempt({issue}).status!=='SECOND_ABSENCE' || !Number.isFinite(Date.parse(issue.created_at)) || !Number.isInteger(count) || count<2
    || chatby.notification_count!==0 || chatby.unverifiable_customer_activity!==false
    || chatby.order_recovery_offer_count!==0)return null;
  const prior=(fresh.notification_history || []).filter(n=>n.canonical_issue_id!==issue.canonical_issue_id)
    .sort((a,b)=>Date.parse(a.notification_at)-Date.parse(b.notification_at));
  const observed=chatby.order_absent_notices || [];
  if(prior.length!==count || observed.length!==count
    || new Set(prior.map(n=>n.claim_id)).size!==count
    || new Set(prior.map(n=>n.canonical_issue_id)).size!==count
    || new Set(prior.map(n=>n.outcome?.provider_message_id)).size!==count)return null;
  for(const [i,n]of prior.entries()){
    const stage=n.outcome?.notice_stage || 'INITIAL';
    if(n.status!=='VERIFIED' || n.canonical_order_id!==issue.canonical_order_id || n.conversation_id!==chatby.conversation_id
      || !n.claim_id || !n.message_id || !String(n.outcome?.provider_message_id || '').startsWith('wamid.')
      || !Number.isFinite(Date.parse(n.notification_at)) || Date.parse(n.notification_at)>=Date.parse(issue.created_at)
      || (i===0?stage!=='INITIAL':i===1?stage!=='SECOND_ABSENCE':stage!=='REPEATED_ABSENCE')
      || (i>0&&(n.outcome?.previous_claim_id!==prior[i-1].claim_id || Date.parse(n.notification_at)<=Date.parse(prior[i-1].notification_at)))
      || (i>1&&n.outcome?.notice_sequence!==i+1))return null;
    const matching=observed.filter(m=>m.template_name==='dropea_ausente_v3' && String(m.message_id)===String(n.message_id)
      && m.provider_message_id===n.outcome.provider_message_id && Date.parse(m.at)===Date.parse(n.notification_at));
    if(matching.length!==1)return null;
  }
  if(protectedReply(fresh,prior[0].notification_at))return null;
  const last=prior.at(-1);
  return {previous_claim_id:last.claim_id,previous_issue_id:last.canonical_issue_id,
    previous_notification_at:last.notification_at,previous_count:count,notice_sequence:count+1};
}
