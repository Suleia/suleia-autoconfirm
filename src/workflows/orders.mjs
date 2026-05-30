import { getAppConfig } from '../config.mjs';
import {
  findOrder,
  hasWebhookEvent,
  listPendingOrders,
  loadState,
  recordWebhookEvent,
  saveState,
  upsertOrder
} from '../storage.mjs';
import {
  cancelDropeaOrder,
  confirmDropeaOrder,
  getDropeaOrderById,
  listPendingDropeaOrders
} from '../clients/dropea.mjs';
import {
  createSubscriber,
  findSubscriberForOrder,
  getChatMessages,
  sendWhatsappTemplate,
  subscriberConfirmsOrder
} from '../clients/chatby.mjs';
import { classifyConversation } from '../clients/openai.mjs';
import { getShopifyOrderFinancialStatus } from '../clients/shopify.mjs';
import { getSimulationDecision, upsertSheetRow } from '../clients/sheets.mjs';

const config = getAppConfig();

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAfterCutoff(order, cutoffIso) {
  if (!cutoffIso) return true;
  const cutoff = parseDate(cutoffIso);
  const createdAt = parseDate(order.raw?.created_at || order.raw?.createdAt || order.createdAt);
  if (!cutoff || !createdAt) return true;
  return createdAt >= cutoff;
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    role: String(message.role || message.sender || message.direction || 'message').toLowerCase(),
    content: message.content || message.message || message.text || message.button_text || message.buttonText || '',
    raw: message
  }));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isCustomerMessage(message) {
  const role = normalizeText(message.role);
  const raw = message.raw || {};
  const direction = normalizeText(raw.direction || raw.type || raw.message_type || raw.messageType || raw.from_type || raw.fromType);
  const sender = normalizeText(raw.sender || raw.sender_type || raw.senderType || raw.author || raw.from || raw.source);

  if (['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (['in', 'inbound', 'incoming', 'received'].includes(direction)) return true;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(sender)) return true;
  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.is_echo === true || raw.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system', 'tienda', 'store'].includes(role)) return false;
  if (['out', 'outbound', 'sent'].includes(direction)) return false;
  return false;
}

function customerMessages(messages) {
  return messages
    .filter((message) => isCustomerMessage(message))
    .filter((message) => String(message.content || '').trim());
}

function messageTimestamp(message) {
  const raw = message?.raw || {};
  const numeric = Number(raw.ts || raw.timestamp || raw.created || raw.time);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const date = messageDate(message);
  return date ? date.getTime() : 0;
}

function messageDate(message) {
  return parseDate(message?.raw?.created_at || message?.raw?.createdAt || message?.created_at || message?.createdAt || message?.timestamp);
}

function customerMessagesAfter(messages, sinceIso) {
  const since = parseDate(sinceIso);
  if (!since) return customerMessages(messages);
  return customerMessages(messages).filter((message) => {
    const createdAt = messageDate(message);
    if (createdAt) return createdAt >= since;
    const timestamp = messageTimestamp(message);
    return timestamp ? timestamp >= since.getTime() : false;
  });
}

function deterministicCustomerIntent(messages) {
  const text = normalizeText(messages.map((message) => [
    message.content,
    message.raw?.payload?.title,
    message.raw?.payload?.body,
    message.raw?.title,
    message.raw?.button_text,
    message.raw?.buttonText
  ].filter(Boolean).join(' ')).join('\n'));
  if (!text) return null;

  const cancelPatterns = [
    /\bno lo quiero\b/,
    /\bno quiero\b/,
    /\bno confirmo\b/,
    /\bcancel(ar|o|ado)?\b/,
    /\banular\b/,
    /\bno me interesa\b/,
    /\bno lo voy a recibir\b/,
    /\bno voy a aceptarlo\b/,
    /\bcambiar datos\b/,
    /\bcambiar direccion\b/,
    /\bmodificar datos\b/,
    /\bdireccion (mal|incorrecta|equivocada)\b/
  ];

  if (cancelPatterns.some((pattern) => pattern.test(text))) {
    return {
      intent: 'CANCEL',
      confidence: 100,
      reason: 'El cliente no confirma el pedido o pide cambiar datos de entrega.'
    };
  }

  const confirmPatterns = [
    /\bconfirmo\b/,
    /\bconfirmado\b/,
    /\bconfirmar mi pedido\b/,
    /\bsi lo quiero\b/,
    /\bs[ií],? lo quiero\b/,
    /\blo quiero\b/,
    /\badelante\b/,
    /\bperfecto\b/,
    /\bok\b/,
    /\bvale\b/
  ];

  if (confirmPatterns.some((pattern) => pattern.test(text))) {
    return {
      intent: 'CONFIRM',
      confidence: 100,
      reason: 'El cliente confirma el pedido mediante respuesta o boton de WhatsApp.'
    };
  }

  return null;
}

function confirmedStoredOrder(order, store) {
  const confidence = Number(order.aiConfidence ?? 0);
  const threshold = store.confidenceThreshold || config.defaultStore.confidenceThreshold || 90;
  return String(order.aiIntent || '').toUpperCase() === 'CONFIRM' && confidence >= threshold;
}

function storedConfirmationResult(order, store) {
  const analysis = {
    intent: 'CONFIRM',
    confidence: Number(order.aiConfidence ?? 100),
    reason: 'Confirmacion ya detectada previamente; se conserva aunque Chatby haya cambiado el pedido activo del contacto.'
  };

  if (store.agentDryRun ?? config.defaultStore.agentDryRun) {
    return { dryRun: true, action: 'would_confirm', analysis, source: 'stored_confirmation' };
  }

  return null;
}

async function simulationOverrideResult(order, store) {
  if (!(store.agentDryRun ?? config.defaultStore.agentDryRun)) return null;

  const override = await getSimulationDecision(order.orderId);
  if (!override) return null;

  if (['CONFIRM', 'CONFIRMAR', 'CONFIRMED', 'SI', 'SÍ', 'YES'].includes(override.decision)) {
    const analysis = {
      intent: 'CONFIRM',
      confidence: 100,
      reason: override.reason || 'Confirmacion validada en la hoja de entrenamiento.'
    };
    const updated = upsertOrder(store.id, {
      ...order,
      status: 'MANUAL_REVIEW',
      aiConfidence: 100,
      aiIntent: 'CONFIRM'
    });
    await upsertSheetRow(updated);
    return { dryRun: true, action: 'would_confirm', analysis, source: override.source || 'sheet_training' };
  }

  if (['NO_CONFIRM', 'NO CONFIRM', 'NO_CONFIRMAR', 'NO', 'CANCEL', 'CANCELAR'].includes(override.decision)) {
    const analysis = {
      intent: 'CANCEL',
      confidence: 100,
      reason: override.reason || 'Pedido marcado como no confirmado en la hoja de entrenamiento.'
    };
    const updated = upsertOrder(store.id, {
      ...order,
      aiConfidence: 100,
      aiIntent: 'NO_CONFIRM'
    });
    await upsertSheetRow(updated);
    return { dryRun: true, action: 'would_not_confirm', analysis, source: override.source || 'sheet_training' };
  }

  return null;
}

function currentSubscriberOrderId(subscriber) {
  const fields = subscriber?.user_fields || [];
  const field = fields.find((item) => normalizeText(item.name) === 'dropea: numero');
  return field?.value ? String(field.value) : null;
}

function customerConversationIntentForOrder(messages, order) {
  const orderedMessages = [...messages].sort((a, b) => messageTimestamp(a) - messageTimestamp(b));
  const customerOnly = orderedMessages.filter((message) => isCustomerMessage(message));

  for (let index = customerOnly.length - 1; index >= 0; index -= 1) {
    const message = customerOnly[index];
    const intent = deterministicCustomerIntent([message]);
    if (!intent) continue;

    if (intent.intent === 'CANCEL') {
      return {
        ...intent,
        source: 'customer_message'
      };
    }

    if (intent.intent === 'CONFIRM') {
      return {
        ...intent,
        source: normalizeText(message.raw?.msg_type || message.raw?.message_type).includes('postback')
          ? 'chatby_button'
          : 'customer_text'
      };
    }
  }

  return null;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function templateParamsForOrder(order) {
  const address = order.raw?.shipping_address || order.raw?.shippingAddress || order.raw?.address || {};
  return {
    'BODY_{{1}}': `${firstName(order.customerName)}!`,
    'BODY_{{2}}': order.raw?.product_name || order.raw?.productName || `Pedido ${order.orderId}`,
    'BODY_{{3}}': `${order.orderAmount ?? ''}€`,
    'BODY_{{4}}': [address.address1, address.address2].filter(Boolean).join(' ') || '',
    'BODY_{{5}}': address.city || '',
    'BODY_{{6}}': address.province || address.zip || ''
  };
}

export async function ingestPendingOrders({ store = config.defaultStore, limit = 50 } = {}) {
  const pending = await listPendingDropeaOrders({ limit, page: 1 });
  const processed = [];

  for (const order of pending) {
    if (!isAfterCutoff(order, store.activationCutoff)) {
      continue;
    }

    const existing = findOrder(store.id, order.orderId);
    const merged = upsertOrder(store.id, {
      orderId: order.orderId,
      status: order.status || 'PENDING',
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      orderAmount: order.orderAmount,
      currencyCode: order.currencyCode,
      raw: order.raw,
      chatbyUserNs: existing?.chatbyUserNs || null,
      chatbyTemplateSentAt: existing?.chatbyTemplateSentAt || null,
      aiConfidence: existing?.aiConfidence ?? null,
      aiIntent: existing?.aiIntent || null,
      confirmedAt: existing?.confirmedAt || null
    });

    await upsertSheetRow({
      orderId: merged.orderId,
      customerName: merged.customerName,
      customerPhone: merged.customerPhone,
      createdAt: merged.createdAt,
      status: merged.status,
      orderAmount: merged.orderAmount,
      confirmedAt: merged.confirmedAt
    });

    processed.push(merged);
  }

  const state = { ...loadState() };
  state.lastPollAt = new Date().toISOString();
  saveState(state);

  return { processed: processed.length, orders: processed };
}

export async function ensureChatbyThread(order, store = config.defaultStore) {
  if (!config.chatbyToken) return order;
  if (order.chatbyUserNs) return order;
  if (!order.customerPhone) return order;

  const existingSubscriber = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });

  if (existingSubscriber?.user_ns) {
    const updated = upsertOrder(store.id, {
      ...order,
      chatbyUserNs: existingSubscriber.user_ns,
      chatbyTemplateSentAt: order.chatbyTemplateSentAt || existingSubscriber.subscribed || order.createdAt
    });
    await upsertSheetRow(updated);
    return updated;
  }

  const created = await createSubscriber({
    phone: order.customerPhone,
    name: order.customerName || order.customerPhone,
    email: order.customerEmail || undefined,
    metadata: {
      orderId: order.orderId,
      source: 'dropea'
    }
  });

  const userNs = created?.data?.user_ns || created?.user_ns || created?.userNs || created?.id || null;
  if (!userNs) return order;

  let updated = upsertOrder(store.id, { ...order, chatbyUserNs: userNs });

  if (store.whatsappTemplateName || config.whatsappTemplateName) {
    await sendWhatsappTemplate({
      user_ns: userNs,
      template_name: store.whatsappTemplateName || config.whatsappTemplateName,
      params: templateParamsForOrder(order)
    });
    updated = upsertOrder(store.id, { ...updated, chatbyTemplateSentAt: new Date().toISOString() });
  }

  await upsertSheetRow(updated);
  return updated;
}

export async function analyzeAndMaybeConfirmOrder(order, store = config.defaultStore) {
  if (order.status !== 'PENDING') {
    return { skipped: true, reason: 'order_not_pending' };
  }

  if (confirmedStoredOrder(order, store)) {
    const storedResult = storedConfirmationResult(order, store);
    if (storedResult) return storedResult;
  }

  const simulationOverride = await simulationOverrideResult(order, store);
  if (simulationOverride) return simulationOverride;

  if (!order.chatbyUserNs) {
    return { skipped: true, reason: 'no_chat_thread' };
  }

  const messages = normalizeChatMessages(await getChatMessages(order.chatbyUserNs));
  const subscriber = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });

  const subscriberOrderId = currentSubscriberOrderId(subscriber);
  if (subscriberOrderId === String(order.orderId) && subscriberConfirmsOrder(subscriber)) {
    const analysis = {
      intent: 'CONFIRM',
      confidence: 100,
      reason: 'El cliente confirmo el pedido mediante el boton de WhatsApp.'
    };
    const patch = {
      ...order,
      aiConfidence: 100,
      aiIntent: 'CONFIRM'
    };

    if (store.agentDryRun ?? config.defaultStore.agentDryRun) {
      patch.status = 'MANUAL_REVIEW';
      const updated = upsertOrder(store.id, patch);
      await upsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis, source: 'chatby_button' };
    }

    const confirmation = await confirmDropeaOrder(order.orderId);
    patch.status = 'CONFIRMED';
    patch.confirmedAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await upsertSheetRow(updated);
    return { action: 'confirmed', analysis, confirmation, source: 'chatby_button' };
  }

  const validFrom = order.chatbyTemplateSentAt || order.createdAt || order.raw?.created_at || order.raw?.createdAt;
  const inboundCustomerMessages = customerMessagesAfter(messages, validFrom);
  if (!inboundCustomerMessages.length) {
    if (confirmedStoredOrder(order, store)) {
      const storedResult = storedConfirmationResult(order, store);
      if (storedResult) return storedResult;
    }

    const patch = {
      ...order,
      aiConfidence: null,
      aiIntent: 'WAITING_CUSTOMER'
    };
    const updated = upsertOrder(store.id, patch);
    await upsertSheetRow(updated);
    return { skipped: true, reason: 'no_customer_confirmation' };
  }

  const lastMessage = inboundCustomerMessages[inboundCustomerMessages.length - 1];
  const lastMessageAt = parseDate(lastMessage?.raw?.created_at || lastMessage?.raw?.createdAt || lastMessage?.created_at || lastMessage?.createdAt);
  if (lastMessageAt) {
    const diffHours = (Date.now() - lastMessageAt.getTime()) / 36e5;
    if (diffHours < (store.cooldownHours || config.defaultStore.cooldownHours || 1)) {
      return { skipped: true, reason: 'cooldown' };
    }
  }

  const analysis = customerConversationIntentForOrder(inboundCustomerMessages, order)
    || deterministicCustomerIntent(inboundCustomerMessages)
    || await classifyConversation([
      { role: 'system', content: `Clasifica SOLO mensajes entrantes del cliente para el pedido ${order.orderId}.` },
      ...inboundCustomerMessages
    ]);

  const confidence = Number(analysis?.confidence ?? 0);
  const intent = String(analysis?.intent || 'UNCLEAR').toUpperCase();
  const threshold = store.confidenceThreshold || config.defaultStore.confidenceThreshold || 90;

  const patch = {
    ...order,
    aiConfidence: confidence,
    aiIntent: intent
  };

  if (intent === 'CONFIRM' && confidence >= threshold) {
    if (store.agentDryRun ?? config.defaultStore.agentDryRun) {
      patch.status = 'MANUAL_REVIEW';
      const updated = upsertOrder(store.id, patch);
      await upsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis };
    }

    if (order.raw?.payment_method === 'SHOPIFY' || order.raw?.source === 'shopify') {
      const financialStatus = await getShopifyOrderFinancialStatus(order.orderId);
      if (financialStatus !== 'paid') {
        patch.status = 'MANUAL_REVIEW';
        const updated = upsertOrder(store.id, patch);
        await upsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }
    }

    const confirmation = await confirmDropeaOrder(order.orderId);
    patch.status = 'CONFIRMED';
    patch.confirmedAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await upsertSheetRow(updated);
    return { action: 'confirmed', analysis, confirmation };
  }

  if (intent === 'CANCEL' && confidence >= threshold) {
    patch.status = 'MANUAL_REVIEW';
    const updated = upsertOrder(store.id, patch);
    await upsertSheetRow(updated);
    return {
      dryRun: store.agentDryRun ?? config.defaultStore.agentDryRun,
      action: 'would_not_confirm',
      analysis
    };
  }

  const updated = upsertOrder(store.id, patch);
  await upsertSheetRow(updated);
  return { action: 'unclear', analysis };
}

