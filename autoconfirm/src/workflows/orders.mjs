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
  cancelDropeaOrder,
  confirmDropeaOrder,
  getDropeaOrderById,
  listRecentDropeaOrders,
  listPendingDropeaOrders
} from '../clients/dropea.mjs';
import {
  createSubscriber,
  findSubscriberByPhone,
  findSubscriberForOrderRobust as findSubscriberForOrder,
  getChatMessages,
  sendWhatsappTemplate,
  subscriberConfirmsOrderRobust as subscriberConfirmsOrder
} from '../clients/chatby.mjs';
import { sendMetaWhatsappTemplate } from '../clients/meta-whatsapp.mjs';
import { runOpenAIAssistantAnalysis } from '../clients/openai-assistant.mjs';
import { classifyConversation } from '../clients/openai.mjs';
import { getShopifyOrderFinancialStatus, listRecentShopifyOrders } from '../clients/shopify.mjs';
import { appendAgentDecision, getSimulationDecision, upsertSheetRow } from '../clients/sheets.mjs';
import { blockedCustomerReason, isBlockedCustomerOrder } from '../policies/blocked-customers.mjs';

const config = getAppConfig();
let automationCycleRunning = false;

async function safeUpsertSheetRow(order, context = 'sheet_sync') {
  if (!config.googleSheetsEnabled) {
    return { skipped: true, reason: 'google_sheets_disabled' };
  }

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

async function safeAppendAgentDecision(decision, context = 'agent_decision') {
  if (!config.googleSheetsEnabled) {
    return { skipped: true, reason: 'google_sheets_disabled' };
  }

  try {
    return await appendAgentDecision(decision);
  } catch (error) {
    console.error(`[${context}] Agent decision audit failed for order ${decision?.orderId || 'unknown'}:`, error);
    const state = { ...loadState() };
    state.lastSheetSyncError = error instanceof Error ? error.message : String(error);
    saveState(state);
    return { skipped: true, error: error instanceof Error ? error.message : String(error) };
  }
}

async function recordDecisionAndReturn(order, result) {
  const analysis = result?.analysis || {};
  await safeAppendAgentDecision({
    orderId: result?.orderId || order?.orderId,
    action: result?.action || result?.reason || 'skipped',
    intent: analysis.intent || order?.aiIntent || '',
    confidence: analysis.confidence ?? order?.aiConfidence ?? '',
    source: result?.source || 'workflow',
    customerMessage: analysis.customer_message || analysis.customerMessage || '',
    reason: analysis.reason || result?.reason || '',
    dryRun: result?.dryRun ?? ''
  });
  return result;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKeyInTimezone(value, timezone = config.timezone || 'Europe/Madrid') {
  const date = parseDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function todayKey(timezone = config.timezone || 'Europe/Madrid') {
  return dateKeyInTimezone(new Date().toISOString(), timezone);
}

function dropeaCreatedAt(order) {
  return order?.createdAt
    || order?.raw?.created_at
    || order?.raw?.createdAt
    || order?.raw?.date
    || order?.raw?.created
    || null;
}

function hoursSince(value) {
  const date = parseDate(value);
  if (!date) return null;
  return (Date.now() - date.getTime()) / 36e5;
}

function unansweredTimeoutStart(order) {
  return order.raw?.created_at
    || order.raw?.createdAt
    || order.createdAt
    || order.chatbyTemplateSentAt
    || order.chatbyTemplateAttemptedAt;
}

function addHours(value, hours) {
  const date = parseDate(value) || new Date();
  return new Date(date.getTime() + (Number(hours) || 1) * 36e5).toISOString();
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
    return timestamp ? timestamp >= since.getTime() : true;
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

  const addressChangePatterns = [
    /\bcambio de direccion\b/,
    /\bcambiar direccion\b/,
    /\bcambiar la direccion\b/,
    /\bmodificar direccion\b/,
    /\bmodificar la direccion\b/,
    /\bcambio direccion\b/,
    /\bdireccion (mal|incorrecta|equivocada)\b/,
    /\bcambiar datos\b/,
    /\bmodificar datos\b/,
    /\bcambiar envio\b/,
    /\bcambiar el envio\b/,
    /\bcorregir direccion\b/,
    /\bcorregir la direccion\b/,
    /\bmudar morada\b/,
    /\balterar morada\b/,
    /\bmudar endereco\b/,
    /\balterar endereco\b/,
    /\bendereco (errado|incorreto)\b/,
    /\bmorada (errada|incorreta)\b/
  ];

  if (addressChangePatterns.some((pattern) => pattern.test(text))) {
    return {
      intent: 'ADDRESS_CHANGE',
      confidence: 100,
      reason: 'El cliente pide cambiar o corregir datos de entrega; no se debe confirmar hasta revisar direccion.'
    };
  }

  const cancelPatterns = [
    /\bno lo quiero\b/,
    /\bno quiero\b/,
    /\bno confirmo\b/,
    /\bno confirmar\b/,
    /\bnao quero\b/,
    /\bnao confirmo\b/,
    /\bcancel(ar|o|ado)?\b/,
    /\bcancelar\b/,
    /\bquiero cancelar\b/,
    /\bquiero anular\b/,
    /\banular\b/,
    /\banula\b/,
    /\banulad[oa]\b/,
    /\beliminar pedido\b/,
    /\bquitar pedido\b/,
    /\bborra(r)? pedido\b/,
    /\bno enviar\b/,
    /\bno lo envie(s)?\b/,
    /\bno me lo envie(s)?\b/,
    /\bno me lo mand(e|es|en)\b/,
    /\bno lo mand(e|es|en)\b/,
    /\bno mand(e|es|en) nada\b/,
    /\bme arrepenti\b/,
    /\bme he arrepentido\b/,
    /\bya no lo quiero\b/,
    /\bya no quiero\b/,
    /\bya no me interesa\b/,
    /\bno me interesa\b/,
    /\bno lo voy a recibir\b/,
    /\bno voy a aceptarlo\b/,
    /\bno acepto\b/,
    /\brechaz(o|ar|ado)\b/,
    /\bno recogere\b/,
    /\bno lo recogere\b/,
    /\bno puedo recibirlo\b/,
    /\bpedido por error\b/,
    /\bme equivoque\b/,
    /\berror al pedir\b/,
    /\bno lo necesito\b/,
    /\bno hace falta\b/,
    /\bdejadlo\b/,
    /\bdejalo\b/,
    /\bdejarlo\b/,
    /\bpaso\b/
  ];

  if (cancelPatterns.some((pattern) => pattern.test(text))) {
    return {
      intent: 'CANCEL',
      confidence: 100,
      reason: 'El cliente no confirma el pedido.'
    };
  }

  const confirmPatterns = [
    /^(si|sii|siii|sim|ok|vale|perfecto|claro|correcto)$/,
    /\bconfirmo\b/,
    /\bconfirmado\b/,
    /\bconfirmada\b/,
    /\bconfirmar\b/,
    /\bconfirmar mi pedido\b/,
    /\bconfirmar o pedido\b/,
    /\bsi lo quiero\b/,
    /\bsi,? lo quiero\b/,
    /\bsim,? quero\b/,
    /\bquero sim\b/,
    /\blo quiero\b/,
    /\beu quero\b/,
    /\bpode enviar\b/,
    /\bpode mandar\b/,
    /\bpode seguir\b/,
    /\bpode prosseguir\b/,
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
  if ([
    'CONFIRMED',
    'CANCELLED',
    'REJECTED_UNANSWERED',
    'REJECTED_AFTER_CONFIRM_CANCEL',
    'REJECTED_BLOCKED_CUSTOMER',
    'BLOCKED_CUSTOMER_NO_DROPEA_ID',
    'BLOCKED_CUSTOMER_CANCELLATION_FAILED',
    'MANUAL_REVIEW',
    'PENDING_ADDRESS_CHANGE'
  ].includes(localStatus)) return localStatus;
  return remoteStatus;
}

function isShopifyOrder(order) {
  return normalizeText(order?.raw?.source) === 'shopify'
    || normalizeText(order?.raw?.payment_method) === 'shopify'
    || String(order?.orderId || '').startsWith('SHOPIFY-');
}

function isTerminalBlockedCustomerStatus(status) {
  return [
    'REJECTED_BLOCKED_CUSTOMER',
    'BLOCKED_CUSTOMER_NO_DROPEA_ID',
    'CANCELLED'
  ].includes(String(status || '').toUpperCase());
}

function shopifyWorkflowStatusForOrder(order, existing) {
  const localStatus = String(existing?.status || '').toUpperCase();
  const financialStatus = normalizeText(order.financialStatus);

  if (order.cancelledAt) return 'CANCELLED';
  if ([
    'CONFIRMED',
    'CANCELLED',
    'REJECTED_BLOCKED_CUSTOMER',
    'BLOCKED_CUSTOMER_NO_DROPEA_ID',
    'BLOCKED_CUSTOMER_CANCELLATION_FAILED',
    'MANUAL_REVIEW',
    'PENDING_ADDRESS_CHANGE'
  ].includes(localStatus)) return localStatus;
  if (financialStatus.includes('paid') || financialStatus.includes('pagado')) return 'CONFIRMED';
  return 'PENDING';
}

function normalizeShopifyWorkflowOrder(order, existing = null) {
  const products = Array.isArray(order.products) ? order.products : [];
  const productName = products.map((item) => item.title).filter(Boolean).join(', ') || 'Producto Shopify';
  const orderId = String(order.name || order.id || '').replace(/^#/, 'SHOPIFY-');
  const status = shopifyWorkflowStatusForOrder(order, existing);

  return {
    ...(existing || {}),
    orderId,
    shopifyOrderId: order.id,
    status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    orderAmount: order.totalAmount,
    currencyCode: order.currencyCode,
    productName,
    createdAt: order.createdAt,
    raw: {
      source: 'shopify',
      ...order
    },
    chatbyUserNs: existing?.chatbyUserNs || null,
    chatbyTemplateSentAt: existing?.chatbyTemplateSentAt || null,
    aiConfidence: existing?.aiConfidence ?? null,
    aiIntent: existing?.aiIntent || null,
    confirmedAt: status === 'CONFIRMED' ? existing?.confirmedAt || new Date().toISOString() : existing?.confirmedAt || null,
    operationalNote: existing?.operationalNote
      || `Pedido sincronizado desde Shopify. Pago: ${order.financialStatus || 'sin dato'}. Fulfillment: ${order.fulfillmentStatus || 'sin dato'}.`
  };
}

function normalizeShopifyWebhookOrder(payload) {
  const customer = payload.customer || {};
  const billing = payload.billing_address || {};
  const shipping = payload.shipping_address || {};
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const name = payload.name || (payload.order_number ? `#${payload.order_number}` : String(payload.id || ''));

  return {
    id: payload.admin_graphql_api_id || payload.id,
    name,
    createdAt: payload.created_at || payload.createdAt || new Date().toISOString(),
    cancelledAt: payload.cancelled_at || payload.cancelledAt || null,
    financialStatus: payload.financial_status || payload.displayFinancialStatus || '',
    fulfillmentStatus: payload.fulfillment_status || payload.displayFulfillmentStatus || '',
    totalAmount: Number(payload.total_price || payload.current_total_price || payload.totalAmount || 0),
    currencyCode: payload.currency || payload.currencyCode || 'EUR',
    customerName: [
      customer.first_name || shipping.first_name || billing.first_name,
      customer.last_name || shipping.last_name || billing.last_name
    ].filter(Boolean).join(' ') || shipping.name || billing.name || payload.email || 'Cliente Shopify',
    customerEmail: payload.email || customer.email || null,
    customerPhone: payload.phone || shipping.phone || billing.phone || customer.phone || null,
    products: lineItems.map((item) => ({
      title: item.title || item.name || item.sku || 'Producto Shopify',
      quantity: Number(item.quantity || 1)
    })),
    raw: payload
  };
}

async function shopifyFinancialStatusForOrder(order) {
  const rawStatus = normalizeText(order?.raw?.financialStatus || order?.raw?.displayFinancialStatus || order?.raw?.raw?.displayFinancialStatus);
  if (rawStatus) return rawStatus;

  if (!String(order?.orderId || '').startsWith('SHOPIFY-')) {
    return normalizeText(await getShopifyOrderFinancialStatus(order.orderId));
  }

  return '';
}

function shopifyConfirmationResult(order, store, patch, analysis, source = 'shopify') {
  const updated = upsertOrder(store.id, {
    ...patch,
    status: 'CONFIRMED',
    confirmedAt: patch.confirmedAt || new Date().toISOString(),
    operationalNote: 'Pedido Shopify confirmado localmente por el agente. No se ejecuta confirmacion en Dropea para pedidos de Shopify.'
  });
  return { action: 'confirmed_shopify_local', analysis, source, order: updated };
}

async function applyBlockedCustomerPolicy(order, store, source = 'blocked_customer_policy') {
  if (!isBlockedCustomerOrder(order, store)) return null;

  if (isTerminalBlockedCustomerStatus(order.status) && order.cancelledAt) {
    return {
      skipped: true,
      action: 'blocked_customer_already_handled',
      source,
      order
    };
  }

  const now = new Date().toISOString();
  const reason = blockedCustomerReason(order, store);
  const orderId = String(order.orderId || '');
  const canCancelInDropea = /^\d+$/.test(orderId);
  const basePatch = {
    ...order,
    aiConfidence: 100,
    aiIntent: 'BLOCKED_CUSTOMER',
    chatbyUserNs: order.chatbyUserNs || null,
    chatbyTemplateSentAt: order.chatbyTemplateSentAt || null,
    chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || null,
    chatbyTemplateName: order.chatbyTemplateName || configuredWhatsappTemplate(store) || null,
    chatbyTemplateSendStatus: 'blocked_customer_no_send',
    chatbyTemplateLastError: null,
    operationalNote: reason
  };

  if (!canCancelInDropea) {
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'BLOCKED_CUSTOMER_NO_DROPEA_ID',
      blockedCustomerDetectedAt: order.blockedCustomerDetectedAt || now
    });
    await safeUpsertSheetRow(updated, 'blocked_customer_policy');
    return {
      dryRun: false,
      action: 'blocked_customer_no_chatby_no_dropea_id',
      source,
      analysis: {
        intent: 'BLOCKED_CUSTOMER',
        confidence: 100,
        reason: `${reason} El pedido aun no tiene ID numerico de Dropea para cancelar.`
      },
      order: updated
    };
  }

  try {
    const cancellation = await cancelDropeaOrder(orderId);
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'REJECTED_BLOCKED_CUSTOMER',
      cancelledAt: now,
      blockedCustomerDetectedAt: order.blockedCustomerDetectedAt || now,
      raw: {
        ...(basePatch.raw || {}),
        automaticBlockedCustomerCancellation: {
          cancellation,
          source,
          cancelledAt: now
        }
      }
    });
    await safeUpsertSheetRow(updated, 'blocked_customer_policy');

    const state = { ...loadState() };
    const history = Array.isArray(state.automaticBlockedCustomerCancellations)
      ? state.automaticBlockedCustomerCancellations
      : [];
    state.automaticBlockedCustomerCancellations = [
      ...history,
      {
        orderId,
        phone: order.customerPhone || null,
        cancelledAt: now,
        source
      }
    ].slice(-200);
    saveState(state);

    return {
      dryRun: false,
      action: 'cancelled_blocked_customer',
      source,
      analysis: {
        intent: 'BLOCKED_CUSTOMER',
        confidence: 100,
        reason
      },
      cancellation,
      order: updated
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'BLOCKED_CUSTOMER_CANCELLATION_FAILED',
      blockedCustomerDetectedAt: order.blockedCustomerDetectedAt || now,
      cancellationError: message,
      raw: {
        ...(basePatch.raw || {}),
        automaticBlockedCustomerCancellationError: {
          message,
          source,
          failedAt: now
        }
      }
    });
    await safeUpsertSheetRow(updated, 'blocked_customer_policy');
    return {
      skipped: true,
      action: 'blocked_customer_cancellation_failed',
      source,
      error: message,
      analysis: {
        intent: 'BLOCKED_CUSTOMER',
        confidence: 100,
        reason
      },
      order: updated
    };
  }
}

