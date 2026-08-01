import crypto from 'node:crypto';

export const DISCOUNT_POLICY_VERSION = 'incident-discount-shadow-v1.0.0';
export const MAX_DISCOUNT_EUR = 5;
export const DISCOUNT_STATES = Object.freeze([
  'NOT_OFFERED', 'OFFER_PREPARED', 'OFFER_SENT', 'CUSTOMER_ACCEPTED', 'CUSTOMER_REJECTED',
  'CUSTOMER_NO_RESPONSE', 'DROPEA_REQUEST_PENDING', 'EMAIL_PREPARED', 'EMAIL_SENT',
  'AWAITING_DROPEA_CONFIRMATION', 'DROPEA_CONFIRMED', 'COD_CHANGE_VERIFIED', 'READY_FOR_RETRY',
  'EXPIRED', 'CANCELLED', 'HUMAN_REVIEW'
]);

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Amount must be numeric');
  return Math.round(number * 100) / 100;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function prepareDiscountOffer({ orderId, originalAmount, reason, createdAt = new Date().toISOString() }) {
  const amount = money(originalAmount);
  const eligible = amount >= MAX_DISCOUNT_EUR && reason === 'REFUSED_NO_RESPONSE';
  return Object.freeze({
    order_id: String(orderId),
    original_amount: amount,
    discount_amount: eligible ? MAX_DISCOUNT_EUR : 0,
    new_amount: eligible ? money(amount - MAX_DISCOUNT_EUR) : amount,
    status: eligible ? 'OFFER_PREPARED' : 'NOT_OFFERED',
    eligible,
    blocking_reasons: eligible ? [] : ['DISCOUNT_POLICY_NOT_APPLICABLE'],
    policy_version: DISCOUNT_POLICY_VERSION,
    created_at: new Date(createdAt).toISOString(),
    email_prepared: false,
    email_sent: false,
    actions_executed: 0,
    discounts_applied: 0,
    messages_sent: 0,
    production_writes: 0,
    run_mode: 'SIMULATION'
  });
}

export function prepareDiscountEmailDraft({
  offer,
  dropeaOrderId,
  customerAcceptanceMessageIdHash,
  acceptedAt,
  createdAt = new Date().toISOString()
}) {
  if (!offer?.eligible || offer.discount_amount !== MAX_DISCOUNT_EUR) throw new Error('A strict 5 EUR eligible offer is required');
  if (!/^[a-f0-9]{64}$/i.test(String(customerAcceptanceMessageIdHash || ''))) {
    throw new Error('Customer acceptance evidence must be a SHA-256/HMAC hash');
  }
  const subject = `Solicitud de modificacion de reembolso - Pedido ${String(dropeaOrderId)}`;
  const body = [
    'Hola,',
    '',
    `Solicitamos aplicar una reduccion de 5 EUR al importe contra reembolso del pedido ${String(dropeaOrderId)}, tras la aceptacion expresa del cliente.`,
    '',
    `Importe original: ${offer.original_amount.toFixed(2)} EUR`,
    'Descuento: 5.00 EUR',
    `Nuevo importe: ${offer.new_amount.toFixed(2)} EUR`,
    '',
    'Por favor, confirmad la modificacion del reembolso y de la etiqueta antes de coordinar un nuevo intento de entrega.',
    '',
    'Gracias.'
  ].join('\n');
  return Object.freeze({
    order_id: offer.order_id,
    dropea_order_id: String(dropeaOrderId),
    original_amount: offer.original_amount,
    discount_amount: MAX_DISCOUNT_EUR,
    new_amount: offer.new_amount,
    customer_acceptance_message_id_hash: String(customerAcceptanceMessageIdHash),
    accepted_at: new Date(acceptedAt).toISOString(),
    future_recipient_role: 'DROPEA_SUPPORT',
    draft_subject: subject,
    draft_body_sanitized: body,
    draft_hash: hash(`${subject}\n${body}`),
    created_at: new Date(createdAt).toISOString(),
    status: 'EMAIL_PREPARED',
    email_prepared: true,
    email_sent: false,
    dropea_request_sent: false,
    cod_change_verified: false,
    ready_for_retry: false,
    actions_executed: 0,
    discounts_applied: 0,
    production_writes: 0,
    run_mode: 'SIMULATION'
  });
}
