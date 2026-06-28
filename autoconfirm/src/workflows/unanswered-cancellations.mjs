import { getAppConfig } from '../config.mjs';
import { cancelDropeaOrder, listPendingDropeaOrders } from '../clients/dropea.mjs';
import {
  findSubscriberForOrderRobust as findSubscriberForOrder,
  getChatMessages
} from '../clients/chatby.mjs';
import { findOrder, loadState, saveState, upsertOrder } from '../storage.mjs';

const config = getAppConfig();

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursSince(value) {
  const date = parseDate(value);
  if (!date) return null;
  return (Date.now() - date.getTime()) / 36e5;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function messageContent(message) {
  return [
    message?.content,
    message?.message,
    message?.text,
    message?.button_text,
    message?.buttonText,
    message?.payload?.title,
    message?.payload?.body,
    message?.title
  ].filter(Boolean).join(' ');
}

function messageDate(message) {
  return parseDate(message?.created_at || message?.createdAt || message?.timestamp || message?.time);
}

function isCustomerMessage(message) {
  const role = normalizeText(message?.role || message?.sender || message?.direction || message?.type);
  const sender = normalizeText(message?.sender_type || message?.senderType || message?.from_type || message?.fromType || message?.source);
  if (message?.is_echo === true || message?.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (['in', 'inbound', 'incoming', 'received'].includes(role)) return true;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(sender)) return true;
  return Boolean(messageContent(message).trim()) && !['outbound', 'sent'].includes(role);
}

function classifyCustomerSignal(messages) {
  const text = normalizeText(messages.map(messageContent).join('\n'));
  if (!text) return 'NO_RESPONSE';

  const addressChange = [
    /\bcambio de direccion\b/,
    /\bcambiar direccion\b/,
    /\bcambiar datos\b/,
    /\bmodificar direccion\b/,
    /\bcorregir direccion\b/,
    /\bdireccion (mal|incorrecta|equivocada)\b/
  ].some((pattern) => pattern.test(text));
  if (addressChange) return 'ADDRESS_CHANGE';

  const cancel = [
    /\bno lo quiero\b/,
    /\bno quiero\b/,
    /\bcancel(ar|o|ado)?\b/,
    /\banular\b/,
    /\bno enviar\b/,
    /\bya no me interesa\b/,
    /\bno me interesa\b/,
    /\brechaz(o|ar|ado)\b/
  ].some((pattern) => pattern.test(text));
  if (cancel) return 'CANCEL';

  const confirm = [
    /\bconfirmo\b/,
    /\bconfirmado\b/,
    /\bconfirmar mi pedido\b/,
    /\bsi lo quiero\b/,
    /\blo quiero\b/,
    /\bpode enviar\b/,
    /\badelante\b/,
    /\bperfecto\b/,
    /\bok\b/,
    /\bvale\b/
  ].some((pattern) => pattern.test(text));
  if (confirm) return 'CONFIRM';

  return 'UNCLEAR';
}

async function customerMessagesForOrder(order, createdAt) {
  if (!config.chatbyToken) return { ok: false, reason: 'missing_chatby_token', messages: [] };
  if (!order.customerPhone) return { ok: false, reason: 'missing_customer_phone', messages: [] };
  const subscriber = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });
  if (!subscriber?.user_ns) return { ok: true, reason: 'no_chatby_thread', messages: [] };

  const since = parseDate(createdAt);
  const messages = await getChatMessages(subscriber.user_ns);
  return {
    ok: true,
    reason: 'chatby_thread_checked',
    messages: (Array.isArray(messages) ? messages : [])
    .filter(isCustomerMessage)
    .filter((message) => {
      if (!since) return true;
      const date = messageDate(message);
      return !date || date >= since;
    })
  };
}

function hasStoredConfirmation(order) {
  const status = normalizeText(order?.status);
  const intent = normalizeText(order?.aiIntent);
  return [
    'confirmed',
    'confirmed_by_customer',
    'confirm_delay_pending',
    'confirm_delay_ready'
  ].includes(status) || intent.includes('confirm');
}

