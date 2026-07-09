import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { listDropeaOrdersByStatus } from '../clients/dropea.mjs';
import { findSubscriberForOrderRobust, getChatMessages, subscriberConfirmsOrderRobust } from '../clients/chatby.mjs';
import { loadState, saveState } from '../storage.mjs';

const config = getAppConfig();
const cachePath = path.join(config.dataDir, 'dashboard', 'operational-orders-cache.json');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function messageContent(message = {}) {
  const raw = message.raw || message;
  return [
    message.content,
    message.message,
    message.text,
    message.button_text,
    message.buttonText,
    raw.content,
    raw.message,
    raw.text,
    raw.button_text,
    raw.buttonText,
    raw.payload?.title,
    raw.payload?.body,
    raw.title
  ].filter(Boolean).join(' ');
}

function isCustomerMessage(message = {}) {
  const raw = message.raw || message;
  const role = normalize(message.role || raw.role || raw.sender || raw.direction || raw.type || raw.from_type || raw.sender_type);
  const text = normalize(messageContent(message));
  if (['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.is_echo === true || raw.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  if (/dropea_pedido_nuevo|pedido_nuevo_v|plantilla|template/.test(text)) return false;
  return Boolean(text);
}

function classifyCustomerMessages(messages = []) {
  const customerMessages = messages.filter(isCustomerMessage);
  const text = normalize(customerMessages.map(messageContent).join(' | '));

  if (!customerMessages.length || !text) {
    return {
      signal: 'NO_RESPONSE',
      status: 'PENDING',
      agentAction: 'wait_customer',
      agentIntent: 'NO_RESPONSE',
      agentConfidence: 0,
      agentReason: 'Sin respuesta del cliente en Chatby.',
      customerMessages: 0
    };
  }

  if (/cambio de direccion|cambiar direccion|cambiar datos|direccion incorrecta|direcc/.test(text)) {
    return {
      signal: 'ADDRESS_CHANGE',
      status: 'PENDING_ADDRESS_CHANGE',
      agentAction: 'would_not_confirm',
      agentIntent: 'ADDRESS_CHANGE_REQUESTED',
      agentConfidence: 100,
      agentReason: 'El cliente pidio cambiar direccion o datos de entrega.',
      customerMessages: customerMessages.length
    };
  }

  if (/no lo quiero|no quiero|cancel|anular|no enviar|ya no me interesa|no me interesa|rechaz/.test(text)) {
    return {
      signal: 'CANCEL',
      status: 'NOT_CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_not_confirm',
      agentIntent: 'NO_CONFIRM',
      agentConfidence: 100,
      agentReason: 'El cliente rechazo o pidio cancelar el pedido.',
      customerMessages: customerMessages.length
    };
  }

  if (/confirmar mi pedido|confirmo|confirmado|si lo quiero|lo quiero|adelante|perfecto|\bok\b|\bvale\b/.test(text)) {
    return {
      signal: 'CONFIRM',
      status: 'PENDING',
      agentAction: 'would_confirm',
      agentIntent: 'CONFIRM',
      agentConfidence: 100,
      agentReason: 'El cliente confirmo el pedido en Chatby.',
      customerMessages: customerMessages.length
    };
  }

  return {
    signal: 'UNCLEAR',
    status: 'PENDING',
    agentAction: 'manual_review',
    agentIntent: 'UNCLEAR',
    agentConfidence: 60,
    agentReason: 'El cliente respondio, pero la intencion no es concluyente.',
    customerMessages: customerMessages.length
  };
}

function guessProduct(order) {
  const raw = JSON.stringify(order.raw || order || '').toLowerCase();
  if (raw.includes('colla') || raw.includes('gum')) return 'Collagum';
  if (raw.includes('tiras') || raw.includes('v34') || raw.includes('blanque')) return 'Tiras blanqueadoras';
  if (raw.includes('nida')) return 'NIDA premium';
  return 'Producto';
}

async function collectPendingOrders({ limit = 100, pages = 10 } = {}) {
  const orders = [];
  for (let page = 1; page <= pages; page += 1) {
    const rows = await listDropeaOrdersByStatus({ status: 'PENDING', limit, page });
    if (!Array.isArray(rows) || !rows.length) break;
    orders.push(...rows);
    if (rows.length < limit) break;
  }
  return orders;
}

async function enrichPendingOrder(order, previous = null) {
  let subscriber = null;
  let messages = [];
  let chatbyStatus = 'Sin Chatby';
  let chatbyUserNs = null;
  let chatbyError = null;
  let signal = {
    signal: 'NO_RESPONSE',
    status: 'PENDING',
    agentAction: 'wait_customer',
    agentIntent: 'NO_RESPONSE',
    agentConfidence: 0,
    agentReason: 'Sin respuesta del cliente en Chatby.',
    customerMessages: 0
  };

  try {
    subscriber = await findSubscriberForOrderRobust({
      phone: order.customerPhone,
      orderId: order.orderId,
      maxPages: 8
    });
    chatbyUserNs = subscriber?.user_ns || subscriber?.userNs || subscriber?.ns || null;
    messages = chatbyUserNs ? await getChatMessages(chatbyUserNs) : [];
    signal = subscriberConfirmsOrderRobust(subscriber)
      ? {
          signal: 'CONFIRM',
          status: 'PENDING',
          agentAction: 'would_confirm',
          agentIntent: 'CONFIRM',
          agentConfidence: 100,
          agentReason: 'Chatby marca al cliente como confirmado.',
          customerMessages: Array.isArray(messages) ? messages.filter(isCustomerMessage).length : 0
        }
      : classifyCustomerMessages(Array.isArray(messages) ? messages : []);
    chatbyStatus = chatbyUserNs ? 'Chatby revisado' : 'Sin conversacion localizada';
  } catch (error) {
    chatbyError = error instanceof Error ? error.message : String(error);
    chatbyStatus = 'Error revisando Chatby';
    if (previous && (previous.customerConfirmed || Number(previous.customerMessages || 0) > 0 || previous.customerSignalRaw)) {
      return {
        ...previous,
        customer: order.customerName || previous.customer || '',
        phone: order.customerPhone || previous.phone || '',
        createdAt: order.raw?.created_at || order.raw?.createdAt || previous.createdAt || '',
        dropeaStatus: order.status || previous.dropeaStatus || 'PENDING',
        amount: Number(order.orderAmount) || previous.amount || null,
        product: guessProduct(order) || previous.product,
        liveSource: 'Dropea + Chatby cache conservada',
        chatbyStatus: 'Chatby limitado: mantengo ultima senal valida',
        chatbyLiveCheckedAt: new Date().toISOString(),
        chatbyError,
        raw: order.raw || previous.raw || {}
      };
    }
  }

  return {
    orderId: String(order.orderId || ''),
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.raw?.created_at || order.raw?.createdAt || '',
    dropeaStatus: order.status || 'PENDING',
    status: signal.status,
    amount: Number(order.orderAmount) || null,
    issue: order.raw?.issues ? 'Si' : 'No',
    issueCode: order.raw?.issues?.incidence_code || '',
    note: signal.agentReason,
    confirmedAt: '',
    product: guessProduct(order),
    liveSource: 'Dropea + Chatby cache',
    agentAction: signal.agentAction,
    agentIntent: signal.agentIntent,
    agentConfidence: signal.agentConfidence,
    agentReason: signal.agentReason,
    customerSignalSource: 'chatby_cache',
    customerSignalRaw: signal.signal,
    customerConfirmed: signal.signal === 'CONFIRM',
    customerMessages: signal.customerMessages,
    chatbyStatus,
    chatbyUserNs,
    chatbyLiveCheckedAt: new Date().toISOString(),
    chatbyError,
    raw: order.raw || {}
  };
}

export function loadOperationalOrdersCache() {
  return readJson(cachePath, {
    ok: false,
    updatedAt: null,
    intervalMinutes: config.defaultStore.operationalDashboardIntervalMinutes,
    orders: [],
    error: null
  });
}

export async function syncOperationalOrders({ limit = 100, pages = 10 } = {}) {
  const updatedAt = new Date().toISOString();

  try {
    const previousCache = loadOperationalOrdersCache();
    const previousByOrderId = new Map((previousCache.orders || []).map((order) => [String(order.orderId), order]));
    const pending = await collectPendingOrders({ limit, pages });
    const orders = [];
    for (const order of pending) {
      orders.push(await enrichPendingOrder(order, previousByOrderId.get(String(order.orderId))));
    }

    const payload = {
      ok: true,
      updatedAt,
      intervalMinutes: config.defaultStore.operationalDashboardIntervalMinutes,
      count: orders.length,
      confirmedByCustomer: orders.filter((order) => order.customerConfirmed).length,
      withCustomerResponse: orders.filter((order) => Number(order.customerMessages) > 0).length,
      orders,
      error: null
    };
    writeJson(cachePath, payload);

    const state = { ...loadState() };
    state.lastOperationalOrdersSyncAt = updatedAt;
    state.lastOperationalOrdersSyncError = null;
    state.lastOperationalOrdersSyncCount = orders.length;
    saveState(state);

    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const previous = loadOperationalOrdersCache();
    const payload = {
      ...previous,
      ok: false,
      updatedAt: previous.updatedAt || updatedAt,
      error: message
    };
    writeJson(cachePath, payload);

    const state = { ...loadState() };
    state.lastOperationalOrdersSyncAt = updatedAt;
    state.lastOperationalOrdersSyncError = message;
    saveState(state);

    throw error;
  }
}
