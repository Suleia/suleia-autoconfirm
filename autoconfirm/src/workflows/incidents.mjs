import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { listDropeaIncidences, listDropeaOrders, listDropeaOrdersBasic, listDropeaOrdersByStatus, listDropeaOrdersByStatusBasic, listDropeaOrderStateValues } from '../clients/dropea.mjs';
import { findSubscriberInIndexByPhone, getChatMessages, loadSubscriberIndex } from '../clients/chatby.mjs';
import { getGlsTrackingHistory } from '../clients/gls.mjs';
import { loadState, saveState } from '../storage.mjs';
import { syncIncidentsCacheToSupabase } from '../db/supabase-store.mjs';

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
  const text = normalize(issueReason(issue));
  return ['AS', 'NAM', 'MCC', 'DIR', 'DI'].includes(code)
    || text.includes('ausente')
    || text.includes('no acepta')
    || text.includes('direccion')
    || text.includes('faltan datos');
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
    const bOrderId = numericId(b?.order?.orderId || b?.issue?.orderId);
    const aOrderId = numericId(a?.order?.orderId || a?.issue?.orderId);
    if (bOrderId !== aOrderId) return bOrderId - aOrderId;
    const bIssueId = numericId(b?.issue?.id || b?.issue?.incidenceId);
    const aIssueId = numericId(a?.issue?.id || a?.issue?.incidenceId);
    return bIssueId - aIssueId;
  });
}

