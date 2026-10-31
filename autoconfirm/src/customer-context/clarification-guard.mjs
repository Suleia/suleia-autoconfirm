export function clarificationGuard(context){
  const question=(context.clarifications||[]).filter(c=>!c.answered_at&&
    ['ATTEMPTING','PROVIDER_ACCEPTED','DELIVERY_UNVERIFIED'].includes(c.status)).at(-1);
  if(question)return {allowed:false,state:'WAITING_CUSTOMER',reason:'WAITING_CUSTOMER',
    finding:{code:'REPEATED_CLARIFICATION',severity:'HIGH',question_hash:question.message_hash}};
  return {allowed:true,state:'READY',reason:'NO_ACTIVE_CLARIFICATION'};
}