async function storedConfirmationResult(order, store) {
  const analysis = {
    intent: 'CONFIRM',
    confidence: Number(order.aiConfidence ?? 100),
    reason: 'Confirmacion ya detectada previamente; se conserva aunque Chatby haya cambiado el pedido activo del contacto.'
  };

  if (store.agentDryRun ?? config.defaultStore.agentDryRun) {
    const updated = upsertOrder(store.id, {
      ...order,
      status: 'CONFIRMED_BY_CUSTOMER',
      aiConfidence: analysis.confidence,
      aiIntent: 'CONFIRM',
      operationalNote: 'Confirmacion ya detectada previamente. En modo simulacion, el agente habria confirmado el pedido.'
    });
    await safeUpsertSheetRow(updated);
    return { dryRun: true, action: 'would_confirm', analysis, source: 'stored_confirmation' };
  }

  return null;
}

async function unansweredTimeoutCancellationResult(order, store, validFrom) {
  // La cancelacion por 36h se ejecuta solo desde runUnansweredCancellationSweep,
  // que verifica Chatby en modo fail-safe antes de tocar Dropea.
  return null;
}

async function scheduleDelayedConfirmation(order, store, analysis, source, signalAt = null, inboundCustomerMessages = []) {
  const delayHours = Number(store.confirmationDelayHours ?? config.defaultStore.confirmationDelayHours ?? 1) || 1;
  const startedAt = signalAt || new Date().toISOString();
  const dueAt = addHours(startedAt, delayHours);
  const updated = upsertOrder(store.id, {
    ...order,
    status: 'PENDING',
    aiConfidence: Number(analysis?.confidence ?? 100),
    aiIntent: 'CONFIRM_DELAY_PENDING',
    confirmationDelayStartedAt: startedAt,
    confirmationDueAt: dueAt,
    confirmationSource: source || 'customer_confirmation',
    operationalNote: `Cliente confirmo claramente. El agente esperara ${delayHours}h antes de confirmar en Dropea y revisara si el cliente cancela durante la espera.`
  });
  await safeUpsertSheetRow(updated);

  const dueDate = parseDate(dueAt);
  if (dueDate && Date.now() >= dueDate.getTime()) {
    const immediateResult = await processDelayedConfirmation(updated, store, inboundCustomerMessages);
    if (immediateResult && !immediateResult.skipped) return immediateResult;
  }

  return {
    action: 'confirmation_scheduled',
    dryRun: false,
    analysis: {
      ...analysis,
      intent: 'CONFIRM_DELAY_PENDING',
      reason: `Confirmacion detectada. Confirmacion real programada para ${dueAt}; antes se revisara Chatby por cancelaciones posteriores.`
    },
    source,
    dueAt
  };
}

