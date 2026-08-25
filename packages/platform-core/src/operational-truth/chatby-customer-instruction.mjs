function normalizedText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function deliveryInstructionFromText(value) {
  const text = normalizedText(value);
  const weekday = [
    ['MONDAY', /\blunes\b/], ['TUESDAY', /\bmartes\b/], ['WEDNESDAY', /\bmiercoles\b/],
    ['THURSDAY', /\bjueves\b/], ['FRIDAY', /\bviernes\b/], ['SATURDAY', /\bsabado\b/],
    ['SUNDAY', /\bdomingo\b/]
  ].find(([, pattern]) => pattern.test(text))?.[0] || null;
  const tomorrowMentions = (text.match(/\bmanana\b/g) || []).length;
  const nextDay = /\b(manana|dia siguiente|siguiente dia)\b/.test(text);
  const morning = /\b(por|durante|en) (?:la )?manana\b|\bde manana\b/.test(text)
    || /\btemprano\b/.test(text) || (tomorrowMentions >= 2 && /\btarde\b/.test(text));
  const afternoon = /\b(por|durante|en) (?:la )?tarde\b|\bde tarde\b/.test(text)
    || (morning && /\btarde\b/.test(text));
  const callBeforeDelivery = /(?:llam|avis).{0,45}(?:antes|previ).{0,45}(?:entreg|repart)|(?:antes|previ).{0,45}(?:entreg|repart).{0,45}(?:llam|avis)/.test(text);
  const deliveryLanguage = /\b(entreg|repart|recib|llevar)/.test(text);
  const requestedWindow = morning && afternoon ? 'MORNING_OR_AFTERNOON'
    : morning ? 'MORNING' : afternoon ? 'AFTERNOON' : null;
  return Object.freeze({
    requested_day: nextDay ? 'NEXT_DAY' : weekday,
    requested_window: requestedWindow,
    call_before_delivery: callBeforeDelivery,
    is_delivery_request: deliveryLanguage && (nextDay || weekday || requestedWindow !== null || callBeforeDelivery)
      || ((nextDay || weekday) && requestedWindow !== null)
  });
}

