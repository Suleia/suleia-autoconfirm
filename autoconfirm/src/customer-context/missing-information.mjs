export function requiredMissingInformation(context,intendedAction,{minimumConfidence=.9}={}){
  const facts=context.current_facts||{};
  const known=type=>facts[type]?.confidence>=minimumConfidence&&facts[type].status==='CURRENT';
  if(['RETURN','AUTO_CANCEL','DISCOUNT_ACCEPT','STATUS_REPLY'].includes(intendedAction))return [];
  if(intendedAction==='ADDRESS')return ['ADDRESS','POSTAL_CODE','CITY'].filter(type=>!known(type));
  if(!known('WANTS_ORDER')||facts.WANTS_ORDER.value_json!==true)return ['WANTS_ORDER'];
  const hasWindow=known('DELIVERY_WINDOW')||known('TIME_FROM')||known('TIME_TO')||known('DELIVERY_AVAILABILITY');
  if(context.policy?.ownerProvidesDefaultSchedule&&!known('DELIVERY_DATE')&&!hasWindow&&!context.expired_delivery_date)return [];
  const missing=[];
  if(context.policy?.requireDeliveryDate&&!known('DELIVERY_DATE')&&!(context.policy.ownerProvidesDefaultDate&&hasWindow&&!context.expired_delivery_date))missing.push('DELIVERY_DATE');
  if(context.policy?.requireDeliveryWindow&&!hasWindow)missing.push('TIME_WINDOW');
  for(const uncertain of context.unresolved||[]){
    if(['TIME_FROM','TIME_TO'].includes(uncertain)){
      const index=missing.indexOf('TIME_WINDOW');if(index>=0)missing.splice(index,1);
      missing.push(uncertain);
    }
  }
  return [...new Set(missing)]; // Payment is never a required customer answer.
}