function sortIncidentsByOrderDesc(incidents) {
  return [...incidents].sort((a, b) => {
    const bOrderId = numericId(b?.orderId);
    const aOrderId = numericId(a?.orderId);
    if (bOrderId !== aOrderId) return bOrderId - aOrderId;
    const bIssueId = numericId(b?.incidenceId);
    const aIssueId = numericId(a?.incidenceId);
    return bIssueId - aIssueId;
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

function classifyIncident(issue, order) {
  const rawReason = issue ? issueReason(issue) : 'Pedido con incidencia';
  const code = String(rawReason || '').trim().toUpperCase();
  const text = normalize([
    rawReason,
    issue?.title,
    issue?.description,
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
    || code === 'DIR'
    || code === 'DI'
    || text.includes('direccion')
    || text.includes('dirección')
    || text.includes('faltan datos')
    || text.includes('datos incompletos')
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
  if (text.includes('tarde')) instructionParts.push('entregar por la tarde');
  if (text.includes('manana')) instructionParts.push('entregar por la manana');
  if (text.includes('mediodia') || text.includes('medio dia')) instructionParts.push('entregar al mediodia');
  if (text.includes('noche')) instructionParts.push('entregar por la noche');
  const dayHits = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].filter((day) => text.includes(day));
  if (dayHits.length) instructionParts.push(`dia indicado: ${unique(dayHits).join(', ')}`);
  if (/otro dia|reprogram|nueva entrega|volver a pasar|que pasen|entregar/.test(text)) instructionParts.push('pide nueva entrega');
  if (details.phoneMentioned || /llamar|telefono|telf|movil/.test(text)) {
    instructionParts.push(details.phoneMentioned ? `llamar al ${details.phoneMentioned}` : 'pide llamada telefonica');
  }
  details.deliveryInstruction = unique(instructionParts).join(' | ');

  details.wantsCancel = /no lo quiero|no quiero|cancel|anul|rechaz|no acepta|no acepto|no me interesa|devolver|no voy a recibir/.test(text);
  details.wantsReceive = /si lo quiero|quiero recibir|lo quiero|entregar|que lo traigan|que vuelvan|volver a pasar|confirmo|correcto|ok|vale/.test(text) && !details.wantsCancel;
  details.courierIssue = /no ha pasado|no paso|repartidor|mensajero|nadie vino|no llamaron|no me llamaron|estaba en casa/.test(text);

  if (details.wantsCancel) details.customerIntentDetail = 'El cliente parece rechazar o cancelar el pedido.';
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
  return {
    directionReminderSent: source.includes('dropea_incidencia_direccion_v1'),
    absentReminderSent: source.includes('dropea_incidencia_ausente') || source.includes('suleia_incidencia_ausente'),
    discountReminderSent: source.includes('descuento') || source.includes('discount') || source.includes('5 eur') || source.includes('5€'),
    pendingOrderReminderSent: source.includes('dropea_pedido_pendiente') || source.includes('pendiente de confirmacion')
  };
}

function recommendationPayload({ action, tone, solution, stage, instruction = '', template = '', intentDetail = '' }) {
  return {
    action,
    tone,
    solution,
    resolutionStage: stage,
    operationalInstruction: instruction,
    templateRecommendation: template,
    templateName: template,
    customerIntentDetail: intentDetail
  };
}

function typeAwareIncidentSolution(classification, chatby, issue = null) {
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
      action: 'Rechazar/cancelar incidencia',
      tone: 'danger',
      stage: 'Cliente rechaza',
      intentDetail,
      instruction: 'No enviar mas recordatorios. Propuesta: rechazar/cancelar la incidencia en Dropea cuando se active modo real.',
      solution: `El cliente muestra rechazo o cancelacion.${last} Propuesta: rechazar/cancelar en Dropea y registrar el motivo.`
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
    if (Number.isFinite(ageHours) && ageHours >= 24 && !sent.directionReminderSent) {
      return recommendationPayload({
        action: 'Enviar recordatorio direccion',
        tone: 'warning',
        stage: '24h sin respuesta',
        template: 'es_ES - dropea_incidencia_direccion_v1',
        intentDetail,
        instruction: 'Entrenamiento: si se activa modo real, enviar un recordatorio de direccion y esperar datos del cliente.',
        solution: `Incidencia de direccion sin respuesta tras ${ageText}. Propuesta: enviar la plantilla es_ES - dropea_incidencia_direccion_v1.`
      });
    }
    return recommendationPayload({
      action: sent.directionReminderSent ? 'Esperar datos tras recordatorio' : 'Esperar respuesta del cliente',
      tone: 'warning',
      stage: sent.directionReminderSent ? 'Recordatorio ya enviado' : 'Esperando cliente',
      intentDetail,
      instruction: sent.directionReminderSent
        ? 'No enviar otro recordatorio de direccion de momento. Esperar datos o revisar manualmente.'
        : 'Esperar hasta cumplir 24h desde la incidencia antes de enviar recordatorio.',
      solution: sent.directionReminderSent
        ? 'Ya consta recordatorio de direccion. Propuesta: esperar respuesta o revisar manualmente si urge.'
        : 'Incidencia de direccion sin respuesta. Propuesta: esperar a que el cliente envie datos completos.'
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
        action: 'Ofrecer descuento 5 EUR',
        tone: 'warning',
        stage: '24h sin respuesta',
        template: 'plantilla descuento incidencia no acepta mercancia 5 EUR',
        intentDetail,
        instruction: 'Entrenamiento: enviar una sola plantilla de descuento de 5 EUR si no responde tras 24h.',
        solution: `No acepta mercancia sin respuesta tras ${ageText}. Propuesta: enviar una plantilla con descuento de 5 EUR para recuperar el pedido.`
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
    if (Number.isFinite(ageHours) && ageHours >= 24 && !sent.absentReminderSent) {
      return recommendationPayload({
        action: 'Enviar unico recordatorio ausente',
        tone: 'warning',
        stage: '24h sin respuesta',
        template: 'suleia_incidencia_ausente_v2',
        intentDetail,
        instruction: 'Entrenamiento: enviar un unico aviso extra para coordinar nueva entrega. No enviar mas de un recordatorio.',
        solution: `Ausente sin respuesta tras ${ageText}. Propuesta: enviar un unico recordatorio de coordinacion de entrega.`
      });
    }
    return recommendationPayload({
      action: sent.absentReminderSent ? 'Esperar tras aviso ausente' : 'Esperar instruccion',
      tone: 'warning',
      stage: sent.absentReminderSent ? 'Recordatorio ya enviado' : 'Esperando cliente',
      intentDetail,
      instruction: sent.absentReminderSent
        ? 'No enviar mas recordatorios de ausente. Esperar respuesta o revisar manualmente.'
        : 'Esperar hasta 24h desde la incidencia antes del aviso extra.',
      solution: sent.absentReminderSent
        ? 'Ya consta recordatorio de ausente. Propuesta: esperar respuesta y no duplicar mensajes.'
        : 'Incidencia por ausente sin respuesta. Propuesta: esperar instruccion del cliente.'
    });
  }

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

function transportHistoryFromIssue(issue = {}) {
  const raw = issue.raw || issue;
  const sourceParts = [issue.description, raw.description, issue.solutions, raw.solutions]
    .flatMap((value) => {
      if (!value) return [];
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed.map((item) => typeof item === 'string' ? item : JSON.stringify(item));
        } catch {}
        return [value];
      }
      if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item));
      return [JSON.stringify(value)];
    })
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

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
  const raw = issue.raw || issue;
  return unique([issue.description, raw.description, issue.solutions, raw.solutions]
    .flatMap((value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'object') return [JSON.stringify(value)];
      return [value];
    })
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))
    .join(' | ');
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
  if (explicitIncidence && transportEventMatchesType(explicitIncidence, classification)) return explicitIncidence;
  const operationalIncidences = history.filter((event) => (
    normalize(event?.code) === 'incidence'
    && !/shippingservice|shipping service/.test(normalize(event?.text))
  ));
  return operationalIncidences[operationalIncidences.length - 1] || explicitIncidence || null;
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
    message?.payload
  ].filter(Boolean).join(' ');
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

