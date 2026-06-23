import { getDropeaOrderById } from '../src/clients/dropea.mjs';
import { getAppConfig } from '../src/config.mjs';
import { findOrder, upsertOrder } from '../src/storage.mjs';
import {
  createSubscriber,
  findSubscriberForOrder,
  sendWhatsappTemplate
} from '../src/clients/chatby.mjs';
import { sendMetaWhatsappTemplate } from '../src/clients/meta-whatsapp.mjs';

const config = getAppConfig();

const forceSend = process.argv.includes('--force');

function parseOrderIds() {
  const ids = process.argv
    .slice(2)
    .filter((value) => !String(value).startsWith('--'))
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (!ids.length) {
    throw new Error('order_ids_required');
  }

  return [...new Set(ids)];
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Hola';
}

function templateParamsForOrder(order) {
  const address = order.raw?.shipping_address || order.raw?.shippingAddress || order.raw?.address || {};
  return {
    'BODY_{{1}}': `${firstName(order.customerName)}!`,
    'BODY_{{2}}': order.raw?.product_name || order.raw?.productName || `Pedido ${order.orderId}`,
    'BODY_{{3}}': `${order.orderAmount ?? ''} EUR`,
    'BODY_{{4}}': [address.address1, address.address2].filter(Boolean).join(' ') || '',
    'BODY_{{5}}': address.city || '',
    'BODY_{{6}}': address.province || address.zip || ''
  };
}