async function processDelayedConfirmation(order, store, inboundCustomerMessages) {
  if (String(order.aiIntent || '').toUpperCase() !== 'CONFIRM_DELAY_PENDING') return null;

  const dueAt = parseDate(order.confirmationDueAt);
  const startedAt = order.confirmationDelayStartedAt || order.confirmationDueAt || new Date().toISOString();
  const messagesAfterConfirmation = customerMessagesAfter(inboundCustomerMessages, startedAt);
  const latestIntent = customerConversationIntentForOrder(messagesAfterConfirmation, order)
    || deterministicCustomerIntent(messagesAfterConfirmation);

  if (latestIntent?.intent === 'CANCEL') {
    const cancellation = await cancelDropeaOrder(order.orderId);
    const updated = upsertOrder(store.id, {
      ...order,
      status: 'REJECTED_AFTER_CONFIRM_CANCEL',
      aiConfidence: Number(latestIntent.confidence ?? 100),
      aiIntent: 'CANCEL_AFTER_CONFIRMATION',
      cancelledAt: new Date().toISOString(),
      operationalNote: 'Cliente cancelo despues de confirmar y antes de la hora de espera. El agente rechazo/cancelo el pedido en Dropea.'
    });
    await safeUpsertSheetRow(updated);
    return {
      action: 'rejected_after_confirmation_cancel',
      dryRun: false,
      analysis: {
        ...latestIntent,
        reason: latestIntent.reason || 'El cliente cancelo despues de confirmar, dentro de la ventana de espera.'
      },
      cancellation,
      source: latestIntent.source || 'customer_cancel_after_confirmation'
    };
  }

  if (latestIntent?.intent === 'ADDRESS_CHANGE') {
    const updated = upsertOrder(store.id, {
      ...order,
      status: 'PENDING_ADDRESS_CHANGE',
      aiConfidence: Number(latestIntent.confidence ?? 100),
      aiIntent: 'ADDRESS_CHANGE_REQUESTED',
      operationalNote: 'Cliente pidio cambiar direccion/datos despues de confirmar. No se confirma en Dropea hasta corregir datos.'
    });
    await safeUpsertSheetRow(updated);
    return {
      action: 'hold_after_confirmation_address_change',
      dryRun: false,
      analysis: latestIntent,
      source: latestIntent.source || 'customer_address_change_after_confirmation'
    };
  }

  if (!dueAt || Date.now() < dueAt.getTime()) {
    return {
      skipped: true,
      reason: 'confirmation_delay_waiting',
      dueAt: order.confirmationDueAt
    };
  }

  const delayedConfirmRealEnabled = Boolean(store.delayedConfirmRealEnabled ?? config.defaultStore.delayedConfirmRealEnabled);
  if (!delayedConfirmRealEnabled) {
    const updated = upsertOrder(store.id, {
      ...order,
      status: 'CONFIRM_DELAY_READY',
      aiIntent: 'CONFIRM_DELAY_READY',
      operationalNote: 'La espera de 1h termino y no hubo cancelacion posterior, pero la confirmacion real esta desactivada.'
    });
    await safeUpsertSheetRow(updated);
    return {
      dryRun: true,
      action: 'would_confirm_after_delay',
      analysis: {
        intent: 'CONFIRM',
        confidence: Number(order.aiConfidence ?? 100),
        reason: 'Pasada la espera de 1h sin cancelacion posterior. Confirmacion real desactivada por configuracion.'
      },
      source: order.confirmationSource || 'delayed_confirmation'
    };
  }

  const confirmation = await confirmDropeaOrder(order.orderId);
  const updated = upsertOrder(store.id, {
    ...order,
    status: 'CONFIRMED',
    aiConfidence: Number(order.aiConfidence ?? 100),
    aiIntent: 'CONFIRM',
    confirmedAt: new Date().toISOString(),
    operationalNote: 'Confirmacion ejecutada en Dropea tras esperar 1h y comprobar que no hubo cancelacion posterior en Chatby.'
  });
  await safeUpsertSheetRow(updated);
  return {
    action: 'confirmed_after_delay',
    dryRun: false,
    analysis: {
      intent: 'CONFIRM',
      confidence: Number(order.aiConfidence ?? 100),
      reason: 'Pasada la espera de 1h tras la confirmacion, no se detecto cancelacion posterior en Chatby.'
    },
    confirmation,
    source: order.confirmationSource || 'delayed_confirmation'
  };
}

