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
import { claimTemplateDelivery, finishTemplateDelivery, getTemplateDelivery } from '../db/supabase-store.mjs';
import {
  INCIDENT_DISCOUNT_TEMPLATE_NAME,
  incidentDiscountTemplateData
} from './incident-discount-template.mjs';
import {
  classifyIncidentDiscountResponse,
  extractWamid,
  findVerifiedTemplateDelivery,
  INCIDENT_MERCHANDISE_TEMPLATE_LEDGER_NAME,
  incidentDiscountPolicy
} from './incident-discount-policy.mjs';
import {
  selectIncidentDiscountOrderPair,
  selectShopifyOrderForDropeaOrder,
  selectRecentShopifyOnlyTestOrder
} from './incident-discount-order-match.mjs';

const config = getAppConfig();
const activeTestSends = new Set();
const activeRecoverySends = new Set();
let cachedDiscountTemplate = null;

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
  if (cachedDiscountTemplate) return cachedDiscountTemplate;
  const target = normalizedTemplate(INCIDENT_DISCOUNT_TEMPLATE_NAME);
  let compatible = null;
  for (let page = 1; page <= 30 && !compatible; page += 1) {
    const templates = templateRows(await listWhatsappTemplates({ page, limit: 200 }));
    const exact = templates.find((item) => normalizedTemplate(item?.name) === target);
    compatible = exact || null;
    if (!templates.length) break;
  }
  if (!compatible) return null;
  const defaults = parseDefaultValues(compatible.default_values);
  cachedDiscountTemplate = {
    name: compatible.name,
    language: defaults.lang || compatible.language || 'es_ES',
    namespace: compatible.namespace || null,
    status: String(compatible.status || '').toUpperCase(),
    defaultParams: defaults.params && typeof defaults.params === 'object' ? defaults.params : {},
    bodyFields: (Array.isArray(compatible.params) ? compatible.params : [])
      .filter((item) => /^BODY_/i.test(String(item?.label || '')))
      .map((item) => item.label)
  };
  return cachedDiscountTemplate;
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
  const orders = await listRecentShopifyOrders({ first: 250 });
  return orders.filter((order) => digits(order.customerPhone).endsWith(target));
}

async function buildContext(phone, { allowShopifyOnlyTest = false } = {}) {
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
  const shopifyOnlyTest = !orderPair && allowShopifyOnlyTest
    ? selectRecentShopifyOnlyTestOrder(shopifyOrders)
    : null;
  if (!orderPair && !shopifyOnlyTest) {
    const error = new Error('Shopify y Dropea no identifican el mismo pedido reciente con suficiente seguridad.');
    error.code = 'CROSS_SOURCE_ORDER_MISMATCH';
    throw error;
  }
  const dropeaOrder = orderPair?.dropeaOrder || null;
  const shopifyOrder = orderPair?.shopifyOrder || shopifyOnlyTest.order;
  const sourceMode = orderPair ? 'dropea_shopify_verified' : 'shopify_only_authorized_test';
  const orderKey = orderPair
    ? String(dropeaOrder.orderId)
    : `shopify-test:${shopifyOrder.id}`;

  const subscriber = orderPair
    ? await findSubscriberForOrderRobust({
        phone: normalizedPhone,
        orderId: dropeaOrder.orderId,
        maxPages: 30
      }) || await findSubscriberByPhone({ phone: normalizedPhone, maxPages: 30 })
    : await findSubscriberByPhone({ phone: normalizedPhone, maxPages: 30 });
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
      dedupeKey: `${orderKey}|${template.name}`
    },
    orderKey,
    sourceMode,
    crossSourceVerified: Boolean(orderPair),
    existingDelivery,
    responseState
  };
}

function publicPreview(context) {
  return {
    candidateFound: true,
    orderReference: maskOrderId(context.dropeaOrder?.orderId || context.shopifyOrder.name || context.shopifyOrder.id),
    orderFingerprint: fingerprint(context.orderKey),
    shopifyOrderReference: maskOrderId(context.shopifyOrder.name || context.shopifyOrder.id),
    crossSourceVerified: context.crossSourceVerified,
    sourceMode: context.sourceMode,
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
    mode: context.crossSourceVerified
      ? 'AUTHORIZED_SINGLE_TEST_PREVIEW'
      : 'AUTHORIZED_SINGLE_TEST_PREVIEW_SHOPIFY_ONLY'
  };
}

