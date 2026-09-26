import crypto from 'node:crypto';

export const REJECTED_POLICY = Object.freeze({
  policy_id: 'RECIPIENT_REJECTED_POLICY_V1', policy_version: '2026-09-26.1',
  discount_amount_eur: 5, offer_delay_hours: 24, recovery_timeout_hours: 48,
  timer: 'RECIPIENT_REJECTED_RECOVERY_48H', owner: 'render_incident_automation',
  latest_valid_intent_wins: true, ambiguous_return: false,
  previously_confirmed_denial_auto_return: false
});
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Only current, exactly correlated inbound messages may be passed by the caller.
export function rejectedIntent(text, { offerVerified = false, previouslyConfirmed = false } = {}) {
  const t = norm(text);
  const base = { intent: 'AMBIGUOUS', wants_order: null, discount_accepted: false, requests_return: false };
  if (!t) return { ...base, intent: 'NO_RESPONSE' };
  if (/\b(?:quiza|no se|ya veremos|ahora no|me pillo fuera|no estaba)\b/.test(t)) return base;
  if (/no (?:lo )?he pedido|no hice (?:el|este) pedido/.test(t)) return { ...base,
    reason: previouslyConfirmed ? 'CURRENT_ORDER_PREVIOUSLY_CONFIRMED' : 'ORDER_ORIGIN_DISPUTED' };
  const wants = /(?:si |mejor |final |pero )?(?:lo quiero|quiero (?:el pedido|recibirlo)|quiero que.*(?:lleven|entreguen))|que me lo vuelvan a llevar|si[, ]+(?:manana|por la)|wants_order|requests_new_delivery/.test(t)
    && !/no (?:lo quiero|quiero (?:el pedido|recibirlo))/.test(t);
  const rejectsDiscount = /no quiero (?:el )?descuento|sin descuento|rechazo (?:el )?descuento|rejects_discount/.test(t);
  if (wants && rejectsDiscount) return { ...base, intent: 'REJECTS_DISCOUNT', wants_order: true };
  if (/no quiero (?:el|este) pedido|no lo quiero|(?:ya )?no quiero recibirlo|\bdevolver\b|que vuelva|requests_return|reject_order/.test(t)) {
    if (wants || /no (?:quiero )?devolver|no lo devuelv/.test(t)) return { ...base, reason: 'CONTRADICTORY_MESSAGE' };
    return { ...base, intent: 'REQUESTS_RETURN', wants_order: false, requests_return: true };
  }
  if (rejectsDiscount) return { ...base, intent: 'REJECTS_DISCOUNT' };
  if (offerVerified && /quiero el descuento|acepto (?:el )?descuento|accept_discount_5|^acepto[.! ]*$/.test(t))
    return { ...base, intent: 'ACCEPTS_DISCOUNT', wants_order: true, discount_accepted: true };
  if (/recoger en agencia|recogida en agencia/.test(t)) return { ...base, intent: 'REQUESTS_AGENCY', wants_order: true };
  if (wants) return { ...base, intent: 'WANTS_ORDER', wants_order: true };
  return base;
}

