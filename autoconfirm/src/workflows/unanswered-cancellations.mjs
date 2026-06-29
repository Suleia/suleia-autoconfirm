import { getAppConfig } from '../config.mjs';
import { cancelDropeaOrder, listPendingDropeaOrders } from '../clients/dropea.mjs';
import {
  findSubscriberByPhone,
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

function compactStringList(values) {
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function subscriberHasCustomerAction(subscriber) {
  if (!subscriber) return false;

  const leadStatus = normalizeText(subscriber.lead_status || subscriber.status || '');
  const passiveStatuses = new Set(['pendiente', 'pending', 'abierto', 'open', 'nuevo', 'new', 'sin respuesta']);
  if (leadStatus && !passiveStatuses.has(leadStatus)) return true;

  const labels = compactStringList((subscriber.labels || []).map((label) => label.name || label.title || label));
  const tags = compactStringList((subscriber.tags || []).map((tag) => tag.name || tag.title || tag));
  const actionPattern = /(confirm|cancel|rechaz|direccion|direcc|datos|envio|entrega|respuesta|respond)/;
  if ([...labels, ...tags].some((value) => actionPattern.test(value))) return true;

  const fields = Array.isArray(subscriber.user_fields) ? subscriber.user_fields : [];
  return fields.some((field) => {
    const name = normalizeText(field?.name || field?.label || '');
    const value = normalizeText(field?.value || '');
    if (!value) return false;
    if (/dropea|pedido|order|telefono|phone|nombre|email|importe|total/.test(name)) return false;
    return /(confirm|cancel|rechaz|direccion|direcc|datos|envio|entrega|respuesta|respond|boton|button|accion|action)/.test(name);
  });
}

function isCustomerMessage(message) {
  const role = normalizeText(message?.role || message?.sender || message?.direction || message?.type);
  const sender = normalizeText(message?.sender_type || message?.senderType || message?.from_type || message?.fromType || message?.source);
  if (message?.is_echo === true || message?.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (['in', 'inbound', 'incoming', 'received'].includes(role)) return true;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(sender)) return true;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(sender)) return false;
  return false;
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
  }) || await findSubscriberByPhone({ phone: order.customerPhone });
  if (!subscriber?.user_ns) return { ok: false, reason: 'no_chatby_thread', messages: [] };

  const since = parseDate(createdAt);
  const messages = await getChatMessages(subscriber.user_ns);
  return {
    ok: true,
    reason: 'chatby_thread_checked',
    subscriber,
    hasCustomerAction: subscriberHasCustomerAction(subscriber),
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
      if (chatbyCheck.hasCustomerAction || signal !== 'NO_RESPONSE') {
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: chatbyCheck.hasCustomerAction ? 'chatby_customer_action_detected' : `customer_signal_${signal.toLowerCase()}`,
          customerMessages: chatbyCheck.messages.length
        });
        continue;
      }

      const patch = {
        ...existing,
        ...order,
        aiConfidence: 100,
        aiIntent: 'REJECT_UNANSWERED_TIMEOUT',
        timeoutCancellationEvaluatedAt: new Date().toISOString(),
        operationalNote: `Sin ninguna respuesta ni accion del cliente en Chatby tras ${Math.floor(elapsedHours)}h desde la fecha real del pedido en Dropea.`
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
    state.lastUnansweredCancellationSweepSummary = {
      checked: results.length,
      cancelled: results.filter((item) => item.action === 'cancelled_unanswered').length,
      skipped: results.filter((item) => item.skipped).length,
      dryRun: results.filter((item) => item.dryRun).length,
      sample: results.slice(-50).map((item) => ({
        orderId: item.orderId,
        action: item.action || null,
        skipped: Boolean(item.skipped),
        reason: item.reason || null,
        dryRun: Boolean(item.dryRun),
        customerMessages: item.customerMessages ?? null,
        elapsedHours: item.elapsedHours ?? null
      }))
    };
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