export async function previewIncidentDiscountTest({ phone } = {}) {
  return publicPreview(await buildContext(phone, { allowShopifyOnlyTest: true }));
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

  const context = await buildContext(phone, { allowShopifyOnlyTest: true });
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
      orderId: context.orderKey,
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
      orderId: context.orderKey,
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
        sourceMode: context.sourceMode,
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
        orderId: context.orderKey,
        customerPhone: context.phone,
        templateName: context.template.name,
        provider: 'chatby',
        chatbyUserNs: context.subscriber.user_ns,
        status: 'failed',
        attemptedAt,
        lastError: error instanceof Error ? error.message : String(error),
        raw: { mode: 'AUTHORIZED_SINGLE_TEST', sourceMode: context.sourceMode }
      }).catch(() => null);
    }
    throw error;
  } finally {
    activeTestSends.delete(activeKey);
  }
}

function recoveryResult(result = {}) {
  return {
    status: result.status || 'skipped',
    reason: result.reason || null,
    templateName: result.templateName || null,
    initialTemplateSentAt: result.initialTemplateSentAt || null,
    dueAt: result.dueAt || null,
    attemptedAt: result.attemptedAt || null,
    sentAt: result.sentAt || null,
    verified: result.verified === true,
    responseStatus: result.responseStatus || 'NOT_SENT',
    respondedAt: result.respondedAt || null,
    originalPrice: result.originalPrice || null,
    finalPrice: result.finalPrice || null,
    discountAmountEur: result.discountAmountEur ?? 5,
    crossSourceVerified: result.crossSourceVerified === true,
    error: result.error || null
  };
}

function evaluateRecoveryPolicy(input, { authorizedImmediate = false } = {}) {
  const policy = incidentDiscountPolicy(input);
  if (!authorizedImmediate || policy.reason !== 'waiting_discount_window' || !policy.dueAt) return policy;
  const dueAt = Date.parse(policy.dueAt);
  if (!Number.isFinite(dueAt)) return policy;
  // This is an explicitly authorized one-time advance of the timer only. All
  // other eligibility checks (current rejection, verified initial template,
  // no customer activity and no prior discount) remain inside the policy.
  return incidentDiscountPolicy({ ...input, now: dueAt });
}

