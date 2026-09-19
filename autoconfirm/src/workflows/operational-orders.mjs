import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { listDropeaOrdersByStatus } from '../clients/dropea.mjs';
import {
  findSubscriberInIndexByPhone,
  findSubscriberInIndexForOrder,
  getChatMessages,
  loadSubscriberIndex,
  subscriberConfirmsOrderRobust
} from '../clients/chatby.mjs';
import { loadState, saveState } from '../storage.mjs';
import { syncOperationalOrdersCacheToSupabase } from '../db/supabase-store.mjs';
import { customerConversationIntentForOrder } from './orders.mjs';

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
  if (raw.from_me === false || raw.fromMe === false || raw.incoming === true || raw.is_incoming === true) return true;
  if (raw.is_echo === true || raw.isEcho === true) return false;
  if (raw.from_me === true || raw.fromMe === true || raw.outgoing === true || raw.is_outgoing === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  if (/dropea_pedido_|pedido_nuevo_v|pedido_preparado_v|plantilla|template/.test(text)) return false;
  return false;
}

function messageDate(message = {}) {
  const raw = message.raw || message;
  const value = message.created_at
    || message.createdAt
    || message.timestamp
    || message.sent_at
    || message.sentAt
    || message.ts
    || raw.created_at
    || raw.createdAt
    || raw.timestamp
    || raw.ts
    || null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function messagesForCurrentOrder(messages = [], createdAt) {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(created)) return messages;
  const threshold = created - (15 * 60 * 1000);
  return messages.filter((message) => {
    const timestamp = messageDate(message);
    if (!timestamp) return true;
    return new Date(timestamp).getTime() >= threshold;
  });
}