async function simulationOverrideResult(order, store) {
  if (!(store.agentDryRun ?? config.defaultStore.agentDryRun)) return null;
  if (!config.googleSheetsEnabled) return null;

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
      status: 'CONFIRMED_BY_CUSTOMER',
      aiConfidence: 100,
      aiIntent: 'CONFIRM',
      operationalNote: 'Cliente confirmo claramente. En modo simulacion, el agente habria confirmado el pedido.'
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
      status: isAddressChange ? 'PENDING_ADDRESS_CHANGE' : order.status,
      aiConfidence: 100,
      aiIntent: isAddressChange ? 'ADDRESS_CHANGE_REQUESTED' : 'NO_CONFIRM',
      operationalNote: isAddressChange
        ? 'Cliente solicito cambiar datos/direccion de envio. Pedido pendiente hasta corregir direccion en Dropea; no confirmar automaticamente.'
        : order.operationalNote
    });
    await safeUpsertSheetRow(updated);
    return { dryRun: true, action: 'would_not_confirm', analysis, source };
  }

  return null;
}

function currentSubscriberOrderId(subscriber) {
  const fields = subscriber?.user_fields || [];
  const field = fields.find((item) => {
    const name = normalizeText(item.name);
    return name.includes('dropea')
      && (
        name.includes('numero')
        || name.includes('n mero')
        || name.includes('nã')
        || name.includes('num')
        || name.includes('order')
        || name.includes('pedido')
      );
  });
  return field?.value ? String(field.value) : null;
}

function subscriberConfirmationTimestamp(subscriber) {
  if (!subscriberConfirmsOrder(subscriber)) return null;

  const fields = subscriber?.user_fields || [];
  const confirmationField = fields.find((item) => {
    const name = normalizeText(item.name);
    return name.includes('confirm');
  });
  const fieldDate = parseDate(confirmationField?.value);
  if (fieldDate) return fieldDate;

  return parseDate(
    subscriber?.confirmed_at
    || subscriber?.confirmedAt
    || subscriber?.lead_status_updated_at
    || subscriber?.leadStatusUpdatedAt
    || subscriber?.updated_at
    || subscriber?.updatedAt
  );
}

