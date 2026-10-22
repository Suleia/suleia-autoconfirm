import {classifyAbsenceAttempt} from '../packages/platform-core/src/incident/absent-evidence.mjs';
import {interpretAbsentResponse} from '../packages/platform-core/src/incident/recipient-absent-policy.mjs';

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
  const replies=(fresh.events || []).filter(e=>e.direction==='INBOUND'
    && e.canonical_order_id===issue.canonical_order_id
    && Date.parse(e.created_at)>=Date.parse(n.notification_at)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  const interpretations=replies.map(interpretAbsentResponse);
  if(interpretations[0]?.reason_code==='NEGATED_OR_CORRECTED_CUSTOMER_REQUEST')return null;
  const intent=interpretations.find(i=>i.customer_intent!=='UNCLEAR')?.customer_intent;
  if(['RETURN_REQUEST','PICKUP_AT_AGENCY','ADDRESS_CHANGE','ADDRESS_DATA_REQUEST','CONTRADICTORY'].includes(intent))return null;
  return {previous_claim_id:n.claim_id,previous_issue_id:n.canonical_issue_id,previous_notification_at:n.notification_at};
}
