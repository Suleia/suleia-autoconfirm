import { getAppConfig } from '../config.mjs';
import {
  findOrder,
  hasRecentWebhookEvent,
  listPendingOrders,
  loadState,
  recordWebhookEvent,
  saveState,
  upsertOrder
} from '../storage.mjs';
import {
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
import { runOpenAIAssistantAnalysis } from '../clients/openai-assistant.mjs';
import { classifyConversation } from '../clients/openai.mjs';
import { getShopifyOrderFinancialStatus } from '../clients/shopify.mjs';
import { getSimulationDecision, upsertSheetRow } from '../clients/sheets.mjs';

const config = getAppConfig();
let automationCycleRunning = false;

async function safeUpsertSheetRow(order, context = 'sheet_sync') {
  try {
    const result = await upsertSheetRow(order);
    const state = { ...loadState() };
    if (!result?.skipped) {
      state.lastSheetSyncAt = new Date().toISOString();
    }
    state.lastSheetSyncError = null;
    saveState(state);
    return result;
  } catch (error) {
    console.error(`[${context}] Google Sheets sync failed for order ${order?.orderId || 'unknown'}:`, error);
    const state = { ...loadState() };
    state.lastSheetSyncError = error instanceof Error ? error.message : String(error);
    saveState(state);
    return { skipped: true, error: error instanceof Error ? error.message : String(error) };
  }
}

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
    /\bs[iÃ­],? lo quiero\b/,
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

function workflowStatusForPolledOrder(existing, polledStatus) {
  const remoteStatus = String(polledStatus || 'PENDING').toUpperCase();
  const localStatus = String(existing?.status || '').toUpperCase();

  if (!existing) return remoteStatus;
  if (['CONFIRMED', 'CANCELLED'].includes(remoteStatus)) return remoteStatus;
  if (['CONFIRMED', 'CANCELLED', 'MANUAL_REVIEW'].includes(localStatus)) return localStatus;
  return remoteStatus;
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

  let override = null;
  try {
    override = await getSimulationDecision(order.orderId);
  } catch (error) {
    const state = { ...loadState() };
    state.lastSheetSyncError = error instanceof Error ? error.message : String(error);
    saveState(state);
    console.error(`[simulation_override] Google Sheets control lookup failed for order ${order.orderId}:`, error);
    return null;
  }

  if (!override) return null;

  if (['CONFIRM', 'CONFIRMAR', 'CONFIRMED', 'SI', 'SÃ', 'YES'].includes(override.decision)) {
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
    await safeUpsertSheetRow(updated);
    return { dryRun: true, action: 'would_confirm', analysis, source: override.source || 'sheet_training' };
  }

  if (['NO_CONFIRM', 'NO CONFIRM', 'NO_CONFIRMAR', 'NO', 'CANCEL', 'CANCELAR'].includes(override.decision)) {
    const analysis = {
      intent: 'CANCEL',
      confidence: 100,
      reason: override.reason || 'Pedido marcado como no confirmado en la hoja de entrenamiento.'
    };
    const source = override.source || 'sheet_training';
    const isAddressChange = normalizeText(`${source} ${analysis.reason}`).includes('direccion')
      || normalizeText(`${source} ${analysis.reason}`).includes('envio')
      || normalizeText(`${source} ${analysis.reason}`).includes('envÃ­o');
    const updated = upsertOrder(store.id, {
      ...order,
      status: isAddressChange ? 'MANUAL_REVIEW' : order.status,
      aiConfidence: 100,
      aiIntent: isAddressChange ? 'ADDRESS_CHANGE_REQUESTED' : 'NO_CONFIRM',
      operationalNote: isAddressChange
        ? 'Cliente solicito cambiar datos/direccion de envio. No confirmar en Dropea hasta revisar y corregir direccion.'
        : order.operationalNote
    });
    await safeUpsertSheetRow(updated);
    return { dryRun: true, action: 'would_not_confirm', analysis, source };
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
        source: normalizeText(message.raw?.msg_type || message.raw?.message_type).includes('postback')
          ? 'chatby_change_address_button'
          : 'customer_message'
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

function normalizeDropeaWebhookOrder(payload) {
  const customer = payload.customer || {};
  const orderId = String(payload.order_id || payload.orderId || payload.id || '');
  if (!orderId) return null;

  return {
    orderId,
    status: String(payload.new_status || payload.status || 'PENDING').toUpperCase(),
    customerName: customer.full_name || customer.fullName || customer.name || null,
    customerPhone: customer.phone || customer.mobile || null,
    customerEmail: customer.email || null,
    orderAmount: Number(payload.total_amount ?? payload.amount ?? payload.total ?? 0) || null,
    currencyCode: payload.currency || payload.currency_code || 'EUR',
    raw: payload
  };
}

function isExcludedNewSheetStatus(status) {
  return [
    'CANCELLED',
    'REJECTED',
    'REJECT',
    'DELIVERED',
    'CHARGED',
    'RETURNED',
    'LOST'
  ].includes(String(status || '').toUpperCase());
}

function templateParamsForOrder(order) {
  const address = order.raw?.shipping_address || order.raw?.shippingAddress || order.raw?.address || {};
  return {
    'BODY_{{1}}': `${firstName(order.customerName)}!`,
    'BODY_{{2}}': order.raw?.product_name || order.raw?.productName || `Pedido ${order.orderId}`,
    'BODY_{{3}}': `${order.orderAmount ?? ''}â‚¬`,
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
      status: workflowStatusForPolledOrder(existing, order.status),
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

    await safeUpsertSheetRow(merged);

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
    await safeUpsertSheetRow(updated);
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

  await safeUpsertSheetRow(updated);
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

  const validFrom = order.chatbyTemplateSentAt || order.createdAt || order.raw?.created_at || order.raw?.createdAt;
  const inboundCustomerMessages = customerMessagesAfter(messages, validFrom);
  const latestInboundCustomerMessageAt = inboundCustomerMessages.length
    ? parseDate(inboundCustomerMessages[inboundCustomerMessages.length - 1]?.raw?.created_at || inboundCustomerMessages[inboundCustomerMessages.length - 1]?.raw?.createdAt || inboundCustomerMessages[inboundCustomerMessages.length - 1]?.createdAt)
    : null;
  const immediateCustomerIntent = customerConversationIntentForOrder(inboundCustomerMessages, order)
    || deterministicCustomerIntent(inboundCustomerMessages);
  if (immediateCustomerIntent?.intent === 'CANCEL') {
    const patch = {
      ...order,
      status: 'MANUAL_REVIEW',
      aiConfidence: Number(immediateCustomerIntent.confidence ?? 100),
      aiIntent: 'ADDRESS_CHANGE_REQUESTED',
      operationalNote: 'Cliente solicito cambiar datos/direccion de envio. No confirmar en Dropea hasta revisar y corregir direccion.'
    };
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return {
      dryRun: store.agentDryRun ?? config.defaultStore.agentDryRun,
      action: 'would_not_confirm',
      analysis: {
        ...immediateCustomerIntent,
        reason: 'El cliente ha pedido cambiar datos/direccion de envio; la direccion de Dropea no debe considerarse valida.'
      },
      source: immediateCustomerIntent.source || 'customer_change_request'
    };
  }

  if (immediateCustomerIntent?.intent === 'CONFIRM') {
    const analysis = {
      ...immediateCustomerIntent,
      reason: immediateCustomerIntent.reason || 'El cliente confirma claramente el pedido.'
    };
    const patch = {
      ...order,
      aiConfidence: Number(immediateCustomerIntent.confidence ?? 100),
      aiIntent: 'CONFIRM'
    };

    if (store.agentDryRun ?? config.defaultStore.agentDryRun) {
      patch.status = 'MANUAL_REVIEW';
      patch.operationalNote = 'Simulacion: el cliente confirmo claramente y el pedido habria sido confirmado.';
      const updated = upsertOrder(store.id, patch);
      await safeUpsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis, source: immediateCustomerIntent.source || 'customer_message' };
    }

    if (order.raw?.payment_method === 'SHOPIFY' || order.raw?.source === 'shopify') {
      const financialStatus = await getShopifyOrderFinancialStatus(order.orderId);
      if (financialStatus !== 'paid') {
        patch.status = 'MANUAL_REVIEW';
        patch.operationalNote = 'Pedido pendiente de pago en Shopify. No se confirma automaticamente.';
        const updated = upsertOrder(store.id, patch);
        await safeUpsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }
    }

    const confirmation = await confirmDropeaOrder(order.orderId);
    patch.status = 'CONFIRMED';
    patch.confirmedAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return { action: 'confirmed', analysis, confirmation, source: immediateCustomerIntent.source || 'customer_message' };
  }

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
      await safeUpsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis, source: 'chatby_button' };
    }

    const confirmation = await confirmDropeaOrder(order.orderId);
    patch.status = 'CONFIRMED';
    patch.confirmedAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return { action: 'confirmed', analysis, confirmation, source: 'chatby_button' };
  }

  const useAssistant = (store.agentEnabled ?? config.defaultStore.agentEnabled) && config.openaiAssistantEnabled && config.openaiAssistantId;
  const assistantCheckedAt = parseDate(order.assistantCheckedAt);
  const shouldRunAssistant =
    useAssistant
    && (
      !assistantCheckedAt
      || (latestInboundCustomerMessageAt && latestInboundCustomerMessageAt > assistantCheckedAt)
      || (!inboundCustomerMessages.length && !assistantCheckedAt)
    );

  if (shouldRunAssistant) {
    try {
      const assistantResult = await runOpenAIAssistantAnalysis(order, store);
      if (assistantResult) {
        return assistantResult;
      }
    } catch (error) {
      console.error('OpenAI assistant error:', error);
    }
  }

  if (assistantCheckedAt && latestInboundCustomerMessageAt && latestInboundCustomerMessageAt <= assistantCheckedAt) {
    return { skipped: true, reason: 'already_analyzed_no_new_message' };
  }

  if (!inboundCustomerMessages.length) {
    if (confirmedStoredOrder(order, store)) {
      const storedResult = storedConfirmationResult(order, store);
      if (storedResult) return storedResult;
    }

    if (assistantCheckedAt) {
      return { skipped: true, reason: 'waiting_customer_already_logged' };
    }

    const patch = {
      ...order,
      aiConfidence: null,
      aiIntent: 'WAITING_CUSTOMER',
      assistantCheckedAt: new Date().toISOString(),
      operationalNote: order.operationalNote || 'Pedido nuevo en espera de respuesta del cliente.'
    };
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
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
      await safeUpsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis };
    }

    if (order.raw?.payment_method === 'SHOPIFY' || order.raw?.source === 'shopify') {
      const financialStatus = await getShopifyOrderFinancialStatus(order.orderId);
      if (financialStatus !== 'paid') {
        patch.status = 'MANUAL_REVIEW';
        const updated = upsertOrder(store.id, patch);
        await safeUpsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }
    }

    const confirmation = await confirmDropeaOrder(order.orderId);
    patch.status = 'CONFIRMED';
    patch.confirmedAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return { action: 'confirmed', analysis, confirmation };
  }

  if (intent === 'CANCEL' && confidence >= threshold) {
    patch.status = 'MANUAL_REVIEW';
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return {
      dryRun: store.agentDryRun ?? config.defaultStore.agentDryRun,
      action: 'would_not_confirm',
      analysis
    };
  }

  const updated = upsertOrder(store.id, patch);
  await safeUpsertSheetRow(updated);
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

