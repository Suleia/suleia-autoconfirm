import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { getDropeaOrderById, listDropeaIncidences, listDropeaOrders, listDropeaOrdersBasic, listDropeaOrdersByStatusBasic, listDropeaOrderStateValues } from '../clients/dropea.mjs';
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
  const likely = [
    'INCIDENCE',
    'INCIDENT',
    'INCIDENTS',
    'ISSUE',
    'ISSUES',
    'WITH_INCIDENT',
    'WITH_INCIDENTS',
    'WITH_INCIDENCE',
    'WITH_INCIDENCES',
    'HAS_INCIDENT',
    'HAS_INCIDENCE',
    'CON_INCIDENCIA',
    'INCIDENCIA',
    'PENDING_ISSUE',
    'PENDING_INCIDENT',
    'PENDING_INCIDENCE',
    'UNRESOLVED',
    'PENDING_RESOLUTION'
  ];

  const matchingDiscovered = discovered.filter((status) => {
    const text = normalize(status);
    return text.includes('incid')
      || text.includes('issue')
      || text.includes('problem')
      || text.includes('resolver')
      || text.includes('unresolved');
  });

  return unique([...matchingDiscovered, ...likely]);
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
  let directIncidentsError = null;
  const fallbackErrors = [];
  const diagnostics = {
    ordersWithIssuesScanned: 0,
    ordersBasicScanned: 0,
    statusCandidatesTried: [],
    statusRows: {}
  };
  try {
    const rows = [];
    for (let page = 1; page <= pages; page += 1) {
      const incidences = await listDropeaIncidences({ limit, page });
      if (!Array.isArray(incidences) || !incidences.length) break;
      for (const incidence of incidences.filter(isPendingIssue)) {
        let order = null;
        if (incidence.orderId) {
          order = await getDropeaOrderById(incidence.orderId).catch(() => null);
        }
        rows.push({ order, issue: incidence });
      }
      if (incidences.length < limit) break;
    }
    if (rows.length) return rows;
  } catch (error) {
    directIncidentsError = error instanceof Error ? error.message : String(error);
    // Fallback to order scans for Dropea API versions that do not expose incidents directly.
  }

  const rows = [];
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

  for (let page = 1; page <= Math.max(pages, 10); page += 1) {
    let orders = [];
    try {
      orders = await listDropeaOrdersBasic({ limit, page });
    } catch (error) {
      fallbackErrors.push(`orders_basic_page_${page}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (!Array.isArray(orders) || !orders.length) break;
    diagnostics.ordersBasicScanned += orders.length;
    for (const order of orders.filter(orderLooksLikeIncident)) {
      rows.push({
        order,
        issue: {
          id: null,
          incidence_code: 'Incidencia pendiente',
          status: 'PENDIENTE',
          created_at: order?.raw?.created_at || null
        }
      });
    }
    if (orders.length < limit) break;
  }
  if (rows.length) return rows;

  const defaultStatuses = [];
  let discoveredStatuses = defaultStatuses;
  try {
    discoveredStatuses = await listDropeaOrderStateValues();
  } catch {
    discoveredStatuses = defaultStatuses;
  }

  const statusCandidates = incidentStatusCandidates(discoveredStatuses);
  diagnostics.statusCandidatesTried = statusCandidates;

  for (const status of statusCandidates) {
    for (let page = 1; page <= pages; page += 1) {
      let orders = [];
      try {
        orders = await listDropeaOrdersByStatusBasic({ status, limit, page });
      } catch (error) {
        fallbackErrors.push(`orders_status_${status}_page_${page}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (!Array.isArray(orders) || !orders.length) break;
      diagnostics.statusRows[status] = (diagnostics.statusRows[status] || 0) + orders.length;
      for (const order of orders) {
        rows.push({
          order,
          issue: {
            id: null,
            incidence_code: 'Incidencia pendiente',
            status: 'PENDIENTE',
            created_at: order?.raw?.created_at || null,
            source: `orders_status_${status}`
          }
        });
      }
      if (orders.length < limit) break;
    }
  }
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
    const pending = await collectPendingIncidents({ limit, pages });
    for (const { order, issue } of pending) {
      const phone = order?.customerPhone || order?.raw?.customer?.phone || issue?.customerPhone || '';
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
        orderId: String(order?.orderId || issue?.orderId || ''),
        incidenceId: issue?.id || issue?.incidenceId ? String(issue.id || issue.incidenceId) : null,
        incidenceDate: issueDate(order, issue),
        reason: issue ? issueReason(issue) : 'Pedido con incidencia',
        issueStatus: issue ? (issueStatus(issue) || 'PENDIENTE') : 'PENDIENTE',
        orderStatus: order?.status || issue?.orderStatus || 'CON INCIDENCIA',
        customerName: order?.customerName || order?.raw?.customer?.full_name || issue?.customerName || '',
        phone,
        amount: order?.orderAmount ?? null,
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
