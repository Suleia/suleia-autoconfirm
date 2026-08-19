function normalizedText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function deliveryInstructionFromText(value) {
  const text = normalizedText(value);
  const nextDay = /\b(manana|dia siguiente|siguiente dia)\b/.test(text);
  const morning = /\b(por|durante|en) la manana\b|\bde manana\b/.test(text);
  const afternoon = /\b(por|durante|en) la tarde\b|\bde tarde\b/.test(text);
  const callBeforeDelivery = /(?:llam|avis).{0,45}(?:antes|previ).{0,45}(?:entreg|repart)|(?:antes|previ).{0,45}(?:entreg|repart).{0,45}(?:llam|avis)/.test(text);
  const deliveryLanguage = /\b(entreg|repart|recib|llevar)/.test(text);
  const requestedWindow = morning && afternoon ? 'MORNING_OR_AFTERNOON'
    : morning ? 'MORNING' : afternoon ? 'AFTERNOON' : null;
  return Object.freeze({
    requested_day: nextDay ? 'NEXT_DAY' : null,
    requested_window: requestedWindow,
    call_before_delivery: callBeforeDelivery,
    is_delivery_request: deliveryLanguage && (nextDay || requestedWindow !== null || callBeforeDelivery)
  });
}

export function interpretChatbyCustomerText(value) {
  const text = normalizedText(value);
  const delivery = deliveryInstructionFromText(text);
  let intent = 'UNKNOWN';
  if (/(quiero el descuento|acepto el descuento|descuento.*si)/.test(text)) intent = 'DISCOUNT_ACCEPTED';
  else if (/(no quiero el descuento|rechazo el descuento|sin descuento)/.test(text)) intent = 'DISCOUNT_REJECTED';
  else if (/(recoger.*agencia|recogida.*agencia|pickup)/.test(text)) intent = 'PICKUP_AT_AGENCY';
  else if (/(cambiar.*direccion|cambio.*direccion|direccion incorrecta)/.test(text)) intent = 'CHANGE_ADDRESS';
  else if (/(no quiero el pedido|cancel|rechaz|devolver|devolucion)/.test(text)) intent = 'FINAL_REJECTION';
  else if (delivery.is_delivery_request || /(reintentar.*entrega|nuevo intento|volver.*entregar)/.test(text)) intent = 'DELIVERY_RETRY';
  else if (/(si quiero el pedido|quiero mi pedido|confirmo|confirmado|lo quiero)/.test(text)) intent = 'CUSTOMER_STILL_WANTS_ORDER';
  return Object.freeze({ intent, delivery });
}

export const chatbyCustomerInstructionInternals = Object.freeze({ normalizedText });
