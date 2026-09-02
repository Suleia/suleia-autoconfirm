import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import {
  getDropeaOrderById,
  listDropeaOrders,
  listDropeaOrdersBasic,
  listDropeaOrdersByStatusBasic,
  listDropeaOrderStateValues,
  pickupDropeaIssueAtDepot,
  resolveDropeaIssue,
  returnDropeaIssueToOrigin
} from '../clients/dropea.mjs';
import { collectPendingDropeaV2Incidents } from '../clients/dropea-v2-incidents.mjs';
import { findSubscriberInIndexByPhone, findSubscriberInIndexForExactOrder, findSubscriberInIndexForOrder, getChatMessages, loadSubscriberIndex } from '../clients/chatby.mjs';
import { getGlsTrackingHistory } from '../clients/gls.mjs';
import { loadState, saveState } from '../storage.mjs';
import {
  claimIncidentAddressResolution,
  finishIncidentAddressResolution,
  syncAgentMemoryRuleToSupabase,
  syncIncidentsCacheToSupabase
} from '../db/supabase-store.mjs';
import { evaluateIncidentResponseWait, messagesAfterCurrentIncident } from './incident-response-wait.mjs';
import { carrierIncidentDisplay } from './incident-carrier-history.mjs';
import { processIncidentDiscountRecovery } from './incident-discount-service.mjs';
import { processIncidentNotification } from './incident-notifications.mjs';
import { incorrectAddressOperationalDecision } from './incident-address-resolution.mjs';

const config = getAppConfig();
const cachePath = path.join(config.dataDir, 'dashboard', 'incidents-cache.json');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function issueStatus(issue) {
  return String(issue?.status || issue?.state || issue?.resolution_status || '').toUpperCase();
}

function statusLooksClosed(value) {
  const status = normalize(value);
  if (!status) return false;
  return status.includes('resolved')
    || status.includes('resuelto')
    || status.includes('solucion')
    || status.includes('closed')
    || status.includes('cerrad')
    || status.includes('sent')
    || status.includes('enviad')
    || status.includes('delivered')
    || status.includes('entregad')
    || status.includes('returned')
    || status.includes('devuelt')
    || status.includes('cancel')
    || status.includes('reject')
    || status.includes('rechaz');
}

function isPendingIssue(issue) {
  const status = normalize(issueStatus(issue));
  if (!status) return true;
  if (status === 'solution_send' || status === 'solution_sent') return false;
  if (statusLooksClosed(status)) return false;
  return status.includes('pending')
    || status.includes('pendiente')
    || status.includes('open')
    || status.includes('abiert')
    || status.includes('unresolved')
    || status.includes('resolver');
}