async function sendOrderTemplate({ userNs, order, templateName, params }) {
  try {
    return {
      provider: 'chatby',
      response: await sendWhatsappTemplate({
        user_ns: userNs,
        user_id: order.customerPhone,
        template_name: templateName,
        params
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canFallbackToMeta = /pro feature only/i.test(message) || config.whatsappProvider === 'meta';
    if (!canFallbackToMeta) throw error;

    return {
      provider: 'meta',
      fallbackReason: message,
      response: await sendMetaWhatsappTemplate({
        to: order.customerPhone,
        templateName,
        params
      })
    };
  }
}

function createdUserNs(created) {
  return created?.data?.user_ns || created?.user_ns || created?.userNs || created?.id || null;
}

async function resolveChatbyUserNs(order, existing) {
  if (existing?.chatbyUserNs) return existing.chatbyUserNs;

  const subscriber = await findSubscriberForOrder({
    phone: order.customerPhone,
    orderId: order.orderId
  });
  if (subscriber?.user_ns) return subscriber.user_ns;

  const created = await createSubscriber({
    phone: order.customerPhone,
    name: order.customerName || order.customerPhone,
    email: order.customerEmail || undefined,
    metadata: {
      orderId: order.orderId,
      source: 'dropea'
    }
  });

  const userNs = createdUserNs(created);
  if (!userNs) {
    throw new Error(`Chatby no devolvio user_ns al crear el contacto: ${JSON.stringify(created)}`);
  }
  return userNs;
}

async function sendTemplateForOrderId(orderId) {
  const existing = findOrder(config.defaultStore.id, orderId);
  let liveOrder = null;
  let liveOrderWarning = null;
  try {
    liveOrder = await getDropeaOrderById(orderId);
  } catch (error) {
    liveOrderWarning = `dropea_lookup_failed_using_local_order: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!liveOrder && !existing) {
    return { orderId, ok: false, error: 'dropea_order_not_found' };
  }

  const prepared = upsertOrder(config.defaultStore.id, {
    ...(existing || {}),
    ...(liveOrder || {}),
    status: String(liveOrder?.status || existing?.status || 'PENDING').toUpperCase(),
    chatbyUserNs: existing?.chatbyUserNs || null,
    // Keep historical sent timestamp if present; otherwise ensureChatbyThread will send the template.
    chatbyTemplateSentAt: existing?.chatbyTemplateSentAt || null,
    chatbyTemplateAttemptedAt: existing?.chatbyTemplateAttemptedAt || null,
    chatbyTemplateName: existing?.chatbyTemplateName || null,
    chatbyTemplateSendStatus: existing?.chatbyTemplateSendStatus || null,
    chatbyTemplateLastError: existing?.chatbyTemplateLastError || null,
    aiConfidence: existing?.aiConfidence ?? null,
    aiIntent: existing?.aiIntent || null,
    confirmedAt: existing?.confirmedAt || null,
    operationalNote: existing?.operationalNote || null
  });

  if ((prepared.chatbyTemplateSentAt || prepared.chatbyTemplateAttemptedAt) && !forceSend) {
    return {
      orderId,
      ok: true,
      skipped: true,
      reason: 'already_attempted_use_force_to_resend',
      status: prepared.status,
      customer: prepared.customerName,
      phone: prepared.customerPhone ? `***${String(prepared.customerPhone).slice(-4)}` : null,
      chatbyUserNs: prepared.chatbyUserNs || null,
      chatbyTemplateSentAt: prepared.chatbyTemplateSentAt || null,
      chatbyTemplateAttemptedAt: prepared.chatbyTemplateAttemptedAt || null,
      chatbyTemplateSendStatus: prepared.chatbyTemplateSendStatus || null,
      template: config.whatsappTemplateName || config.defaultStore.whatsappTemplateName || null
    };
  }

  const userNs = await resolveChatbyUserNs(prepared, existing);
  const templateName = config.whatsappTemplateName || config.defaultStore.whatsappTemplateName || null;
  if (!templateName) throw new Error('Falta WHATSAPP_TEMPLATE_NAME.');

  const sentAt = new Date().toISOString();
  upsertOrder(config.defaultStore.id, {
    ...prepared,
    chatbyUserNs: userNs,
    chatbyTemplateAttemptedAt: sentAt,
    chatbyTemplateName: templateName,
    chatbyTemplateSendStatus: 'attempted',
    chatbyTemplateLastError: null
  });

  let sendResult = null;
  try {
    sendResult = await sendOrderTemplate({
      userNs,
      order: prepared,
      templateName,
      params: templateParamsForOrder(prepared)
    });
  } catch (error) {
    const updated = upsertOrder(config.defaultStore.id, {
      ...prepared,
      chatbyUserNs: userNs,
      chatbyTemplateAttemptedAt: sentAt,
      chatbyTemplateName: templateName,
      chatbyTemplateSendStatus: 'failed',
      chatbyTemplateLastError: error instanceof Error ? error.message : String(error)
    });
    return {
      orderId,
      ok: false,
      forced: forceSend,
      warning: liveOrderWarning,
      status: updated.status,
      customer: updated.customerName,
      phone: updated.customerPhone ? `***${String(updated.customerPhone).slice(-4)}` : null,
      chatbyUserNs: updated.chatbyUserNs || null,
      chatbyTemplateAttemptedAt: updated.chatbyTemplateAttemptedAt || null,
      chatbyTemplateSendStatus: updated.chatbyTemplateSendStatus || null,
      template: templateName,
      error: updated.chatbyTemplateLastError
    };
  }

  const updated = upsertOrder(config.defaultStore.id, {
    ...prepared,
    chatbyUserNs: userNs,
    chatbyTemplateSentAt: sentAt,
    chatbyTemplateAttemptedAt: sentAt,
    chatbyTemplateName: templateName,
    chatbyTemplateSendStatus: 'sent',
    chatbyTemplateLastError: null,
    chatbyLastSendResponse: sendResult
  });

  return {
    orderId,
    ok: Boolean(updated.chatbyUserNs && updated.chatbyTemplateSentAt),
    forced: forceSend,
    warning: liveOrderWarning,
    status: updated.status,
    customer: updated.customerName,
    phone: updated.customerPhone ? `***${String(updated.customerPhone).slice(-4)}` : null,
    chatbyUserNs: updated.chatbyUserNs || null,
    chatbyTemplateSentAt: updated.chatbyTemplateSentAt || null,
    template: templateName,
    sendResult
  };
}

const orderIds = parseOrderIds();
const results = [];

for (const orderId of orderIds) {
  try {
    results.push(await sendTemplateForOrderId(orderId));
  } catch (error) {
    results.push({
      orderId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

console.log(JSON.stringify({
  ok: results.every((item) => item.ok),
  total: results.length,
  sent: results.filter((item) => item.ok).length,
  results
}, null, 2));
