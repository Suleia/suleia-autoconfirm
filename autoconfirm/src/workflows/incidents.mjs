import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { getDropeaOrderById, listDropeaIncidences, listDropeaOrders, listDropeaOrdersBasic, listDropeaOrdersByStatus, listDropeaOrdersByStatusBasic, listDropeaOrderStateValues } from '../clients/dropea.mjs';
import { findSubscriberByPhone, getChatMessages } from '../clients/chatby.mjs';
import { loadState, saveState } from '../storage.mjs';

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

function isPendingIssue(issue) {
  const status = normalize(issueStatus(issue));
  if (!status) return true;
  return status.includes('pending')
    || status.includes('pendiente')
    || status.includes('open')
    || status.includes('abiert')
    || status.includes('unresolved')
    || status.includes('resolver');
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

function typeAwareIncidentSolution(classification, chatby) {
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
    || null;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function clip(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isCustomerMessage(message) {
  const raw = JSON.stringify(message || {});
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || '');
  if (from.includes('customer') || from.includes('user') || from.includes('cliente') || from.includes('inbound')) return true;
  if (from.includes('bot') || from.includes('agent') || from.includes('admin') || from.includes('outbound')) return false;
  return raw.includes('"is_bot":false') || raw.includes('"from_me":false') || raw.includes('"incoming"');
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
    customerMessages
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

async function chatbyContextForPhone(phone) {
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

  const subscriber = await findSubscriberByPhone({ phone, maxPages: 20 });
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
  const messages = userNs ? await getChatMessages(userNs) : [];
  return {
    ok: true,
    userNs,
    subscriberName: subscriber.name || subscriber.full_name || null,
    ...summarizeConversation(Array.isArray(messages) ? messages : [])
  };
}

async function collectPendingIncidents({ limit = 100, pages = 3 } = {}) {
  let directIncidentsError = null;
  const directRows = [];
  const fallbackErrors = [];
  const diagnostics = {
    incidenceStatusScanned: 0,
    ordersWithIssuesScanned: 0,
    ordersBasicScanned: 0,
    statusCandidatesTried: [],
    statusRows: {}
  };
  const rows = [];
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
      const issues = asArray(order.raw?.issues).filter(isPendingIssue);
      for (const issue of issues) {
        rows.push({ order, issue });
      }
    }
    if (orders.length < limit) break;
  }
  if (rows.length) return rows;

  try {
    for (let page = 1; page <= Math.max(pages, 5); page += 1) {
      const incidences = await listDropeaIncidences({ limit, page });
      if (!Array.isArray(incidences) || !incidences.length) break;
      for (const incidence of incidences.filter(isPendingIssue)) {
        if (!incidence.orderId) continue;
        const order = await getDropeaOrderById(incidence.orderId).catch(() => null);
        if (!order || String(order.status || '').toUpperCase() !== 'INCIDENCE') continue;
        directRows.push({ order, issue: incidence });
      }
      if (incidences.length < limit) break;
    }
  } catch (error) {
    directIncidentsError = error instanceof Error ? error.message : String(error);
  }
  if (directRows.length) return directRows;

  for (let page = 1; page <= Math.max(pages, 10); page += 1) {
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
      const issues = asArray(order.raw?.issues).filter(isPendingIssue);
      for (const issue of issues) {
        rows.push({ order, issue });
      }
    }
    if (orders.length < limit) break;
  }
  if (rows.length) return rows;

  if (!rows.length && directIncidentsError) {
    throw new Error(`No se encontraron incidencias. Endpoint directo fallo: ${directIncidentsError}. Diagnostico: ${JSON.stringify(diagnostics)}. Fallbacks: ${fallbackErrors.join(' | ') || 'sin errores; no habia filas con issues/status incidencia'}`);
  }
  return rows;
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
    const pending = await collectPendingIncidents({ limit, pages });
    for (const { order, issue } of pending) {
      const orderId = String(order?.orderId || issue?.orderId || '');
      const phone = order?.customerPhone || order?.raw?.customer?.phone || issue?.customerPhone || '';
      let chatby;
      try {
        const phoneKey = digits(phone).slice(-9) || `order:${orderId}`;
        if (chatbyByPhone.has(phoneKey)) {
          chatby = chatbyByPhone.get(phoneKey);
        } else {
          chatby = await chatbyContextForPhone(phone);
          chatbyByPhone.set(phoneKey, chatby);
        }
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
      const recommendation = typeAwareIncidentSolution(classification, chatby);
      const customerSignal = customerSignalForIncident(chatby);
      const confidence = confidenceForIncident({ classification, chatby, recommendation });

      incidents.push({
        orderId,
        incidenceId: issue?.id || issue?.incidenceId ? String(issue.id || issue.incidenceId) : null,
        incidenceDate: issueDate(order, issue),
        reason: classification.label,
        reasonCode: classification.code || null,
        rawReason: classification.rawReason,
        incidentType: classification.type,
        incidentTypeLabel: classification.label,
        incidentTypeTone: classification.tone,
        issueStatus: issue ? (issueStatus(issue) || 'PENDIENTE') : 'PENDIENTE',
        orderStatus: order?.status || issue?.orderStatus || 'CON INCIDENCIA',
        customerName: order?.customerName || order?.raw?.customer?.full_name || issue?.customerName || '',
        phone,
        amount: order?.orderAmount ?? null,
        chatbyIntent: chatby.intent || 'unknown',
        chatbyStatus: chatby.status,
        chatbySummary: chatby.summary,
        customerSignalLabel: customerSignal.label,
        customerSignalTone: customerSignal.tone,
        customerSignalDetail: customerSignal.detail,
        proposedSolution: recommendation.solution,
        actionRecommended: recommendation.action,
        actionTone: recommendation.tone,
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
      });
    }

    const payload = {
      ok: true,
      updatedAt,
      intervalMinutes: config.defaultStore.incidentsSyncIntervalMinutes,
      count: incidents.length,
      incidents,
      error: null
    };
    writeJson(cachePath, payload);
    const state = { ...loadState() };
    state.lastIncidentsSyncAt = updatedAt;
    state.lastIncidentsSyncError = null;
    state.lastIncidentsSyncCount = incidents.length;
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
    const state = { ...loadState() };
    state.lastIncidentsSyncAt = updatedAt;
    state.lastIncidentsSyncError = message;
    saveState(state);
    throw error;
  }
}