function isTrackedIncidentReason(issue) {
  const code = String(issueReason(issue) || '').trim().toUpperCase();
  const text = normalize([
    issueReason(issue),
    issue?.description,
    issue?.observations,
    issue?.annotations,
    issue?.history,
    issue?.raw?.description,
    issue?.raw?.observations,
    issue?.raw?.annotations,
    issue?.raw?.history
  ].filter(Boolean).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
  return ['AS', 'C', 'DO', 'DI', 'FD', 'MC', 'MCC', 'NAM', 'RD', 'DIR'].includes(code)
    || text.includes('ausente')
    || text.includes('no acepta')
    || text.includes('direccion')
    || text.includes('faltan datos')
    || text.includes('telefono incorrecto');
}

function isPendingResolutionIssue(issue, order = null) {
  if (!isPendingIssue(issue)) return false;
  if (!isTrackedIncidentReason(issue)) return false;
  const issueOrderStatus = normalize(issue?.orderStatus || issue?.order_status || issue?.raw?.order_status || '');
  const orderStatus = normalize([
    order?.status,
    order?.raw?.status,
    order?.raw?.order_status,
    issueOrderStatus
  ].filter(Boolean).join(' '));

  if (!orderStatus) return true;
  if (statusLooksClosed(orderStatus)) return false;
  return orderStatus.includes('incid')
    || orderStatus.includes('issue')
    || orderStatus.includes('con incidencia')
    || orderStatus === 'incidence';
}

function numericId(value) {
  const num = Number(String(value || '').replace(/\D/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function sortRowsByOrderDesc(rows) {
  return [...rows].sort((a, b) => {
    const bIssueId = numericId(b?.issue?.id || b?.issue?.incidenceId);
    const aIssueId = numericId(a?.issue?.id || a?.issue?.incidenceId);
    if (bIssueId !== aIssueId) return bIssueId - aIssueId;
    const bOrderId = numericId(b?.order?.orderId || b?.issue?.orderId);
    const aOrderId = numericId(a?.order?.orderId || a?.issue?.orderId);
    return bOrderId - aOrderId;
  });
}

export function sortIncidentsByIncidenceDesc(incidents) {
  return [...incidents].sort((a, b) => {
    const bIssueId = numericId(b?.incidenceId);
    const aIssueId = numericId(a?.incidenceId);
    if (bIssueId !== aIssueId) return bIssueId - aIssueId;
    const bOrderId = numericId(b?.orderId);
    const aOrderId = numericId(a?.orderId);
    return bOrderId - aOrderId;
  });
}

function orderLooksLikeIncident(order) {
  const text = normalize([
    order?.status,
    order?.raw?.status,
    order?.raw?.order_status,
    order?.raw?.state,
    order?.raw?.issue_status,
    order?.raw?.incidence_status
  ].filter(Boolean).join(' '));
  return text.includes('incid')
    || text.includes('issue')
    || text.includes('con incidencia')
    || text.includes('incidence');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function incidentStatusCandidates(discoveredStatuses = []) {
  const discovered = Array.isArray(discoveredStatuses) ? discoveredStatuses : [];
  return unique(discovered.filter((status) => {
    const text = normalize(status);
    return text.includes('incid')
      || text.includes('issue')
      || text.includes('problem')
      || text.includes('resolver')
      || text.includes('unresolved');
  }));
}

function issueReason(issue) {
  return issue?.incidence_code
    || issue?.incidenceCode
    || issue?.code
    || issue?.reason
    || issue?.type
    || issue?.name
    || 'Incidencia pendiente';
}

const INCIDENT_TYPES = {
  absent: { type: 'absent', label: 'Ausente', tone: 'warning' },
  rejectedGoods: { type: 'rejected_goods', label: 'No acepta mercancía', tone: 'danger' },
  address: { type: 'address', label: 'Dirección incorrecta o faltan datos', tone: 'warning' },
  unknown: { type: 'unknown', label: 'Incidencia pendiente', tone: 'neutral' }
};

export function classifyIncident(issue, order) {
  const rawReason = issue ? issueReason(issue) : 'Pedido con incidencia';
  const code = String(rawReason || '').trim().toUpperCase();
  const text = normalize([
    rawReason,
    issue?.title,
    issue?.description,
    issue?.observations,
    issue?.annotations,
    issue?.history,
    issue?.incidence,
    issue?.incidence_type,
    issue?.incidenceType,
    issue?.category,
    order?.raw?.incidence,
    order?.raw?.incidence_type,
    order?.raw?.issues?.incidence_code,
    order?.raw?.issues?.reason
  ].filter(Boolean).join(' '));

  if (code === 'AS' || text.includes('ausente') || text.includes('no habia nadie') || text.includes('no había nadie')) {
    return { ...INCIDENT_TYPES.absent, code, rawReason };
  }
  if (code === 'NAM' || text.includes('no acepta') || text.includes('rechaza mercancia') || text.includes('rechaza mercancía')) {
    return { ...INCIDENT_TYPES.rejectedGoods, code, rawReason };
  }
  if (
    code === 'MCC'
    || code === 'FD'
    || code === 'DIR'
    || code === 'DI'
    || text.includes('direccion')
    || text.includes('dirección')
    || text.includes('faltan datos')
    || text.includes('datos incompletos')
    || text.includes('telefono incorrecto')
    || text.includes('codigo postal')
    || text.includes('cp')
  ) {
    return { ...INCIDENT_TYPES.address, code, rawReason };
  }

  return { ...INCIDENT_TYPES.unknown, code, rawReason };
}

function legacyTypeAwareIncidentSolution(classification, chatby) {
  const intent = chatby.intent || '';
  const responded = Number(chatby.customerMessages || 0) > 0;
  const last = chatby.lastCustomerMessage ? ` Último mensaje: "${clip(chatby.lastCustomerMessage, 120)}".` : '';

  if (intent === 'reject_or_cancel') {
    return {
      action: 'Rechazar/cancelar incidencia',
      tone: 'danger',
      solution: `El cliente muestra rechazo o cancelación.${last} Propuesta: rechazar/cancelar en Dropea y registrar el motivo.`
    };
  }
  if (intent === 'delivery_instruction' || intent === 'reprogram_delivery') {
    return {
      action: 'Resolver con instrucción de entrega',
      tone: 'positive',
      solution: `El cliente ha dado una instrucción útil.${last} Propuesta: resolver en Dropea trasladando literalmente la franja, teléfono o comentario del cliente.`
    };
  }
  if (intent === 'address_data') {
    return {
      action: 'Actualizar datos de entrega',
      tone: 'positive',
      solution: `El cliente ha enviado o mencionado datos de dirección.${last} Propuesta: actualizar Dropea si están completos; si falta algo, pedir el dato exacto por Chatby.`
    };
  }

  if (classification.type === 'address') {
    return responded
      ? {
          action: 'Revisar datos recibidos',
          tone: 'warning',
          solution: 'Hay respuesta del cliente, pero no veo datos completos. Propuesta: revisar conversación y pedir solo el dato que falta antes de resolver.'
        }
      : {
          action: 'Pedir dirección completa',
          tone: 'warning',
          solution: 'Incidencia de dirección sin respuesta del cliente. Propuesta: pedir calle, número, piso/puerta, CP y ciudad por Chatby.'
        };
  }

  if (classification.type === 'rejected_goods') {
    return responded
      ? {
          action: 'Validar rechazo del cliente',
          tone: 'danger',
          solution: 'Incidencia de no aceptación con respuesta. Propuesta: confirmar si el cliente rechaza definitivamente; si sí, rechazar en Dropea.'
        }
      : {
          action: 'Confirmar si desea recibirlo',
          tone: 'danger',
          solution: 'Incidencia de no aceptación sin respuesta clara. Propuesta: preguntar si desea recibirlo o cancelar, sin insistir con mensajes repetidos.'
        };
  }

  if (classification.type === 'absent') {
    return responded
      ? {
          action: 'Coordinar nueva entrega',
          tone: 'positive',
          solution: 'Incidencia por ausente con respuesta. Propuesta: extraer franja/fecha/teléfono y resolver en Dropea con esa instrucción.'
        }
      : {
          action: 'Solicitar nueva entrega',
          tone: 'warning',
          solution: 'Incidencia por ausente sin respuesta. Propuesta: enviar plantilla de coordinación de entrega y esperar instrucción del cliente.'
        };
  }

  return responded
    ? {
        action: 'Revisión con respuesta',
        tone: 'warning',
        solution: 'Hay respuesta del cliente, pero la tipología no está clara. Propuesta: revisar manualmente y dar feedback al agente.'
      }
    : {
        action: 'Revisión manual',
        tone: 'neutral',
        solution: chatby.proposedSolution || 'Sin señal suficiente. Propuesta: revisar Dropea y Chatby antes de resolver.'
      };
}

function incidentAgeHours(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function rawCustomerTextForDisplay(chatby) {
  return String(chatby.rawCustomerText || chatby.lastCustomerMessage || '').replace(/\s+/g, ' ').trim();
}

function extractOperationalDetailsFromText(rawText = '') {
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  const text = normalize(raw);
  const details = {
    hasAddressData: false,
    addressSummary: '',
    deliveryInstruction: '',
    wantsCancel: false,
    wantsReceive: false,
    courierIssue: false,
    phoneMentioned: '',
    deliveryTomorrow: false,
    deliveryMorning: false,
    deliveryAfternoon: false,
    deliveryBeforeTime: '',
    deliveryAfterTime: '',
    deliveryDay: '',
    deliveryDateLabel: '',
    paymentMethod: '',
    paymentQuestion: false,
    customerIntentDetail: ''
  };

  const phoneMatch = raw.match(/(?:\+34\s*)?[67]\d(?:[\s.-]?\d){7}/);
  if (phoneMatch) details.phoneMentioned = phoneMatch[0].trim();

  const hasAddressKeyword = /direccion|calle|avenida|av\.?|numero|portal|piso|puerta|codigo postal|cp|ciudad|localidad|bloque|escalera/.test(text);
  if (hasAddressKeyword) {
    details.hasAddressData = true;
    details.addressSummary = clip(raw, 180);
  }

  const instructionParts = [];
  const hourMatches = [...raw.matchAll(/\b(?:a partir de las|desde las|sobre las|despues de las|antes de las)?\s*([01]?\d|2[0-3])[:.]?([0-5]\d)?\s*(?:h|horas)?\b/gi)]
    .map((match) => match[0].trim())
    .filter((item) => /\d/.test(item));
  if (hourMatches.length) instructionParts.push(`horario indicado: ${unique(hourMatches).slice(0, 2).join(', ')}`);
  const beforeMatch = text.match(/antes de las\s*([01]?\d|2[0-3])(?::([0-5]\d))?/);
  const afterMatch = text.match(/(?:a partir de las|desde las|despues de las)\s*([01]?\d|2[0-3])(?::([0-5]\d))?/);
  if (beforeMatch) details.deliveryBeforeTime = `${beforeMatch[1].padStart(2, '0')}:${beforeMatch[2] || '00'}`;
  if (afterMatch) details.deliveryAfterTime = `${afterMatch[1].padStart(2, '0')}:${afterMatch[2] || '00'}`;
  details.deliveryTomorrow = /\bmanana\b/.test(text) && !/(?:por|durante) la manana/.test(text);
  details.deliveryMorning = /(?:por|durante) la manana/.test(text);
  details.deliveryAfternoon = text.includes('tarde');
  if (details.deliveryTomorrow) instructionParts.push('entregar manana');
  if (details.deliveryAfternoon) instructionParts.push('entregar por la tarde');
  if (details.deliveryMorning) instructionParts.push('entregar por la manana');
  if (text.includes('mediodia') || text.includes('medio dia')) instructionParts.push('entregar al mediodia');
  if (text.includes('noche')) instructionParts.push('entregar por la noche');
  const dayHits = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].filter((day) => text.includes(day));
  if (dayHits.length) {
    details.deliveryDay = dayHits[0];
    instructionParts.push(`dia indicado: ${unique(dayHits).join(', ')}`);
  }
  const monthNames = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
  const explicitDate = text.match(new RegExp(`(?:el\\s+)?([0-3]?\\d)\\s+de\\s+(${monthNames})\\b`));
  if (explicitDate) {
    details.deliveryDateLabel = `${Number(explicitDate[1])} de ${explicitDate[2]}`;
    instructionParts.push(`fecha indicada: ${details.deliveryDateLabel}`);
  }
  if (/otro dia|reprogram|nueva entrega|volver a pasar|que pasen|entregar/.test(text)) instructionParts.push('pide nueva entrega');
  if (details.phoneMentioned || /llamar|telefono|telf|movil/.test(text)) {
    instructionParts.push(details.phoneMentioned ? `llamar al ${details.phoneMentioned}` : 'pide llamada telefonica');
  }
  details.deliveryInstruction = unique(instructionParts).join(' | ');

  details.wantsCancel = /no lo quiero|no quiero|cancel|anul|rechaz|no acepta|no acepto|no me interesa|devolver|no voy a recibir/.test(text);
  details.wantsReceive = /si lo quiero|quiero recibir|lo quiero|entregar|que lo traigan|que vuelvan|volver a pasar|confirmo|correcto|ok|vale/.test(text) && !details.wantsCancel;
  details.courierIssue = /no ha pasado|no paso|repartidor|mensajero|nadie vino|no llamaron|no me llamaron|estaba en casa/.test(text);
  details.paymentQuestion = /(?:puedo|podria|se puede|aceptan|pagar|pago).{0,35}(?:tarjeta|efectivo)|(?:tarjeta|efectivo).{0,35}(?:pagar|pago)/.test(text);
  if (text.includes('tarjeta')) details.paymentMethod = 'tarjeta';
  else if (text.includes('efectivo')) details.paymentMethod = 'efectivo';

  if (details.wantsCancel) details.customerIntentDetail = 'El cliente parece rechazar o cancelar el pedido.';
  else if (details.paymentQuestion && details.paymentMethod) details.customerIntentDetail = `El cliente mantiene interes y pregunta por pagar con ${details.paymentMethod}.`;
  else if (details.deliveryInstruction) details.customerIntentDetail = `El cliente da instrucciones de entrega: ${details.deliveryInstruction}.`;
  else if (details.hasAddressData) details.customerIntentDetail = 'El cliente aporta o menciona datos de direccion.';
  else if (details.wantsReceive) details.customerIntentDetail = 'El cliente parece querer recibir el pedido.';
  else if (raw) details.customerIntentDetail = 'Hay respuesta del cliente, pero necesita lectura manual del contexto.';
  else details.customerIntentDetail = 'No hay respuesta entrante del cliente.';

  return details;
}

function detectSentTemplates(messages = [], allText = '') {
  const source = normalize([
    allText,
    ...messages.map((message) => `${messageText(message)} ${JSON.stringify(message || {})}`)
  ].join(' | '));
  const directionMessage = [...orderedMessagesChronologically(messages)].reverse().find((message) => (
    normalize(`${messageText(message)} ${JSON.stringify(message || {})}`).includes('dropea_incidencia_direccion_v1')
  ));
  return {
    directionReminderSent: source.includes('dropea_incidencia_direccion_v1'),
    directionReminderSentAt: directionMessage ? messageDate(directionMessage) : null,
    absentReminderSent: source.includes('dropea_incidencia_ausente') || source.includes('suleia_incidencia_ausente'),
    discountReminderSent: source.includes('descuento') || source.includes('discount') || source.includes('5 eur') || source.includes('5€'),
    pendingOrderReminderSent: source.includes('dropea_pedido_pendiente') || source.includes('pendiente de confirmacion')
  };
}

function recommendationPayload({ action, tone, solution, stage, instruction = '', template = '', intentDetail = '', trainingOnly = false, automationReady = true, responseWait = null }) {
  return {
    action,
    tone,
    solution,
    resolutionStage: stage,
    operationalInstruction: instruction,
    templateRecommendation: template,
    templateName: template,
    customerIntentDetail: intentDetail,
    trainingOnly,
    automationReady,
    responseWait
  };
}

function responseWaitRecommendation(responseWait, { template = '', reminderPending = false } = {}) {
  if (!responseWait?.applies) return null;
  const deadline = responseWait.deadlineAt || 'fecha no disponible';
  const remaining = Number.isFinite(responseWait.remainingHours)
    ? `${Math.ceil(responseWait.remainingHours)}h restantes`
    : 'tiempo restante no disponible';

  if (responseWait.pendingDecision === 'PROCESS_CUSTOMER_RESPONSE') {
    return recommendationPayload({
      action: 'Interpretar respuesta del cliente',
      tone: 'positive',
      stage: 'Respuesta valida posterior a la incidencia',
      intentDetail: responseWait.latestValidMessage || '',
      trainingOnly: true,
      responseWait,
      instruction: 'Entrenamiento: analizar la respuesta posterior a la incidencia vigente y proponer una solucion adaptada. No ejecutar acciones reales.',
      solution: `El cliente ha respondido despues de la incidencia vigente: "${clip(responseWait.latestValidMessage, 160)}". Propuesta: interpretar el contexto y preparar la resolucion; no ejecutar.`
    });
  }

  if (responseWait.pendingDecision === 'MANUAL_REVIEW') {
    return recommendationPayload({
      action: 'Revision manual obligatoria',
      tone: 'danger',
      stage: 'Verificacion final incompleta',
      trainingOnly: true,
      automationReady: false,
      responseWait,
      instruction: 'No proponer ni ejecutar devolucion: falta una lectura final fiable de Chatby, de la incidencia vigente o del estado pendiente en Dropea.',
      solution: `Comprobacion cerrada por seguridad. ${responseWait.evidence} Estado de verificacion: ${responseWait.verificationStatus}.`
    });
  }

  if (responseWait.pendingDecision === 'RETURN_TO_ORIGIN_TRAINING') {
    return recommendationPayload({
      action: 'Devolver al origen (entrenamiento)',
      tone: 'danger',
      stage: '48h sin respuesta valida',
      trainingOnly: true,
      responseWait,
      instruction: 'Entrenamiento: registrar que se propondria Devolver al origen. No pulsar el boton ni ejecutar ninguna accion real en Dropea.',
      solution: `Han transcurrido 48h desde la incidencia vigente sin respuesta valida posterior. Verificacion final superada en lectura, pero la accion permanece bloqueada en entrenamiento. Fecha limite: ${deadline}.`
    });
  }

  return recommendationPayload({
    action: reminderPending ? 'Preparar recordatorio (entrenamiento)' : 'Esperar respuesta del cliente',
    tone: 'warning',
    stage: `Esperando cliente - ${remaining}`,
    template,
    trainingOnly: true,
    responseWait,
    instruction: reminderPending
      ? 'Entrenamiento: dejar preparado un unico recordatorio, sin enviarlo desde esta regla. Mantener la espera desde la incidencia vigente.'
      : 'No ejecutar ninguna accion. Revisar unicamente mensajes posteriores a la incidencia vigente hasta completar 48 horas.',
    solution: `Incidencia vigente en espera hasta ${deadline}. ${responseWait.evidence}`
  });
}

function typeAwareIncidentSolution(classification, chatby, issue = null, responseWait = null) {
  const intent = chatby.intent || '';
  const responded = Number(chatby.customerMessages || 0) > 0;
  const last = chatby.lastCustomerMessage ? ` Ultimo mensaje: "${clip(chatby.lastCustomerMessage, 120)}".` : '';
  const ageHours = incidentAgeHours(issue?.created_at || issue?.createdAt || issue?.date || issue?.opened_at || null);
  const ageText = Number.isFinite(ageHours) ? `${Math.round(ageHours)}h desde la incidencia` : 'antiguedad no disponible';
  const details = chatby.operationalDetails || extractOperationalDetailsFromText(rawCustomerTextForDisplay(chatby));
  const sent = chatby.sentTemplates || {};
  const intentDetail = details.customerIntentDetail || '';

  if (intent === 'reject_or_cancel') {
    return recommendationPayload({
      action: 'Devolver al origen (entrenamiento)',
      tone: 'danger',
      stage: 'Cliente rechaza',
      intentDetail,
      trainingOnly: true,
      instruction: 'No enviar ofertas, descuentos ni nuevas entregas. Proponer devolver al origen; no ejecutar durante el entrenamiento.',
      solution: `El cliente rechaza expresamente el pedido.${last} Resolucion propuesta: devolver al origen. Accion real bloqueada durante el entrenamiento.`
    });
  }
  if (details.deliveryInstruction && (classification.type === 'absent' || classification.type === 'rejected_goods' || intent === 'delivery_instruction' || intent === 'reprogram_delivery')) {
    return recommendationPayload({
      action: 'Resolver con instruccion de entrega',
      tone: 'positive',
      stage: 'Respuesta accionable',
      intentDetail,
      instruction: `Escribir en resolucion de Dropea: "${details.deliveryInstruction}". ${details.phoneMentioned ? `Telefono indicado: ${details.phoneMentioned}.` : ''}`.trim(),
      solution: `El cliente ha dado una instruccion util.${last} Propuesta: resolver en Dropea trasladando literalmente la franja, telefono o comentario del cliente.`
    });
  }
  if (details.hasAddressData && (classification.type === 'address' || intent === 'address_data')) {
    return recommendationPayload({
      action: 'Actualizar datos de entrega',
      tone: 'positive',
      stage: 'Datos recibidos',
      intentDetail,
      instruction: `Revisar y copiar datos de direccion en Dropea. Texto detectado: "${details.addressSummary || clip(rawCustomerTextForDisplay(chatby), 160)}"`,
      solution: `El cliente ha enviado o mencionado datos de direccion.${last} Propuesta: actualizar Dropea si estan completos; si falta algo, pedir solo el dato exacto.`
    });
  }

  if (classification.type === 'address') {
    if (responded) {
      return recommendationPayload({
        action: 'Revisar dato faltante',
        tone: 'warning',
        stage: 'Respuesta incompleta',
        intentDetail,
        instruction: 'Pedir solo el dato que falte: calle, numero, piso/puerta, CP, ciudad o telefono.',
        solution: 'Hay respuesta del cliente, pero no veo datos completos. Propuesta: revisar conversacion y pedir solo el dato que falta antes de resolver.'
      });
    }
    const waitRecommendation = responseWaitRecommendation(responseWait, {
      template: sent.directionReminderSent ? '' : 'es_ES - dropea_incidencia_direccion_v1',
      reminderPending: !sent.directionReminderSent
    });
    if (waitRecommendation) return waitRecommendation;
    return recommendationPayload({
      action: 'Revision manual de direccion',
      tone: 'warning',
      stage: 'Sin reloj verificable',
      intentDetail,
      trainingOnly: true,
      automationReady: false,
      instruction: 'No actuar hasta verificar la fecha de la incidencia vigente y volver a leer Chatby.',
      solution: 'No se ha podido construir de forma fiable la espera de 48h desde la incidencia vigente.'
    });
  }

  if (classification.type === 'rejected_goods') {
    if (details.wantsReceive || details.courierIssue) {
      return recommendationPayload({
        action: 'Solicitar nueva entrega',
        tone: 'positive',
        stage: 'Cliente quiere recibirlo',
        intentDetail,
        instruction: details.courierIssue
          ? 'Indicar en Dropea que el cliente afirma que el repartidor no paso o no contacto. Solicitar nuevo intento de entrega.'
          : 'Indicar en Dropea que el cliente quiere recibir el pedido y solicitar nuevo intento de entrega.',
        solution: `El cliente parece querer recibir el pedido.${last} Propuesta: resolver en Dropea solicitando nuevo intento de entrega.`
      });
    }
    if (responded) {
      return recommendationPayload({
        action: 'Validar intencion del cliente',
        tone: 'warning',
        stage: 'Respuesta ambigua',
        intentDetail,
        instruction: 'Leer conversacion completa. Si confirma rechazo, rechazar; si quiere recibirlo, pedir nuevo intento de entrega.',
        solution: 'Incidencia de no acepta mercancia con respuesta, pero no concluyente. Propuesta: revisar contexto antes de actuar.'
      });
    }
    if (Number.isFinite(ageHours) && ageHours >= 24 && !sent.discountReminderSent) {
      return recommendationPayload({
        action: 'Preparar oferta de 5 EUR',
        tone: 'warning',
        stage: '24h sin respuesta',
        template: '',
        intentDetail,
        trainingOnly: true,
        automationReady: false,
        instruction: 'Entrenamiento: preparar una unica oferta de 5 EUR. No enviar nada hasta que exista y se apruebe la plantilla correspondiente.',
        solution: `No acepta expedicion y sigue sin respuesta tras ${ageText}. Siguiente paso futuro: ofrecer 5 EUR una sola vez. La plantilla aun no existe; no ejecutar.`
      });
    }
    return recommendationPayload({
      action: sent.discountReminderSent ? 'Esperar tras descuento' : 'Esperar respuesta',
      tone: 'danger',
      stage: sent.discountReminderSent ? 'Descuento ya ofrecido' : 'Esperando cliente',
      intentDetail,
      instruction: sent.discountReminderSent
        ? 'No enviar mas descuentos. Esperar respuesta o revisar manualmente.'
        : 'Esperar hasta 24h desde la incidencia antes de ofrecer descuento.',
      solution: sent.discountReminderSent
        ? 'Ya consta aviso/descuento. Propuesta: no insistir y esperar decision del cliente.'
        : 'Incidencia de no aceptacion sin respuesta clara. Propuesta: esperar antes del primer incentivo.'
    });
  }

  if (classification.type === 'absent') {
    if (responded) {
      return recommendationPayload({
        action: 'Coordinar nueva entrega',
        tone: details.deliveryInstruction ? 'positive' : 'warning',
        stage: details.deliveryInstruction ? 'Instruccion clara' : 'Respuesta a interpretar',
        intentDetail,
        instruction: details.deliveryInstruction
          ? `Escribir en Dropea: "${details.deliveryInstruction}".`
          : 'Leer si indica dia, franja, tarde/manana, telefono o nueva entrega. Si falta concrecion, pedirla.',
        solution: details.deliveryInstruction
          ? 'Incidencia por ausente con instruccion clara. Propuesta: resolver en Dropea copiando la instruccion del cliente.'
          : 'Incidencia por ausente con respuesta. Propuesta: interpretar la franja/fecha o pedir concrecion antes de resolver.'
      });
    }
    const reminderPending = Number.isFinite(responseWait?.elapsedHours)
      && responseWait.elapsedHours >= 24
      && !sent.absentReminderSent;
    const waitRecommendation = responseWaitRecommendation(responseWait, {
      template: reminderPending ? 'suleia_incidencia_ausente_v2' : '',
      reminderPending
    });
    if (waitRecommendation) return waitRecommendation;
    return recommendationPayload({
      action: 'Revision manual de ausencia',
      tone: 'warning',
      stage: 'Sin reloj verificable',
      intentDetail,
      trainingOnly: true,
      automationReady: false,
      instruction: 'No actuar hasta verificar la fecha de la incidencia vigente y volver a leer Chatby.',
      solution: 'No se ha podido construir de forma fiable la espera de 48h desde la incidencia vigente.'
    });
  }

  const genericResponseWait = responseWaitRecommendation(responseWait);
  if (genericResponseWait) return genericResponseWait;

  return responded
    ? recommendationPayload({
        action: 'Revision con respuesta',
        tone: 'warning',
        stage: 'Tipologia no clasificada',
        intentDetail,
        instruction: 'Revisar manualmente y usar feedback para entrenar al agente.',
        solution: 'Hay respuesta del cliente, pero la tipologia no esta clara. Propuesta: revisar manualmente y dar feedback al agente.'
      })
    : recommendationPayload({
        action: 'Revision manual',
        tone: 'neutral',
        stage: 'Sin senal suficiente',
        intentDetail,
        instruction: 'Revisar Dropea y Chatby antes de resolver.',
        solution: chatby.proposedSolution || 'Sin senal suficiente. Propuesta: revisar Dropea y Chatby antes de resolver.'
      });
}

function phoneLast9(value) {
  return digits(value).slice(-9);
}

function ageHoursAt(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Number(now) - timestamp) / 3600000);
}

function conciseDeliverySolution(details, phone) {
  // The order phone is the authoritative contact; use a number mentioned in chat only as fallback.
  const contact = phoneLast9(phone || details.phoneMentioned);
  let instruction = '';
  if (details.deliveryDateLabel) instruction = `Entregar el ${details.deliveryDateLabel}.`;
  else if (details.deliveryTomorrow && details.deliveryAfternoon) instruction = 'Realizar nueva entrega manana por la tarde.';
  else if (details.deliveryTomorrow) instruction = 'Realizar nueva entrega manana.';
  else if (details.deliveryBeforeTime) instruction = `Ultimo intento antes de las ${details.deliveryBeforeTime}.`;
  else if (details.deliveryAfterTime) instruction = `Realizar nueva entrega a partir de las ${details.deliveryAfterTime}.`;
  else if (details.deliveryDay) instruction = `Realizar nueva entrega el ${details.deliveryDay}.`;
  else if (details.deliveryAfternoon) instruction = 'Realizar nueva entrega por la tarde.';
  else if (details.deliveryMorning) instruction = 'Realizar nueva entrega por la manana.';
  if (!instruction) return '';

  const withPhone = contact
    ? details.deliveryDateLabel
      ? `${instruction} Contactar previamente con el ${contact}.`
      : `${instruction} Llamar antes al ${contact}.`
    : instruction;
  if (withPhone.length <= 80) return withPhone;
  const shorter = contact ? `${instruction} Llamar ${contact}.` : instruction;
  return shorter.length <= 80 ? shorter : shorter.slice(0, 80).trim();
}

export function incidentOperationalDecision({
  classification,
  chatby = {},
  transportHistory = [],
  phone = '',
  incidentDate = null,
  now = Date.now()
} = {}) {
  const transportText = normalize((Array.isArray(transportHistory) ? transportHistory : [])
    .map((event) => event?.text || '')
    .join(' | '));
  // Operational actions must be grounded in the latest inbound customer message.
  // Older buttons/templates remain useful context, but cannot trigger a new delivery action.
  const customerText = String(chatby.lastCustomerMessage || '').replace(/\s+/g, ' ').trim();
  const normalizedCustomerText = normalize(customerText);
  const details = extractOperationalDetailsFromText(customerText);
  const customerResponded = Number(chatby.customerMessages || 0) > 0;
  const ageHours = ageHoursAt(incidentDate, now);
  const discountExchange = findDiscountRecoveryExchange(chatby.messagesForNotification, incidentDate);

  if (/pasaran a recoger en agencia|pasara a recoger en agencia|recoger en agencia|recogida en agencia/.test(transportText)) {
    return {
      eligible: true,
      action: 'pickup_at_depot',
      text: '',
      confidence: 99,
      ruleId: 'core_incident_pickup_at_depot',
      reason: 'El historial de Dropea indica expresamente que el cliente recogera en agencia.'
    };
  }

  if (
    classification?.type === 'rejected_goods'
    && /no tiene dinero|sin dinero|no dispone de dinero|no llevaba dinero/.test(transportText)
    && Number.isFinite(ageHours)
    && ageHours >= 72
    && !customerResponded
  ) {
    return {
      eligible: true,
      action: 'return_to_origin',
      text: '',
      confidence: 98,
      ruleId: 'core_incident_return_after_rejection_72h',
      reason: `Rechazo por falta de dinero, ${Math.floor(ageHours)}h sin respuesta posterior del cliente.`
    };
  }

  if (
    classification?.type === 'rejected_goods'
    && customerResponded
    && chatby.chatbyReadVerified === true
    && discountExchange.offerVerified
    && discountExchange.latestReplyRejectsOffer
  ) {
    return {
      eligible: true,
      action: 'return_to_origin',
      text: '',
      confidence: 99,
      ruleId: 'core_incident_discount_rejected_return',
      reason: 'El cliente rechazo expresamente la oferta autorizada de 5 EUR enviada despues de abrirse la incidencia.'
    };
  }

  if (
    classification?.type === 'rejected_goods'
    && customerResponded
    && chatby.chatbyReadVerified === true
    && discountExchange.offerVerified
    && discountExchange.latestReplyAcceptsOffer
  ) {
    return {
      eligible: false,
      action: 'none',
      text: '',
      confidence: 96,
      ruleId: 'core_incident_discount_accepted_requires_price_update',
      reason: 'El cliente acepta el descuento de 5 EUR. Mantener activo y actualizar el importe antes de solicitar una nueva entrega.'
    };
  }

  if (!customerResponded || chatby.chatbyReadVerified !== true || details.wantsCancel) {
    return {
      eligible: false,
      action: 'none',
      text: '',
      confidence: details.wantsCancel && customerResponded && chatby.chatbyReadVerified === true ? 99 : 0,
      ruleId: details.wantsCancel && customerResponded && chatby.chatbyReadVerified === true
        ? 'core_incident_explicit_rejection_training'
        : null,
      trainingOnly: details.wantsCancel === true,
      reason: details.wantsCancel
        ? `El cliente expresa un rechazo inequivoco: "${clip(customerText, 140)}". No ofrecer descuento ni nueva entrega; proponer devolver al origen en entrenamiento.`
        : 'No hay una respuesta de cliente verificada y accionable.'
    };
  }

  if (details.paymentQuestion && details.paymentMethod && !details.wantsCancel) {
    const contact = phoneLast9(details.phoneMentioned || phone);
    const base = `Realizar entrega para pago con ${details.paymentMethod}.`;
    const text = contact ? `${base} Llamar al telefono ${contact}.` : base;
    return {
      eligible: true,
      action: 'accept_solution',
      text: text.length <= 80 ? text : `${base} Llamar al ${contact}.`,
      confidence: 96,
      ruleId: 'core_incident_payment_method_delivery',
      reason: `El cliente pregunta por pago con ${details.paymentMethod} y mantiene la intencion de recibir el pedido.`
    };
  }

  const deliveryText = conciseDeliverySolution(details, phone);
  if (deliveryText && (classification?.type === 'absent' || classification?.type === 'rejected_goods')) {
    const confirmedSlot = details.deliveryAfternoon || details.deliveryMorning;
    return {
      eligible: true,
      action: 'accept_solution',
      text: deliveryText,
      confidence: confirmedSlot ? 99 : details.deliveryBeforeTime || details.deliveryAfterTime || details.deliveryTomorrow || details.deliveryDay ? 97 : 93,
      ruleId: confirmedSlot
        ? 'core_incident_confirmed_delivery_slot_accept'
        : 'core_incident_exact_availability_accept',
      trainingOnly: Boolean(details.deliveryDateLabel),
      reason: `El cliente comunica una disponibilidad concreta: ${clip(normalizedCustomerText, 140)}.`
    };
  }

  return {
    eligible: false,
    action: 'none',
    text: '',
    confidence: 0,
    ruleId: null,
    reason: 'La conversacion necesita revision humana antes de actuar en Dropea.'
  };
}

function recommendationWithOperationalDecision(recommendation, decision) {
  if (!decision?.eligible || decision.action === 'none') return recommendation;
  const labels = {
    accept_solution: 'Aceptar solucion',
    pickup_at_depot: 'Recoger en agencia',
    return_to_origin: 'Devolver al origen'
  };
  const action = labels[decision.action] || 'Revision manual';
  const instruction = decision.text || action;
  return {
    ...recommendation,
    action,
    tone: decision.action === 'return_to_origin' ? 'danger' : 'positive',
    solution: decision.reason,
    resolutionStage: 'Decision operativa de alta confianza',
    operationalInstruction: instruction,
    customerIntentDetail: decision.reason
  };
}

function issueList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  return [value];
}

function incidentActionLedgerEntry(incidenceId) {
  return loadState().incidentActionLedger?.[String(incidenceId || '')] || null;
}

function rememberIncidentAction(incident, decision, patch = {}) {
  const state = { ...loadState() };
  const ledger = { ...(state.incidentActionLedger || {}) };
  const key = String(incident.incidenceId || '');
  const previous = ledger[key] || {};
  const now = new Date().toISOString();
  ledger[key] = {
    ...previous,
    incidenceId: key,
    orderId: String(incident.orderId || ''),
    action: decision.action,
    text: decision.text || '',
    ruleId: decision.ruleId || null,
    confidence: decision.confidence || 0,
    reason: decision.reason || '',
    status: patch.status || previous.status || 'attempted',
    attemptedAt: patch.attemptedAt || previous.attemptedAt || now,
    completedAt: patch.completedAt || previous.completedAt || null,
    verifiedAt: patch.verifiedAt || previous.verifiedAt || null,
    error: patch.error ?? previous.error ?? null,
    response: patch.response ?? previous.response ?? null,
    updatedAt: now
  };
  state.incidentActionLedger = Object.fromEntries(Object.entries(ledger)
    .sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
    .slice(0, 2500));
  saveState(state);
  return ledger[key];
}

async function verifyIncidentLeftPending(incident, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    const order = await getDropeaOrderById(incident.orderId).catch(() => null);
    if (!order) continue;
    const issue = issueList(order?.raw?.issues).find((item) => String(item?.id || '') === String(incident.incidenceId));
    if (!issue || !isPendingIssue(issue)) {
      return { verified: true, issueStatus: issue ? issueStatus(issue) : 'NOT_PENDING' };
    }
  }
  return { verified: false, issueStatus: 'PENDING' };
}

async function auditIncidentAction(incident, decision, result) {
  const timestamp = result.verifiedAt || result.completedAt || result.attemptedAt || new Date().toISOString();
  await syncAgentMemoryRuleToSupabase({
    id: `incident_action_${incident.incidenceId}_${decision.action}`,
    type: 'incident_action_audit',
    source: 'suleia_incident_agent',
    incidenceId: incident.incidenceId,
    orderId: incident.orderId,
    text: `${decision.action}: ${result.status}. ${decision.reason}`,
    createdAt: timestamp,
    raw: { incident, decision, result }
  }).catch((error) => {
    console.error('Supabase incident action audit error:', error instanceof Error ? error.message : String(error));
  });
}

async function executeIncidentOperationalDecision(incident, decision) {
  if (!decision?.eligible || decision.action === 'none') {
    return { status: 'not_applicable', verified: false, reason: decision?.reason || 'Sin accion automatica.' };
  }
  if (decision.trainingOnly === true) {
    return { status: 'would_execute', verified: false, reason: 'Regla nueva guardada exclusivamente para entrenamiento; ejecucion real bloqueada.' };
  }
  if (!config.defaultStore.incidentResolutionRealEnabled) {
    return { status: 'would_execute', verified: false, reason: 'Resolucion real desactivada por configuracion.' };
  }
  if (!incident.incidenceId || !incident.orderId) {
    return { status: 'blocked_missing_identifiers', verified: false, reason: 'Falta ID de incidencia o pedido.' };
  }

  const previous = incidentActionLedgerEntry(incident.incidenceId);
  if (previous && ['verified', 'applied_unverified'].includes(previous.status)) {
    return {
      ...previous,
      status: previous.status === 'verified' ? 'already_verified' : previous.status,
      verified: previous.status === 'verified'
    };
  }

  const attemptedAt = new Date().toISOString();
  rememberIncidentAction(incident, decision, { status: 'attempted', attemptedAt, error: null });
  try {
    let response;
    if (decision.action === 'accept_solution') response = await resolveDropeaIssue(incident.incidenceId, decision.text);
    else if (decision.action === 'pickup_at_depot') response = await pickupDropeaIssueAtDepot(incident.incidenceId);
    else if (decision.action === 'return_to_origin') response = await returnDropeaIssueToOrigin(incident.incidenceId);
    else throw new Error(`Accion de incidencia no soportada: ${decision.action}`);

    const completedAt = new Date().toISOString();
    const verification = await verifyIncidentLeftPending(incident);
    const status = verification.verified ? 'verified' : 'applied_unverified';
    const result = rememberIncidentAction(incident, decision, {
      status,
      completedAt,
      verifiedAt: verification.verified ? new Date().toISOString() : null,
      response,
      error: verification.verified ? null : `Dropea acepto la accion, pero la incidencia sigue ${verification.issueStatus}.`
    });
    await auditIncidentAction(incident, decision, result);
    return { ...result, verified: verification.verified };
  } catch (error) {
    const missingCredential = error?.code === 'DROPEA_ACCESS_TOKEN_MISSING';
    const result = rememberIncidentAction(incident, decision, {
      status: missingCredential ? 'blocked_missing_credential' : 'failed',
      error: error instanceof Error ? error.message : String(error)
    });
    await auditIncidentAction(incident, decision, result);
    return { ...result, verified: false };
  }
}

async function currentPendingIncident(incidenceId, orderId) {
  const rows = await collectPendingDropeaV2Incidents({ limit: 100, pages: 3 });
  return rows.find(({ issue, order }) => (
    String(issue?.id || issue?.incidenceId || '') === String(incidenceId || '')
    && String(order?.orderId || issue?.orderId || '') === String(orderId || '')
  )) || null;
}

function safeIncidentActionError(error) {
  const code = String(error?.code || '').trim();
  if (code) return code.slice(0, 120);
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  const match = message.match(/\b(?:DROPEA|CHATBY|SUPABASE)_[A-Z0-9_]+\b/);
  return match?.[0] || 'INCIDENT_ADDRESS_RESOLUTION_FAILED';
}

async function verifyAddressIncidentLeftPending(incidenceId, orderId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    const current = await currentPendingIncident(incidenceId, orderId);
    if (!current) return true;
  }
  return false;
}