function customerConversationIntentForOrder(messages, order) {
  const orderedMessages = [...messages].sort((a, b) => messageTimestamp(a) - messageTimestamp(b));
  const customerOnly = orderedMessages.filter((message) => isCustomerMessage(message));

  for (let index = customerOnly.length - 1; index >= 0; index -= 1) {
    const message = customerOnly[index];
    const intent = deterministicCustomerIntent([message]);
    if (!intent) continue;

    if (intent.intent === 'ADDRESS_CHANGE') {
      return {
        ...intent,
        customer_message: message.content || '',
        source: normalizeText(message.raw?.msg_type || message.raw?.message_type).includes('postback')
          ? 'chatby_change_address_button'
          : 'customer_address_change'
      };
    }

    if (intent.intent === 'CANCEL') {
      return {
        ...intent,
        customer_message: message.content || '',
        source: normalizeText(message.raw?.msg_type || message.raw?.message_type).includes('postback')
          ? 'chatby_change_address_button'
          : 'customer_message'
      };
    }

    if (intent.intent === 'CONFIRM') {
      return {
        ...intent,
        customer_message: message.content || '',
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

function sameOrderId(left, right) {
  const leftText = String(left || '');
  const rightText = String(right || '');
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;
  const leftDigits = leftText.replace(/\D/g, '');
  const rightDigits = rightText.replace(/\D/g, '');
  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

function subscriberContainsOrderId(subscriber, orderId) {
  const target = String(orderId || '').replace(/\D/g, '');
  if (!target) return false;
  const text = JSON.stringify(subscriber || {});
  return text.replace(/\D/g, ' ').split(/\s+/).includes(target);
}

async function resolveSubscriberForOrder(order) {
  const exact = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });
  if (exact) return exact;

  if (!order.customerPhone) return null;
  const byPhone = await findSubscriberByPhone({ phone: order.customerPhone, maxPages: 10 });
  if (!byPhone) return null;

  const sameThread = order.chatbyUserNs && String(byPhone.user_ns || byPhone.userNs || '') === String(order.chatbyUserNs);
  if (sameThread || subscriberContainsOrderId(byPhone, order.orderId)) {
    return byPhone;
  }

  return null;
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

function configuredWhatsappTemplate(store) {
  return store.whatsappTemplateName || config.whatsappTemplateName || null;
}

function templateAlreadyAttempted(order, templateName) {
  if (order.chatbyTemplateAttemptedAt || order.chatbyTemplateSentAt) return true;
  if (!templateName) return false;
  return normalizeText(order.chatbyTemplateName) === normalizeText(templateName)
    && ['sent', 'failed', 'already_seen', 'attempted'].includes(normalizeText(order.chatbyTemplateSendStatus));
}

function retryableTemplateFailure(order) {
  const status = normalizeText(order?.chatbyTemplateSendStatus);
  return status === 'failed';
}

function staleTemplateAttempt(order) {
  const status = normalizeText(order?.chatbyTemplateSendStatus);
  if (status !== 'attempted') return false;
  if (order?.chatbyTemplateSentAt) return false;
  const attemptedAt = parseDate(order?.chatbyTemplateAttemptedAt);
  if (!attemptedAt) return true;
  return (Date.now() - attemptedAt.getTime()) / 60000 >= Number(process.env.INITIAL_TEMPLATE_RETRY_AFTER_MINUTES || 10);
}

function messageLooksLikeTemplate(message, templateName) {
  const target = normalizeText(String(templateName || '').split(/\s+/).pop() || templateName);
  if (!target) return false;
  const raw = message?.raw || message || {};
  const text = normalizeText([
    message?.content,
    raw.template_name,
    raw.templateName,
    raw.name,
    raw.content?.name,
    raw.message,
    raw.text,
    raw.title,
    JSON.stringify(raw)
  ].filter(Boolean).join(' '));
  return text.includes(target);
}

function messageLooksLikeTemplateForOrder(message, templateName, orderId) {
  if (!messageLooksLikeTemplate(message, templateName)) return false;
  const targetOrderId = String(orderId || '').replace(/\D/g, '');
  if (!targetOrderId) return true;
  const raw = message?.raw || message || {};
  const text = [
    message?.content,
    raw.template_name,
    raw.templateName,
    raw.name,
    raw.content?.name,
    raw.message,
    raw.text,
    raw.title,
    JSON.stringify(raw)
  ].filter(Boolean).join(' ');
  return text.replace(/\D/g, ' ').split(/\s+/).includes(targetOrderId);
}

async function markTemplateAlreadySeen(order, userNs, store, templateName) {
  if (!userNs) return null;
  try {
    const messages = normalizeChatMessages(await getChatMessages(userNs));
    if (!messages.some((message) => messageLooksLikeTemplate(message, templateName))) return null;
    return upsertOrder(store.id, {
      ...order,
      chatbyUserNs: userNs,
      chatbyTemplateSentAt: order.chatbyTemplateSentAt || new Date().toISOString(),
      chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || new Date().toISOString(),
      chatbyTemplateName: templateName,
      chatbyTemplateSendStatus: 'already_seen'
    });
  } catch {
    return null;
  }
}

async function markTemplateAlreadySeenForOrder(order, userNs, store, templateName) {
  if (!userNs) return null;
  try {
    const messages = normalizeChatMessages(await getChatMessages(userNs));
    if (!messages.some((message) => messageLooksLikeTemplateForOrder(message, templateName, order.orderId))) return null;
    return upsertOrder(store.id, {
      ...order,
      chatbyUserNs: userNs,
      chatbyTemplateSentAt: order.chatbyTemplateSentAt || new Date().toISOString(),
      chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || new Date().toISOString(),
      chatbyTemplateName: templateName,
      chatbyTemplateSendStatus: 'already_seen'
    });
  } catch {
    return null;
  }
}

function createdChatbyUserNs(created) {
  return created?.data?.user_ns || created?.user_ns || created?.userNs || created?.id || null;
}

function shouldFallbackToChatby(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /authorization error|oauth|meta whatsapp respondio 400|meta whatsapp respondio 401|meta whatsapp respondio 403/i.test(message);
}

async function resolveOrCreateChatbyUserNsForTemplate(order, userNs) {
  if (userNs) return userNs;
  if (!config.chatbyToken || !order.customerPhone) return null;

  const subscriber = await resolveSubscriberForOrder(order)
    || await findSubscriberByPhone({ phone: order.customerPhone, maxPages: 10 });
  if (subscriber?.user_ns) return subscriber.user_ns;

  const created = await createSubscriber({
    phone: order.customerPhone,
    name: order.customerName || order.customerPhone,
    email: order.customerEmail || undefined,
    metadata: {
      orderId: order.orderId,
      source: 'dropea',
      createdBy: 'suleia-autoconfirm'
    }
  });

  return createdChatbyUserNs(created);
}

async function sendInitialTemplateWithFallback({ order, templateName, params, userNs }) {
  const preferredProvider = String(config.whatsappProvider || 'meta').toLowerCase();
  if (preferredProvider === 'chatby') {
    const chatbyUserNs = await resolveOrCreateChatbyUserNsForTemplate(order, userNs);
    if (!chatbyUserNs) {
      throw new Error('No se pudo resolver o crear contacto en Chatby para enviar plantilla.');
    }
    const response = await sendWhatsappTemplate({
      user_ns: chatbyUserNs,
      user_id: order.customerPhone,
      template_name: templateName,
      params
    });
    return { provider: 'chatby', response, userNs: chatbyUserNs };
  }

  try {
    const response = await sendMetaWhatsappTemplate({
      to: order.customerPhone,
      templateName,
      params
    });
    return { provider: 'meta', response, userNs };
  } catch (error) {
    if (!shouldFallbackToChatby(error)) throw error;

    const fallbackUserNs = await resolveOrCreateChatbyUserNsForTemplate(order, userNs);
    if (!fallbackUserNs) throw error;

    const response = await sendWhatsappTemplate({
      user_ns: fallbackUserNs,
      user_id: order.customerPhone,
      template_name: templateName,
      params
    });

    return {
      provider: 'chatby',
      fallbackReason: error instanceof Error ? error.message : String(error),
      response,
      userNs: fallbackUserNs
    };
  }
}

async function sendChatbyTemplateForOrder(order, userNs, store) {
  const blocked = await applyBlockedCustomerPolicy(order, store, 'chatby_template_send_guard');
  if (blocked) return blocked.order || order;

  const templateName = configuredWhatsappTemplate(store);
  if (!templateName || !userNs || templateAlreadyAttempted(order, templateName)) return order;

  const alreadySeen = await markTemplateAlreadySeen(order, userNs, store, templateName);
  if (alreadySeen) return alreadySeen;

  const params = templateParamsForOrder(order);
  let sendResponse = null;
  const provider = 'meta';
  const attemptedAt = new Date().toISOString();

  upsertOrder(store.id, {
    ...order,
    chatbyUserNs: userNs,
    chatbyTemplateAttemptedAt: attemptedAt,
    chatbyTemplateName: templateName,
    chatbyTemplateSendStatus: 'attempted',
    chatbyTemplateLastError: null
  });

  try {
    sendResponse = await sendInitialTemplateWithFallback({
      order,
      templateName,
      params,
      userNs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return upsertOrder(store.id, {
      ...order,
      chatbyUserNs: userNs,
      chatbyTemplateAttemptedAt: attemptedAt,
      chatbyTemplateName: templateName,
      chatbyTemplateSendStatus: 'failed',
      chatbyTemplateLastError: message
    });
  }

  return upsertOrder(store.id, {
    ...order,
    chatbyUserNs: sendResponse.userNs || userNs,
    chatbyTemplateSentAt: new Date().toISOString(),
    chatbyTemplateAttemptedAt: attemptedAt,
    chatbyTemplateName: templateName,
    chatbyTemplateSendStatus: 'sent',
    chatbyTemplateLastError: null,
    chatbyLastSendResponse: {
      provider: sendResponse.provider || provider,
      response: sendResponse.response,
      fallbackReason: sendResponse.fallbackReason || null
    }
  });
}

export async function ingestPendingOrders({ store = config.defaultStore, limit = 100, pages = 5 } = {}) {
  const pendingById = new Map();
  for (let page = 1; page <= pages; page += 1) {
    const pageOrders = await listPendingDropeaOrders({ limit, page });
    for (const order of pageOrders) {
      pendingById.set(String(order.orderId), order);
    }
    if (pageOrders.length < limit) break;
  }
  const pending = [...pendingById.values()];
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
      chatbyTemplateAttemptedAt: existing?.chatbyTemplateAttemptedAt || null,
      chatbyTemplateName: existing?.chatbyTemplateName || null,
      chatbyTemplateSendStatus: existing?.chatbyTemplateSendStatus || null,
      chatbyTemplateLastError: existing?.chatbyTemplateLastError || null,
      aiConfidence: existing?.aiConfidence ?? null,
      aiIntent: existing?.aiIntent || null,
      confirmationDelayStartedAt: existing?.confirmationDelayStartedAt || null,
      confirmationDueAt: existing?.confirmationDueAt || null,
      confirmationSource: existing?.confirmationSource || null,
      confirmedAt: existing?.confirmedAt || null,
      cancelledAt: existing?.cancelledAt || null,
      timeoutCancellationEvaluatedAt: existing?.timeoutCancellationEvaluatedAt || null,
      assistantCheckedAt: existing?.assistantCheckedAt || null,
      operationalNote: existing?.operationalNote || null
    });

    const blocked = await applyBlockedCustomerPolicy(merged, store, 'dropea_pending_ingest');
    if (blocked) {
      processed.push(blocked.order || merged);
      continue;
    }

    await safeUpsertSheetRow(merged);
    processed.push(merged);
  }

  const state = { ...loadState() };
  state.lastPollAt = new Date().toISOString();
  saveState(state);

  return { processed: processed.length, orders: processed };
}

export async function backfillTodayMissingInitialTemplates({
  store = config.defaultStore,
  limit = 100,
  pages = 2,
  statuses = null,
  targetDate = null
} = {}) {
  const templateName = configuredWhatsappTemplate(store);
  if (!templateName) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, reason: 'missing_template_name', results: [] };
  }

  const targetKey = targetDate || todayKey(config.timezone);
  const orders = await listRecentDropeaOrders({
    limit,
    pages,
    statuses: statuses || ['PENDING', 'CONFIRMED', 'IN_PREPARATION', 'PREPARED']
  });

  const results = [];

  for (const order of orders) {
    const createdKey = dateKeyInTimezone(dropeaCreatedAt(order), config.timezone);
    if (createdKey !== targetKey) continue;

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
      chatbyTemplateAttemptedAt: existing?.chatbyTemplateAttemptedAt || null,
      chatbyTemplateName: existing?.chatbyTemplateName || null,
      chatbyTemplateSendStatus: existing?.chatbyTemplateSendStatus || null,
      chatbyTemplateLastError: existing?.chatbyTemplateLastError || null,
      aiConfidence: existing?.aiConfidence ?? null,
      aiIntent: existing?.aiIntent || null,
      operationalNote: existing?.operationalNote || null
    });

    if (!isAfterCutoff(order, store.activationCutoff)) {
      results.push({ orderId: order.orderId, skipped: true, reason: 'before_activation_cutoff' });
      continue;
    }

    const blocked = await applyBlockedCustomerPolicy(merged, store, 'initial_template_backfill_guard');
    if (blocked) {
      results.push({ orderId: order.orderId, action: blocked.action || 'blocked_customer', skipped: Boolean(blocked.skipped) });
      continue;
    }

    const retryableAttempt = retryableTemplateFailure(merged) || staleTemplateAttempt(merged);
    if (templateAlreadyAttempted(merged, templateName) && !retryableAttempt) {
      results.push({ orderId: order.orderId, skipped: true, reason: 'already_attempted', status: merged.chatbyTemplateSendStatus });
      continue;
    }

    const sendCandidate = retryableAttempt
      ? {
          ...merged,
          chatbyTemplateSentAt: null,
          chatbyTemplateAttemptedAt: null,
          chatbyTemplateSendStatus: null,
          chatbyTemplateLastError: null
        }
      : merged;

    let subscriber = null;
    if (config.chatbyToken && merged.customerPhone) {
      subscriber = await resolveSubscriberForOrder(merged);
      if (!subscriber) {
        subscriber = await findSubscriberByPhone({ phone: merged.customerPhone, maxPages: 10 });
      }
    }

    if (subscriber?.user_ns) {
      const alreadySeen = await markTemplateAlreadySeenForOrder(sendCandidate, subscriber.user_ns, store, templateName);
      if (alreadySeen) {
        results.push({ orderId: order.orderId, action: 'already_seen', userNs: subscriber.user_ns });
        continue;
      }
    }

    const hydrated = subscriber?.user_ns
      ? await sendChatbyTemplateForOrder({ ...sendCandidate, chatbyUserNs: subscriber.user_ns }, subscriber.user_ns, store)
      : await ensureChatbyThread(sendCandidate, store);

    await safeUpsertSheetRow(hydrated, 'initial_template_backfill');

    results.push({
      orderId: order.orderId,
      action: hydrated.chatbyTemplateSendStatus === 'sent' ? 'sent' : hydrated.chatbyTemplateSendStatus,
      status: hydrated.status,
      error: hydrated.chatbyTemplateLastError || null
    });
  }

  const state = { ...loadState() };
  state.lastInitialTemplateBackfillAt = new Date().toISOString();
  saveState(state);

  const sent = results.filter((item) => item.action === 'sent').length;
  const failed = results.filter((item) => item.action === 'failed').length;
  const skipped = results.filter((item) => item.skipped || ['already_seen', 'already_attempted'].includes(item.action)).length;
  return { processed: results.length, sent, failed, skipped, date: targetKey, results };
}