export async function processIncidentDiscountRecovery({
  incident,
  order,
  messages = [],
  realEnabled = false,
  authorizedImmediate = false,
  now = Date.now(),
  dependencies = {}
} = {}) {
  const deps = {
    getMessages: dependencies.getMessages || getChatMessages,
    getTemplate: dependencies.getTemplate || findTemplate,
    getShopifyOrders: dependencies.getShopifyOrders || findShopifyOrders,
    claim: dependencies.claim || claimTemplateDelivery,
    finish: dependencies.finish || finishTemplateDelivery,
    getDelivery: dependencies.getDelivery || getTemplateDelivery,
    send: dependencies.send || sendWhatsappTemplate,
    waitForDelivery: dependencies.waitForDelivery || waitForVerifiedDelivery
  };
  if (!incident?.orderId || !order) {
    return recoveryResult({ reason: 'missing_current_incident_order' });
  }
  if (!incident?.chatbyUserNs) {
    return recoveryResult({ reason: 'missing_chatby_conversation' });
  }

  let template;
  try {
    template = await deps.getTemplate();
  } catch (error) {
    return recoveryResult({ reason: 'discount_template_catalog_unavailable', error: error instanceof Error ? error.message : String(error) });
  }
  if (!template) return recoveryResult({ reason: 'discount_template_not_found' });
  if (template.status !== 'APPROVED') {
    return recoveryResult({ reason: 'discount_template_not_approved', templateName: template.name });
  }

  let freshMessages;
  try {
    freshMessages = await deps.getMessages(incident.chatbyUserNs);
  } catch (error) {
    return recoveryResult({ reason: 'chatby_final_read_failed', templateName: template.name, error: error instanceof Error ? error.message : String(error) });
  }
  let merchandisePersistentDelivery;
  let discountPersistentDelivery;
  try {
    [merchandisePersistentDelivery, discountPersistentDelivery] = await Promise.all([
      deps.getDelivery({
        storeId: config.defaultStore.id,
        orderId: incident.orderId,
        templateName: INCIDENT_MERCHANDISE_TEMPLATE_LEDGER_NAME
      }),
      deps.getDelivery({
        storeId: config.defaultStore.id,
        orderId: incident.orderId,
        templateName: template.name
      })
    ]);
  } catch (error) {
    return recoveryResult({ reason: 'template_delivery_ledger_read_failed', templateName: template.name, error: error instanceof Error ? error.message : String(error) });
  }
  const policy = evaluateRecoveryPolicy({
    incident: { ...incident, chatbyReadVerified: true },
    messages: freshMessages,
    now,
    discountTemplateName: template.name,
    merchandisePersistentDelivery,
    discountPersistentDelivery
  }, { authorizedImmediate });
  const response = classifyIncidentDiscountResponse(freshMessages, template.name, discountPersistentDelivery);
  if (!policy.eligible) {
    return recoveryResult({
      reason: policy.reason,
      status: policy.reason === 'discount_template_already_sent' ? 'already_sent' : 'skipped',
      templateName: template.name,
      initialTemplateSentAt: policy.merchandiseTemplateSentAt,
      dueAt: policy.dueAt,
      sentAt: policy.discountTemplateSentAt,
      verified: policy.reason === 'discount_template_already_sent',
      responseStatus: response.status,
      respondedAt: response.respondedAt
    });
  }

  let shopifyOrders;
  try {
    shopifyOrders = await deps.getShopifyOrders(incident.phone || order.customerPhone || '');
  } catch (error) {
    return recoveryResult({ reason: 'shopify_order_read_failed', templateName: template.name, error: error instanceof Error ? error.message : String(error) });
  }
  const exactPair = selectShopifyOrderForDropeaOrder({ dropeaOrder: order, shopifyOrders });
  if (!exactPair) {
    return recoveryResult({ reason: 'cross_source_order_mismatch', templateName: template.name });
  }

  let templateData;
  try {
    templateData = incidentDiscountTemplateData({
      order: exactPair.order,
      customerName: exactPair.order.customerName || incident.customerName,
      productSummary: null
    });
  } catch (error) {
    return recoveryResult({ reason: error?.code || 'discount_template_data_invalid', templateName: template.name, error: error instanceof Error ? error.message : String(error) });
  }
  const preview = {
    templateName: template.name,
    initialTemplateSentAt: policy.merchandiseTemplateSentAt,
    dueAt: policy.dueAt,
    originalPrice: templateData.originalPrice,
    finalPrice: templateData.finalPrice,
    discountAmountEur: 5,
    crossSourceVerified: true,
    responseStatus: response.status,
    respondedAt: response.respondedAt
  };
  if (!realEnabled) return recoveryResult({ ...preview, status: 'would_send', reason: 'real_delivery_disabled' });

  // Re-read immediately before claiming and sending. Any message or button after
  // the initial template closes the lane, including an ambiguous reply.
  const finalMessages = await deps.getMessages(incident.chatbyUserNs).catch(() => null);
  if (!Array.isArray(finalMessages)) {
    return recoveryResult({ ...preview, reason: 'chatby_pre_send_read_failed' });
  }
  const finalPolicy = evaluateRecoveryPolicy({
    incident: { ...incident, chatbyReadVerified: true },
    messages: finalMessages,
    now: Date.now(),
    discountTemplateName: template.name,
    merchandisePersistentDelivery,
    discountPersistentDelivery
  }, { authorizedImmediate });
  if (!finalPolicy.eligible) {
    const finalResponse = classifyIncidentDiscountResponse(finalMessages, template.name, discountPersistentDelivery);
    return recoveryResult({
      ...preview,
      status: finalPolicy.reason === 'discount_template_already_sent' ? 'already_sent' : 'skipped',
      reason: finalPolicy.reason,
      sentAt: finalPolicy.discountTemplateSentAt,
      verified: finalPolicy.reason === 'discount_template_already_sent',
      responseStatus: finalResponse.status,
      respondedAt: finalResponse.respondedAt
    });
  }

  const activeKey = `${incident.orderId}|${normalizedTemplate(template.name)}`;
  if (activeRecoverySends.has(activeKey)) return recoveryResult({ ...preview, status: 'already_in_flight', reason: 'process_dedupe_guard' });
  activeRecoverySends.add(activeKey);
  const attemptedAt = new Date().toISOString();
  let claim = null;
  try {
    claim = await deps.claim({
      storeId: config.defaultStore.id,
      orderId: incident.orderId,
      customerPhone: incident.phone || order.customerPhone || '',
      templateName: template.name,
      provider: 'chatby',
      chatbyUserNs: incident.chatbyUserNs
    });
    if (!claim?.acquired) {
      return recoveryResult({
        ...preview,
        status: `persistent_${claim?.existing?.status || 'blocked'}`,
        reason: claim?.reason || 'persistent_dedupe_guard',
        attemptedAt: claim?.existing?.attempted_at || null,
        sentAt: claim?.existing?.sent_at || null,
        verified: ['sent', 'already_seen'].includes(String(claim?.existing?.status || ''))
      });
    }

    const providerResponse = await deps.send({
      user_ns: incident.chatbyUserNs,
      user_id: incident.phone || order.customerPhone || '',
      content: {
        name: template.name,
        lang: template.language,
        namespace: template.namespace,
        params: { ...template.defaultParams, ...templateData.params }
      }
    });
    const responseWamid = extractWamid(providerResponse);
    const delivery = responseWamid
      ? { wamid: responseWamid, sentAt: new Date().toISOString() }
      : await deps.waitForDelivery(incident.chatbyUserNs, template.name, attemptedAt);
    const status = delivery ? 'sent' : 'delivery_unverified';
    const sentAt = delivery?.sentAt || null;
    await deps.finish({
      storeId: config.defaultStore.id,
      orderId: incident.orderId,
      customerPhone: incident.phone || order.customerPhone || '',
      templateName: template.name,
      provider: 'chatby',
      chatbyUserNs: incident.chatbyUserNs,
      status,
      attemptedAt,
      sentAt,
      lastError: delivery ? null : 'Chatby no devolvio un wamid verificable; no se reintentara automaticamente.',
      raw: {
        mode: authorizedImmediate
          ? 'INCIDENT_DISCOUNT_AUTHORIZED_IMMEDIATE_REAL'
          : 'INCIDENT_DISCOUNT_RECOVERY_REAL',
        initialTemplateSentAt: policy.merchandiseTemplateSentAt,
        crossSourceVerified: true,
        discountAmountEur: 5,
        originalAmount: templateData.originalAmount,
        finalAmount: templateData.finalAmount,
        providerAccepted: Boolean(providerResponse)
      }
    });
    return recoveryResult({
      ...preview,
      status,
      reason: delivery ? 'discount_template_sent' : 'delivery_unverified_no_retry',
      attemptedAt,
      sentAt,
      verified: Boolean(delivery)
    });
  } catch (error) {
    if (claim?.acquired) {
      await deps.finish({
        storeId: config.defaultStore.id,
        orderId: incident.orderId,
        customerPhone: incident.phone || order.customerPhone || '',
        templateName: template.name,
        provider: 'chatby',
        chatbyUserNs: incident.chatbyUserNs,
        status: 'failed',
        attemptedAt,
        lastError: error instanceof Error ? error.message : String(error),
        raw: {
          mode: authorizedImmediate
            ? 'INCIDENT_DISCOUNT_AUTHORIZED_IMMEDIATE_REAL'
            : 'INCIDENT_DISCOUNT_RECOVERY_REAL',
          crossSourceVerified: true
        }
      }).catch(() => null);
    }
    return recoveryResult({ ...preview, status: 'failed', reason: 'discount_template_send_failed', attemptedAt, error: error instanceof Error ? error.message : String(error) });
  } finally {
    activeRecoverySends.delete(activeKey);
  }
}