async function auditAddressIncidentAction(incident, decision, result) {
  const timestamp = result.verifiedAt || result.completedAt || result.attemptedAt || new Date().toISOString();
  await syncAgentMemoryRuleToSupabase({
    id: `incident_address_action_${incident.incidenceId}`,
    type: 'incident_address_action_audit',
    source: 'suleia_incident_agent',
    incidenceId: incident.incidenceId,
    orderId: incident.orderId,
    text: `${decision.ruleId}: ${result.status}`,
    createdAt: timestamp,
    raw: {
      incidenceId: incident.incidenceId,
      orderId: incident.orderId,
      ruleId: decision.ruleId,
      status: result.status,
      attemptedAt: result.attemptedAt || null,
      completedAt: result.completedAt || null,
      verifiedAt: result.verifiedAt || null
    }
  }).catch(() => null);
}

export async function executeIncorrectAddressResolution(incident, analyzedDecision, dependencies = {}) {
  const readCurrent = dependencies.readCurrent || currentPendingIncident;
  const readMessages = dependencies.readMessages || getChatMessages;
  const claimResolution = dependencies.claimResolution || claimIncidentAddressResolution;
  const resolveIssue = dependencies.resolveIssue || resolveDropeaIssue;
  const verifyResolution = dependencies.verifyResolution || verifyAddressIncidentLeftPending;
  const finishResolution = dependencies.finishResolution || finishIncidentAddressResolution;
  const auditResolution = dependencies.auditResolution || auditAddressIncidentAction;
  const realEnabled = dependencies.realEnabled ?? config.defaultStore.incidentAddressResolutionRealEnabled;
  const manualStatus = analyzedDecision?.status || 'MANUAL_REVIEW';
  if (!analyzedDecision?.eligible || analyzedDecision.ruleId !== 'core_incident_incorrect_address_customer_solution') {
    return { status: manualStatus, verified: false, reason: analyzedDecision?.reason || 'Revision manual.' };
  }
  if (realEnabled !== true) {
    return { status: 'WOULD_RESOLVE_ADDRESS', verified: false, reason: 'Resolucion real de direccion desactivada.' };
  }
  if (!incident.incidenceId || !incident.orderId || !incident.chatbyUserNs) {
    return { status: 'MANUAL_REVIEW_MISSING_IDENTIFIERS', verified: false, reason: 'Faltan identificadores verificables.' };
  }

  let current;
  try {
    current = await readCurrent(incident.incidenceId, incident.orderId);
  } catch (error) {
    return { status: 'MANUAL_REVIEW_DROPEA_UNVERIFIED', verified: false, reason: safeIncidentActionError(error) };
  }
  if (!current) {
    return { status: 'ALREADY_RESOLVED', verified: true, reason: 'La incidencia ya no esta pendiente en Dropea.' };
  }
  const currentClassification = classifyIncident(current.issue, current.order);
  if (currentClassification.type !== 'address' || !isPendingIssue(current.issue)) {
    return { status: 'MANUAL_REVIEW_DROPEA_CHANGED', verified: false, reason: 'La incidencia vigente ya no es una direccion pendiente.' };
  }

  let refreshedChatby;
  try {
    const messages = await readMessages(incident.chatbyUserNs);
    refreshedChatby = scopeChatbyToCurrentIncident({
      ...summarizeConversation(messages),
      messagesForNotification: messages,
      chatbyReadVerified: true,
      chatbyReadAttempts: 1,
      orderAssociation: 'EXACT_ORDER',
      userNs: incident.chatbyUserNs
    }, incident.incidenceDate);
  } catch (error) {
    return { status: 'MANUAL_REVIEW_CHATBY_UNVERIFIED', verified: false, reason: safeIncidentActionError(error) };
  }
  const freshDecision = incorrectAddressOperationalDecision({
    classification: currentClassification,
    chatby: refreshedChatby,
    phone: current.order?.customerPhone || incident.phone
  });
  if (!freshDecision.eligible) {
    return { status: freshDecision.status || 'MANUAL_REVIEW', verified: false, reason: freshDecision.reason };
  }

  const attemptedAt = new Date().toISOString();
  let claim;
  try {
    claim = await claimResolution({
      storeId: config.defaultStore.id || 'suleia',
      orderId: incident.orderId,
      incidenceId: incident.incidenceId
    });
  } catch (error) {
    return { status: 'MANUAL_REVIEW_IDEMPOTENCY_UNAVAILABLE', verified: false, reason: safeIncidentActionError(error) };
  }
  if (!claim?.acquired || claim?.persistent !== true) {
    const priorStatus = String(claim?.existing?.status || '').toLowerCase();
    return {
      status: ['verified', 'applied_unverified', 'already_resolved'].includes(priorStatus)
        ? 'ALREADY_RESOLVED'
        : 'MANUAL_REVIEW_ALREADY_CLAIMED',
      verified: priorStatus === 'verified' || priorStatus === 'already_resolved',
      reason: claim?.reason || 'La incidencia ya tiene una reclamacion persistente.'
    };
  }

  try {
    await resolveIssue(incident.incidenceId, freshDecision.text);
    const completedAt = new Date().toISOString();
    const verified = await verifyResolution(incident.incidenceId, incident.orderId);
    const status = verified ? 'AUTO_RESOLVED' : 'AUTO_APPLIED_PENDING_VERIFICATION';
    const verifiedAt = verified ? new Date().toISOString() : null;
    await finishResolution({
      storeId: config.defaultStore.id || 'suleia',
      orderId: incident.orderId,
      incidenceId: incident.incidenceId,
      status: verified ? 'verified' : 'applied_unverified',
      attemptedAt,
      completedAt,
      evidence: { ruleId: freshDecision.ruleId, verified }
    });
    const result = { status, verified, attemptedAt, completedAt, verifiedAt, reason: freshDecision.reason };
    await auditResolution(incident, freshDecision, result);
    console.log(`Incident address action ${incident.incidenceId} ${incident.orderId}: ${status}`);
    return result;
  } catch (error) {
    const safeError = safeIncidentActionError(error);
    await finishResolution({
      storeId: config.defaultStore.id || 'suleia',
      orderId: incident.orderId,
      incidenceId: incident.incidenceId,
      status: 'failed_manual_review',
      attemptedAt,
      lastError: safeError,
      evidence: { ruleId: freshDecision.ruleId, verified: false }
    }).catch(() => null);
    const result = { status: 'MANUAL_REVIEW_ACTION_FAILED', verified: false, attemptedAt, error: safeError, reason: safeError };
    await auditResolution(incident, freshDecision, result);
    console.error(`Incident address action ${incident.incidenceId} ${incident.orderId}: ${result.status} (${safeError})`);
    return result;
  }
}