export async function ingestShopifyOrders({ store = config.defaultStore, limit = 100 } = {}) {
  if (!config.shopifyDomain || (!config.shopifyAdminAccessToken && (!config.shopifyClientId || !config.shopifyClientSecret))) {
    const state = { ...loadState() };
    state.lastShopifySyncError = 'Faltan credenciales de Shopify para verificar pedidos.';
    saveState(state);
    return {
      skipped: true,
      reason: 'missing_shopify_credentials',
      processed: 0,
      orders: []
    };
  }

  const recent = await listRecentShopifyOrders({ first: limit });
  const processed = [];

  for (const order of recent) {
    const orderId = String(order.name || order.id || '').replace(/^#/, 'SHOPIFY-');
    if (!orderId) continue;
    if (!isAfterCutoff({ createdAt: order.createdAt, raw: order }, store.activationCutoff)) {
      continue;
    }

    const existing = findOrder(store.id, orderId);
    const merged = upsertOrder(store.id, normalizeShopifyWorkflowOrder(order, existing));
    const blocked = await applyBlockedCustomerPolicy(merged, store, 'shopify_ingest');
    if (blocked) {
      processed.push(blocked.order || merged);
      continue;
    }

    await safeUpsertSheetRow(merged, 'shopify_ingest');
    processed.push(merged);
  }

  const state = { ...loadState() };
  state.lastShopifySyncAt = new Date().toISOString();
  state.lastShopifySyncError = null;
  saveState(state);

  return { processed: processed.length, orders: processed };
}

export async function handleShopifyWebhook({ store = config.defaultStore, payload }) {
  const normalized = normalizeShopifyWebhookOrder(payload || {});
  const orderId = String(normalized.name || normalized.id || '').replace(/^#/, 'SHOPIFY-');
  if (!orderId) {
    return { accepted: false, reason: 'missing_shopify_order_id' };
  }

  if (!isAfterCutoff({ createdAt: normalized.createdAt, raw: normalized }, store.activationCutoff)) {
    return { accepted: true, skipped: true, reason: 'before_activation_cutoff', orderId };
  }

  const existing = findOrder(store.id, orderId);
  const merged = upsertOrder(store.id, normalizeShopifyWorkflowOrder(normalized, existing));
  const blocked = await applyBlockedCustomerPolicy(merged, store, 'shopify_webhook');
  if (blocked) {
    const state = { ...loadState() };
    state.lastShopifyWebhookAt = new Date().toISOString();
    state.lastShopifySyncError = null;
    saveState(state);
    return { accepted: true, order: blocked.order || merged, blockedCustomer: true, action: blocked.action };
  }

  await safeUpsertSheetRow(merged, 'shopify_webhook');

  const state = { ...loadState() };
  state.lastShopifyWebhookAt = new Date().toISOString();
  state.lastShopifySyncError = null;
  saveState(state);

  return { accepted: true, order: merged };
}

export async function ensureChatbyThread(order, store = config.defaultStore) {
  const blocked = await applyBlockedCustomerPolicy(order, store, 'ensure_chatby_thread_guard');
  if (blocked) return blocked.order || order;

  const templateName = configuredWhatsappTemplate(store);
  if (templateName && !templateAlreadyAttempted(order, templateName)) {
    const attemptedAt = new Date().toISOString();
    const params = templateParamsForOrder(order);
    upsertOrder(store.id, {
      ...order,
      chatbyTemplateAttemptedAt: attemptedAt,
      chatbyTemplateName: templateName,
      chatbyTemplateSendStatus: 'attempted',
      chatbyTemplateLastError: null
    });
    try {
      const sendResponse = await sendInitialTemplateWithFallback({
        order,
        templateName,
        params,
        userNs: order.chatbyUserNs || null
      });
      const updated = upsertOrder(store.id, {
        ...order,
        chatbyUserNs: sendResponse.userNs || order.chatbyUserNs || null,
        chatbyTemplateSentAt: new Date().toISOString(),
        chatbyTemplateAttemptedAt: attemptedAt,
        chatbyTemplateName: templateName,
        chatbyTemplateSendStatus: 'sent',
        chatbyTemplateLastError: null,
        chatbyLastSendResponse: {
          provider: sendResponse.provider || 'meta',
          response: sendResponse.response,
          fallbackReason: sendResponse.fallbackReason || null
        }
      });
      await safeUpsertSheetRow(updated);
      return updated;
    } catch (error) {
      const updated = upsertOrder(store.id, {
        ...order,
        chatbyTemplateAttemptedAt: attemptedAt,
        chatbyTemplateName: templateName,
        chatbyTemplateSendStatus: 'failed',
        chatbyTemplateLastError: error instanceof Error ? error.message : String(error)
      });
      await safeUpsertSheetRow(updated);
      return updated;
    }
  }

  if (!config.chatbyToken) return order;
  if (order.chatbyUserNs) {
    return order;
  }
  if (!order.customerPhone) return order;

  const existingSubscriber = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });

  if (existingSubscriber?.user_ns) {
    const updated = upsertOrder(store.id, {
      ...order,
      chatbyUserNs: existingSubscriber.user_ns,
      chatbyTemplateSentAt: order.chatbyTemplateSentAt || null
    });
    await safeUpsertSheetRow(updated);
    return updated;
  }

  return order;
}

