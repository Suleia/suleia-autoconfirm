import { getAppConfig } from '../config.mjs';
import { cancelDropeaOrder, getDropeaOrderById, listDropeaOrdersByStatus } from '../clients/dropea.mjs';
import {
  findSubscriberByPhone,
  findSubscriberForOrderRobust as findSubscriberForOrder,
  getChatMessages
} from '../clients/chatby.mjs';
import { findOrder, loadState, saveState, upsertOrder } from '../storage.mjs';
import { blockedCustomerReason, isBlockedCustomerOrder } from '../policies/blocked-customers.mjs';

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
  const explicitActionStatus = /(confirmad|confirm|cancel|rechaz|direccion|direcc|datos envio|cambio datos|cambio direccion)/;
  if (explicitActionStatus.test(leadStatus)) return true;

  const labels = compactStringList((subscriber.labels || []).map((label) => label.name || label.title || label));
  const tags = compactStringList((subscriber.tags || []).map((tag) => tag.name || tag.title || tag));
  const actionPattern = /(confirmad|ped-confirm|cancel|rechaz|direccion|direcc|datos envio|cambio datos|cambio direccion)/;
  if ([...labels, ...tags].some((value) => actionPattern.test(value))) return true;

  const fields = Array.isArray(subscriber.user_fields) ? subscriber.user_fields : [];
  return fields.some((field) => {
    const name = normalizeText(field?.name || field?.label || '');
    const value = normalizeText(field?.value || '');
    if (!value) return false;
    if (/dropea|pedido|order|telefono|phone|nombre|email|importe|total/.test(name)) return false;
    return /(confirm|cancel|rechaz|direccion|direcc|datos_envio|datos envio|cambio direccion|accion cliente)/.test(name);
  });
}

function isCustomerMessage(message) {
  const role = normalizeText(message?.role || message?.sender || message?.direction || message?.type || message?.from || message?.sent_by || message?.sentBy);
  const sender = normalizeText(message?.sender_type || message?.senderType || message?.from_type || message?.fromType || message?.source || message?.author_type || message?.authorType);
  const content = normalizeText(messageContent(message));
  if (message?.is_echo === true || message?.isEcho === true) return false;
  if (message?.from_me === true || message?.fromMe === true || message?.is_outgoing === true || message?.isOutgoing === true) return false;
  if (message?.is_bot === true || message?.isBot === true || message?.bot_id || message?.botId || message?.agent_id || message?.agentId || message?.admin_id || message?.adminId) return false;
  if (message?.is_customer === true || message?.isCustomer === true || message?.from_me === false || message?.fromMe === false || message?.is_outgoing === false || message?.isOutgoing === false) return true;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (['in', 'inbound', 'incoming', 'received'].includes(role)) return true;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(sender)) return true;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(sender)) return false;
  if (/^(agente|bot|suleia|plantilla|template)\b/.test(content)) return false;
  if (/dropea_pedido_nuevo|pedido_nuevo_v/.test(content)) return false;
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
  if (!subscriber?.user_ns) {
    return {
      ok: true,
      reason: 'no_chatby_thread_assumed_no_response',
      subscriber: null,
      hasCustomerAction: false,
      messages: []
    };
  }

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
  if ([
    'confirmed',
    'confirmed_by_customer',
    'confirm_delay_pending',
    'confirm_delay_ready'
  ].includes(status)) return true;

  if (/(not_confirm|no_confirm|should_not_confirm|unconfirm|sin_confirm|no_confirmado|reject|rechaz|cancel|address|direccion|unclear|wait|esperar)/.test(intent)) {
    return false;
  }

  return [
    'confirm',
    'confirmed',
    'should_confirm',
    'customer_confirmed',
    'confirmed_by_customer',
    'confirm_delay_pending',
    'confirm_delay_ready'
  ].includes(intent);
}

async function executeDropeaCancellation(orderId) {
  const before = await getDropeaOrderById(orderId).catch((error) => ({
    lookupError: error instanceof Error ? error.message : String(error)
  }));
  const cancellation = await cancelDropeaOrder(orderId);
  const after = await getDropeaOrderById(orderId).catch((error) => ({
    lookupError: error instanceof Error ? error.message : String(error)
  }));

  return {
    beforeStatus: before?.status || before?.lookupError || null,
    cancellation,
    afterStatus: after?.status || after?.lookupError || null,
    verifiedAt: new Date().toISOString()
  };
}

function cancellationStatusesFromEnv() {
  return String(process.env.UNANSWERED_CANCELLATION_STATUSES || 'PENDING')
    .split(',')
    .map((status) => status.trim().toUpperCase())
    .filter((status) => status !== 'WITH_ISSUE' && status !== 'CON_INCIDENCIA')
    .filter(Boolean);
}