function customerSignalForIncident(chatby) {
  const messages = Number(chatby.customerMessages || 0);
  const intent = chatby.intent || '';
  if (intent === 'chatby_error') {
    return {
      label: 'Chatby no disponible',
      tone: 'danger',
      detail: 'No he podido leer la conversacion. No actuar sin revisar.'
    };
  }
  if (intent === 'not_found_chatby' || intent === 'missing_phone' || intent === 'no_conversation') {
    return {
      label: 'Sin conversacion localizada',
      tone: 'warning',
      detail: 'No encuentro hilo fiable en Chatby para este telefono.'
    };
  }
  if (messages <= 0 || intent === 'outbound_only') {
    return {
      label: 'Cliente sin respuesta',
      tone: 'neutral',
      detail: 'Solo veo mensajes salientes; el cliente no ha contestado.'
    };
  }
  if (intent === 'reject_or_cancel') {
    return {
      label: 'Cliente quiere cancelar/rechazar',
      tone: 'danger',
      detail: 'Hay respuesta entrante con contexto de rechazo o cancelacion.'
    };
  }
  if (intent === 'delivery_instruction' || intent === 'reprogram_delivery') {
    return {
      label: 'Cliente da instruccion de entrega',
      tone: 'positive',
      detail: 'Hay respuesta accionable para resolver o reprogramar entrega.'
    };
  }
  if (intent === 'address_data') {
    return {
      label: 'Cliente aporta datos de direccion',
      tone: 'positive',
      detail: 'Hay respuesta entrante con datos o correccion de envio.'
    };
  }
  if (intent === 'positive_confirmation') {
    return {
      label: 'Cliente muestra conformidad',
      tone: 'positive',
      detail: 'Hay respuesta positiva, pero conviene revisar como aplica a la incidencia.'
    };
  }
  return {
    label: 'Respuesta ambigua',
    tone: 'warning',
    detail: 'El cliente ha contestado, pero necesito criterio o feedback para decidir mejor.'
  };
}

