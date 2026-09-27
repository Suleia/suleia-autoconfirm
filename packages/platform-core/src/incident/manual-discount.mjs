// Read-only queue. Acceptance is evidence, never proof of a reduced COD amount.
export function manualDiscountAcceptance(item) {
  const d=item.discount_recovery || {};
  const acceptedAt=d.responded_at || item.discount_responded_at;
  const offeredAt=d.sent_at || item.discount_sent_at;
  const accepted=(d.status || item.discount_recovery_response_status)==='DISCOUNT_ACCEPTED';
  const verified=d.delivery_verified===true || item.discount_delivery_verified===true;
  const afterOffer=Date.parse(acceptedAt)>Date.parse(offeredAt);
  const afterOpening=Date.parse(offeredAt)>=Date.parse(item.created_at);
  const quality=d.status==='DISCOUNT_ACCEPTED' || item.discount_signal_quality==='VERIFIED';
  if(!accepted || !verified || !quality || !afterOffer || !afterOpening || Date.parse(acceptedAt)>Date.now())return null;
  const decision=item.rejected_observation?.decision;
  const superseded=(Date.parse(item.latest_private_customer_message_at)>Date.parse(acceptedAt))
    || (decision?.decision_status==='CURRENT' && Date.parse(decision.responded_at)>=Date.parse(acceptedAt)
      && decision.intent!=='ACCEPTS_DISCOUNT' && decision.intent!=='NO_RESPONSE');
  const open=item.status==='PENDING' && item.is_active===true;
  const returned=item.rejected_observation?.return_verified===true;
  const pending=open&&!superseded&&!returned;
  return {status:pending?'MANUAL_ACTION_PENDING':superseded?'LATER_RESPONSE_REVIEW':'HISTORICAL',
    pending,accepted_at:acceptedAt,offered_at:offeredAt,discount_amount:5,
    original_amount:d.original_amount??item.discount_original_amount??null,
    final_amount:d.final_amount??item.discount_final_amount??null,
    label:pending?'Descuento aceptado · acción manual':superseded?'Aceptó descuento · respuesta posterior':'Descuento aceptado · histórico',
    reason:pending?'Revisar Chatby y tramitar manualmente el descuento y la entrega. No se enviará correo automático a Dropea.':superseded?'Hay una respuesta posterior: revisar la intención actual antes de actuar.':'Fuera de la cola actual; no implica descuento aplicado.',
    email_automatic:false,discount_applied_verified:false};
}

export function manualDiscountPresentation(item) {
  const a=manualDiscountAcceptance(item);
  if(!a)return item;
  const result={...item,manual_discount:a};
  if(!a.pending)return result;
  return {...result,autonomy:{status:'HUMAN_REVIEW',label:'Acción manual'},
    next_best_action:{action:'MANUAL_DISCOUNT_RECOVERY',label:'Gestionar descuento aceptado',reason:a.reason,confidence:'Aceptación observada',execution_mode:'MANUAL',blocking_reasons:['Gestión manual solicitada por el propietario']},
    autonomous_state:{code:'HUMAN_REVIEW_REQUIRED',label:'Descuento aceptado · acción manual'}};
}
