import crypto from 'node:crypto';
import { getAppConfig } from '../config.mjs';
import { listDropeaOrders } from '../clients/dropea.mjs';
import {
  findSubscriberByPhone,
  findSubscriberForOrderRobust,
  getChatMessages,
  listWhatsappTemplates,
  sendWhatsappTemplate
} from '../clients/chatby.mjs';
import { listRecentShopifyOrders } from '../clients/shopify.mjs';
import { claimTemplateDelivery, finishTemplateDelivery } from '../db/supabase-store.mjs';
import {
  INCIDENT_DISCOUNT_TEMPLATE_NAME,
  incidentDiscountTemplateData
} from './incident-discount-template.mjs';
import {
  classifyIncidentDiscountResponse,
  extractWamid,
  findVerifiedTemplateDelivery
} from './incident-discount-policy.mjs';
import { selectIncidentDiscountOrderPair } from './incident-discount-order-match.mjs';

const config = getAppConfig();
const activeTestSends = new Set();

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizedTemplate(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^es_es[\s_-]*/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function maskOrderId(value) {
  const source = String(value || '');
  return source ? `***${source.slice(-3)}` : '***';
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function templateRows(value) {
  const found = [];
  const visited = new Set();
  function visit(item, depth = 0) {
    if (!item || typeof item !== 'object' || depth > 8 || visited.has(item)) return;
    visited.add(item);
    if (!Array.isArray(item) && typeof item.name === 'string') found.push(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) visit(child, depth + 1);
  }
  visit(value);
  return found;
}

function parseDefaultValues(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function findTemplate() {
  const target = normalizedTemplate(INCIDENT_DISCOUNT_TEMPLATE_NAME);
  let compatible = null;
  for (let page = 1; page <= 30 && !compatible; page += 1) {
    const templates = templateRows(await listWhatsappTemplates({ page, limit: 200 }));
    const exact = templates.find((item) => normalizedTemplate(item?.name) === target);
    compatible = exact || templates.find((item) => normalizedTemplate(item?.name).includes('dropea_incidencia_descuento_5')) || null;
    if (!templates.length) break;
  }
  if (!compatible) return null;
  const defaults = parseDefaultValues(compatible.default_values);
  return {
    name: compatible.name,
    language: defaults.lang || compatible.language || 'es_ES',
    namespace: compatible.namespace || null,
    status: String(compatible.status || '').toUpperCase(),
    defaultParams: defaults.params && typeof defaults.params === 'object' ? defaults.params : {},
    bodyFields: (Array.isArray(compatible.params) ? compatible.params : [])
      .filter((item) => /^BODY_/i.test(String(item?.label || '')))
      .map((item) => item.label)
  };
}

async function findDropeaOrders(phone) {
  const target = digits(phone).slice(-9);
  const matches = [];
  for (let page = 1; page <= 10; page += 1) {
    const orders = await listDropeaOrders({ limit: 100, page });
    matches.push(...orders.filter((order) => digits(order.customerPhone).endsWith(target)));
    if (orders.length < 100) break;
  }
  return matches;
}

async function findShopifyOrders(phone) {
  const target = digits(phone).slice(-9);
  const orders = await listRecentShopifyOrders({ first: 100 });
  return orders.filter((order) => digits(order.customerPhone).endsWith(target));
}

async function buildContext(phone) {
  const normalizedPhone = digits(phone);
  if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
    const error = new Error('Telefono de prueba no valido.');
    error.code = 'INVALID_TEST_PHONE';
    throw error;
  }

  const [dropeaOrders, shopifyOrders, template] = await Promise.all([
    findDropeaOrders(normalizedPhone),
    findShopifyOrders(normalizedPhone),
    findTemplate()
  ]);
  if (!dropeaOrders.length) {
    const error = new Error('No se encontro un pedido reciente de Dropea para el telefono autorizado.');
    error.code = 'DROPEA_ORDER_NOT_FOUND';
    throw error;
  }
  if (!shopifyOrders.length) {
    const error = new Error('No se encontro el pedido reciente equivalente en Shopify.');
    error.code = 'SHOPIFY_ORDER_NOT_FOUND';
    throw error;
  }
  if (!template) {
    const error = new Error('No se encontro la plantilla de descuento en Chatby.');
    error.code = 'DISCOUNT_TEMPLATE_NOT_FOUND';
    throw error;
  }

  const orderPair = selectIncidentDiscountOrderPair({ dropeaOrders, shopifyOrders });
  if (!orderPair) {
    const error = new Error('Shopify y Dropea no identifican el mismo pedido reciente con suficiente seguridad.');
    error.code = 'CROSS_SOURCE_ORDER_MISMATCH';
    throw error;
  }
  const { dropeaOrder, shopifyOrder } = orderPair;

  const subscriber = await findSubscriberForOrderRobust({
    phone: normalizedPhone,
    orderId: dropeaOrder.orderId,
    maxPages: 30
  }) || await findSubscriberByPhone({ phone: normalizedPhone, maxPages: 30 });
  if (!subscriber?.user_ns) {
    const error = new Error('No se encontro la conversacion Chatby del pedido.');
    error.code = 'CHATBY_CONVERSATION_NOT_FOUND';
    throw error;
  }

  const messages = await getChatMessages(subscriber.user_ns);
  const templateData = incidentDiscountTemplateData({ order: shopifyOrder });
  const existingDelivery = findVerifiedTemplateDelivery(messages, template.name);
  const responseState = classifyIncidentDiscountResponse(messages, template.name);
  return {
    phone: normalizedPhone,
    dropeaOrder,
    shopifyOrder,
    subscriber,
    messages,
    template,
    templateData: {
      ...templateData,
      templateName: template.name,
      language: template.language,
      dedupeKey: `${dropeaOrder.orderId}|${template.name}`
    },
    existingDelivery,
    responseState
  };
}

function publicPreview(context) {
  return {
    candidateFound: true,
    orderReference: maskOrderId(context.dropeaOrder.orderId),
    orderFingerprint: fingerprint(context.dropeaOrder.orderId),
    shopifyOrderReference: maskOrderId(context.shopifyOrder.name || context.shopifyOrder.id),
    crossSourceVerified: true,
    conversationFound: true,
    template: {
      name: context.template.name,
      language: context.template.language,
      status: context.template.status,
      bodyFields: context.template.bodyFields
    },
    body: {
      BODY_1: context.templateData.params['BODY_{{1}}'],
      BODY_2: context.templateData.params['BODY_{{2}}'],
      BODY_3: context.templateData.params['BODY_{{3}}']
    },
    originalPrice: context.templateData.originalPrice,
    finalPrice: context.templateData.finalPrice,
    discountAmountEur: 5,
    existingDelivery: Boolean(context.existingDelivery),
    responseStatus: context.responseState.status,
    automationEnabled: false,
    mode: 'AUTHORIZED_SINGLE_TEST_PREVIEW'
  };
}

export async function previewIncidentDiscountTest({ phone } = {}) {
  return publicPreview(await buildContext(phone));
}

async function waitForVerifiedDelivery(userNs, templateName, startedAt) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
    const messages = await getChatMessages(userNs).catch(() => []);
    const delivery = findVerifiedTemplateDelivery(messages, templateName);
    if (delivery?.sentAt && Date.parse(delivery.sentAt) >= Date.parse(startedAt) - 5000) return delivery;
  }
  return null;
}