export function addressInstructionFromText(value) {
  const literal = String(value || '').replace(/\r\n?/g, '\n').trim();
  const text = normalizedText(literal);
  const streetType = /\b(calle|c\/|avenida|avda\.?|plaza|paseo|camino|carretera|urbanizacion|ronda|travesia|via)\b/.exec(text);
  const postalCode = /\b(\d{5})\b/.exec(literal)?.[1] || null;
  const explicitNumber = /\b(?:numero|n[ºo]\.?|num\.?)\s*[:#-]?\s*(\d{1,4}[a-z]?)\b/i.exec(literal)?.[1] || null;
  const streetNumber = streetType
    ? new RegExp(`${streetType[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\n,;]{1,90}?(?:,|\\s)\\s*(\\d{1,4}[a-z]?)\\b`, 'i').exec(literal)?.[1] || null
    : null;
  const locality = /\b(?:localidad|ciudad|municipio)\s*[:#-]?\s*([a-záéíóúüñ][a-záéíóúüñ .'-]{1,79})/i.exec(literal)?.[1]?.trim()
    || (postalCode ? new RegExp(`\\b${postalCode}\\b\\s*[,;-]?\\s*([a-záéíóúüñ][a-záéíóúüñ .'-]{1,79})`, 'i').exec(literal)?.[1]?.trim() : null)
    || null;
  const unit = /\b((?:piso|puerta|portal|bloque|escalera)\s*[:#-]?\s*[a-z0-9ºª .-]{1,40})/i.exec(literal)?.[1]?.trim() || null;
  const streetLine = literal.split('\n').map((line) => line.trim()).find((line) =>
    /\b(calle|c\/|avenida|avda\.?|plaza|paseo|camino|carretera|urbanizaci[oó]n|ronda|traves[ií]a|v[ií]a)\b/i.test(line)) || null;
  const fields = Object.freeze({
    street_line: streetLine,
    street_number: explicitNumber || streetNumber,
    postal_code: postalCode,
    locality,
    unit
  });
  const missing = [
    !streetLine ? 'STREET' : null,
    !(explicitNumber || streetNumber) ? 'NUMBER' : null,
    !postalCode ? 'POSTAL_CODE' : null,
    !locality ? 'LOCALITY' : null
  ].filter(Boolean);
  return Object.freeze({
    literal: literal || null,
    fields,
    missing_fields: Object.freeze(missing),
    complete: missing.length === 0,
    has_address_data: Boolean(streetLine || postalCode || explicitNumber || locality)
  });
}

export function interpretChatbyCustomerText(value) {
  const text = normalizedText(value);
  const delivery = deliveryInstructionFromText(text);
  const address = addressInstructionFromText(value);
  let intent = 'UNKNOWN';
  if (/(quiero el descuento|acepto el descuento|descuento.*si)/.test(text)) intent = 'DISCOUNT_ACCEPTED';
  else if (/(no quiero el descuento|rechazo el descuento|sin descuento)/.test(text)) intent = 'DISCOUNT_REJECTED';
  else if (/(recoger.*agencia|recogida.*agencia|pickup)/.test(text)) intent = 'PICKUP_AT_AGENCY';
  else if (/(cambiar.*direccion|cambio.*direccion|direccion incorrecta)/.test(text)) intent = 'CHANGE_ADDRESS';
  else if (/(no quiero el pedido|cancel|rechaz|devolver|devolucion)/.test(text)) intent = 'FINAL_REJECTION';
  else if (delivery.is_delivery_request || /(reintentar.*entrega|nuevo intento|volver.*entregar)/.test(text)) intent = 'DELIVERY_RETRY';
  else if (/(si quiero el pedido|quiero mi pedido|confirmo|confirmado|lo quiero)/.test(text)) intent = 'CUSTOMER_STILL_WANTS_ORDER';
  return Object.freeze({ intent, delivery, address });
}

function shortAnswer(value) {
  return normalizedText(value).replace(/[.!¡¿?]+/g, '').trim();
}

export function interpretChatbyCustomerReply({ customerText, precedingOperatorText = '' } = {}) {
  const direct = interpretChatbyCustomerText(customerText);
  if (direct.intent !== 'UNKNOWN') {
    return Object.freeze({ ...direct, interpretation_basis: 'DIRECT_CUSTOMER_TEXT' });
  }

  const answer = shortAnswer(customerText);
  const prompt = normalizedText(precedingOperatorText);
  const addressPrompt = /\b(direccion|codigo postal|datos (?:de )?(?:envio|entrega))\b/.test(prompt);
  const looksLikeAddress = /\b(?:calle|avenida|avda|plaza|paseo|camino|carretera|urbanizacion|numero|nº|piso|puerta)\b/.test(normalizedText(customerText))
    || /\b\d{5}\b/.test(String(customerText || ''));
  if (addressPrompt && looksLikeAddress) {
    return Object.freeze({
      intent: 'CHANGE_ADDRESS',
      delivery: direct.delivery,
      address: direct.address,
      interpretation_basis: 'ADDRESS_DATA_REPLY_TO_ADDRESS_REQUEST'
    });
  }
  const affirmative = /^(si|sí|vale|correcto|de acuerdo|ok|okay)$/.test(answer);
  if (!affirmative || !prompt) {
    return Object.freeze({ ...direct, interpretation_basis: 'INSUFFICIENT_CONTEXT' });
  }

  const receiveQuestion = prompt.match(/(?:¿|\b)(?:quiere|desea|prefiere).{0,45}(?:recibir|entreg)[^¿?]*\?\s*$/)?.[0] || '';
  const rejectionQuestion = prompt.match(/(?:¿|\b)(?:confirma|es eso cierto|quiere|desea).{0,55}(?:no quiere|rechaz|cancel|devol)[^¿?]*\?\s*$/)?.[0] || '';
  const asksToReceive = Boolean(receiveQuestion) && !/no quiere|rechaz|cancel|devol/.test(receiveQuestion);
  const asksToReject = Boolean(rejectionQuestion) && !/recibir|entreg/.test(rejectionQuestion);
  if (asksToReceive && !asksToReject) {
    return Object.freeze({
      intent: 'CUSTOMER_STILL_WANTS_ORDER',
      delivery: direct.delivery,
      address: direct.address,
      interpretation_basis: 'AFFIRMATIVE_REPLY_TO_RECEIVE_QUESTION'
    });
  }
  if (asksToReject && !asksToReceive) {
    return Object.freeze({
      intent: 'FINAL_REJECTION',
      delivery: direct.delivery,
      address: direct.address,
      interpretation_basis: 'AFFIRMATIVE_REPLY_TO_REJECTION_QUESTION'
    });
  }
  return Object.freeze({ ...direct, interpretation_basis: 'AMBIGUOUS_OPERATOR_QUESTION' });
}

export const chatbyCustomerInstructionInternals = Object.freeze({ normalizedText });
