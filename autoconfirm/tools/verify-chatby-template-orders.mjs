import { sendWhatsappTemplate, getChatMessages } from '../src/clients/chatby.mjs';
import { getAppConfig } from '../src/config.mjs';
import { findOrder, upsertOrder } from '../src/storage.mjs';

const config = getAppConfig();
const forceSendAllowed = ['1', 'true', 'yes'].includes(String(process.env.ALLOW_CHATBY_FORCE_SEND || '').toLowerCase());

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const ids = args
    .filter((value) => value !== '--force')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (!ids.length) throw new Error('order_ids_required');
  return { force, ids: [...new Set(ids)] };
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

function summarizeMessage(message) {
  const raw = message?.raw || message || {};
  return {
    role: message?.role || raw.role || raw.sender || raw.direction || raw.type || null,
    content: message?.content || raw.content || raw.message || raw.text || raw.button_text || raw.buttonText || null,
    createdAt: raw.created_at || raw.createdAt || raw.timestamp || null,
    type: raw.msg_type || raw.message_type || raw.type || null,
    template: raw.template_name || raw.templateName || raw.content?.name || raw.name || null,
    status: raw.status || raw.delivery_status || raw.deliveryStatus || null
  };
}

async function inspectOrder(orderId, { force }) {
  const order = findOrder(config.defaultStore.id, orderId);
  if (!order) return { orderId, ok: false, error: 'local_order_not_found' };
  if (!order.chatbyUserNs) return { orderId, ok: false, error: 'missing_chatby_user_ns' };

  let resend = null;
  if (force) {
    if (!forceSendAllowed) {
      return {
        orderId,
        ok: false,
        blocked: true,
        error: 'force_resend_blocked_set_ALLOW_CHATBY_FORCE_SEND_true_to_override'
      };
    }
    resend = await sendWhatsappTemplate({
      user_ns: order.chatbyUserNs,
      template_name: config.whatsappTemplateName || config.defaultStore.whatsappTemplateName,
      params: templateParamsForOrder(order)
    });
    upsertOrder(config.defaultStore.id, {
      ...order,
      chatbyTemplateSentAt: new Date().toISOString()
    });
  }

  const messages = await getChatMessages(order.chatbyUserNs);
  const safeMessages = Array.isArray(messages) ? messages.slice(-8).map(summarizeMessage) : [];

  return {
    orderId,
    ok: true,
    customer: order.customerName,
    phone: order.customerPhone ? `***${String(order.customerPhone).slice(-4)}` : null,
    chatbyUserNs: order.chatbyUserNs,
    chatbyTemplateSentAt: order.chatbyTemplateSentAt,
    resendResponse: resend,
    lastMessages: safeMessages
  };
}

const { force, ids } = parseArgs();
const results = [];

for (const orderId of ids) {
  try {
    results.push(await inspectOrder(orderId, { force }));
  } catch (error) {
    results.push({ orderId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ ok: results.every((item) => item.ok), force, results }, null, 2));