function isCancellationCandidateStatus(status) {
  const normalized = normalizeText(status)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return [
    'pending',
    'pendiente',
    'pend',
    'pend_de_confirmacion',
    'pendiente_confirmacion',
    'pendiente_de_confirmacion',
    'with_issue',
    'con_incidencia',
    'incidencia'
  ].includes(normalized) || (normalized.includes('pend') && normalized.includes('confirm'));
}

async function collectCancellationCandidates({ limit, pages, orderIds = [] }) {
  const pendingById = new Map();
  const statuses = cancellationStatusesFromEnv();

  for (const status of statuses) {
    for (let page = 1; page <= pages; page += 1) {
      let pageOrders = [];
      try {
        pageOrders = await listDropeaOrdersByStatus({ status, limit, page });
      } catch (error) {
        if (status === 'PENDING') throw error;
        break;
      }
      for (const order of pageOrders) {
        if (isCancellationCandidateStatus(order.status)) {
          pendingById.set(String(order.orderId), order);
        }
      }
      if (pageOrders.length < limit) break;
    }
  }

  for (const orderId of orderIds) {
    const cleanOrderId = String(orderId || '').trim();
    if (!cleanOrderId || pendingById.has(cleanOrderId)) continue;
    const order = await getDropeaOrderById(cleanOrderId);
    if (order && isCancellationCandidateStatus(order.status)) {
      pendingById.set(String(order.orderId), order);
    }
  }

  return [...pendingById.values()];
}

