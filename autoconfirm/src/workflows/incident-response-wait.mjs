export const INCIDENT_RESPONSE_WAIT_STATE = 'WAITING_CUSTOMER_INCIDENT_RESPONSE';
export const DEFAULT_INCIDENT_RESPONSE_TIMEOUT_HOURS = 48;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function messageText(message) {
  return [
    message?.text,
    message?.message,
    message?.content,
    message?.caption,
    message?.button_text,
    typeof message?.payload === 'string' ? message.payload : null
  ].filter((value) => typeof value === 'string' && value.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

function messageDate(message) {
  const value = message?.created_at
    || message?.createdAt
    || message?.date
    || message?.timestamp
    || message?.sent_at
    || message?.sentAt
    || message?.ts
    || null;
  const source = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(source)) return source;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function isInboundCustomerMessage(message) {
  const rawMessage = message?.raw || message || {};
  const raw = JSON.stringify(rawMessage);
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || rawMessage?.direction || '');
  if (['in', 'incoming', 'inbound', 'received'].includes(from)) return true;
  if (['out', 'outgoing', 'outbound', 'agent', 'bot', 'admin', 'system', 'event', 'template'].includes(from)) return false;
  if (from.includes('customer') || from.includes('user') || from.includes('cliente') || from.includes('inbound')) return true;
  if (from.includes('bot') || from.includes('agent') || from.includes('admin') || from.includes('outbound') || from.includes('system') || from.includes('event')) return false;
  if (rawMessage.is_from_customer === true || rawMessage.isFromCustomer === true || rawMessage.from_customer === true) return true;
  if (rawMessage.from_me === false || rawMessage.fromMe === false || rawMessage.incoming === true || rawMessage.is_incoming === true) return true;
  if (rawMessage.from_me === true || rawMessage.fromMe === true || rawMessage.outgoing === true || rawMessage.is_outgoing === true) return false;
  return raw.includes('"is_bot":false') || raw.includes('"from_me":false') || raw.includes('"incoming"');
}

function isUsefulIncidentResponse(text) {
  const source = normalize(text);
  if (!source || source.length < 2) return false;
  if (/^(hola|buenas|gracias|ok|vale|si|no|\?|\.)$/.test(source)) return false;
  return /direccion|calle|avenida|av\b|numero|piso|puerta|portal|bloque|codigo postal|\bcp\b|localidad|ciudad|provincia|telefono|movil|llam|contact|recibir|recibo|entrega|entregar|repart|manana|tarde|noche|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hora|franja|agencia|confirm|correct|datos|cancel|anul|no lo quiero|no quiero|equivoc|tarjeta|efectivo|pagar|pago/.test(source);
}

function madridLocalTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(guess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)
  );
  return guess - (represented - guess);
}

function timestamp(value) {
  const source = String(value || '').trim();
  const unzoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(source);
  const time = unzoned ? madridLocalTimestamp(source) : source ? new Date(source).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

export function messagesAfterCurrentIncident(messages = [], incidentAt = null) {
  const incidentMs = timestamp(incidentAt);
  if (incidentMs === null) return [];
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({ message, at: messageDate(message), text: messageText(message) }))
    .filter((entry) => entry.at && timestamp(entry.at) > incidentMs)
    .sort((left, right) => timestamp(left.at) - timestamp(right.at));
}

export function evaluateIncidentResponseWait({
  orderId = '',
  incidenceId = '',
  incidentType = '',
  reason = '',
  observation = '',
  incidentAt = null,
  messages = [],
  chatbyReadVerified = false,
  currentIncidentVerified = false,
  dropeaStillPending = true,
  dropeaStatus = '',
  checks = 0,
  timeoutHours = DEFAULT_INCIDENT_RESPONSE_TIMEOUT_HOURS,
  now = Date.now()
} = {}) {
  const type = normalize(incidentType);
  const reasonText = normalize(`${reason} ${observation}`);
  const applies = type === 'absent'
    || type === 'address'
    || /ausente|no responde|sin respuesta|faltan datos|falta de datos|direccion incompleta|direccion incorrecta|no contesta|imposibilidad de contacto|informacion insuficiente/.test(reasonText);
  const incidentMs = timestamp(incidentAt);
  const timeout = Number.isFinite(Number(timeoutHours)) && Number(timeoutHours) > 0
    ? Number(timeoutHours)
    : DEFAULT_INCIDENT_RESPONSE_TIMEOUT_HOURS;
  const deadlineMs = incidentMs === null ? null : incidentMs + (timeout * 3600000);
  const elapsedHours = incidentMs === null ? null : Math.max(0, (Number(now) - incidentMs) / 3600000);
  const remainingHours = deadlineMs === null ? null : Math.max(0, (deadlineMs - Number(now)) / 3600000);
  const postIncident = messagesAfterCurrentIncident(messages, incidentAt);
  const inbound = postIncident.filter((entry) => isInboundCustomerMessage(entry.message));
  const valid = inbound.filter((entry) => isUsefulIncidentResponse(entry.text));
  const latestInbound = inbound[inbound.length - 1] || null;
  const latestValid = valid[valid.length - 1] || null;
  const expired = deadlineMs !== null && Number(now) >= deadlineMs;
  const finalVerificationReady = chatbyReadVerified === true
    && currentIncidentVerified === true
    && dropeaStillPending === true;

  let pendingDecision = 'WAIT_FOR_CUSTOMER';
  let verificationStatus = 'waiting';
  if (!applies) pendingDecision = 'NOT_APPLICABLE';
  else if (latestValid) pendingDecision = 'PROCESS_CUSTOMER_RESPONSE';
  else if (!chatbyReadVerified) {
    pendingDecision = 'MANUAL_REVIEW';
    verificationStatus = 'chatby_unverified';
  } else if (expired && !finalVerificationReady) {
    pendingDecision = 'MANUAL_REVIEW';
    verificationStatus = currentIncidentVerified !== true
      ? 'current_incident_unverified'
      : dropeaStillPending !== true ? 'dropea_not_pending' : 'final_check_failed';
  } else if (expired) {
    pendingDecision = 'RETURN_TO_ORIGIN_TRAINING';
    verificationStatus = 'final_check_ready_training_only';
  }

  return {
    applies,
    state: applies ? INCIDENT_RESPONSE_WAIT_STATE : null,
    orderId: String(orderId || ''),
    incidenceId: String(incidenceId || ''),
    incidentType: incidentType || '',
    reason: reason || '',
    observation: observation || '',
    incidentAt: incidentMs === null ? null : new Date(incidentMs).toISOString(),
    deadlineAt: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
    timeoutHours: timeout,
    elapsedHours,
    remainingHours,
    expired,
    validResponse: Boolean(latestValid),
    latestInboundMessage: latestInbound?.text || '',
    latestInboundAt: latestInbound?.at || null,
    latestValidMessage: latestValid?.text || '',
    latestValidAt: latestValid?.at || null,
    postIncidentInboundCount: inbound.length,
    dropeaStatus: dropeaStatus || '',
    dropeaStillPending: dropeaStillPending === true,
    pendingDecision,
    checks: Math.max(0, Number(checks || 0)) + 1,
    finalVerificationReady,
    verificationStatus,
    trainingOnly: true,
    evidence: latestValid
      ? `Respuesta valida posterior a la incidencia: "${latestValid.text}" (${latestValid.at}).`
      : latestInbound
        ? `Existe un mensaje posterior, pero no contiene informacion util para resolver: "${latestInbound.text}" (${latestInbound.at}).`
        : `No existe mensaje entrante valido posterior a la incidencia vigente (${incidentAt || 'fecha no disponible'}).`
  };
}
