// Business contract confirmed by the owner: email Dropea support, then supply
// the delivery solution. This pure planner neither sends mail nor writes Dropea.
export function rejectedSupportRecoveryPlan({ orderId, issueId, originalCents, offeredFinalCents, currentCents, currency, latestIntent, offerVerified, readVerified, priorReturn, priorRecovery }) {
  const deny = reason => ({ eligible: false, reason });
  if (!/^(?:ES)?[1-9][0-9]*$/.test(String(orderId)) || !/^[1-9][0-9]*$/.test(String(issueId))) return deny('EXACT_IDENTITY_REQUIRED');
  if (!readVerified || !offerVerified || latestIntent !== 'ACCEPTS_DISCOUNT') return deny('CURRENT_VERIFIED_ACCEPTANCE_REQUIRED');
  if (priorReturn) return deny('RETURN_ALREADY_REQUESTED');
  if (priorRecovery) return deny('RECOVERY_ALREADY_CLAIMED_RECONCILE');
  if (currency !== 'EUR' || ![originalCents, offeredFinalCents, currentCents].every(Number.isSafeInteger)
      || originalCents < 500 || offeredFinalCents !== originalCents - 500) return deny('VERIFIED_OFFER_AMOUNT_REQUIRED');
  // Never subtract another 5 EUR from an already reduced or changed amount.
  if (currentCents !== originalCents) return deny(currentCents === offeredFinalCents ? 'DISCOUNT_ALREADY_OBSERVED_RECONCILE' : 'CURRENT_AMOUNT_CHANGED');
  const id = String(orderId).replace(/^ES/, '');
  const reference = `ES${id}`;
  const finalAmount = (offeredFinalCents / 100).toFixed(2).replace('.', ',');
  return {
    eligible: true, orderId: id, issueId: String(issueId),
    idempotencyKey: `${id}:recovery_offer:EUR:500`,
    originalCents, discountCents: 500, finalCents: offeredFinalCents,
    email: { to: 'soporte@dropea.com', subject: `Descuento de 5 EUR y nueva entrega — pedido ${reference}`,
      text: `El cliente del pedido ${reference} ha aceptado un descuento de 5,00 EUR. El importe final a cobrar es ${finalAmount} EUR. Solicitamos aplicar este importe y realizar de nuevo la entrega. Incidencia: ${issueId}.` },
    solution: `Realizar entrega. Cobrar ${finalAmount} EUR, con descuento de 5 EUR comunicado a soporte.`,
    steps: ['SEND_SUPPORT_EMAIL', 'PROVIDE_DELIVERY_SOLUTION', 'VERIFY_COLLECTABLE_AMOUNT_AND_SOLUTION'],
    status: 'PREPARED', discountApplied: false, deliveryRequested: false,
    requiredCapabilities: ['PERSISTENT_ORDER_CLAIM', 'CONFIGURED_MAIL_SENDER', 'VERIFIED_SOLUTION_CONTRACT', 'DIRECT_PROVIDER_READ']
  };
}