function clip(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isCustomerMessage(message) {
  const rawMessage = message?.raw || message || {};
  const raw = JSON.stringify(rawMessage);
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || rawMessage?.direction || '');
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
  const lastCustomerMessage = [...messages].reverse().find(isCustomerMessage);
  const lastMessageText = lastCustomerMessage ? clip(messageText(lastCustomerMessage), 220) : '';
  const customerMessageItems = messages.filter(isCustomerMessage);
  const rawCustomerText = customerMessageItems.map(messageText).join(' | ');
  const rawAllText = messages.map(messageText).join(' | ');
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

async function chatbyContextForPhone(phone, subscriberIndex, messagesByUserNs = new Map(), { since = null } = {}) {
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

  const subscriber = findSubscriberInIndexByPhone(subscriberIndex, { phone });
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
    messagesByUserNs.set(userNs, getChatMessages(userNs));
  }
  const allMessages = userNs ? await messagesByUserNs.get(userNs) : [];
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
    subscriberName: subscriber.name || subscriber.full_name || null,
    ...summarizeConversation(Array.isArray(messages) ? messages : [])
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
  let directIncidentsError = null;
  const directRows = [];
  let directIncidentsSucceeded = false;
  const fallbackErrors = [];
  const diagnostics = {
    incidenceStatusScanned: 0,
    ordersWithIssuesScanned: 0,
    ordersBasicScanned: 0,
    statusCandidatesTried: [],
    statusRows: {}
  };
  const rows = [];
  const useDirectIssuesEndpointFirst = true;
  if (useDirectIssuesEndpointFirst) try {
    for (let page = 1; page <= Math.max(pages, 30); page += 1) {
      const incidences = await listDropeaIncidences({ limit, page, status: 'PENDING', sort: 'ID', direction: 'DESC' });
      directIncidentsSucceeded = true;
      if (!Array.isArray(incidences) || !incidences.length) break;
      for (const incidence of incidences.filter((item) => isPendingResolutionIssue(item))) {
        if (!incidence.orderId) continue;
        const order = orderFromIncidence(incidence);
        if (!isPendingResolutionIssue(incidence, order)) continue;
        directRows.push({ order, issue: incidence });
      }
      if (incidences.length < limit) break;
    }
  } catch (error) {
    directIncidentsError = error instanceof Error ? error.message : String(error);
  }
  if (directRows.length) return sortRowsByOrderDesc(directRows);
  if (directIncidentsSucceeded) return [];

  for (let page = 1; page <= Math.max(pages, 5); page += 1) {
    let orders = [];
    try {
      orders = await listDropeaOrdersByStatus({ status: 'INCIDENCE', limit, page });
    } catch (error) {
      fallbackErrors.push(`orders_status_INCIDENCE_page_${page}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (!Array.isArray(orders) || !orders.length) break;
    diagnostics.incidenceStatusScanned += orders.length;
    for (const order of orders) {
      const issues = asArray(order.raw?.issues).filter((issue) => isPendingResolutionIssue(issue, order));
      for (const issue of issues) {
        rows.push({ order, issue });
      }
    }
    if (orders.length < limit) break;
  }
  if (rows.length) return sortRowsByOrderDesc(rows);

  try {
    for (let page = 1; page <= Math.max(pages, 5); page += 1) {
      const incidences = await listDropeaIncidences({ limit, page, status: 'PENDING', sort: 'ID', direction: 'DESC' });
      if (!Array.isArray(incidences) || !incidences.length) break;
      for (const incidence of incidences.filter((item) => isPendingResolutionIssue(item))) {
        if (!incidence.orderId) continue;
        const order = orderFromIncidence(incidence);
        if (!isPendingResolutionIssue(incidence, order)) continue;
        directRows.push({ order, issue: incidence });
      }
      if (incidences.length < limit) break;
    }
  } catch (error) {
    directIncidentsError = error instanceof Error ? error.message : String(error);
  }
  if (directRows.length) return sortRowsByOrderDesc(directRows);

  for (let page = 1; page <= Math.max(pages, 30); page += 1) {
    let orders = [];
    try {
      orders = await listDropeaOrders({ limit, page });
    } catch (error) {
      fallbackErrors.push(`orders_with_issues_page_${page}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (!Array.isArray(orders) || !orders.length) break;
    diagnostics.ordersWithIssuesScanned += orders.length;
    for (const order of orders) {
      const issues = asArray(order.raw?.issues).filter((issue) => isPendingResolutionIssue(issue, order));
      for (const issue of issues) {
        rows.push({ order, issue });
      }
    }
    if (orders.length < limit) break;
  }
  if (rows.length) return sortRowsByOrderDesc(rows);

  if (!rows.length && directIncidentsError) {
    throw new Error(`No se encontraron incidencias. Endpoint directo fallo: ${directIncidentsError}. Diagnostico: ${JSON.stringify(diagnostics)}. Fallbacks: ${fallbackErrors.join(' | ') || 'sin errores; no habia filas con issues/status incidencia'}`);
  }
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

export async function syncPendingIncidents({ limit = 100, pages = 3 } = {}) {
  const updatedAt = new Date().toISOString();
  const incidents = [];

  try {
    const previousCache = loadIncidentsCache();
    const previousByOrderId = new Map((previousCache.incidents || []).map((incident) => [String(incident.orderId), incident]));
    const chatbyByPhone = new Map();
    const messagesByUserNs = new Map();
    const pending = await collectPendingIncidents({ limit, pages });
    const subscriberIndex = await loadSubscriberIndex({ maxPages: 10, limit: 100 });
    const analyzed = await mapWithConcurrency(pending, 12, async ({ order, issue }) => {
      const orderId = String(order?.orderId || issue?.orderId || '');
      const phone = order?.customerPhone || order?.raw?.customer?.phone || issue?.customerPhone || '';
      const fallbackTransportHistory = transportHistoryFromIssue(issue);
      const incidentStartedAt = fallbackTransportHistory[0]?.eventAt || issueDate(order, issue);
      let chatby;
      try {
        const phoneKey = `${digits(phone).slice(-9) || `order:${orderId}`}|${issue?.id || incidentStartedAt || ''}`;
        if (!chatbyByPhone.has(phoneKey)) {
          chatbyByPhone.set(phoneKey, chatbyContextForPhone(phone, subscriberIndex, messagesByUserNs, {
            since: incidentStartedAt
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
          customerMessages: 0
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
            confidence: previous.contextConfidence || previous.confidence || 45
          };
        }
      }
      const classification = classifyIncident(issue, order);
      const cleanLabel = incidentDisplayLabel(classification);
      const glsTracking = await getGlsTrackingHistory({
        trackingUrl: issue?.trackingUrl || issue?.raw?.tracking_url || issue?.raw?.order?.tracking_url,
        tracking: issue?.tracking || issue?.raw?.tracking || issue?.raw?.order?.tracking_code
      }).catch(() => null);
      const mergedTransport = mergeOfficialTransportHistory(glsTracking, issue, fallbackTransportHistory, classification);
      const transportHistory = mergedTransport.history;
      const latestTransportEvent = transportHistory[transportHistory.length - 1] || null;
      const currentIncidenceDate = mergedTransport.incidenceEvent?.eventAt || issueDate(order, issue);
      const recommendation = typeAwareIncidentSolution(classification, chatby, issue);
      const customerSignal = customerSignalForIncident(chatby);
      const confidence = confidenceForIncident({ classification, chatby, recommendation });

      return {
        orderId,
        incidenceId: issue?.id || issue?.incidenceId ? String(issue.id || issue.incidenceId) : null,
        incidenceDate: currentIncidenceDate,
        incidentAgeHours: incidentAgeHours(currentIncidenceDate),
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
        transportHistory,
        transportLatestEvent: latestTransportEvent,
        transportIncidenceEvent: mergedTransport.incidenceEvent,
        transportLogAvailable: transportHistory.length > 0,
        transportLogCompleteness: glsTracking?.history?.length ? 'official_tracking' : 'summary_only',
        transportLogSource: glsTracking?.source || 'Dropea API: description, solutions and tracking fields',
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
        chatbyUserNs: chatby.userNs || null
      };
    });
    incidents.push(...analyzed);

    const sortedIncidents = sortIncidentsByOrderDesc(incidents);
    const payload = {
      ok: true,
      updatedAt,
      intervalMinutes: config.defaultStore.incidentsSyncIntervalMinutes,
      agentName: 'Agente de incidencias',
      agentMode: 'training_read_only',
      agentModeLabel: 'Entrenamiento y analisis; sin acciones automaticas',
      transportHistoryNotice: 'Historial oficial de GLS cuando hay tracking disponible; detalle de Dropea como respaldo.',
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
