import crypto from 'node:crypto';

export const SUPPORT_WORKFLOW = 'accepted_discount_support_v1';
export const SUPPORT_TO = 'soporte@dropea.com';
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id = x => /^[1-9]\d*$/.test(String(x));
export function moneyCents(value) {
  const s = String(value ?? '');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
export function acceptedDiscountPlan(s, {now = Date.now(), activationAt} = {}) {
  const deny = reason => ({eligible:false, reason});
  if (!id(s.orderId) || !id(s.issueId) || !id(s.ownerId) || !s.exactOrder || !s.readVerified) return deny('EXACT_ORDER_REQUIRED');
  if (s.issueStatus !== 'PENDING' || !s.active || !s.allowed?.includes('PROVIDE_SOLUTION') || s.priorReturn || s.pickupArranged) return deny('ISSUE_NOT_AVAILABLE');
  if (!/^\+34[6789]\d{8}$/.test(s.phone || '') || s.phone !== s.conversationPhone) return deny('PHONE_MISMATCH');
  const offerAt = Date.parse(s.offerAt), acceptedAt = Date.parse(s.acceptedAt), issueAt = Date.parse(s.issueAt), activation = Date.parse(activationAt);
  if (![offerAt,acceptedAt,issueAt,activation,now].every(Number.isFinite) || offerAt < issueAt || acceptedAt <= offerAt || acceptedAt > now || acceptedAt < activation) return deny('CURRENT_OFFER_TIMING_REQUIRED');
  if (s.intent !== 'ACCEPTS_DISCOUNT' || !s.offerVerified || !s.offerMessageId || !s.acceptanceMessageId) return deny('VERIFIED_ACCEPTANCE_REQUIRED');
  // A new cancellation/correction within the hour must prevent execution.
  if (now - acceptedAt < 3600000) return deny('WAIT_ONE_HOUR');
  const original = moneyCents(s.originalAmount), current = moneyCents(s.currentAmount), offered = moneyCents(s.offeredAmount);
  if (s.currency !== 'EUR' || original === null || offered === null || original <= 500 || offered !== original - 500) return deny('OFFER_AMOUNT_MISMATCH');
  if (current !== original) return deny(current === offered ? 'ALREADY_DISCOUNTED_RECONCILE' : 'CURRENT_AMOUNT_CHANGED');
  const amount = (offered / 100).toFixed(2).replace('.', ',');
  const identity = {orderId:String(s.orderId), issueId:String(s.issueId), ownerId:String(s.ownerId), phone:s.phone, conversationId:s.conversationId,customerName:s.customerName,
    offerMessageId:String(s.offerMessageId), acceptanceMessageId:String(s.acceptanceMessageId), acceptedAt:s.acceptedAt, offerAt:s.offerAt, originalCents:original, finalCents:offered};
  const key = hash([SUPPORT_WORKFLOW, identity.orderId]); // One recovery per order, including reopened issues.
  return {...identity, eligible:true, key, snapshot:hash(identity), discountApplied:false,
    email:{to:SUPPORT_TO,subject:`Aplicar descuento en pedido ES${s.orderId}`,
      text:`Hola, soy el ID dropshipper ${s.ownerId}. Quiero aplicar un descuento en el pedido ES${s.orderId} e id incidencia ${s.issueId}. Se le aplica descuento de 5€. Importe total a cobrar: ${amount}€.\n\nAdjuntamos las capturas de Chatby de la oferta y aceptación. Teléfono: ${s.phone}. Aceptación: ${s.acceptedAt} (UTC).`},
    solution:`Realizar entrega y cobrar al cliente ${amount}€. Llamar a ${s.phone.slice(3)} antes de entregar.`};
}
export function validateSupportEvidence(plan, evidence, now = Date.now()) {
  if (!evidence || evidence.source !== 'CHATBY_BROWSER_SCREENSHOT' || evidence.snapshot !== plan.snapshot
      || evidence.phone !== plan.phone || evidence.conversationId !== plan.conversationId
      || evidence.orderId !== plan.orderId || evidence.acceptanceMessageId !== plan.acceptanceMessageId
      || evidence.offerMessageId !== plan.offerMessageId || evidence.acceptedAt !== plan.acceptedAt
      || !evidence.visiblePhone || !evidence.visibleDateTime || !evidence.visibleAcceptance || !evidence.visibleOffer
      || !Number.isFinite(Date.parse(evidence.capturedAt)) || now-Date.parse(evidence.capturedAt)>300000 || Date.parse(evidence.capturedAt)>now+60000) return false;
  return Array.isArray(evidence.attachments) && evidence.attachments.length>=1 && evidence.attachments.length<=4
    && evidence.attachments.every(a=>a.mimeType==='image/png' && /^[a-zA-Z0-9_-]+\.png$/.test(a.filename)
      && Buffer.isBuffer(a.bytes) && a.bytes.length>1000 && a.bytes.length<8000000
      && a.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
}

// Dependencies have separate read, capture, mail and provider responsibilities.
// A durable claim is never automatically recycled after an uncertain write.
export async function runAcceptedDiscount(incident, deps, options) {
  if (!deps.ready()) return {status:'CONNECTIONS_REQUIRED',discountApplied:false};
  const fresh = () => deps.read(incident).then(s=>acceptedDiscountPlan(s,options));
  const plan = await fresh();
  if (!plan.eligible) return {status:plan.reason,discountApplied:false};
  const previous = await deps.get(plan);
  if (previous) return {status:previous.status==='verified'?'ALREADY_VERIFIED':'RECONCILIATION_REQUIRED',discountApplied:false};
  const evidence = await deps.capture(plan);
  if (!validateSupportEvidence(plan,evidence)) return {status:'SCREENSHOT_NOT_VERIFIED',discountApplied:false};
  const reread = await fresh();
  if (!reread.eligible || reread.snapshot!==plan.snapshot) return {status:'CUSTOMER_OR_ORDER_CHANGED',discountApplied:false};
  const claim = await deps.claim(plan);
  if (!claim.acquired || !claim.persistent) return {status:'ALREADY_CLAIMED_OR_STORE_UNAVAILABLE',discountApplied:false};
  let phase='CLAIMED', mailId=null;
  const attachmentHashes=evidence.attachments.map(a=>({filename:a.filename,sha256:crypto.createHash('sha256').update(a.bytes).digest('hex')}));
  const audit={workflow:SUPPORT_WORKFLOW,orderId:plan.orderId,issueId:plan.issueId,phone:plan.phone,acceptedAt:plan.acceptedAt,
    acceptanceMessageId:plan.acceptanceMessageId,originalCents:plan.originalCents,finalCents:plan.finalCents,snapshot:plan.snapshot,attachmentHashes,requestedAt:new Date().toISOString()};
  const save=(status,extra={})=>deps.save(plan,status,{...audit,phase,mailId,...extra});
  try {
    const beforeMail=await fresh();
    if (!beforeMail.eligible || beforeMail.snapshot!==plan.snapshot) {await save('aborted');return {status:'CUSTOMER_OR_ORDER_CHANGED',discountApplied:false};}
    phase='EMAIL_REQUESTED';await save('requested');
    mailId=await deps.send(plan,evidence.attachments);
    if (!mailId || !await deps.verifyMail(mailId,plan,evidence.attachments)) throw Error('EMAIL_READBACK_FAILED');
    phase='EMAIL_VERIFIED';await save('email_verified');
    const beforeSolution=await fresh();
    if (!beforeSolution.eligible || beforeSolution.snapshot!==plan.snapshot) {await save('review_required');return {status:'EMAIL_SENT_SOLUTION_BLOCKED',mailId,discountApplied:false};}
    phase='SOLUTION_REQUESTED';await save('requested');
    await deps.solve(plan);
    if (!await deps.verifySolution(plan)) throw Error('SOLUTION_READBACK_FAILED');
    phase='SOLUTION_VERIFIED';await save('verified',{verifiedAt:new Date().toISOString(),discountApplied:false});
    return {status:'SUPPORT_SENT_SOLUTION_VERIFIED',mailId,discountApplied:false};
  } catch {
    await save('unknown');
    return {status:'RECONCILIATION_REQUIRED',phase,mailId,discountApplied:false};
  }
}