export function rejectedDecisionSnapshot({ incident, response, recovery, now = Date.now() }) {
  const input = { order_id: String(incident.orderId), issue_id: String(incident.incidenceId),
    conversation_hash: incident.chatbyUserNs ? digest(incident.chatbyUserNs) : null,
    read_verified: incident.chatbyReadVerified === true, read_at: incident.chatbyReadAt || null,
    intent: response.intent || 'AMBIGUOUS', responded_at: response.respondedAt || null,
    offer_at: recovery.sentAt || null, return_status: incident.incidentDiscountReturnStatus || null };
  let next = 'HUMAN_REVIEW';
  const returned = ['RETURN_REQUESTED_VERIFIED','RETURN_ALREADY_REQUESTED_FOR_ORDER','RETURN_REQUESTED_UNVERIFIED','MANUAL_RECONCILIATION_REQUIRED'].includes(input.return_status);
  if (input.read_verified && !returned) {
    if (response.intent === 'REQUESTS_RETURN') next = 'RETURN_TO_ORIGIN';
    else if (response.discount_accepted) next = 'APPLY_DISCOUNT';
    else if (response.wants_order) next = response.intent === 'REQUESTS_AGENCY' ? 'OFFER_AGENCY' : 'REQUEST_NEW_DELIVERY';
    else if (response.intent === 'NO_RESPONSE') next = recovery.verified && Number.isFinite(Date.parse(recovery.sentAt)) && now-Date.parse(recovery.sentAt)>=48*3600000 ? 'RETURN_TO_ORIGIN' : recovery.verified ? 'WAIT_FOR_CUSTOMER' : recovery.reason === 'discount_template_due' ? 'OFFER_RECOVERY_DISCOUNT' : 'WAIT_FOR_CUSTOMER';
  }
  const policy_snapshot_hash = digest(REJECTED_POLICY), input_snapshot_hash = digest(input);
  return { ...input, ...response, policy_id: REJECTED_POLICY.policy_id, policy_version: REJECTED_POLICY.policy_version,
    policy_snapshot_hash, input_snapshot_hash, decision_id: digest([policy_snapshot_hash,input_snapshot_hash]),
    decision_status: 'CURRENT', decided_at: new Date(now).toISOString(), next_best_action: next,
    autonomy: next === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'PREPARED', discount_amount_eur: 5 };
}

export function rejectedRuntimeStatus(config, state, now = Date.now(), env = process.env) {
  const master=env.RECIPIENT_REJECTED_AUTOMATION_LIVE !== 'false';
  const last=state.lastIncidentDiscountRecoveryAt||null;
  const fresh=Number.isFinite(Date.parse(last)) && now-Date.parse(last) < 45*60000;
  const enabled=config.enableIncidentDiscountTemplate===true;
  const offer=enabled&&config.incidentDiscountRealEnabled===true&&master&&env.RECIPIENT_REJECTED_OFFER_BREAKER!=='OPEN';
  const returns=config.defaultStore.incidentDiscountReturnAutomaticEnabled===true&&config.defaultStore.incidentDiscountReturnRealEnabled===true&&master&&env.RECIPIENT_REJECTED_RETURN_BREAKER!=='OPEN';
  const known=v=>fresh?(v?'LIVE':'OFF'):'UNKNOWN';
  return {workflow:'RECIPIENT_REJECTED',owner:'render_incident_automation',observed_at:new Date(now).toISOString(),
    last_cycle_at:last,healthy:fresh&&!state.lastIncidentsSyncError,master_enabled:master,
    policy:REJECTED_POLICY,stages:{detection:known(enabled),contact:fresh&&state.lastRejectedNativeContactObserved===true?'LIVE':'UNKNOWN',interpretation:known(enabled),decision:known(enabled),
      recovery_offer:known(offer),discount:'UNKNOWN',new_delivery:'OFF',return:known(returns),verification:known(returns)},
    capabilities:{apply_discount:false,new_delivery:false,explicit_return_without_offer:false},
    breakers:{notification:env.RECIPIENT_REJECTED_OFFER_BREAKER==='OPEN'?'OPEN':'CLOSED',discount:'UNKNOWN',delivery:'UNKNOWN',return:env.RECIPIENT_REJECTED_RETURN_BREAKER==='OPEN'?'OPEN':'CLOSED'},
    summary:state.lastIncidentDiscountRecoverySummary||null,return_summary:state.lastIncidentDiscountReturnSummary||null,
    native_contact_owner:'chatby_native',native_template:'dropea_incidencia_mercancia_v1',
    discount_template:'es_es_dropea_incidencia_descuento_5_v1',scheduler_minutes:config.incidentDiscountIntervalMinutes};
}
