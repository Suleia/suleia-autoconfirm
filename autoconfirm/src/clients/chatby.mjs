import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

const subscriberIndexCacheMs = Math.max(1000, Number(process.env.CHATBY_SUBSCRIBER_CACHE_MS || 120000));
const requestMinIntervalMs = Math.max(0, Number(process.env.CHATBY_REQUEST_MIN_INTERVAL_MS || 100));
const readRetryBaseMs = Math.max(0, Number(process.env.CHATBY_READ_RETRY_BASE_MS || 500));
let subscriberIndexCache = null;
let subscriberIndexInFlight = null;
let requestQueue = Promise.resolve();
let nextRequestAt = 0;
let rateLimitedUntil = 0;

const CHATBY_NATIVE_LIFECYCLE_TEMPLATES = new Set([
  'dropea_pedido_preparado_v1',
  'dropea_incidencia_mercancia_v1'
]);

function templateSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[a-z]{2}_[a-z]{2}\s+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function chatbyLifecycleTemplateOwner() {
  return String(process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER || 'repository')
    .trim()
    .toLowerCase();
}

function chatbyLifecycleTemplateOwnerFor(templateName) {
  if (templateSlug(templateName) === 'dropea_incidencia_mercancia_v1') {
    return String(process.env.CHATBY_INCIDENT_TEMPLATE_OWNER || chatbyLifecycleTemplateOwner())
      .trim()
      .toLowerCase();
  }
  return chatbyLifecycleTemplateOwner();
}

export function chatbyNativeOwnsLifecycleTemplate(templateName) {
  return chatbyLifecycleTemplateOwnerFor(templateName) === 'chatby_native'
    && CHATBY_NATIVE_LIFECYCLE_TEMPLATES.has(templateSlug(templateName));
}

export function chatbyRepositoryOwnsIncidentTemplate() {
  return String(process.env.CHATBY_INCIDENT_TEMPLATE_OWNER || '').trim().toLowerCase() === 'repository';
}

