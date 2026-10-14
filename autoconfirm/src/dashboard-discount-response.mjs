// Display-only projection. Opening a dashboard must not read customer histories
// or compete with the governed worker. Never infer silence from missing data.
export function cachedDiscountResponse(ledger, cache, now=Date.now()) {
 const unavailable={status:'STATUS_UNAVAILABLE',respondedAt:null};
 const reviewedAt=Date.parse(cache?.updatedAt);
 if(!Number.isFinite(reviewedAt)||now-reviewedAt>60*60000||reviewedAt>now)return unavailable;
 const sentAt=Date.parse(ledger?.sent_at);
 if(!Number.isFinite(sentAt))return unavailable;
 const incident=cache?.incidents?.find(i=>String(i.orderId)===String(ledger.order_id)
  &&i.chatbyUserNs===ledger.chatby_user_ns&&i.incidentDiscountTemplate===ledger.template_name
  &&Date.parse(i.incidentDiscountSentAt)===sentAt&&i.chatbyReadVerified===true&&i.incidentDiscountVerified===true);
 const status=incident?.incidentDiscountResponseStatus;
 if(!['DISCOUNT_ACCEPTED','DISCOUNT_REJECTED','OTHER_RESPONSE','NO_RESPONSE'].includes(status))return unavailable;
 return {status,respondedAt:incident.incidentDiscountRespondedAt||null};
}
