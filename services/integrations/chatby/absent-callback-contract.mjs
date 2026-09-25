import {ABSENT_TEMPLATE_BUTTONS,ABSENT_TEMPLATE_NAME} from '../../../packages/platform-core/src/incident/absent-template.mjs';

// This is an evidence-controlled binding, not a label/alias detector. An admin
// installs the contract only after capturing provider callbacks from the canary.
// Configured destinations alone, synthetic fixtures and old v2 replies cannot
// establish this evidence. Unknown callbacks remain unverified.
export function absentCallbackContextMatches(message,currentNotice,now=new Date()) {
  // A preceding template name alone does not bind a button to this incident.
  // Require provider reply context, exact conversation, and a verified notice.
  const replyTo=message?.context?.id || message?.payload?.context?.id || message?.reply_to_message_id;
  const conversation=message?.conversation_id || message?.user_ns;
  const numeric=Number(message?.ts);
  const timestamp=Number.isFinite(numeric) ? new Date(numeric>1e12?numeric:numeric*1000):null;
  const eventAt=message?.event_at || message?.created_at || (timestamp && Number.isFinite(+timestamp)?timestamp.toISOString():null);
  if(currentNotice?.verified!==true || String(currentNotice.template_id)!=='1552419'
    || !currentNotice.message_id || !replyTo || !currentNotice.conversation_id
    || String(conversation)!==String(currentNotice.conversation_id)
    || ![currentNotice.message_id,currentNotice.provider_message_id].filter(Boolean).map(String).includes(String(replyTo))
    || !Number.isFinite(Date.parse(eventAt)) || !Number.isFinite(Date.parse(currentNotice.notification_at))
    || Date.parse(eventAt)<=Date.parse(currentNotice.notification_at) || Date.parse(eventAt)>+new Date(now))return false;
  return true;
}

export function verifyAbsentCallback(message, contextTemplate, contract, now=new Date(), currentNotice=null) {
  if(!absentCallbackContextMatches(message,currentNotice,now))return null;
  if(contextTemplate!==ABSENT_TEMPLATE_NAME || contract?.status!=='OBSERVED_REAL'
    || contract.template_name!==ABSENT_TEMPLATE_NAME || String(contract.template_id)!=='1552419'
    || !contract.evidence_id || !Number.isFinite(Date.parse(contract.observed_at))
    || Date.parse(contract.observed_at)>+new Date(now) || !Array.isArray(contract.buttons)
    || contract.buttons.length<1 || contract.buttons.length>3)return null;
  const ids=new Set(),payloads=new Set();
  for(const entry of contract.buttons){
    const expected=ABSENT_TEMPLATE_BUTTONS.find(button=>button.payload===entry?.canonical_payload);
    if(!expected || payloads.has(entry.canonical_payload)
      || entry.text!==expected.text || !entry.observed_message_id
      || !entry.observed_notification_message_id || !/^f\d+n\d+$/.test(entry.provider_id || '')
      || ids.has(entry.provider_id))return null;
    ids.add(entry.provider_id);
    payloads.add(entry.canonical_payload);
  }
  const candidates=[message?.interactive?.button_reply?.id,message?.payload?.button_reply?.id,
    message?.button_payload,message?.postback?.payload,message?.payload?.payload];
  const present=[...new Set(candidates.filter(x=>typeof x==='string' && x.length))];
  if(present.length!==1)return null;
  const entry=contract.buttons.find(x=>x.provider_id===present[0]);
  if(!entry)return null;
  const labels=[message?.interactive?.button_reply?.title,message?.payload?.button_reply?.title,
    message?.button_text,message?.payload?.title].filter(x=>typeof x==='string' && x.length);
  if(labels.some(x=>x!==entry.text))return null;
  return {provider_id:entry.provider_id,canonical_payload:entry.canonical_payload,
    contract_evidence_id:contract.evidence_id};
}