export async function sendAuthorizedIncidentDiscountTest({
  phone,
  authorization
} = {}) {
  if (authorization !== 'AUTHORIZED_SINGLE_TEST') {
    const error = new Error('Falta autorizacion explicita para el envio unico.');
    error.code = 'SINGLE_TEST_NOT_AUTHORIZED';
    throw error;
  }

  const context = await buildContext(phone);
  if (context.template.status !== 'APPROVED') {
    const error = new Error('La plantilla no esta aprobada en Chatby.');
    error.code = 'DISCOUNT_TEMPLATE_NOT_APPROVED';
    throw error;
  }
  if (context.existingDelivery) {
    return { status: 'already_sent', verified: true, ...publicPreview(context) };
  }

  const activeKey = context.templateData.dedupeKey;
  if (activeTestSends.has(activeKey)) {
    return { status: 'already_in_flight', verified: false, ...publicPreview(context) };
  }
  activeTestSends.add(activeKey);

  let claim = null;
  const attemptedAt = new Date().toISOString();
  try {
    claim = await claimTemplateDelivery({
      storeId: config.defaultStore.id,
      orderId: context.dropeaOrder.orderId,
      customerPhone: context.phone,
      templateName: context.template.name,
      provider: 'chatby',
      chatbyUserNs: context.subscriber.user_ns
    });
    if (!claim?.acquired) {
      return {
        status: `persistent_${claim?.existing?.status || 'claimed'}`,
        verified: ['sent', 'already_seen'].includes(String(claim?.existing?.status || '')),
        ...publicPreview(context)
      };
    }

    const response = await sendWhatsappTemplate({
      user_ns: context.subscriber.user_ns,
      user_id: context.phone,
      content: {
        name: context.template.name,
        lang: context.template.language,
        namespace: context.template.namespace,
        params: {
          ...context.template.defaultParams,
          ...context.templateData.params
        }
      }
    });
    const responseWamid = extractWamid(response);
    const delivery = responseWamid
      ? { wamid: responseWamid, sentAt: new Date().toISOString() }
      : await waitForVerifiedDelivery(context.subscriber.user_ns, context.template.name, attemptedAt);
    const status = delivery ? 'sent' : 'delivery_unverified';
    const sentAt = delivery?.sentAt || null;
    await finishTemplateDelivery({
      storeId: config.defaultStore.id,
      orderId: context.dropeaOrder.orderId,
      customerPhone: context.phone,
      templateName: context.template.name,
      provider: 'chatby',
      chatbyUserNs: context.subscriber.user_ns,
      status,
      attemptedAt,
      sentAt,
      lastError: delivery ? null : 'Chatby no devolvio un wamid verificable; no se reintentara automaticamente.',
      raw: {
        mode: 'AUTHORIZED_SINGLE_TEST',
        dynamicFieldsVerified: true,
        discountAmountEur: 5,
        originalAmount: context.templateData.originalAmount,
        finalAmount: context.templateData.finalAmount,
        providerAccepted: Boolean(response)
      }
    });

    return {
      status,
      verified: Boolean(delivery),
      sentAt,
      ...publicPreview(context)
    };
  } catch (error) {
    if (claim?.acquired) {
      await finishTemplateDelivery({
        storeId: config.defaultStore.id,
        orderId: context.dropeaOrder.orderId,
        customerPhone: context.phone,
        templateName: context.template.name,
        provider: 'chatby',
        chatbyUserNs: context.subscriber.user_ns,
        status: 'failed',
        attemptedAt,
        lastError: error instanceof Error ? error.message : String(error),
        raw: { mode: 'AUTHORIZED_SINGLE_TEST' }
      }).catch(() => null);
    }
    throw error;
  } finally {
    activeTestSends.delete(activeKey);
  }
}