function confidenceForIncident({ classification, chatby, recommendation }) {
  const intent = chatby.intent || '';
  const messages = Number(chatby.customerMessages || 0);
  const hasLastMessage = Boolean(chatby.lastCustomerMessage);
  const hasEvidence = Array.isArray(chatby.evidence) && chatby.evidence.length > 0;
  let score = 45;
  const reasons = [];

  if (classification.type !== 'unknown') {
    score += 18;
    reasons.push(`Tipologia Dropea identificada: ${classification.label}`);
  } else {
    reasons.push('Tipologia Dropea poco especifica');
  }

  if (intent === 'chatby_error') {
    return {
      score: 18,
      reason: 'Chatby no respondio correctamente; no hay base fiable para actuar.'
    };
  }
  if (['missing_phone', 'not_found_chatby', 'no_conversation'].includes(intent)) {
    return {
      score: 28,
      reason: 'No he localizado una conversacion util en Chatby para contrastar la incidencia.'
    };
  }

  if (messages > 0) {
    score += 16;
    reasons.push(`${messages} mensaje(s) entrante(s) del cliente`);
  } else {
    score -= 12;
    reasons.push('Sin respuesta entrante del cliente');
  }

  if (hasLastMessage) {
    score += 8;
    reasons.push('Ultimo mensaje del cliente disponible');
  }
  if (hasEvidence) {
    score += Math.min(12, chatby.evidence.length * 4);
    reasons.push(`Evidencias: ${chatby.evidence.join(', ')}`);
  }

  if (['reject_or_cancel', 'delivery_instruction', 'address_data'].includes(intent)) {
    score += 18;
    reasons.push(`Intencion clara detectada: ${chatby.status || intent}`);
  } else if (intent === 'reprogram_delivery' || intent === 'positive_confirmation') {
    score += 12;
    reasons.push(`Senal accionable detectada: ${chatby.status || intent}`);
  } else if (intent === 'customer_unclear') {
    score -= 4;
    reasons.push('Respuesta real, pero con intencion incompleta');
  } else if (intent === 'outbound_only') {
    score = classification.type === 'unknown' ? 34 : 48;
    reasons.push('La recomendacion se basa en Dropea, no en respuesta del cliente');
  }

  if (recommendation.tone === 'positive' && messages > 0) score += 5;
  if (recommendation.tone === 'danger' && intent !== 'reject_or_cancel') score -= 6;
  if (recommendation.resolutionStage) {
    score += 8;
    reasons.push(`Etapa operativa: ${recommendation.resolutionStage}`);
  }
  if (recommendation.operationalInstruction) {
    score += 6;
    reasons.push('Instruccion operativa generada');
  }
  if (chatby.operationalDetails?.deliveryInstruction || chatby.operationalDetails?.hasAddressData) {
    score += 10;
    reasons.push('Dato accionable extraido de Chatby');
  }

  return {
    score: Math.max(12, Math.min(96, Math.round(score))),
    reason: reasons.slice(0, 4).join(' | ')
  };
}

function issueDate(order, issue) {
  return issue?.created_at
    || issue?.createdAt
    || issue?.created_at
    || issue?.date
    || issue?.opened_at
    || issue?.createdAt
    || order?.raw?.updated_at
    || order?.raw?.created_at
    || order?.createdAt
    || null;
}

function spanishDateTimeToIso(value) {
  const match = String(value || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second = '00'] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+02:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const TRANSPORT_CONTEXT_KEYS = /description|solution|observation|observacion|note|nota|comment|comentario|history|historial|annotation|anotacion|incident|incidenc|reason|motivo|carrier|transport|logistic|event|evento/i;

function transportContextValues(value, key = '', depth = 0, seen = new Set()) {
  if (value === null || value === undefined || depth > 6) return [];
  if (typeof value === 'string' || typeof value === 'number') {
    return TRANSPORT_CONTEXT_KEYS.test(key) ? [String(value)] : [];
  }
  if (typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => transportContextValues(item, key, depth + 1, seen));
  }
  return Object.entries(value).flatMap(([childKey, childValue]) => {
    const nextKey = `${key}.${childKey}`;
    if (typeof childValue === 'string' || typeof childValue === 'number') {
      return TRANSPORT_CONTEXT_KEYS.test(nextKey) ? [String(childValue)] : [];
    }
    return transportContextValues(childValue, nextKey, depth + 1, seen);
  });
}

function transportSourceParts(issue = {}) {
  const raw = issue.raw || issue;
  return unique([
    ...transportContextValues(issue),
    ...transportContextValues(raw),
    issue.description,
    raw.description,
    issue.solutions,
    raw.solutions
  ].flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return [JSON.stringify(value)];
    return [value];
  }).map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
}

export function transportHistoryFromIssue(issue = {}) {
  const sourceParts = transportSourceParts(issue);

  const combined = unique(sourceParts).join(' | ');
  if (!combined) return [];
  const dateRegex = /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\b/g;
  const matches = [...combined.matchAll(dateRegex)];
  if (!matches.length) {
    return [{ eventAt: null, text: clip(combined, 600) }];
  }

  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index : combined.length;
    return {
      eventAt: spanishDateTimeToIso(match[0]),
      text: clip(combined.slice(start, end).replace(/^\s*[|;-]+|\s*[|;-]+$/g, ''), 600)
    };
  }).sort((left, right) => new Date(left.eventAt || 0) - new Date(right.eventAt || 0));
}

function issueTransportDetail(issue = {}) {
  return transportSourceParts(issue).join(' | ');
}

function transportEventMatchesType(event, classification) {
  const text = normalize(`${event?.text || ''} ${event?.code || ''}`);
  if (!text) return false;
  if (classification?.type === 'absent') return /ausente|no habia nadie|no estaba/.test(text);
  if (classification?.type === 'address') return /direccion incorrecta|faltan datos|datos incompletos|direccion incompleta/.test(text);
  if (classification?.type === 'rejected_goods') return /no acepta|rechaz|rehus|mercancia/.test(text);
  return normalize(event?.code) === 'incidence' && !/shippingservice|shipping service/.test(text);
}

function selectTransportIncidenceEvent(history = [], classification = null, explicitIncidence = null) {
  const matching = history.filter((event) => transportEventMatchesType(event, classification));
  if (matching.length) return matching[matching.length - 1];
  const operationalIncidences = history.filter((event) => (
    normalize(event?.code) === 'incidence'
    && !/shippingservice|shipping service/.test(normalize(event?.text))
  ));
  if (operationalIncidences.length) return operationalIncidences[operationalIncidences.length - 1];
  if (explicitIncidence && transportEventMatchesType(explicitIncidence, classification)) return explicitIncidence;
  return explicitIncidence || null;
}

function mergeOfficialTransportHistory(glsTracking, issue, fallbackHistory = [], classification = null) {
  if (!glsTracking?.history?.length) {
    const fallbackIncidence = selectTransportIncidenceEvent(fallbackHistory, classification);
    return {
      history: fallbackHistory,
      incidenceEvent: fallbackIncidence || fallbackHistory[fallbackHistory.length - 1] || null
    };
  }

  const detail = issueTransportDetail(issue);
  const selected = selectTransportIncidenceEvent(glsTracking.history, classification, glsTracking.incidence);
  const detailMatchesType = transportEventMatchesType({ text: detail }, classification);
  const incidenceEvent = selected
    ? { ...selected, text: detailMatchesType ? detail : selected.text }
    : null;
  const history = glsTracking.history.map((event) => {
    if (!incidenceEvent?.eventAt || !event?.eventAt) return event;
    const distance = Math.abs(new Date(event.eventAt).getTime() - new Date(incidenceEvent.eventAt).getTime());
    return distance <= 120000 ? { ...event, text: detail || event.text } : event;
  });

  return { history, incidenceEvent };
}

function messageText(message) {
  return [
    message?.text,
    message?.message,
    message?.content,
    message?.caption,
    message?.button_text,
    typeof message?.payload === 'string' ? message.payload : null
  ].filter((value) => typeof value === 'string' && value.trim()).join(' ');
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
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function messageSequence(message) {
  const date = messageDate(message);
  if (date) return { value: new Date(date).getTime(), timestamp: new Date(date).getTime(), reliable: true };
  const numericId = Number(message?.id || message?.message_id || message?.messageId || message?.mid);
  if (Number.isFinite(numericId) && numericId > 0) return { value: numericId, timestamp: null, reliable: true };
  return { value: null, timestamp: null, reliable: false };
}

function orderedMessagesChronologically(messages = []) {
  const rows = (Array.isArray(messages) ? messages : []).map((message, index) => ({
    message,
    index,
    sequence: messageSequence(message)
  }));
  if (!rows.length || rows.some((row) => !row.sequence.reliable)) return rows.map((row) => row.message);
  return rows
    .sort((left, right) => left.sequence.value - right.sequence.value || left.index - right.index)
    .map((row) => row.message);
}

function isAgentMessage(message) {
  const rawMessage = message?.raw || message || {};
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || rawMessage?.direction || '');
  if (['out', 'outgoing', 'outbound', 'agent', 'bot', 'admin'].includes(from)) return true;
  if (from.includes('bot') || from.includes('agent') || from.includes('admin') || from.includes('outbound')) return true;
  return rawMessage.from_me === true
    || rawMessage.fromMe === true
    || rawMessage.outgoing === true
    || rawMessage.is_outgoing === true;
}

