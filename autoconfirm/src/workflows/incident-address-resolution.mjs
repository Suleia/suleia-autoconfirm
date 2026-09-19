const STREET_TYPE = /\b(calle|c\/|avenida|avda\.?|plaza|paseo|camino|carretera|urbanizaci[oó]n|ronda|traves[ií]a|v[ií]a)\b/i;
const LOCATION_ANCHOR = /\b(?:n(?:ú|u)mero|n[ºo]\.?|portal|por\s+tal|piso|puerta|bloque|escalera)\s*[:#-]?\s*(?:\d{1,4}[a-z]?|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|primero|primera|segundo|segunda)\b/i;
const STREET_NUMBER = /\b(?:calle|c\/|avenida|avda\.?|plaza|paseo|camino|carretera|ronda|traves[ií]a|v[ií]a)\b[^,;\n]{1,90}?\b\d{1,4}[a-z]?\b/i;
const UNSAFE_CONTENT = /https?:\/\/|\b(?:token|contrase[nñ]a|password|ignora (?:las|todas)|instrucciones del sistema)\b|@[^\s]+\.[a-z]{2,}/i;
const TERMINAL_REJECTION = /\b(?:no\s+(?:lo\s+)?quiero|no\s+voy\s+a\s+recibir|rechaz|cancel|anul)\b/i;
const ADDRESS_REFERENCE = /\b(?:direcci[oó]n|calle|avenida|avda\.?|plaza|paseo|camino|carretera|urbanizaci[oó]n|portal|por\s+tal|piso|puerta|bloque|escalera)\b/i;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function titleFirst(value) {
  const text = String(value || '').trim();
  return text ? `${text[0].toLocaleUpperCase('es-ES')}${text.slice(1)}` : '';
}

function normalizeAddressLiteral(value) {
  let text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text
    .replace(/\bpor\s+tal\b/gi, 'portal')
    .replace(/\bportal\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/gi, (_, word) => {
      const values = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
      return `portal ${values[word.toLowerCase()]}`;
    })
    .replace(/\b(?:primero|primera)\s*([a-z])\b/gi, (_, letter) => `1º${letter.toUpperCase()}`)
    .replace(/\b(?:segundo|segunda)\s*([a-z])\b/gi, (_, letter) => `2º${letter.toUpperCase()}`)
    .replace(/\bay\s+una?\s+varber[ií]a\b/gi, 'hay una barbería')
    .replace(/\bvarber[ií]a\b/gi, 'barbería')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])(?=\S)/g, '$1 ')
    .trim();
  return titleFirst(text).replace(/[.\s]+$/, '');
}

export function prepareIncorrectAddressSolution({ customerText = '', orderPhone = '' } = {}) {
  if (UNSAFE_CONTENT.test(String(customerText || ''))) {
    return { eligible: false, status: 'MANUAL_REVIEW_AMBIGUOUS_ADDRESS', reason: 'customer_address_unsafe_or_too_long' };
  }
  const literal = normalizeAddressLiteral(customerText);
  const phone = digits(orderPhone).slice(-9);
  if (!literal) return { eligible: false, status: 'MANUAL_REVIEW_NO_RESPONSE', reason: 'customer_address_missing' };
  if (literal.length > 220 || UNSAFE_CONTENT.test(literal)) {
    return { eligible: false, status: 'MANUAL_REVIEW_AMBIGUOUS_ADDRESS', reason: 'customer_address_unsafe_or_too_long' };
  }
  if (!STREET_TYPE.test(literal) || !(LOCATION_ANCHOR.test(literal) || STREET_NUMBER.test(literal))) {
    return { eligible: false, status: 'MANUAL_REVIEW_INCOMPLETE_ADDRESS', reason: 'customer_address_not_actionable' };
  }
  if (phone.length !== 9 || !/^[67]/.test(phone)) {
    return { eligible: false, status: 'MANUAL_REVIEW_MISSING_PHONE', reason: 'authoritative_order_phone_missing' };
  }
  const text = `${literal}. Llamar antes al ${phone}.`;
  if (text.length > 300) {
    return { eligible: false, status: 'MANUAL_REVIEW_AMBIGUOUS_ADDRESS', reason: 'prepared_solution_too_long' };
  }
  return {
    eligible: true,
    status: 'READY_FOR_DROPEA',
    reason: 'verified_customer_address_after_incident',
    text,
    addressLiteral: literal,
    phoneLast9: phone
  };
}

export function selectLatestActionableAddress({ customerTexts = [], orderPhone = '' } = {}) {
  const ordered = Array.isArray(customerTexts)
    ? customerTexts.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index];
    if (TERMINAL_REJECTION.test(candidate)) {
      return { eligible: false, status: 'MANUAL_REVIEW_AMBIGUOUS_ADDRESS', reason: 'later_customer_rejection' };
    }
    const prepared = prepareIncorrectAddressSolution({ customerText: candidate, orderPhone });
    if (prepared.eligible) return prepared;
    if (ADDRESS_REFERENCE.test(candidate)) return prepared;
  }
  return prepareIncorrectAddressSolution({ customerText: ordered.at(-1) || '', orderPhone });
}

export function incorrectAddressOperationalDecision({
  classification,
  chatby = {},
  phone = ''
} = {}) {
  if (classification?.type !== 'address') {
    return { eligible: false, action: 'none', confidence: 0, ruleId: null, status: 'NOT_APPLICABLE', reason: 'not_incorrect_address' };
  }
  if (chatby.orderAssociation !== 'EXACT_ORDER') {
    return { eligible: false, action: 'none', confidence: 0, ruleId: 'manual_address_no_exact_conversation', status: 'MANUAL_REVIEW_NO_EXACT_CONVERSATION', reason: 'Chatby no esta asociado de forma exacta a este pedido.' };
  }
  if (chatby.chatbyReadVerified !== true) {
    return { eligible: false, action: 'none', confidence: 0, ruleId: 'manual_address_chatby_unverified', status: 'MANUAL_REVIEW_CHATBY_UNVERIFIED', reason: 'La lectura de Chatby no esta verificada.' };
  }
  if (Number(chatby.customerMessages || 0) < 1 || !chatby.lastCustomerMessage) {
    return { eligible: false, action: 'none', confidence: 0, ruleId: 'manual_address_no_response', status: 'MANUAL_REVIEW_NO_RESPONSE', reason: 'El cliente no ha contestado despues de la incidencia.' };
  }
  const prepared = selectLatestActionableAddress({
    customerTexts: Array.isArray(chatby.customerTextsAfterIncident) && chatby.customerTextsAfterIncident.length
      ? chatby.customerTextsAfterIncident
      : [chatby.lastCustomerMessage],
    orderPhone: phone
  });
  if (!prepared.eligible) {
    return { eligible: false, action: 'none', confidence: 0, ruleId: 'manual_address_incomplete', status: prepared.status, reason: prepared.reason };
  }
  return {
    eligible: true,
    action: 'accept_solution',
    text: prepared.text,
    confidence: 99,
    ruleId: 'core_incident_incorrect_address_customer_solution',
    status: 'READY_FOR_DROPEA',
    reason: 'Direccion posterior a la incidencia, vinculada exactamente al pedido y con datos accionables.'
  };
}

export const incorrectAddressResolutionInternals = Object.freeze({ normalizeAddressLiteral });
