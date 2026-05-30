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
import { createSubscriber, getChatMessages, sendWhatsappTemplate } from '../clients/chatby.mjs';
import { classifyConversation } from '../clients/openai.mjs';
import { getShopifyOrderFinancialStatus } from '../clients/shopify.mjs';
import { upsertSheetRow } from '../clients/sheets.mjs';

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
    role: message.role || message.sender || message.direction || 'message',
    content: message.content || message.message || message.text || ''
  }));
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

  const updated = upsertOrder(store.id, { ...order, chatbyUserNs: userNs });

  if (store.whatsappTemplateName || config.whatsappTemplateName) {
    await sendWhatsappTemplate({
      user_ns: userNs,
      template_name: store.whatsappTemplateName || config.whatsappTemplateName,
      variables: {
        order_id: order.orderId,
        customer_name: order.customerName || '',
        amount: order.orderAmount ?? '',
        currency: order.currencyCode || ''
      }
    });
  }

  await upsertSheetRow(updated);
  return updated;
}

export async function analyzeAndMaybeConfirmOrder(order, store = config.defaultStore) {
  if (order.status !== 'PENDING') {
    return { skipped: true, reason: 'order_not_pending' };
  }

  if (!order.chatbyUserNs) {
    return { skipped: true, reason: 'no_chat_thread' };
  }

  const messages = normalizeChatMessages(await getChatMessages(order.chatbyUserNs));
  if (!messages.length) {
    return { skipped: true, reason: 'no_messages' };
  }

  const lastMessageAt = parseDate(messages[messages.length - 1]?.created_at || messages[messages.length - 1]?.createdAt);
  if (lastMessageAt) {
    const diffHours = (Date.now() - lastMessageAt.getTime()) / 36e5;
    if (diffHours < (store.cooldownHours || config.defaultStore.cooldownHours || 1)) {
      return { skipped: true, reason: 'cooldown' };
    }
  }

  const analysis = await classifyConversation([
    { role: 'tienda', content: `Pedido ${order.orderId}. Confirma si el cliente acepta.` },
    ...messages
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
    const cancellation = await cancelDropeaOrder(order.orderId);
    patch.status = 'CANCELLED';
    patch.cancelledAt = new Date().toISOString();
    const updated = upsertOrder(store.id, patch);
    await upsertSheetRow(updated);
    return { action: 'cancelled', analysis, cancellation };
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