function assertRepositoryOwnsTemplate(payload) {
  const name = payload?.template_name
    || payload?.templateName
    || payload?.content?.name
    || payload?.content?.template_name;
  const owner = chatbyLifecycleTemplateOwnerFor(name);
  if (owner !== 'chatby_native' || !CHATBY_NATIVE_LIFECYCLE_TEMPLATES.has(templateSlug(name))) return;

  const error = new Error('Lifecycle template blocked: Chatby native automation is the configured single sender.');
  error.code = 'CHATBY_NATIVE_LIFECYCLE_TEMPLATE_OWNER';
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRetryDelay(attempt) {
  return Math.min(5000, readRetryBaseMs * (2 ** Math.max(0, attempt - 1)));
}

function retryableReadStatus(status) {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

async function scheduleRequest(task) {
  const previous = requestQueue;
  let release;
  requestQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  const waitMs = Math.max(0, nextRequestAt - Date.now(), rateLimitedUntil - Date.now());
  if (waitMs) await sleep(waitMs);

  try {
    return await task();
  } finally {
    nextRequestAt = Date.now() + requestMinIntervalMs;
    release();
  }
}

async function request(path, options = {}) {
  if (!config.chatbyToken) throw new Error('Falta CHATBY_TOKEN.');
  const {
    maxAttempts: configuredAttempts,
    timeoutMs: configuredTimeout = 20000,
    retrySafe = false,
    signal: providedSignal,
    ...requestOptions
  } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const methodIsReadOnly = method === 'GET' || method === 'HEAD';
  const canRetry = methodIsReadOnly || retrySafe === true;
  const maxAttempts = Math.max(1, Number(configuredAttempts ?? (canRetry ? 3 : 1)));
  const timeoutMs = Math.max(1000, Number(configuredTimeout || 20000));
  let response;
  let text = '';
  let data = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = providedSignal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      response = await scheduleRequest(() => fetch(`${config.chatbyBaseUrl}${path}`, {
        ...requestOptions,
        signal: providedSignal || controller.signal,
        headers: {
          Authorization: `Bearer ${config.chatbyToken}`,
          'Content-Type': 'application/json',
          ...(requestOptions.headers || {})
        }
      }));
    } catch (error) {
      if (canRetry && !providedSignal && attempt < maxAttempts) {
        await sleep(readRetryDelay(attempt));
        continue;
      }
      if (error?.name === 'AbortError') {
        throw new Error(`Chatby no respondio en ${timeoutMs} ms para ${path}.`);
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!canRetry || !retryableReadStatus(response.status) || attempt === maxAttempts) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const backoffMs = response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : readRetryDelay(attempt);
    if (response.status === 429) {
      rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + backoffMs);
    }
    await sleep(backoffMs);
  }

  if (!response.ok) {
    throw new Error(`Chatby respondió ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  assertNoChatbyError(data);
  return data;
}

function assertNoChatbyError(data) {
  if (!data || typeof data !== 'object') return;

  const status = String(data.status || data.state || '').toLowerCase();
  const explicitFailure = data.ok === false
    || data.success === false
    || Boolean(data.error)
    || ['error', 'failed', 'failure'].includes(status);

  if (explicitFailure) {
    throw new Error(`Chatby devolvio error: ${JSON.stringify(data)}`);
  }
}

export async function createSubscriber(payload) {
  const created = await request('/subscriber/create', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  invalidateSubscriberIndexCache();
  return created;
}

export async function sendWhatsappTemplate(payload) {
  assertRepositoryOwnsTemplate(payload);
  if (!payload.content) {
    payload = await buildWhatsappTemplatePayload(payload);
  }
  assertRepositoryOwnsTemplate(payload);

  return request('/subscriber/send-whatsapp-template', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function sendTextMessage({ user_ns, content }) {
  if (!user_ns || !String(content || '').trim()) {
    throw new Error('Chatby send-text requiere user_ns y content.');
  }
  return request('/subscriber/send-text', {
    method: 'POST',
    body: JSON.stringify({ user_ns, content: String(content).trim() })
  });
}

export async function setSubscriberUserFieldByName({ user_ns, field_name, value }) {
  if (!user_ns || !String(field_name || '').trim()) {
    throw new Error('Chatby set-user-field requiere user_ns y field_name.');
  }
  const response = await request('/subscriber/set-user-field-by-name', {
    method: 'PUT',
    body: JSON.stringify({
      user_ns,
      field_name: String(field_name).trim(),
      value: value == null ? '' : String(value)
    })
  });
  invalidateSubscriberIndexCache();
  return response;
}

export async function clearSubscriberOrderConfirmationState(userNs) {
  if (!userNs) throw new Error('Chatby requiere user_ns para limpiar la confirmacion anterior.');

  const operations = [
    {
      name: 'confirmation_field',
      run: () => request('/subscriber/clear-user-field-by-name', {
        method: 'DELETE',
        body: JSON.stringify({ user_ns: userNs, field_name: 'P. Confirmado' })
      })
    },
    {
      name: 'confirmation_tag',
      run: () => request('/subscriber/remove-tag-by-name', {
        method: 'DELETE',
        body: JSON.stringify({ user_ns: userNs, tag_name: 'PED-Confirmado' })
      })
    },
    {
      name: 'confirmation_label',
      run: () => request('/subscriber/remove-labels-by-name', {
        method: 'DELETE',
        body: JSON.stringify({
          user_ns: userNs,
          data: [{ label_name: 'CONFIRMADO' }]
        })
      })
    }
  ];

  const results = [];
  for (const operation of operations) {
    try {
      const response = await operation.run();
      results.push({ name: operation.name, ok: true, response });
    } catch (error) {
      results.push({
        name: operation.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  invalidateSubscriberIndexCache();
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    throw new Error(`No se pudo limpiar por completo la confirmacion anterior en Chatby: ${JSON.stringify(failures)}`);
  }
  return { ok: true, results };
}

export async function listWhatsappTemplates({ page = 1, limit = 200 } = {}) {
  const response = await request('/whatsapp-template/list', {
    method: 'POST',
    body: JSON.stringify({ page, limit }),
    // This POST is a read-only listing operation and is safe to retry.
    retrySafe: true,
    maxAttempts: 3
  });
  return response?.data ?? response;
}

export async function checkChatbyConnection() {
  const response = await request('/whatsapp-template/list', {
    method: 'POST',
    body: JSON.stringify({ page: 1, limit: 1 }),
    // This POST is a read-only health query and is safe to retry.
    retrySafe: true,
    maxAttempts: 2,
    timeoutMs: 10000
  });
  const rows = response?.data ?? response;
  return {
    ok: true,
    templateCount: Array.isArray(rows) ? rows.length : null
  };
}

function parseTemplateName(templateName) {
  const parts = String(templateName || '').trim().split(/\s+/);
  if (parts.length >= 2 && /^[a-z]{2}_[A-Z]{2}$/.test(parts[0])) {
    return { lang: parts[0], name: parts.slice(1).join(' ') };
  }
  return { lang: null, name: parts.join(' ') };
}

async function buildWhatsappTemplatePayload(payload) {
  const { lang, name } = parseTemplateName(payload.template_name || payload.templateName);
  const templates = await listWhatsappTemplates();
  const template = templates.find((item) => item.name === name && item.status === 'APPROVED')
    || templates.find((item) => item.name === name);

  if (!template) {
    throw new Error(`No se encontrÃ³ plantilla WhatsApp aprobada: ${name}`);
  }

  const defaultParams = template.default_values?.params && typeof template.default_values.params === 'object'
    ? template.default_values.params
    : {};

  const quickReplyParams = Object.fromEntries(
    Object.entries(defaultParams).filter(([key]) => key.startsWith('QUICK_REPLY_'))
  );

  return {
    user_ns: payload.user_ns,
    user_id: payload.user_id,
    content: {
      name: template.name,
      lang: template.default_values?.lang || template.language || lang || 'es_ES',
      namespace: template.namespace,
      params: {
        ...quickReplyParams,
        ...(payload.params || {})
      }
    }
  };
}

export async function getChatMessages(userNs) {
  const response = await request(`/subscriber/chat-messages?user_ns=${encodeURIComponent(userNs)}`, {
    method: 'GET',
    timeoutMs: 12000
  });
  const messages = response?.data ?? response;
  if (!Array.isArray(messages)) {
    throw new Error(`Chatby devolvio una respuesta no valida al leer mensajes: ${JSON.stringify(messages)}`);
  }
  return messages;
}

export async function listSubscribers({ page = 1, limit = 100 } = {}) {
  const response = await request(`/subscribers?limit=${limit}&page=${page}`, {
    method: 'GET',
    timeoutMs: 12000
  });
  return response?.data ?? response;
}

export function invalidateSubscriberIndexCache() {
  subscriberIndexCache = null;
}

export async function loadSubscriberIndex({ maxPages = 20, limit = 100, force = false } = {}) {
  const now = Date.now();
  const cacheCanCoverRequest = subscriberIndexCache
    && subscriberIndexCache.limit === limit
    && subscriberIndexCache.maxPages >= maxPages;
  if (!force && cacheCanCoverRequest && now - subscriberIndexCache.loadedAt < subscriberIndexCacheMs) {
    return subscriberIndexCache.value;
  }
  if (!force && subscriberIndexInFlight) return subscriberIndexInFlight;

  subscriberIndexInFlight = (async () => {
    const subscribers = [];
    const byPhone = new Map();

    for (let page = 1; page <= maxPages; page += 1) {
      const rows = await listSubscribers({ page, limit });
      if (!Array.isArray(rows) || !rows.length) break;
      subscribers.push(...rows);
      for (const subscriber of rows) {
        const phoneKey = digits(subscriber.phone || subscriber.user_id).slice(-9);
        if (!phoneKey) continue;
        const matches = byPhone.get(phoneKey) || [];
        matches.push(subscriber);
        byPhone.set(phoneKey, matches);
      }
      if (rows.length < limit) break;
    }

    const value = { subscribers, byPhone };
    subscriberIndexCache = {
      value,
      loadedAt: Date.now(),
      maxPages,
      limit
    };
    return value;
  })();

  try {
    return await subscriberIndexInFlight;
  } finally {
    subscriberIndexInFlight = null;
  }
}

export async function findSubscribersByPhone({ phone, maxPages = 20, limit = 100 } = {}) {
  const phoneKey = digits(phone).slice(-9);
  if (!phoneKey) return [];
  const index = await loadSubscriberIndex({ maxPages, limit });
  return [...(index.byPhone.get(phoneKey) || [])];
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function fieldValue(subscriber, fieldName) {
  const field = (subscriber.user_fields || []).find((item) => item.name === fieldName);
  return field?.value ?? null;
}

function dropeaOrderFieldValue(subscriber) {
  const field = (subscriber.user_fields || []).find((item) => {
    const name = normalizeText(item.name);
    const compactName = name.replace(/[^a-z0-9]+/g, '');
    const explicitOrderField = compactName === 'pedido' || compactName === 'idpedido';
    return explicitOrderField || (
      name.includes('dropea') && (
        name.includes('numero')
        || name.includes('n mero')
        || name.includes('nã')
        || name.includes('num')
        || name.includes('order')
        || name.includes('pedido')
      )
    );
  });
  return field?.value ?? null;
}

function canonicalDropeaOrderId(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const compact = source.replace(/[\s#_-]+/g, '').toUpperCase();
  const numeric = compact.match(/^(?:ES)?(\d+)$/);
  return numeric ? numeric[1] : compact;
}

function sameDropeaOrderId(left, right) {
  const leftId = canonicalDropeaOrderId(left);
  const rightId = canonicalDropeaOrderId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

function subscriberContainsOrderId(subscriber, orderId) {
  const target = digits(orderId);
  if (!target) return false;
  const text = JSON.stringify(subscriber || {});
  return text.replace(/\D/g, ' ').split(/\s+/).includes(target);
}

function withSyntheticOrderField(subscriber, orderId) {
  if (!subscriber || dropeaOrderFieldValue(subscriber)) return subscriber;
  return {
    ...subscriber,
    user_fields: [
      ...(subscriber.user_fields || []),
      { name: 'Dropea: Numero', value: String(orderId) }
    ]
  };
}

export function findSubscriberInIndexForOrder(index, { phone, orderId, allowConfirmedPhoneFallback = true } = {}) {
  const phoneKey = digits(phone).slice(-9);
  const samePhoneSubscribers = phoneKey ? (index?.byPhone?.get(phoneKey) || []) : [];

  for (const subscriber of samePhoneSubscribers) {
    if (sameDropeaOrderId(dropeaOrderFieldValue(subscriber), orderId)) return subscriber;
    if (subscriberContainsOrderId(subscriber, orderId)) return withSyntheticOrderField(subscriber, orderId);
  }

  const confirmedSamePhone = allowConfirmedPhoneFallback
    ? samePhoneSubscribers.filter((subscriber) => subscriberConfirmsOrderRobust(subscriber))
    : [];
  if (confirmedSamePhone.length === 1) return withSyntheticOrderField(confirmedSamePhone[0], orderId);
  return null;
}

export function findSubscriberInIndexForExactOrder(index, { phone, orderId } = {}) {
  const phoneKey = digits(phone).slice(-9);
  const targetOrder = canonicalDropeaOrderId(orderId);
  if (!phoneKey || !targetOrder) return null;
  const samePhoneSubscribers = index?.byPhone?.get(phoneKey) || [];
  return samePhoneSubscribers.find((subscriber) => (
    sameDropeaOrderId(dropeaOrderFieldValue(subscriber), targetOrder)
  )) || null;
}

export function findSubscriberInIndexByPhone(index, { phone } = {}) {
  const phoneKey = digits(phone).slice(-9);
  return phoneKey ? (index?.byPhone?.get(phoneKey) || [])[0] || null : null;
}

function confirmationFieldValue(subscriber) {
  const field = (subscriber.user_fields || []).find((item) => normalizeText(item.name).includes('confirm'));
  return field?.value ?? null;
}

export async function findSubscriberForOrder({ phone, orderId, maxPages = 10 } = {}) {
  const phoneDigits = digits(phone);
  for (let page = 1; page <= maxPages; page += 1) {
    const subscribers = await listSubscribers({ page, limit: 100 });
    if (!Array.isArray(subscribers) || !subscribers.length) break;

    const found = subscribers.find((subscriber) => {
      const samePhone = phoneDigits && digits(subscriber.phone || subscriber.user_id).endsWith(phoneDigits.slice(-9));
      const sameOrder = String(fieldValue(subscriber, 'Dropea: NÃºmero') || fieldValue(subscriber, 'Dropea: Número') || '') === String(orderId);
      return samePhone && sameOrder;
    });

    if (found) return found;
  }
  return null;
}

export function subscriberConfirmsOrder(subscriber) {
  if (!subscriber) return false;
  const labels = (subscriber.labels || []).map((label) => String(label.name || '').toUpperCase());
  const tags = (subscriber.tags || []).map((tag) => String(tag.name || '').toUpperCase());
  const leadStatus = String(subscriber.lead_status || '').toUpperCase();
  if (leadStatus.includes('DATOS') || leadStatus.includes('ENVIO') || leadStatus.includes('ENVÍO')) {
    return false;
  }
  const confirmedAt = fieldValue(subscriber, 'P. Confirmado');
  return leadStatus === 'CONFIRMADO'
    || labels.includes('CONFIRMADO')
    || tags.includes('PED-CONFIRMADO')
    || Boolean(confirmedAt);
}

export async function findSubscriberForOrderRobust({
  phone,
  orderId,
  maxPages = 10,
  allowConfirmedPhoneFallback = true
} = {}) {
  const index = await loadSubscriberIndex({ maxPages, limit: 100 });
  return findSubscriberInIndexForOrder(index, { phone, orderId, allowConfirmedPhoneFallback });
}

export async function findSubscriberByPhone({ phone, maxPages = 20 } = {}) {
  const index = await loadSubscriberIndex({ maxPages, limit: 100 });
  return findSubscriberInIndexByPhone(index, { phone });
}

export function subscriberConfirmsOrderRobust(subscriber) {
  if (!subscriber) return false;
  const labels = (subscriber.labels || []).map((label) => String(label.name || '').toUpperCase());
  const tags = (subscriber.tags || []).map((tag) => String(tag.name || '').toUpperCase());
  const leadStatus = String(subscriber.lead_status || '').toUpperCase();
  if (leadStatus.includes('DATOS') || leadStatus.includes('ENVIO') || leadStatus.includes('ENVÃO')) {
    return false;
  }
  return leadStatus === 'CONFIRMADO'
    || labels.includes('CONFIRMADO')
    || tags.includes('PED-CONFIRMADO')
    || Boolean(confirmationFieldValue(subscriber))
    || Boolean(fieldValue(subscriber, 'P. Confirmado'));
}

export async function deleteSubscriber(payload) {
  return request('/subscriber/delete', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