async function attachExistingChatbyThread(order, store = config.defaultStore) {
  if (order.chatbyUserNs || !config.chatbyToken || !order.customerPhone) return order;
  const existingSubscriber = await resolveSubscriberForOrder(order);
  if (!existingSubscriber?.user_ns) return order;
  const updated = upsertOrder(store.id, {
    ...order,
    chatbyUserNs: existingSubscriber.user_ns
  });
  await safeUpsertSheetRow(updated);
  return updated;
}

export async function analyzeAndMaybeConfirmOrder(order, store = config.defaultStore) {
  const blocked = await applyBlockedCustomerPolicy(order, store, 'analyze_order_guard');
  if (blocked) return blocked;

  order = await attachExistingChatbyThread(order, store);

  if (order.status !== 'PENDING') {
    return { skipped: true, reason: 'order_not_pending' };
  }

  if (confirmedStoredOrder(order, store)) {
    const storedResult = await storedConfirmationResult(order, store);
    if (storedResult) return storedResult;
  }

  const simulationOverride = await simulationOverrideResult(order, store);
  if (simulationOverride) return simulationOverride;

  if (!order.chatbyUserNs) {
    const validFrom = unansweredTimeoutStart(order);
    const timeoutCancellation = await unansweredTimeoutCancellationResult(order, store, validFrom);
    if (timeoutCancellation) return timeoutCancellation;
    return { skipped: true, reason: 'no_chat_thread' };
  }

  const messages = normalizeChatMessages(await getChatMessages(order.chatbyUserNs));
  const subscriber = await resolveSubscriberForOrder(order);

  const validFrom = unansweredTimeoutStart(order);
  const inboundCustomerMessages = customerMessagesAfter(messages, validFrom);
  const latestInboundCustomerMessageAt = inboundCustomerMessages.length
    ? parseDate(inboundCustomerMessages[inboundCustomerMessages.length - 1]?.raw?.created_at || inboundCustomerMessages[inboundCustomerMessages.length - 1]?.raw?.createdAt || inboundCustomerMessages[inboundCustomerMessages.length - 1]?.createdAt)
    : null;

  const delayedConfirmationResult = await processDelayedConfirmation(order, store, inboundCustomerMessages);
  if (delayedConfirmationResult) return delayedConfirmationResult;

  const immediateCustomerIntent = customerConversationIntentForOrder(inboundCustomerMessages, order)
    || deterministicCustomerIntent(inboundCustomerMessages);
  if (['CANCEL', 'ADDRESS_CHANGE'].includes(immediateCustomerIntent?.intent)) {
    const isAddressChange = immediateCustomerIntent.intent === 'ADDRESS_CHANGE';
    const patch = {
      ...order,
      status: isAddressChange ? 'PENDING_ADDRESS_CHANGE' : 'MANUAL_REVIEW',
      aiConfidence: Number(immediateCustomerIntent.confidence ?? 100),
      aiIntent: isAddressChange ? 'ADDRESS_CHANGE_REQUESTED' : 'NO_CONFIRM',
      operationalNote: isAddressChange
        ? 'Cliente solicito cambiar datos/direccion de envio. Pedido pendiente hasta corregir direccion en Dropea; no confirmar automaticamente.'
        : 'Cliente no confirma el pedido. No confirmar automaticamente.'
    };
    const updated = upsertOrder(store.id, patch);
    await safeUpsertSheetRow(updated);
    return {
      dryRun: store.agentDryRun ?? config.defaultStore.agentDryRun,
      action: 'would_not_confirm',
      analysis: {
        ...immediateCustomerIntent,
        reason: isAddressChange
          ? 'El cliente ha pedido cambiar datos/direccion de envio; la direccion de Dropea no debe considerarse valida.'
          : immediateCustomerIntent.reason
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
      patch.status = 'CONFIRMED_BY_CUSTOMER';
      patch.operationalNote = 'Cliente confirmo claramente. En modo simulacion, el agente habria confirmado el pedido.';
      const updated = upsertOrder(store.id, patch);
      await safeUpsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis, source: immediateCustomerIntent.source || 'customer_message' };
    }

    if (isShopifyOrder(order)) {
      const financialStatus = await shopifyFinancialStatusForOrder(order);
      if (!financialStatus.includes('paid') && !financialStatus.includes('pagado')) {
        patch.status = 'MANUAL_REVIEW';
        patch.operationalNote = 'Pedido pendiente de pago en Shopify. No se confirma automaticamente.';
        const updated = upsertOrder(store.id, patch);
        await safeUpsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }

      const result = shopifyConfirmationResult(order, store, patch, analysis, immediateCustomerIntent.source || 'customer_message');
      await safeUpsertSheetRow(result.order);
      return result;
    }

    return scheduleDelayedConfirmation(
      patch,
      store,
      analysis,
      immediateCustomerIntent.source || 'customer_message',
      latestInboundCustomerMessageAt?.toISOString() || new Date().toISOString(),
      inboundCustomerMessages
    );
  }

  const subscriberOrderId = currentSubscriberOrderId(subscriber);
  if (sameOrderId(subscriberOrderId, order.orderId) && subscriberConfirmsOrder(subscriber)) {
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
      patch.status = 'CONFIRMED_BY_CUSTOMER';
      patch.operationalNote = 'Cliente confirmo claramente por boton. En modo simulacion, el agente habria confirmado el pedido.';
      const updated = upsertOrder(store.id, patch);
      await safeUpsertSheetRow(updated);
      return { dryRun: true, action: 'would_confirm', analysis, source: 'chatby_button' };
    }

    if (isShopifyOrder(order)) {
      const financialStatus = await shopifyFinancialStatusForOrder(order);
      if (!financialStatus.includes('paid') && !financialStatus.includes('pagado')) {
        patch.status = 'MANUAL_REVIEW';
        patch.operationalNote = 'Pedido pendiente de pago en Shopify. No se confirma automaticamente.';
        const updated = upsertOrder(store.id, patch);
        await safeUpsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }

      const result = shopifyConfirmationResult(order, store, patch, analysis, 'chatby_button');
      await safeUpsertSheetRow(result.order);
      return result;
    }

    return scheduleDelayedConfirmation(
      patch,
      store,
      analysis,
      'chatby_button',
      subscriberConfirmationTimestamp(subscriber)?.toISOString()
        || latestInboundCustomerMessageAt?.toISOString()
        || new Date().toISOString(),
      inboundCustomerMessages
    );
  }

  const timeoutCancellation = await unansweredTimeoutCancellationResult(order, store, validFrom);
  if (timeoutCancellation) return timeoutCancellation;

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
      const storedResult = await storedConfirmationResult(order, store);
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

    if (isShopifyOrder(order)) {
      const financialStatus = await shopifyFinancialStatusForOrder(order);
      if (!financialStatus.includes('paid') && !financialStatus.includes('pagado')) {
        patch.status = 'MANUAL_REVIEW';
        const updated = upsertOrder(store.id, patch);
        await safeUpsertSheetRow(updated);
        return { action: 'manual_review_non_paid', analysis, financialStatus };
      }

      const result = shopifyConfirmationResult(order, store, patch, analysis);
      await safeUpsertSheetRow(result.order);
      return result;
    }

    return scheduleDelayedConfirmation(
      patch,
      store,
      analysis,
      analysis.source || 'classified_customer_message',
      lastMessageAt?.toISOString() || new Date().toISOString(),
      inboundCustomerMessages
    );
  }

  if (['CANCEL', 'ADDRESS_CHANGE'].includes(intent) && confidence >= threshold) {
    patch.status = 'MANUAL_REVIEW';
    if (intent === 'ADDRESS_CHANGE') {
      patch.aiIntent = 'ADDRESS_CHANGE_REQUESTED';
      patch.status = 'PENDING_ADDRESS_CHANGE';
      patch.operationalNote = 'Cliente solicito cambiar datos/direccion de envio. Pedido pendiente hasta corregir direccion en Dropea; no confirmar automaticamente.';
    }
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
    let hydrated = order;
    let result = null;
    try {
      const blocked = await applyBlockedCustomerPolicy(order, store, 'auto_confirm_guard');
      if (blocked) {
        result = blocked;
        if (!blocked.skipped) {
          await recordDecisionAndReturn(blocked.order || order, blocked);
        }
        results.push({ orderId: order.orderId, result });
        continue;
      }

      hydrated = await ensureChatbyThread(order, store);
      result = await analyzeAndMaybeConfirmOrder(hydrated, store);
      if (result && !result.skipped) {
        await recordDecisionAndReturn(hydrated, result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = upsertOrder(store.id, {
        ...hydrated,
        aiIntent: hydrated.aiIntent || 'AGENT_ERROR',
        operationalNote: `Error del agente logistico: ${message}`,
        lastAgentErrorAt: new Date().toISOString(),
        lastAgentError: message
      });
      await safeUpsertSheetRow(updated);
      result = { action: 'agent_error', error: message };
      console.error(`[auto_confirm] Order ${order.orderId} failed:`, error);
    }
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
    let shopifyIngestResult = null;
    let templateBackfillResult = null;
    let confirmResult = null;
    let ingestError = null;
    let shopifyIngestError = null;
    let templateBackfillError = null;
    let confirmError = null;

    try {
      ingestResult = await ingestPendingOrders({ store, limit });
    } catch (error) {
      ingestError = error instanceof Error ? error.message : String(error);
      console.error('[automation_cycle] ingestPendingOrders failed:', error);
    }

    try {
      shopifyIngestResult = await ingestShopifyOrders({ store, limit: Math.max(limit, 100) });
    } catch (error) {
      shopifyIngestError = error instanceof Error ? error.message : String(error);
      const state = { ...loadState() };
      state.lastShopifySyncError = shopifyIngestError;
      saveState(state);
      console.error('[automation_cycle] ingestShopifyOrders failed:', error);
    }

    try {
      const state = loadState();
      const lastBackfillAt = parseDate(state.lastInitialTemplateBackfillAt);
      const intervalMinutes = Number(process.env.INITIAL_TEMPLATE_BACKFILL_INTERVAL_MINUTES || 15);
      const due = !lastBackfillAt || ((Date.now() - lastBackfillAt.getTime()) / 60000) >= intervalMinutes;
      if (due) {
        templateBackfillResult = await backfillTodayMissingInitialTemplates({
          store,
          limit: Math.max(limit, 100),
          pages: 2
        });
      } else {
        templateBackfillResult = { skipped: true, reason: 'not_due' };
      }
    } catch (error) {
      templateBackfillError = error instanceof Error ? error.message : String(error);
      console.error('[automation_cycle] backfillTodayMissingInitialTemplates failed:', error);
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
    state.lastShopifySyncError = shopifyIngestError;
    state.lastInitialTemplateBackfillError = templateBackfillError;
    state.lastAutoConfirmError = confirmError;
    saveState(state);

    return {
      ingest: ingestResult,
      shopifyIngest: shopifyIngestResult,
      initialTemplateBackfill: templateBackfillResult,
      autoConfirm: confirmResult,
      ingestError,
      shopifyIngestError,
      templateBackfillError,
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
        chatbyTemplateAttemptedAt: existing?.chatbyTemplateAttemptedAt || null,
        chatbyTemplateName: existing?.chatbyTemplateName || null,
        chatbyTemplateSendStatus: existing?.chatbyTemplateSendStatus || null,
        chatbyTemplateLastError: existing?.chatbyTemplateLastError || null,
        aiConfidence: existing?.aiConfidence ?? null,
        aiIntent: existing?.aiIntent || null,
        confirmationDelayStartedAt: existing?.confirmationDelayStartedAt || null,
        confirmationDueAt: existing?.confirmationDueAt || null,
        confirmationSource: existing?.confirmationSource || null,
        confirmedAt,
        operationalNote: existing?.operationalNote || null
      });
      const blocked = await applyBlockedCustomerPolicy(updated, store, 'dropea_webhook_lookup');
      if (blocked) {
        return {
          orderUpdated: true,
          blockedCustomer: true,
          action: blocked.action,
          source: 'dropea_lookup',
          orderId: (blocked.order || updated).orderId,
          prevStatus,
          newStatus: (blocked.order || updated).status
        };
      }

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
      chatbyTemplateAttemptedAt: existing?.chatbyTemplateAttemptedAt || null,
      chatbyTemplateName: existing?.chatbyTemplateName || null,
      chatbyTemplateSendStatus: existing?.chatbyTemplateSendStatus || null,
      chatbyTemplateLastError: existing?.chatbyTemplateLastError || null,
      aiConfidence: existing?.aiConfidence ?? null,
      aiIntent: existing?.aiIntent || null,
      confirmationDelayStartedAt: existing?.confirmationDelayStartedAt || null,
      confirmationDueAt: existing?.confirmationDueAt || null,
      confirmationSource: existing?.confirmationSource || null,
      confirmedAt: existing?.confirmedAt || null,
      operationalNote: existing?.operationalNote || null
    });
    const blocked = await applyBlockedCustomerPolicy(updated, store, 'dropea_webhook_payload');
    if (blocked) {
      return {
        orderUpdated: true,
        blockedCustomer: true,
        action: blocked.action,
        source: 'webhook_payload',
        orderId: (blocked.order || updated).orderId,
        prevStatus,
        newStatus: (blocked.order || updated).status
      };
    }

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