function isAuthorizedFiveEuroDiscountOffer(text) {
  const source = normalize(text).replace(/\s+/g, ' ');
  if (!/descuento|rebaja|descontar|aplicarle/.test(source)) return false;
  return /(?:^|\D)5\s*(?:€|eur|euros?)?(?:\D|$)/i.test(String(text || ''))
    || /cinco\s+euros?/.test(source);
}

function isExplicitDiscountRejection(text) {
  const source = normalize(text).replace(/\s+/g, ' ');
  return /no muchas gracias|no,? gracias|no (?:estoy|estamos) interesad|no me interesa|no nos interesa|no lo quiero|no quiero (?:el|este|ese) pedido|quiero cancelar|cancelar (?:el )?pedido|anular (?:el )?pedido|rechazo (?:el )?pedido/.test(source);
}

function isExplicitDiscountAcceptance(text) {
  const source = normalize(text).replace(/\s+/g, ' ');
  return /(?:^|\b)(?:si|acepto|de acuerdo|vale|adelante)(?:\b|$)/.test(source)
    && !isExplicitDiscountRejection(text);
}

function findDiscountRecoveryExchange(messages = [], incidentDate = null) {
  const ordered = orderedMessagesChronologically(messages);
  const records = ordered.map((message) => ({
    message,
    text: messageText(message),
    sequence: messageSequence(message)
  })).filter((record) => record.sequence.reliable);
  const latestCustomer = [...records].reverse().find((record) => isCustomerMessage(record.message));
  if (!latestCustomer) return { offerVerified: false, latestReplyRejectsOffer: false, latestReplyAcceptsOffer: false };

  const incidentTimestamp = incidentDate ? new Date(incidentDate).getTime() : Number.NaN;
  const earliestOfferTimestamp = Number.isFinite(incidentTimestamp)
    ? incidentTimestamp - (60 * 60 * 1000)
    : null;
  const offer = [...records].reverse().find((record) => {
    if (!isAgentMessage(record.message) || !isAuthorizedFiveEuroDiscountOffer(record.text)) return false;
    if (record.sequence.value >= latestCustomer.sequence.value) return false;
    if (earliestOfferTimestamp !== null) {
      if (!Number.isFinite(record.sequence.timestamp)) return false;
      if (record.sequence.timestamp < earliestOfferTimestamp) return false;
    }
    return true;
  });
  if (!offer) return { offerVerified: false, latestReplyRejectsOffer: false, latestReplyAcceptsOffer: false };

  return {
    offerVerified: true,
    offerAt: messageDate(offer.message),
    offerText: clip(offer.text, 220),
    latestReplyAt: messageDate(latestCustomer.message),
    latestReplyText: clip(latestCustomer.text, 220),
    latestReplyRejectsOffer: isExplicitDiscountRejection(latestCustomer.text),
    latestReplyAcceptsOffer: isExplicitDiscountAcceptance(latestCustomer.text)
  };
}