export async function runUnansweredCancellationSweep({ store = config.defaultStore, limit = 100, pages = 5, orderIds = [] } = {}) {
  const enabled = Boolean(store.unansweredRejectRealEnabled ?? config.defaultStore.unansweredRejectRealEnabled);
  const dryRun = Boolean(store.agentDryRun ?? config.defaultStore.agentDryRun) && !enabled;
  const limitHours = Number(store.unansweredCancelAfterHours ?? config.defaultStore.unansweredCancelAfterHours ?? 36);
  const results = [];

  try {
    if (!Number.isFinite(limitHours) || limitHours <= 0) {
      return { skipped: true, reason: 'invalid_unanswered_limit_hours' };
    }

    const candidateOrders = await collectCancellationCandidates({ limit, pages, orderIds });

    for (const order of candidateOrders) {
      const existing = findOrder(store.id, order.orderId) || {};
      const storedConfirmation = hasStoredConfirmation(existing);

      if (isBlockedCustomerOrder(order, store)) {
        if (String(existing.status || '').toUpperCase() === 'REJECTED_BLOCKED_CUSTOMER' && existing.cancelledAt) {
          results.push({
            orderId: order.orderId,
            skipped: true,
            reason: 'blocked_customer_already_cancelled',
            status: existing.status
          });
          continue;
        }

        const now = new Date().toISOString();
        const reason = blockedCustomerReason(order, store);
        try {
          const cancellation = await executeDropeaCancellation(order.orderId);
          const updated = upsertOrder(store.id, {
            ...existing,
            ...order,
            status: 'REJECTED_BLOCKED_CUSTOMER',
            aiConfidence: 100,
            aiIntent: 'BLOCKED_CUSTOMER',
            chatbyTemplateSendStatus: 'blocked_customer_no_send',
            chatbyTemplateLastError: null,
            cancelledAt: now,
            operationalNote: reason,
            raw: {
              ...(order.raw || existing.raw || {}),
              automaticBlockedCustomerCancellation: {
                cancellation,
                source: 'automatic_blocked_customer_sweep',
                cancelledAt: now
              }
            }
          });
          const state = { ...loadState() };
          const history = Array.isArray(state.automaticBlockedCustomerCancellations)
            ? state.automaticBlockedCustomerCancellations
            : [];
          state.automaticBlockedCustomerCancellations = [
            ...history,
            {
              orderId: String(order.orderId),
              phone: order.customerPhone || null,
              cancelledAt: now,
              source: 'automatic_blocked_customer_sweep'
            }
          ].slice(-200);
          saveState(state);
          results.push({
            orderId: order.orderId,
            dryRun: false,
            action: 'cancelled_blocked_customer',
            reason: 'blocked_customer_phone',
            cancellation,
            order: updated
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const updated = upsertOrder(store.id, {
            ...existing,
            ...order,
            status: 'BLOCKED_CUSTOMER_CANCELLATION_FAILED',
            aiConfidence: 100,
            aiIntent: 'BLOCKED_CUSTOMER',
            chatbyTemplateSendStatus: 'blocked_customer_no_send',
            chatbyTemplateLastError: null,
            cancellationError: message,
            operationalNote: reason,
            raw: {
              ...(order.raw || existing.raw || {}),
              automaticBlockedCustomerCancellationError: {
                message,
                source: 'automatic_blocked_customer_sweep',
                failedAt: now
              }
            }
          });
          results.push({
            orderId: order.orderId,
            skipped: true,
            reason: 'blocked_customer_dropea_cancellation_failed',
            error: message,
            order: updated
          });
        }
        continue;
      }

      const createdAt = order.raw?.created_at || order.raw?.createdAt || order.createdAt;
      const elapsedHours = hoursSince(createdAt);
      if (elapsedHours === null) {
        results.push({ orderId: order.orderId, skipped: true, reason: 'missing_dropea_created_at', status: order.status });
        continue;
      }
      if (elapsedHours < limitHours) {
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: 'before_36h_window',
          status: order.status,
          elapsedHours: Number(elapsedHours.toFixed(2))
        });
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
          status: order.status,
          elapsedHours: Number(elapsedHours.toFixed(2)),
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      if (!chatbyCheck.ok) {
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: `${chatbyCheck.reason}_fail_closed`,
          status: order.status,
          elapsedHours: Number(elapsedHours.toFixed(2))
        });
        continue;
      }

      const signal = classifyCustomerSignal(chatbyCheck.messages);
      if (chatbyCheck.hasCustomerAction || signal !== 'NO_RESPONSE') {
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: chatbyCheck.hasCustomerAction ? 'chatby_customer_action_detected' : `customer_signal_${signal.toLowerCase()}`,
          chatbyReason: chatbyCheck.reason,
          customerMessages: chatbyCheck.messages.length,
          status: order.status,
          elapsedHours: Number(elapsedHours.toFixed(2)),
          localStatus: existing.status || null,
          localIntent: existing.aiIntent || null,
          storedConfirmation
        });
        continue;
      }

      const patch = {
        ...existing,
        ...order,
        aiConfidence: 100,
        aiIntent: 'REJECT_UNANSWERED_TIMEOUT',
        timeoutCancellationEvaluatedAt: new Date().toISOString(),
        previousLocalStatus: existing.status || null,
        previousLocalIntent: existing.aiIntent || null,
        operationalNote: `Sin ninguna respuesta ni accion del cliente en Chatby tras ${Math.floor(elapsedHours)}h desde la fecha real del pedido en Dropea.`
      };

      if (dryRun) {
        const updated = upsertOrder(store.id, { ...patch, status: 'WOULD_REJECT_UNANSWERED' });
        results.push({
          orderId: order.orderId,
          dryRun: true,
          action: 'would_cancel_unanswered',
          chatbyReason: chatbyCheck.reason,
          customerMessages: chatbyCheck.messages.length,
          elapsedHours: Number(elapsedHours.toFixed(2)),
          order: updated
        });
        continue;
      }

      try {
        const cancellation = await executeDropeaCancellation(order.orderId);
        const cancelledAt = new Date().toISOString();
        const updated = upsertOrder(store.id, {
          ...patch,
          status: 'REJECTED_UNANSWERED',
          cancelledAt,
          raw: {
            ...(patch.raw || {}),
            automaticUnansweredCancellation: cancellation
          }
        });
        const state = { ...loadState() };
        const history = Array.isArray(state.automaticUnansweredCancellations)
          ? state.automaticUnansweredCancellations
          : [];
        state.automaticUnansweredCancellations = [
          ...history,
          {
            orderId: String(order.orderId),
            cancelledAt,
            elapsedHours: Number(elapsedHours.toFixed(2)),
            source: 'automatic_36h_unanswered_sweep',
            chatbyReason: chatbyCheck.reason,
            customerMessages: chatbyCheck.messages.length
          }
        ].slice(-200);
        saveState(state);
        results.push({
          orderId: order.orderId,
          dryRun: false,
          action: 'cancelled_unanswered',
          chatbyReason: chatbyCheck.reason,
          customerMessages: chatbyCheck.messages.length,
          elapsedHours: Number(elapsedHours.toFixed(2)),
          cancellation,
          order: updated
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const updated = upsertOrder(store.id, {
          ...patch,
          status: 'REJECT_UNANSWERED_FAILED',
          cancellationError: message,
          raw: {
            ...(patch.raw || {}),
            automaticUnansweredCancellationError: {
              message,
              failedAt: new Date().toISOString()
            }
          }
        });
        results.push({
          orderId: order.orderId,
          skipped: true,
          reason: 'dropea_cancellation_failed',
          error: message,
          chatbyReason: chatbyCheck.reason,
          customerMessages: chatbyCheck.messages.length,
          elapsedHours: Number(elapsedHours.toFixed(2)),
          order: updated
        });
      }
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
        elapsedHours: item.elapsedHours ?? null,
        chatbyReason: item.chatbyReason ?? null
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