export async function runAutoConfirm({ store = config.defaultStore } = {}) {
  const orders = listPendingOrders(store.id);
  const results = [];

  for (const order of orders) {
    const hydrated = order.chatbyUserNs ? order : await ensureChatbyThread(order, store);
    const result = await analyzeAndMaybeConfirmOrder(hydrated, store);
    results.push({ orderId: order.orderId, result });
  }

  const state = { ...loadState() };
  state.lastAutoConfirmAt = new Date().toISOString();
  saveState(state);

  return { processed: results.length, results };
}

export async function handleDropeaWebhook({ store, payload }) {
  const topic = payload.topic || payload.event || 'unknown';
  const orderId = String(payload.order_id || payload.orderId || payload.id || '');
  const prevStatus = payload.prev_status || payload.previous_status || payload.prevStatus || '';
  const newStatus = payload.new_status || payload.status || payload.newStatus || '';
  const dedupeKey = `${orderId}:${topic}:${newStatus}`;

  if (hasWebhookEvent(store.id, dedupeKey)) {
    return { duplicate: true };
  }

  recordWebhookEvent(store.id, dedupeKey, 'received');

  if (topic === 'order:status_update' || newStatus) {
    const dropeaOrder = await getDropeaOrderById(orderId);
    if (dropeaOrder) {
      const updated = upsertOrder(store.id, {
        orderId: dropeaOrder.orderId,
        status: dropeaOrder.status,
        customerName: dropeaOrder.customerName,
        customerPhone: dropeaOrder.customerPhone,
        customerEmail: dropeaOrder.customerEmail,
        orderAmount: dropeaOrder.orderAmount,
        currencyCode: dropeaOrder.currencyCode,
        raw: dropeaOrder.raw
      });
      await upsertSheetRow(updated);
      return { orderUpdated: true, prevStatus, newStatus };
    }
  }

  return { ignored: true };
}