export async function runUnansweredCancellationSweep({ store = config.defaultStore, limit = 100, pages = 5 } = {}) {
  const enabled = Boolean(store.unansweredRejectRealEnabled ?? config.defaultStore.unansweredRejectRealEnabled);
  const dryRun = Boolean(store.agentDryRun ?? config.defaultStore.agentDryRun) && !enabled;
  const limitHours = Number(store.unansweredCancelAfterHours ?? config.defaultStore.unansweredCancelAfterHours ?? 36);
  const results = [];

  try {
    if (!Number.isFinite(limitHours) || limitHours <= 0) {
      return { skipped: true, reason: 'invalid_unanswered_limit_hours' };
    }

    const pendingById = new Map();
    for (let page = 1; page <= pages; page += 1) {
      const pageOrders = await listPendingDropeaOrders({ limit, page });
      for (const order of pageOrders) pendingById.set(String(order.orderId), order);
      if (pageOrders.length < limit) break;
    }

    for (const order of pendingById.values()) {
      const existing = findOrder(store.id, order.orderId) || {};
      if (hasStoredConfirmation(existing)) {
        results.push({ orderId: order.orderId, skipped: true, reason: 'stored_confirmation_detected' });
        continue;
      }

      const createdAt = order.raw?.created_at || order.raw?.createdAt || order.createdAt;
      const elapsedHours = hoursSince(createdAt);
      if (elapsedHours === null) {
        results.push({ orderId: order.orderId, skipped: true, reason: 'missing_dropea_created_at' });
        continue;
      }
      if (elapsedHours < limitHours) {
        results.push({ orderId: order.orderId, skipped: true, reason: 'before_36h_window', elapsedHours: Number(elapsedHours.toFixed(2)) });
        continue;
      }

      let chatbyCheck;
      try {
        chatbyCheck = await customerMessagesForOrder(order, createdAt);
      } catch (error) {
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: 'chatby_check_failed_fail_closed',
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      if (!chatbyCheck.ok) {
        results.push({ orderId: order.orderId, skipped: true, reason: `${chatbyCheck.reason}_fail_closed` });
        continue;
      }

      const signal = classifyCustomerSignal(chatbyCheck.messages);
      if (signal === 'CONFIRM' || signal === 'ADDRESS_CHANGE') {
        results.push({ orderId: order.orderId, skipped: true, reason: `customer_signal_${signal.toLowerCase()}` });
        continue;
      }

      const patch = {
        ...existing,
        ...order,
        aiConfidence: 100,
        aiIntent: signal === 'CANCEL' ? 'CANCEL_BY_CUSTOMER' : 'REJECT_UNANSWERED_TIMEOUT',
        timeoutCancellationEvaluatedAt: new Date().toISOString(),
        operationalNote: signal === 'CANCEL'
          ? 'Cliente muestra intencion de cancelar. El agente logistico cancela/rechaza el pedido en Dropea.'
          : `Sin confirmacion ni cambio de direccion tras ${Math.floor(elapsedHours)}h desde la fecha real del pedido en Dropea.`
      };

      if (dryRun) {
        const updated = upsertOrder(store.id, { ...patch, status: 'WOULD_REJECT_UNANSWERED' });
        results.push({ orderId: order.orderId, dryRun: true, action: 'would_cancel_unanswered', order: updated });
        continue;
      }

      const cancellation = await cancelDropeaOrder(order.orderId);
      const updated = upsertOrder(store.id, {
        ...patch,
        status: 'REJECTED_UNANSWERED',
        cancelledAt: new Date().toISOString()
      });
      results.push({ orderId: order.orderId, dryRun: false, action: 'cancelled_unanswered', cancellation, order: updated });
    }

    const state = { ...loadState() };
    state.lastUnansweredCancellationSweepAt = new Date().toISOString();
    state.lastUnansweredCancellationSweepError = null;
    saveState(state);

    return { processed: results.length, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = { ...loadState() };
    state.lastUnansweredCancellationSweepAt = new Date().toISOString();
    state.lastUnansweredCancellationSweepError = message;
    saveState(state);
    throw error;
  }
}