export async function runStoreAutomationCycle({ store = config.defaultStore, limit = 50 } = {}) {
  if (automationCycleRunning) {
    return { skipped: true, reason: 'cycle_running' };
  }

  automationCycleRunning = true;
  try {
    let ingestResult = null;
    let confirmResult = null;
    let ingestError = null;
    let confirmError = null;

    try {
      ingestResult = await ingestPendingOrders({ store, limit });
    } catch (error) {
      ingestError = error instanceof Error ? error.message : String(error);
      console.error('[automation_cycle] ingestPendingOrders failed:', error);
    }

    try {
      confirmResult = await runAutoConfirm({ store });
    } catch (error) {
      confirmError = error instanceof Error ? error.message : String(error);
      console.error('[automation_cycle] runAutoConfirm failed:', error);
    }

    const state = { ...loadState() };
    state.lastAutomationCycleAt = new Date().toISOString();
    state.lastIngestError = ingestError;
    state.lastAutoConfirmError = confirmError;
    saveState(state);

    return {
      ingest: ingestResult,
      autoConfirm: confirmResult,
      ingestError,
      confirmError,
      lastAutomationCycleAt: state.lastAutomationCycleAt
    };
  } finally {
    automationCycleRunning = false;
  }
}

export async function handleDropeaWebhook({ store, payload }) {
  const topic = payload.topic || payload.event || 'unknown';
  const orderId = String(payload.order_id || payload.orderId || payload.id || '');
  const prevStatus = payload.prev_status || payload.previous_status || payload.prevStatus || '';
  const newStatus = payload.new_status || payload.status || payload.newStatus || '';
  const dedupeKey = `${orderId || 'unknown'}:${topic}:${newStatus || 'unknown'}`;

  if (hasRecentWebhookEvent(store.id, dedupeKey)) {
    return { duplicate: true };
  }

  recordWebhookEvent(store.id, dedupeKey, 'received');
  const receivedState = { ...loadState(), lastWebhookAt: new Date().toISOString(), lastWebhookError: null };
  saveState(receivedState);

  const existing = orderId ? findOrder(store.id, orderId) : null;

  if (orderId && (topic === 'order:status_update' || newStatus)) {
    const dropeaOrder = await getDropeaOrderById(orderId);
    if (dropeaOrder) {
      if (!existing && isExcludedNewSheetStatus(dropeaOrder.status)) {
        return {
          skipped: true,
          source: 'dropea_lookup',
          reason: 'excluded_terminal_status',
          orderId,
          prevStatus,
          newStatus: dropeaOrder.status
        };
      }

      const confirmedAt =
        String(dropeaOrder.status || '').toUpperCase() === 'CONFIRMED'
          ? existing?.confirmedAt || new Date().toISOString()
          : existing?.confirmedAt || null;

      const updated = upsertOrder(store.id, {
        ...(existing || {}),
        ...dropeaOrder,
        status: workflowStatusForPolledOrder(existing, dropeaOrder.status),
        chatbyUserNs: existing?.chatbyUserNs || null,
        chatbyTemplateSentAt: existing?.chatbyTemplateSentAt || null,
        aiConfidence: existing?.aiConfidence ?? null,
        aiIntent: existing?.aiIntent || null,
        confirmedAt,
        operationalNote: existing?.operationalNote || null
      });
      await safeUpsertSheetRow(updated);
      return { orderUpdated: true, source: 'dropea_lookup', orderId: updated.orderId, prevStatus, newStatus: updated.status };
    }
  }

  const webhookOrder = normalizeDropeaWebhookOrder(payload);
  if (webhookOrder) {
    if (!existing && isExcludedNewSheetStatus(webhookOrder.status)) {
      return {
        skipped: true,
        source: 'webhook_payload',
        reason: 'excluded_terminal_status',
        orderId: webhookOrder.orderId,
        prevStatus,
        newStatus: webhookOrder.status
      };
    }

    const updated = upsertOrder(store.id, {
      ...(existing || {}),
      ...webhookOrder,
      status: workflowStatusForPolledOrder(existing, webhookOrder.status),
      chatbyUserNs: existing?.chatbyUserNs || null,
      chatbyTemplateSentAt: existing?.chatbyTemplateSentAt || null,
      aiConfidence: existing?.aiConfidence ?? null,
      aiIntent: existing?.aiIntent || null,
      confirmedAt: existing?.confirmedAt || null,
      operationalNote: existing?.operationalNote || null
    });
    await safeUpsertSheetRow(updated);
    return {
      orderUpdated: true,
      source: 'webhook_payload',
      orderId: updated.orderId,
      prevStatus,
      newStatus: updated.status
    };
  }

  const fallback = await ingestPendingOrders({ store });
  return { fallbackSync: true, ...fallback };
}

