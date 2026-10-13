// A recovered provider receipt must also retire the stale incident-cache error.
// This reads the durable action and message ledgers; it never sends or retries.
export async function recoverReconciledAddressDetails(incident,previous,read){
 const prior=previous?.last_execution||previous?.execution;
 if(prior?.status!=='EXECUTION_UNKNOWN'||prior.capability!=='DETAILS'||!prior.action_id)return previous;
 const orderId=String(incident.orderId),issueId=String(incident.incidenceId);
 const key={storeId:'suleia',orderId};
 const [action,message]=await Promise.all([
  read({...key,templateName:`address_capability_action_v1:DETAILS:${issueId}`}),
  read({...key,templateName:`address_missing_fields_v1:${issueId}`})
 ]);
 const proof=action?.raw?.provider_result,reconciliation=action?.raw?.reconciliation;
 if(action?.status!=='verified'||String(action.order_id)!==orderId||action.raw?.action_id!==prior.action_id||String(action.raw?.issue_id)!==issueId||action.raw?.capability!=='DETAILS'||
    reconciliation?.source!=='EXACT_CHATBY_OUTGOING_WAMID'||reconciliation.resent!==false||
    proof?.status!=='DETAILS_REQUEST_SENT'||proof.verified!==true||proof.provider_receipt!==true||!String(proof.message_id||'').startsWith('wamid.')||
    message?.status!=='sent'||String(message.order_id)!==orderId||message.raw?.verified!==true||message.raw?.message_id!==proof.message_id||
    !Number.isFinite(Date.parse(message.raw?.last_required_field_request_at)))return previous;
 const execution={...prior,status:'DETAILS_REQUEST_SENT',verified:true,breaker:'CLOSED',message_id:proof.message_id,
  last_required_field_request_at:message.raw.last_required_field_request_at,reconciled_at:reconciliation.at};
 return {...previous,execution,last_execution:execution,last_required_field_request_at:execution.last_required_field_request_at};
}
