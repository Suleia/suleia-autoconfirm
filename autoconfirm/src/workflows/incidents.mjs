import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { listDropeaOrdersByStatus } from '../clients/dropea.mjs';
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

function issueReason(issue) {
  return issue?.incidence_code
    || issue?.code
    || issue?.reason
    || issue?.type
    || issue?.name
    || 'Incidencia pendiente';
}

function issueDate(order, issue) {
  return issue?.created_at
    || issue?.createdAt
    || issue?.date
    || issue?.opened_at
    || order.raw?.updated_at
    || order.raw?.created_at
    || order.createdAt
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

function isCustomerMessage(message) {
  const raw = JSON.stringify(message || {});
  const from = normalize(message?.from || message?.sender || message?.role || message?.type || message?.direction || '');
  if (from.includes('customer') || from.includes('user') || from.includes('cliente') || from.includes('inbound')) return true;
  if (from.includes('bot') || from.includes('agent') || from.includes('admin') || from.includes('outbound')) return false;
  return raw.includes('"is_bot":false') || raw.includes('"from_me":false') || raw.includes('"incoming"');
}

function summarizeConversation(messages = []) {
  const customerMessages = messages.filter(isCustomerMessage);
  const customerText = normalize(customerMessages.map(messageText).join(' | '));
  const allText = normalize(messages.map(messageText).join(' | '));

  if (!messages.length) {
    return {
      status: 'Sin conversación localizada',
      summary: 'No he encontrado conversación en Chatby con ese teléfono.',
      proposedSolution: 'Revisar teléfono en Dropea y contactar manualmente antes de resolver la incidencia.',
      customerMessages: 0
    };
  }

  if (/no acept|rechaz|no lo quiero|no quiero|cancel|anul|no me interesa|no voy a recibir/.test(customerText)) {
    return {
      status: 'Cliente rechaza o cancela',
      summary: 'La conversación contiene señales de rechazo, cancelación o no aceptación del pedido.',
      proposedSolution: 'No insistir en confirmación. Revisar si procede cancelar/rechazar en Dropea y registrar motivo.',
      customerMessages: customerMessages.length
    };
  }

  if (/direccion|direcci|calle|numero|piso|portal|codigo postal|cp|datos/.test(customerText)) {
    return {
      status: 'Necesita corrección de dirección',
      summary: 'El cliente menciona datos de entrega o dirección, por lo que la incidencia parece relacionada con información de envío.',
      proposedSolution: 'Actualizar datos en Dropea si el cliente dejó dirección completa. Si faltan datos, pedirlos por Chatby.',
      customerMessages: customerMessages.length
    };
  }

  if (/manana|mañana|otro dia|otro día|reparto|entrega|ausente|no estaba|no habia nadie|no había nadie|horario/.test(customerText)) {
    return {
      status: 'Reprogramar entrega',
      summary: 'El cliente habla de entrega, ausencia, horario o nueva fecha.',
      proposedSolution: 'Responder con opción de nueva entrega y trasladar la solución a Dropea cuando haya fecha clara.',
      customerMessages: customerMessages.length
    };
  }

  if (/confirm|correcto|si\b|sí\b|adelante|ok|vale/.test(customerText)) {
    return {
      status: 'Cliente muestra conformidad',
      summary: 'Hay señales positivas o de conformidad del cliente, pero la incidencia sigue abierta.',
      proposedSolution: 'Comprobar si Dropea permite enviar solución o reactivar entrega. No cancelar sin revisar incidencia.',
      customerMessages: customerMessages.length
    };
  }

  if (allText) {
    return {
      status: customerMessages.length ? 'Respuesta sin intención clara' : 'Solo mensajes salientes',
      summary: customerMessages.length
        ? 'Hay respuesta del cliente, pero no contiene una intención operativa clara.'
        : 'La conversación contiene mensajes enviados, pero no veo respuesta del cliente.',
      proposedSolution: customerMessages.length
        ? 'Revisar manualmente la conversación antes de resolver la incidencia.'
        : 'Enviar recordatorio o contactar manualmente si la incidencia requiere acción.',
      customerMessages: customerMessages.length
    };
  }

  return {
    status: 'Sin señal útil',
    summary: 'No hay texto suficiente para interpretar la incidencia desde Chatby.',
    proposedSolution: 'Revisión manual.',
    customerMessages: customerMessages.length
  };
}

async function chatbyContextForPhone(phone) {
  if (!digits(phone)) {
    return {
      ok: false,
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
  const rows = [];
  const statuses = ['PENDING', 'CONFIRMED', 'IN_PREPARATION', 'PREPARED', 'IN_TRANSIT'];

  for (const status of statuses) {
    for (let page = 1; page <= pages; page += 1) {
      let orders = [];
      try {
        orders = await listDropeaOrdersByStatus({ status, limit, page });
      } catch (error) {
        if (status === 'PENDING') throw error;
        break;
      }
      if (!Array.isArray(orders) || !orders.length) break;
      for (const order of orders) {
        const issues = asArray(order.raw?.issues).filter(isPendingIssue);
        for (const issue of issues) {
          rows.push({ order, issue });
        }
      }
      if (orders.length < limit) break;
    }
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
    const pending = await collectPendingIncidents({ limit, pages });
    for (const { order, issue } of pending) {
      const phone = order.customerPhone || order.raw?.customer?.phone || '';
      let chatby;
      try {
        chatby = await chatbyContextForPhone(phone);
      } catch (error) {
        chatby = {
          ok: false,
          status: 'Error leyendo Chatby',
          summary: error instanceof Error ? error.message : String(error),
          proposedSolution: 'No resolver automáticamente. Revisar Chatby o credenciales.',
          userNs: null,
          customerMessages: 0
        };
      }

      incidents.push({
        orderId: String(order.orderId),
        incidenceId: issue?.id ? String(issue.id) : null,
        incidenceDate: issueDate(order, issue),
        reason: issue ? issueReason(issue) : 'Pedido con incidencia',
        issueStatus: issue ? (issueStatus(issue) || 'PENDIENTE') : 'PENDIENTE',
        orderStatus: order.status || 'WITH_ISSUE',
        customerName: order.customerName || order.raw?.customer?.full_name || '',
        phone,
        amount: order.orderAmount ?? null,
        chatbyStatus: chatby.status,
        chatbySummary: chatby.summary,
        proposedSolution: chatby.proposedSolution,
        customerMessages: chatby.customerMessages || 0,
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