function clip(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isCustomerMessage(message) {
  const rawMessage = message?.raw || message || {};
  const raw = JSON.stringify(rawMessage);
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || rawMessage?.direction || '');
  if (['in', 'incoming', 'inbound', 'received'].includes(from)) return true;
  if (['out', 'outgoing', 'outbound', 'agent', 'bot', 'admin'].includes(from)) return false;
  if (from.includes('customer') || from.includes('user') || from.includes('cliente') || from.includes('inbound')) return true;
  if (from.includes('bot') || from.includes('agent') || from.includes('admin') || from.includes('outbound')) return false;
  if (rawMessage.is_from_customer === true || rawMessage.isFromCustomer === true || rawMessage.from_customer === true) return true;
  if (rawMessage.from_me === false || rawMessage.fromMe === false || rawMessage.incoming === true || rawMessage.is_incoming === true) return true;
  if (rawMessage.from_me === true || rawMessage.fromMe === true || rawMessage.outgoing === true || rawMessage.is_outgoing === true) return false;
  return raw.includes('"is_bot":false') || raw.includes('"from_me":false') || raw.includes('"incoming"');
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function evidenceFromConversation(customerText, allText) {
  if (!customerText) return allText ? ['solo mensajes salientes'] : [];
  const checks = [
    { key: 'cancelacion', label: 'rechazo/cancelación', regex: /no acept|rechaz|no lo quiero|no quiero|cancel|anul|no me interesa|no voy a recibir/ },
    { key: 'direccion', label: 'datos de dirección', regex: /direccion|direcci|calle|numero|piso|portal|codigo postal|cp|datos/ },
    { key: 'horario', label: 'franja u horario de entrega', regex: /tarde|manana|mañana|mediodia|medio dia|noche|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|horario|franja|llamar|telefono|telf|teléfono|movil|móvil/ },
    { key: 'reprogramacion', label: 'reprogramación de entrega', regex: /otro dia|otro día|reparto|entrega|ausente|no estaba|no habia nadie|no había nadie/ },
    { key: 'conformidad', label: 'conformidad positiva', regex: /confirm|correcto|si\b|sí\b|adelante|ok|vale/ },
    { key: 'solo_saliente', label: 'solo mensajes salientes', regex: /./ }
  ];
  const source = customerText || allText;
  return checks
    .filter((item) => item.regex.test(source) && (item.key !== 'solo_saliente' || !customerText))
    .map((item) => item.label)
    .slice(0, 4);
}

function baseConversationMeta({ intent, customerMessages, customerText, allText, messages }) {
  const orderedMessages = orderedMessagesChronologically(messages);
  const lastCustomerMessage = [...orderedMessages].reverse().find(isCustomerMessage);
  const lastMessageText = lastCustomerMessage ? clip(messageText(lastCustomerMessage), 220) : '';
  const customerMessageItems = orderedMessages.filter(isCustomerMessage);
  const rawCustomerText = customerMessageItems.map(messageText).join(' | ');
  const rawAllText = orderedMessages.map(messageText).join(' | ');
  const confidenceByIntent = {
    reject_or_cancel: 94,
    address_data: 88,
    delivery_instruction: 92,
    reprogram_delivery: 86,
    positive_confirmation: 78,
    customer_unclear: 52,
    outbound_only: 35,
    no_signal: 25,
    no_conversation: 20
  };
  return {
    lastCustomerMessage: lastMessageText,
    lastCustomerAt: lastCustomerMessage ? messageDate(lastCustomerMessage) : null,
    evidence: evidenceFromConversation(customerText, allText),
    confidence: confidenceByIntent[intent] ?? (customerMessages ? 55 : 30),
    customerMessages,
    rawCustomerText,
    rawAllText,
    operationalDetails: extractOperationalDetailsFromText(rawCustomerText || lastMessageText || customerText),
    sentTemplates: detectSentTemplates(messages, rawAllText || allText)
  };
}

function summarizeConversation(messages = []) {
  const customerMessages = messages.filter(isCustomerMessage);
  const customerText = normalize(customerMessages.map(messageText).join(' | '));
  const allText = normalize(messages.map(messageText).join(' | '));

  if (!messages.length) {
    return {
      intent: 'no_conversation',
      status: 'Sin conversación localizada',
      summary: 'No he encontrado conversación en Chatby con ese teléfono.',
      proposedSolution: 'Revisar teléfono en Dropea y contactar manualmente antes de resolver la incidencia.',
      ...baseConversationMeta({ intent: 'no_conversation', customerMessages: 0, customerText, allText, messages })
    };
  }

  if (/no acept|rechaz|no lo quiero|no quiero|cancel|anul|no me interesa|no voy a recibir/.test(customerText)) {
    return {
      intent: 'reject_or_cancel',
      status: 'Cliente rechaza o cancela',
      summary: 'La conversación contiene señales de rechazo, cancelación o no aceptación del pedido.',
      proposedSolution: 'No insistir en confirmación. Revisar si procede cancelar/rechazar en Dropea y registrar motivo.',
      ...baseConversationMeta({ intent: 'reject_or_cancel', customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  if (/direccion|direcci|calle|numero|piso|portal|codigo postal|cp|datos/.test(customerText)) {
    return {
      intent: 'address_data',
      status: 'Necesita corrección de dirección',
      summary: 'El cliente menciona datos de entrega o dirección, por lo que la incidencia parece relacionada con información de envío.',
      proposedSolution: 'Actualizar datos en Dropea si el cliente dejó dirección completa. Si faltan datos, pedirlos por Chatby.',
      ...baseConversationMeta({ intent: 'address_data', customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  if (/tarde|manana|mañana|mediodia|medio dia|noche|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|horario|franja|llamar|telefono|telf|teléfono|movil|móvil/.test(customerText)) {
    return {
      intent: 'delivery_instruction',
      status: 'Cliente da instrucciones de entrega',
      summary: 'El cliente ha indicado una franja, horario, telefono de contacto o instruccion concreta para resolver la incidencia de entrega.',
      proposedSolution: 'Resolver en Dropea trasladando literalmente la instruccion del cliente. No cancelar ni tratar como falta de respuesta.',
      ...baseConversationMeta({ intent: 'delivery_instruction', customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  if (/manana|mañana|otro dia|otro día|reparto|entrega|ausente|no estaba|no habia nadie|no había nadie|horario/.test(customerText)) {
    return {
      intent: 'reprogram_delivery',
      status: 'Reprogramar entrega',
      summary: 'El cliente habla de entrega, ausencia, horario o nueva fecha.',
      proposedSolution: 'Responder con opción de nueva entrega y trasladar la solución a Dropea cuando haya fecha clara.',
      ...baseConversationMeta({ intent: 'reprogram_delivery', customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  if (/confirm|correcto|si\b|sí\b|adelante|ok|vale/.test(customerText)) {
    return {
      intent: 'positive_confirmation',
      status: 'Cliente muestra conformidad',
      summary: 'Hay señales positivas o de conformidad del cliente, pero la incidencia sigue abierta.',
      proposedSolution: 'Comprobar si Dropea permite enviar solución o reactivar entrega. No cancelar sin revisar incidencia.',
      ...baseConversationMeta({ intent: 'positive_confirmation', customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  if (allText) {
    const intent = customerMessages.length ? 'customer_unclear' : 'outbound_only';
    return {
      intent,
      status: customerMessages.length ? 'Respuesta sin intención clara' : 'Solo mensajes salientes',
      summary: customerMessages.length
        ? 'Hay respuesta del cliente, pero no contiene una intención operativa clara.'
        : 'La conversación contiene mensajes enviados, pero no veo respuesta del cliente.',
      proposedSolution: customerMessages.length
        ? 'Revisar manualmente la conversación antes de resolver la incidencia.'
        : 'Enviar recordatorio o contactar manualmente si la incidencia requiere acción.',
      ...baseConversationMeta({ intent, customerMessages: customerMessages.length, customerText, allText, messages })
    };
  }

  return {
    intent: 'no_signal',
    status: 'Sin señal útil',
    summary: 'No hay texto suficiente para interpretar la incidencia desde Chatby.',
    proposedSolution: 'Revisión manual.',
    ...baseConversationMeta({ intent: 'no_signal', customerMessages: customerMessages.length, customerText, allText, messages })
  };
}

async function chatbyContextForPhone(phone, subscriberIndex, messagesByUserNs = new Map(), {
  since = null,
  orderId = null,
  requireExactOrder = false
} = {}) {
  if (!digits(phone)) {
    return {
      ok: false,
      intent: 'missing_phone',
      status: 'Sin teléfono',
      summary: 'Dropea no aporta teléfono suficiente para buscar conversación.',
      proposedSolution: 'Revisar el pedido en Dropea.',
      userNs: null,
      customerMessages: 0
    };
  }

  const exactSubscriber = findSubscriberInIndexForExactOrder(subscriberIndex, { phone, orderId });
  const subscriber = exactSubscriber || (requireExactOrder ? null : (
    findSubscriberInIndexForOrder(subscriberIndex, {
      phone,
      orderId,
      allowConfirmedPhoneFallback: true
    }) || findSubscriberInIndexByPhone(subscriberIndex, { phone })
  ));
  if (!subscriber) {
    return {
      ok: false,
      intent: 'not_found_chatby',
      status: 'No encontrado en Chatby',
      summary: 'No he localizado contacto en Chatby con ese teléfono.',
      proposedSolution: 'Comprobar teléfono y contactar manualmente si la incidencia requiere respuesta.',
      userNs: null,
      customerMessages: 0
    };
  }

  const userNs = subscriber.user_ns || subscriber.ns || subscriber.id || null;
  if (userNs && !messagesByUserNs.has(userNs)) {
    messagesByUserNs.set(userNs, (async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const loaded = await getChatMessages(userNs);
          if (loaded.length || attempt === 3) {
            return { messages: loaded, verified: true, attempts: attempt };
          }
        } catch (error) {
          lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
      throw lastError || new Error('Chatby no devolvio mensajes tras tres lecturas.');
    })());
  }
  const chatRead = userNs
    ? await messagesByUserNs.get(userNs)
    : { messages: [], verified: false, attempts: 0 };
  const allMessages = chatRead.messages;
  const sinceTime = since ? new Date(since).getTime() : Number.NaN;
  const messages = Number.isFinite(sinceTime)
    ? (Array.isArray(allMessages) ? allMessages : []).filter((message) => {
        const timestamp = messageDate(message);
        return timestamp ? new Date(timestamp).getTime() >= sinceTime - (60 * 60 * 1000) : true;
      })
    : allMessages;
  return {
    ok: true,
    userNs,
    orderAssociation: exactSubscriber ? 'EXACT_ORDER' : 'PHONE_FALLBACK',
    subscriberName: subscriber.name || subscriber.full_name || null,
    chatbyReadVerified: chatRead.verified,
    chatbyReadAttempts: chatRead.attempts,
    messagesForNotification: Array.isArray(allMessages) ? allMessages : [],
    ...summarizeConversation(Array.isArray(messages) ? messages : [])
  };
}

function scopeChatbyToCurrentIncident(chatby, incidentAt) {
  const allMessages = Array.isArray(chatby?.messagesForNotification)
    ? chatby.messagesForNotification
    : [];
  const scopedMessages = messagesAfterCurrentIncident(allMessages, incidentAt)
    .map((entry) => entry.message);
  return {
    ...chatby,
    messagesForNotification: allMessages,
    messagesAfterCurrentIncident: scopedMessages,
    customerTextsAfterIncident: scopedMessages.filter(isCustomerMessage).map(messageText).filter(Boolean),
    incidentConversationStartAt: incidentAt || null,
    ...summarizeConversation(scopedMessages)
  };
}

function orderFromIncidence(incidence = {}) {
  const rawOrder = incidence?.raw?.order || incidence?.order || {};
  return {
    orderId: String(incidence.orderId || rawOrder.id || ''),
    status: incidence.orderStatus || rawOrder.status || 'INCIDENCE',
    customerName: incidence.customerName || rawOrder.customer?.full_name || '',
    customerPhone: incidence.customerPhone || rawOrder.customer?.phone || '',
    customerEmail: incidence.customerEmail || rawOrder.customer?.email || '',
    orderAmount: Number(rawOrder.total_amount || 0) || null,
    createdAt: rawOrder.created_at || null,
    raw: rawOrder
  };
}

async function collectPendingIncidents({ limit = 100, pages = 3 } = {}) {
  const rows = await collectPendingDropeaV2Incidents({ limit, pages });
  return sortRowsByOrderDesc(rows);
}

function incidentDisplayLabel(classification) {
  if (classification?.type === 'absent') return 'Ausente';
  if (classification?.type === 'address') return 'Direccion incorrecta o faltan datos';
  if (classification?.type === 'rejected_goods') return 'No acepta mercancia';
  return classification?.label || 'Incidencia pendiente';
}

export function loadIncidentsCache() {
  return readJson(cachePath, {
    ok: false,
    updatedAt: null,
    incidents: [],
    error: null
  });
}

export async function preparePendingIncidentsForAnalysis({
  pending = [],
  indexLoader = loadSubscriberIndex
} = {}) {
  try {
    return {
      pending,
      subscriberIndex: await indexLoader({ maxPages: 10, limit: 100 }),
      subscriberIndexError: null
    };
  } catch (error) {
    return {
      // A Chatby outage must never hide Dropea's pending incidents.
      pending,
      subscriberIndex: null,
      subscriberIndexError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function syncPendingIncidents({ limit = 100, pages = 3 } = {}) {
  const updatedAt = new Date().toISOString();
  const incidents = [];

  try {
    const previousCache = loadIncidentsCache();
    const previousByOrderId = new Map((previousCache.incidents || []).map((incident) => [String(incident.orderId), incident]));
    const chatbyByPhone = new Map();
    const messagesByUserNs = new Map();
    const pending = await collectPendingIncidents({ limit, pages });
    const prepared = await preparePendingIncidentsForAnalysis({ pending });
    const subscriberIndex = prepared.subscriberIndex;
    const analyzed = await mapWithConcurrency(prepared.pending, 4, async ({ order, issue }) => {
      const orderId = String(order?.orderId || issue?.orderId || '');
      const phone = order?.customerPhone || order?.raw?.customer?.phone || issue?.customerPhone || '';
      const fallbackTransportHistory = transportHistoryFromIssue(issue);
      const incidentStartedAt = fallbackTransportHistory[0]?.eventAt || issueDate(order, issue);
      let chatby;
      try {
        if (prepared.subscriberIndexError) {
          throw new Error(`Chatby subscriber index unavailable: ${prepared.subscriberIndexError}`);
        }
        const phoneKey = `${digits(phone).slice(-9) || `order:${orderId}`}|${issue?.id || incidentStartedAt || ''}`;
        if (!chatbyByPhone.has(phoneKey)) {
          chatbyByPhone.set(phoneKey, chatbyContextForPhone(phone, subscriberIndex, messagesByUserNs, {
            since: incidentStartedAt,
            orderId,
            requireExactOrder: true
          }));
        }
        chatby = await chatbyByPhone.get(phoneKey);
      } catch (error) {
        chatby = {
          ok: false,
          intent: 'chatby_error',
          status: 'Error leyendo Chatby',
          summary: error instanceof Error ? error.message : String(error),
          proposedSolution: 'No resolver automáticamente. Revisar Chatby o credenciales.',
          userNs: null,
          customerMessages: 0,
          chatbyReadVerified: false
        };
        const previous = previousByOrderId.get(orderId);
        const previousHasSignal = previous && (previous.customerResponded || Number(previous.customerMessages || 0) > 0 || previous.chatbyUserNs);
        if (previousHasSignal) {
          chatby = {
            ok: false,
            intent: previous.chatbyIntent || 'cached_previous',
            status: 'Chatby limitado: mantengo lectura anterior',
            summary: previous.chatbySummary || 'No he podido refrescar Chatby, asi que mantengo la ultima lectura valida.',
            proposedSolution: previous.proposedSolution || 'Revisar cuando Chatby vuelva a responder.',
            userNs: previous.chatbyUserNs || null,
            customerMessages: previous.customerMessages || 0,
            lastCustomerMessage: previous.lastCustomerMessage || '',
            lastCustomerAt: previous.lastCustomerAt || null,
            evidence: previous.evidence || [],
            confidence: previous.contextConfidence || previous.confidence || 45,
            chatbyReadVerified: false
          };
        }
      }
      const classification = classifyIncident(issue, order);
      const cleanLabel = incidentDisplayLabel(classification);
      // Dropea Public API V2 already supplies the active pending issue. Do not
      // enrich this dashboard read through the retired V1 incidence-history route.
      const dropeaCarrierHistory = [];
      const dropeaCarrierCurrent = null;
      const dropeaCarrierHistoryError = null;
      const glsTracking = await getGlsTrackingHistory({
        trackingUrl: issue?.trackingUrl || issue?.raw?.tracking_url || issue?.raw?.order?.tracking_url,
        tracking: issue?.tracking || issue?.raw?.tracking || issue?.raw?.order?.tracking_code
      }).catch(() => null);
      const mergedTransport = mergeOfficialTransportHistory(glsTracking, issue, fallbackTransportHistory, classification);
      const transportHistory = mergedTransport.history;
      const latestTransportEvent = transportHistory[transportHistory.length - 1] || null;
      const carrierIncident = carrierIncidentDisplay(dropeaCarrierCurrent);
      const currentIncidenceDate = carrierIncident?.annotatedAt || mergedTransport.incidenceEvent?.eventAt || issueDate(order, issue);
      chatby = scopeChatbyToCurrentIncident(chatby, currentIncidenceDate);
      const previous = previousByOrderId.get(orderId);
      const sameIncidentAsPrevious = previous
        && String(previous.incidenceId || '') === String(issue?.id || issue?.incidenceId || '');
      const currentIncidentVerified = Boolean(
        currentIncidenceDate
        && !dropeaCarrierHistoryError
        && (carrierIncident || mergedTransport.incidenceEvent)
      );
      const dropeaStillPending = isPendingIssue(issue);
      const responseWait = evaluateIncidentResponseWait({
        orderId,
        incidenceId: issue?.id || issue?.incidenceId || '',
        incidentType: classification.type,
        reason: cleanLabel,
        observation: carrierIncident?.observation || mergedTransport.incidenceEvent?.text || classification.rawReason,
        incidentAt: currentIncidenceDate,
        messages: chatby.messagesForNotification,
        chatbyReadVerified: chatby.chatbyReadVerified === true,
        currentIncidentVerified,
        dropeaStillPending,
        dropeaStatus: issueStatus(issue) || order?.status || 'PENDIENTE',
        checks: sameIncidentAsPrevious ? Number(previous?.incidentResponseChecks || 0) : 0,
        timeoutHours: config.defaultStore.incidentResponseTimeoutHours
      });
      const baseRecommendation = typeAwareIncidentSolution(classification, chatby, issue, responseWait);
      const genericOperationalDecision = incidentOperationalDecision({
        classification,
        chatby,
        transportHistory,
        phone,
        incidentDate: currentIncidenceDate
      });
      const operationalDecision = classification.type === 'address'
        ? incorrectAddressOperationalDecision({ classification, chatby, phone })
        : genericOperationalDecision;
      const recommendation = recommendationWithOperationalDecision(baseRecommendation, operationalDecision);
      const customerSignal = customerSignalForIncident(chatby);
      const confidence = confidenceForIncident({ classification, chatby, recommendation });

      const incident = {
        orderId,
        incidenceId: issue?.id || issue?.incidenceId ? String(issue.id || issue.incidenceId) : null,
        incidenceDate: currentIncidenceDate,
        incidentAgeHours: incidentAgeHours(currentIncidenceDate),
        incidentResponseState: responseWait.state,
        incidentResponseStartedAt: responseWait.incidentAt,
        incidentResponseDeadlineAt: responseWait.deadlineAt,
        incidentResponseTimeoutHours: responseWait.timeoutHours,
        incidentResponseElapsedHours: responseWait.elapsedHours,
        incidentResponseRemainingHours: responseWait.remainingHours,
        incidentResponseExpired: responseWait.expired,
        incidentResponseValid: responseWait.validResponse,
        incidentResponseLatestInbound: responseWait.latestInboundMessage,
        incidentResponseLatestInboundAt: responseWait.latestInboundAt,
        incidentResponseLatestValid: responseWait.latestValidMessage,
        incidentResponseLatestValidAt: responseWait.latestValidAt,
        incidentResponsePendingDecision: responseWait.pendingDecision,
        incidentResponseChecks: responseWait.checks,
        incidentResponseVerificationStatus: responseWait.verificationStatus,
        incidentResponseFinalVerificationReady: responseWait.finalVerificationReady,
        incidentResponseEvidence: responseWait.evidence,
        incidentResponseTrainingOnly: true,
        reason: cleanLabel,
        reasonCode: classification.code || null,
        rawReason: classification.rawReason,
        incidentType: classification.type,
        incidentTypeLabel: cleanLabel,
        incidentTypeTone: classification.tone,
        issueStatus: issue ? (issueStatus(issue) || 'PENDIENTE') : 'PENDIENTE',
        orderStatus: order?.status || issue?.orderStatus || 'CON INCIDENCIA',
        customerName: order?.customerName || order?.raw?.customer?.full_name || issue?.customerName || '',
        phone,
        amount: order?.orderAmount ?? null,
        carrierCompany: issue?.carrierCompany || issue?.raw?.carrier_company || issue?.raw?.order?.carrier_company || '',
        carrierService: issue?.carrierService || issue?.raw?.carrier_service || issue?.raw?.order?.carrier_service || '',
        tracking: issue?.tracking || issue?.raw?.tracking || issue?.raw?.order?.tracking_code || '',
        trackingUrl: issue?.trackingUrl || issue?.raw?.tracking_url || issue?.raw?.order?.tracking_url || '',
        carrierIncident,
        carrierReason: carrierIncident?.reason || null,
        carrierReasonCode: carrierIncident?.reasonCode || null,
        carrierAnnotatedAt: carrierIncident?.annotatedAt || null,
        carrierObservation: carrierIncident?.observation || null,
        carrierLastUpdatedAt: carrierIncident?.lastUpdatedAt || null,
        carrierIncidenceId: carrierIncident?.incidenceId || null,
        carrierIncidentHistory: dropeaCarrierHistory,
        carrierIncidentHistoryError: dropeaCarrierHistoryError,
        transportHistory,
        transportLatestEvent: latestTransportEvent,
        transportIncidenceEvent: mergedTransport.incidenceEvent,
        transportLogAvailable: transportHistory.length > 0,
        transportLogCompleteness: carrierIncident ? 'dropea_incidence_history' : glsTracking?.history?.length ? 'official_tracking' : 'summary_only',
        transportLogSource: carrierIncident?.source || glsTracking?.source || 'Dropea Public API V2: resumen de incidencia',
        chatbyIntent: chatby.intent || 'unknown',
        chatbyStatus: chatby.status,
        chatbySummary: chatby.summary,
        customerSignalLabel: customerSignal.label,
        customerSignalTone: customerSignal.tone,
        customerSignalDetail: customerSignal.detail,
        proposedSolution: recommendation.solution,
        actionRecommended: recommendation.action,
        actionTone: recommendation.tone,
        resolutionStage: recommendation.resolutionStage,
        operationalInstruction: recommendation.operationalInstruction,
        templateRecommendation: recommendation.templateRecommendation,
        templateName: recommendation.templateName,
        customerIntentDetail: recommendation.customerIntentDetail,
        recommendationTrainingOnly: recommendation.trainingOnly === true,
        recommendationAutomationReady: recommendation.automationReady !== false,
        confidenceReason: confidence.reason,
        recommendedNextStep: recommendation.solution,
        lastCustomerMessage: chatby.lastCustomerMessage || '',
        lastCustomerAt: chatby.lastCustomerAt || null,
        evidence: Array.isArray(chatby.evidence) ? chatby.evidence : [],
        contextConfidence: confidence.score,
        priority: Number(chatby.customerMessages || 0) > 0 ? 'high' : recommendation.tone === 'danger' ? 'medium' : 'normal',
        customerMessages: chatby.customerMessages || 0,
        customerResponded: Number(chatby.customerMessages || 0) > 0,
        alertLevel: Number(chatby.customerMessages || 0) > 0 ? 'customer_response' : 'no_response',
        chatbyUserNs: chatby.userNs || null,
        chatbyOrderAssociation: chatby.orderAssociation || 'NONE',
        chatbyReadVerified: chatby.chatbyReadVerified === true,
        chatbyReadAttempts: Number(chatby.chatbyReadAttempts || 0),
        operationalDecisionAction: operationalDecision.action,
        operationalDecisionEligible: operationalDecision.eligible,
        operationalDecisionConfidence: operationalDecision.confidence,
        operationalDecisionReason: operationalDecision.reason,
        operationalDecisionRuleId: operationalDecision.ruleId,
        operationalDecisionText: operationalDecision.text,
        operationalDecisionTrainingOnly: operationalDecision.trainingOnly === true,
        decisionTrace: {
          dropea: {
            reason: cleanLabel,
            reasonCode: classification.code || null,
            status: issue ? (issueStatus(issue) || 'PENDIENTE') : 'PENDIENTE',
            selectedTransportEvent: mergedTransport.incidenceEvent?.text || '',
            historyEvents: transportHistory.map((event) => event?.text || '').filter(Boolean)
          },
          chatby: {
            readVerified: chatby.chatbyReadVerified === true,
            customerMessages: Number(chatby.customerMessages || 0),
            lastCustomerMessage: chatby.lastCustomerMessage || '',
            lastCustomerAt: chatby.lastCustomerAt || null,
            intent: chatby.intent || 'unknown'
          },
          incidentResponseWait: {
            state: responseWait.state,
            startedAt: responseWait.incidentAt,
            deadlineAt: responseWait.deadlineAt,
            validResponse: responseWait.validResponse,
            latestValidMessage: responseWait.latestValidMessage,
            latestValidAt: responseWait.latestValidAt,
            pendingDecision: responseWait.pendingDecision,
            checks: responseWait.checks,
            verificationStatus: responseWait.verificationStatus,
            finalVerificationReady: responseWait.finalVerificationReady,
            trainingOnly: true
          },
          rule: {
            id: operationalDecision.ruleId || 'manual_review',
            reason: operationalDecision.reason || recommendation.solution,
            confidence: operationalDecision.confidence || confidence.score,
            trainingOnly: operationalDecision.trainingOnly === true
          }
        }
      };
      return {
        incident,
        order,
        messages: Array.isArray(chatby.messagesForNotification) ? chatby.messagesForNotification : [],
        operationalDecision
      };
    });
    for (const item of analyzed) {
      let notification = {
        status: 'disabled',
        reason: 'dropea_v2_dashboard_read_only',
        templateName: null,
        attemptedAt: null,
        sentAt: null,
        verified: false,
        error: null
      };
      const rejectedGoodsCommunicationEnabled = item.incident.incidentType === 'rejected_goods'
        && config.enableIncidentDiscountTemplate === true
        && config.incidentDiscountRealEnabled === true;
      if (rejectedGoodsCommunicationEnabled) {
        try {
          notification = await processIncidentNotification({
            incident: item.incident,
            order: item.order,
            messages: item.messages,
            dryRun: false
          });
        } catch (error) {
          notification = {
            ...notification,
            status: 'failed',
            reason: 'incident_merchandise_template_failed',
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      let discountRecovery = {
        status: 'disabled',
        reason: 'incident_discount_recovery_disabled',
        templateName: null,
        verified: false,
        responseStatus: 'NOT_SENT',
        discountAmountEur: 5
      };
      if (config.enableIncidentDiscountTemplate) {
        try {
          discountRecovery = await processIncidentDiscountRecovery({
            incident: item.incident,
            order: item.order,
            messages: item.messages,
            realEnabled: config.incidentDiscountRealEnabled === true
          });
        } catch (error) {
          discountRecovery = {
            ...discountRecovery,
            status: 'failed',
            reason: 'incident_discount_recovery_failed',
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      // Dropea stays read-only here. The only additional egress is the separately
      // gated, idempotent Chatby template sequence for rejected-goods incidents.
      const actionResult = item.incident.incidentType === 'address'
        ? await executeIncorrectAddressResolution(item.incident, item.operationalDecision)
        : {
            status: 'BLOCKED_READ_ONLY',
            verified: false,
            reason: 'Solo la resolucion gobernada de direccion incorrecta puede escribir en esta ruta.'
          };
      const enrichedIncident = {
        ...item.incident,
        incidentDiscountRecovery: discountRecovery,
        incidentDiscountRecoveryStatus: discountRecovery.status,
        incidentDiscountRecoveryReason: discountRecovery.reason,
        incidentDiscountTemplate: discountRecovery.templateName,
        incidentDiscountInitialTemplateSentAt: discountRecovery.initialTemplateSentAt || null,
        incidentDiscountDueAt: discountRecovery.dueAt || null,
        incidentDiscountSentAt: discountRecovery.sentAt || null,
        incidentDiscountVerified: discountRecovery.verified === true,
        incidentDiscountResponseStatus: discountRecovery.responseStatus || 'NOT_SENT',
        incidentDiscountRespondedAt: discountRecovery.respondedAt || null,
        incidentDiscountOriginalPrice: discountRecovery.originalPrice || null,
        incidentDiscountFinalPrice: discountRecovery.finalPrice || null,
        incidentDiscountAmountEur: 5,
        incidentDiscountCrossSourceVerified: discountRecovery.crossSourceVerified === true,
        incidentNotification: notification,
        incidentNotificationStatus: notification.status,
        incidentNotificationTemplate: notification.templateName,
        incidentNotificationReason: notification.reason,
        incidentNotificationVerified: notification.verified,
        incidentNotificationSentAt: notification.sentAt,
        incidentNotificationError: notification.error,
        operationalActionStatus: actionResult.status,
        operationalActionVerified: actionResult.verified === true,
        operationalActionError: actionResult.error || null,
        operationalActionAttemptedAt: actionResult.attemptedAt || null,
        operationalActionCompletedAt: actionResult.completedAt || null,
        operationalActionVerifiedAt: actionResult.verifiedAt || null
      };
      incidents.push(enrichedIncident);
    }

    const sortedIncidents = sortIncidentsByIncidenceDesc(incidents);
    const discountRecoverySummary = {
      enabled: config.enableIncidentDiscountTemplate === true,
      realEnabled: config.incidentDiscountRealEnabled === true,
      checked: sortedIncidents.filter((incident) => incident.incidentType === 'rejected_goods').length,
      sent: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryStatus === 'sent').length,
      wouldSend: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryStatus === 'would_send').length,
      alreadySent: sortedIncidents.filter((incident) => ['already_sent', 'persistent_sent'].includes(incident.incidentDiscountRecoveryStatus)).length,
      accepted: sortedIncidents.filter((incident) => incident.incidentDiscountResponseStatus === 'DISCOUNT_ACCEPTED').length,
      blockedByCustomerActivity: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryReason === 'customer_interaction_after_merchandise_template').length,
      failed: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryStatus === 'failed').length,
      waiting24Hours: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryReason === 'waiting_discount_window').length,
      missingVerifiedInitialTemplate: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryReason === 'merchandise_template_not_verified').length,
      crossSourceMismatch: sortedIncidents.filter((incident) => incident.incidentDiscountRecoveryReason === 'cross_source_order_mismatch').length,
      discountAmountEur: 5,
      delayHours: 24
    };
    const payload = {
      ok: true,
      updatedAt,
      intervalMinutes: config.defaultStore.incidentsSyncIntervalMinutes,
      agentName: 'Agente de incidencias',
      agentMode: config.incidentDiscountRealEnabled ? 'discount_recovery_live' : 'training_read_only',
      agentModeLabel: config.incidentDiscountRealEnabled
        ? 'Lectura V2 y recuperacion comercial de 5 EUR tras 24 h; sin acciones en Dropea'
        : 'Lectura V2 y analisis; sin mensajes ni acciones automaticas',
      notificationMode: config.incidentDiscountRealEnabled ? 'discount_recovery_live' : 'disabled',
      notificationModeLabel: config.incidentDiscountRealEnabled
        ? 'Plantilla de descuento real, una sola vez, tras 24 h sin respuesta'
        : 'Avisos de incidencia bloqueados en esta ruta de solo lectura',
      discountRecoverySummary,
      transportHistoryNotice: 'Incidencias activas de Dropea Public API V2; historial oficial de GLS cuando hay tracking disponible.',
      count: sortedIncidents.length,
      incidents: sortedIncidents,
      error: null
    };
    writeJson(cachePath, payload);
    await syncIncidentsCacheToSupabase(payload).catch((error) => {
      console.error('Supabase incidents mirror error:', error instanceof Error ? error.message : String(error));
    });
    const state = { ...loadState() };
    state.lastIncidentsSyncAt = updatedAt;
    state.lastIncidentsSyncError = null;
    state.lastIncidentsSyncCount = sortedIncidents.length;
    state.lastIncidentDiscountRecoveryAt = updatedAt;
    state.lastIncidentDiscountRecoverySummary = discountRecoverySummary;
    saveState(state);
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const previous = loadIncidentsCache();
    const payload = {
      ...previous,
      ok: false,
      updatedAt: previous.updatedAt || updatedAt,
      error: message
    };
    writeJson(cachePath, payload);
    await syncIncidentsCacheToSupabase(payload).catch((mirrorError) => {
      console.error('Supabase incidents error mirror failed:', mirrorError instanceof Error ? mirrorError.message : String(mirrorError));
    });
    const state = { ...loadState() };
    state.lastIncidentsSyncAt = updatedAt;
    state.lastIncidentsSyncError = message;
    saveState(state);
    throw error;
  }
}