function priorOrderEvidence(messages = [], createdAt = null) {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  const priorMessages = Number.isFinite(created)
    ? messages.filter((message) => {
        const timestamp = messageDate(message);
        return timestamp ? new Date(timestamp).getTime() < created : true;
      })
    : messages;
  const prepared = priorMessages.filter((message) => /dropea_pedido_preparado_v1|pedido_preparado_v1/.test(normalize(messageContent(message))));
  const rejected = priorMessages.filter((message) => /dropea_pedido_(?:rechazado|cancelado)|pedido_(?:rechazado|cancelado)|pedido cancelado|pedido rechazado/.test(normalize(messageContent(message))));
  if (!prepared.length && !rejected.length) {
    return {
      priorOrderDetected: false,
      priorOrderState: '',
      priorOrderWarning: '',
      priorPreparedAt: null
    };
  }

  const lastPrepared = prepared[prepared.length - 1] || null;
  const lastRejected = rejected[rejected.length - 1] || null;
  const state = lastRejected ? 'Pedido anterior rechazado o cancelado' : 'Pedido anterior preparado o en transito';
  return {
    priorOrderDetected: true,
    priorOrderState: state,
    priorOrderWarning: `${state}. Hay una plantilla dropea_pedido_preparado_v1 previa en la conversacion; revisar duplicidad antes de actuar.`,
    priorPreparedAt: messageDate(lastPrepared || lastRejected)
  };
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

export function classifyCustomerMessages(messages = []) {
  const customerMessages = messages.filter(isCustomerMessage);
  const orderedCustomerMessages = [...customerMessages].sort((left, right) => {
    const leftAt = new Date(messageDate(left) || 0).getTime();
    const rightAt = new Date(messageDate(right) || 0).getTime();
    return leftAt - rightAt;
  });
  const lastCustomerMessage = orderedCustomerMessages.length
    ? messageContent(orderedCustomerMessages[orderedCustomerMessages.length - 1]).replace(/\s+/g, ' ').trim()
    : '';

  if (!orderedCustomerMessages.length || !normalize(orderedCustomerMessages.map(messageContent).join(' | '))) {
    return {
      signal: 'NO_RESPONSE',
      status: 'PENDING',
      agentAction: 'wait_customer',
      agentIntent: 'NO_RESPONSE',
      agentConfidence: 25,
      agentReason: 'Sin respuesta del cliente en Chatby.',
      customerMessages: 0,
      lastCustomerMessage,
      customerActionLabel: 'Sin respuesta del cliente',
      customerActionDetail: 'No veo mensajes entrantes ni botones pulsados por el cliente.'
    };
  }

  const governedMessages = orderedCustomerMessages.map((message) => ({
    role: 'customer',
    content: messageContent(message),
    raw: message.raw || message
  }));
  const intent = customerConversationIntentForOrder(governedMessages, {});

  if (intent?.intent === 'ADDRESS_CHANGE') {
    return {
      signal: 'ADDRESS_CHANGE',
      status: 'PENDING_ADDRESS_CHANGE',
      agentAction: 'would_not_confirm',
      agentIntent: 'ADDRESS_CHANGE_REQUESTED',
      agentConfidence: 100,
      agentReason: 'El cliente pidio cambiar direccion o datos de entrega.',
      customerMessages: customerMessages.length,
      lastCustomerMessage,
      customerActionLabel: 'Pidio cambiar direccion',
      customerActionDetail: lastCustomerMessage || 'Respuesta con contexto de cambio de datos de envio.'
    };
  }

  if (intent?.intent === 'CANCEL') {
    return {
      signal: 'CANCEL',
      status: 'NOT_CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_not_confirm',
      agentIntent: 'NO_CONFIRM',
      agentConfidence: 100,
      agentReason: 'El cliente rechazo o pidio cancelar el pedido.',
      customerMessages: customerMessages.length,
      lastCustomerMessage,
      customerActionLabel: 'Pidio cancelar o rechazar',
      customerActionDetail: lastCustomerMessage || 'Respuesta con contexto de cancelacion o rechazo.'
    };
  }

  if (intent?.intent === 'CONFIRM') {
    return {
      signal: 'CONFIRM',
      status: 'PENDING',
      agentAction: 'would_confirm',
      agentIntent: 'CONFIRM',
      agentConfidence: Math.round(Number(intent.confidence) || 100),
      agentReason: 'El cliente confirmo el pedido en Chatby.',
      customerMessages: customerMessages.length,
      lastCustomerMessage,
      customerActionLabel: 'Confirmo el pedido',
      customerActionDetail: lastCustomerMessage || 'Boton o texto de confirmacion detectado.'
    };
  }

  return {
    signal: 'UNCLEAR',
    status: 'PENDING',
    agentAction: 'manual_review',
    agentIntent: 'UNCLEAR',
    agentConfidence: 68,
    agentReason: 'El cliente respondio, pero la intencion no es concluyente.',
    customerMessages: customerMessages.length,
    lastCustomerMessage,
    customerActionLabel: 'Cliente respondio',
    customerActionDetail: lastCustomerMessage || 'Hay respuesta, pero no basta para actuar automaticamente.'
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

export async function enrichPendingOrder(
  order,
  previous = null,
  subscriberIndex = null,
  messagesByUserNs = new Map(),
  subscriberIndexError = null
) {
  let subscriber = null;
  let conversationSubscriber = null;
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

  if (subscriberIndexError) {
    return {
      orderId: String(order.orderId || ''),
      customer: order.customerName || previous?.customer || '',
      phone: order.customerPhone || previous?.phone || '',
      createdAt: order.raw?.created_at || order.raw?.createdAt || previous?.createdAt || '',
      dropeaStatus: order.status || previous?.dropeaStatus || 'PENDING',
      status: 'PENDING',
      amount: Number(order.orderAmount) || previous?.amount || null,
      issue: order.raw?.issues ? 'Si' : 'No',
      issueCode: order.raw?.issues?.incidence_code || '',
      note: 'La conversación no puede verificarse; no se infiere respuesta ni ausencia de respuesta.',
      confirmedAt: '',
      product: guessProduct(order),
      liveSource: 'Dropea V2; Chatby no verificable',
      agentAction: 'manual_review',
      agentIntent: 'NOT_VERIFIABLE',
      agentConfidence: 0,
      agentReason: 'Chatby no está disponible para verificar la respuesta del cliente.',
      customerSignalSource: 'chatby_unavailable',
      customerSignalRaw: 'NOT_VERIFIABLE',
      customerConfirmed: false,
      customerMessages: 0,
      lastCustomerMessage: '',
      customerActionLabel: 'Respuesta no verificable',
      customerActionDetail: 'El pedido se muestra desde Dropea, pero no se tomará ninguna decisión dependiente de Chatby.',
      chatbyStatus: 'Chatby no verificable',
      chatbyUserNs: null,
      chatbyLiveCheckedAt: new Date().toISOString(),
      chatbyError: subscriberIndexError,
      priorOrderDetected: false,
      priorOrderState: '',
      priorOrderWarning: '',
      priorPreparedAt: null,
      raw: order.raw || previous?.raw || {}
    };
  }

  try {
    subscriber = findSubscriberInIndexForOrder(subscriberIndex, {
      phone: order.customerPhone,
      orderId: order.orderId,
      allowConfirmedPhoneFallback: false
    });
    conversationSubscriber = subscriber || findSubscriberInIndexByPhone(subscriberIndex, {
      phone: order.customerPhone
    });
    chatbyUserNs = conversationSubscriber?.user_ns || conversationSubscriber?.userNs || conversationSubscriber?.ns || null;
    if (chatbyUserNs && !messagesByUserNs.has(chatbyUserNs)) {
      messagesByUserNs.set(chatbyUserNs, getChatMessages(chatbyUserNs));
    }
    messages = chatbyUserNs ? await messagesByUserNs.get(chatbyUserNs) : [];
    const currentMessages = messagesForCurrentOrder(
      Array.isArray(messages) ? messages : [],
      order.raw?.created_at || order.raw?.createdAt
    );
    // Only the subscriber matched to this order can confirm the current order.
    // The phone fallback is used exclusively to inspect prior-order history.
    signal = subscriberConfirmsOrderRobust(subscriber)
      ? {
          signal: 'CONFIRM',
          status: 'PENDING',
          agentAction: 'would_confirm',
          agentIntent: 'CONFIRM',
          agentConfidence: 100,
          agentReason: 'Chatby marca al cliente como confirmado.',
          customerMessages: currentMessages.filter(isCustomerMessage).length,
          lastCustomerMessage: currentMessages.length
            ? messageContent([...currentMessages].reverse().find(isCustomerMessage) || {}).replace(/\s+/g, ' ').trim()
            : '',
          customerActionLabel: 'Confirmado en Chatby',
          customerActionDetail: 'Chatby tiene etiqueta/estado/campo de confirmacion para este cliente.'
        }
      : classifyCustomerMessages(currentMessages);
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

  const priorOrder = priorOrderEvidence(
    Array.isArray(messages) ? messages : [],
    order.raw?.created_at || order.raw?.createdAt
  );
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
    lastCustomerMessage: signal.lastCustomerMessage || '',
    customerActionLabel: signal.customerActionLabel || '',
    customerActionDetail: signal.customerActionDetail || '',
    chatbyStatus,
    chatbyUserNs,
    chatbyLiveCheckedAt: new Date().toISOString(),
    chatbyError,
    ...priorOrder,
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
    let subscriberIndex = null;
    let subscriberIndexError = null;
    try {
      subscriberIndex = await loadSubscriberIndex({ maxPages: 10, limit: 100 });
    } catch (error) {
      subscriberIndexError = error instanceof Error ? error.message : String(error);
    }
    const messagesByUserNs = new Map();
    const orders = await mapWithConcurrency(pending, 12, (order) => (
      enrichPendingOrder(
        order,
        previousByOrderId.get(String(order.orderId)),
        subscriberIndex,
        messagesByUserNs,
        subscriberIndexError
      )
    ));

    const payload = {
      ok: true,
      updatedAt,
      intervalMinutes: config.defaultStore.operationalDashboardIntervalMinutes,
      count: orders.length,
      confirmedByCustomer: orders.filter((order) => order.customerConfirmed).length,
      withCustomerResponse: orders.filter((order) => Number(order.customerMessages) > 0).length,
      responseNotVerifiable: orders.filter((order) => order.customerSignalRaw === 'NOT_VERIFIABLE').length,
      partial: Boolean(subscriberIndexError),
      chatbyError: subscriberIndexError,
      orders,
      error: null
    };
    writeJson(cachePath, payload);
    await syncOperationalOrdersCacheToSupabase(payload).catch((error) => {
      console.error('Supabase operational orders mirror error:', error instanceof Error ? error.message : String(error));
    });

    const state = { ...loadState() };
    state.lastOperationalOrdersSyncAt = updatedAt;
    state.lastOperationalOrdersSyncError = null;
    state.lastOperationalOrdersChatbyError = subscriberIndexError;
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
    await syncOperationalOrdersCacheToSupabase(payload).catch((mirrorError) => {
      console.error('Supabase operational orders error mirror failed:', mirrorError instanceof Error ? mirrorError.message : String(mirrorError));
    });

    const state = { ...loadState() };
    state.lastOperationalOrdersSyncAt = updatedAt;
    state.lastOperationalOrdersSyncError = message;
    saveState(state);

    throw error;
  }
}
