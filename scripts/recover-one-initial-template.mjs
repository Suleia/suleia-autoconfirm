// Administrative exception, never imported by the server or scheduler.
// Requires an explicit matching order authorization; does not change any owner.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  createDropeaV2IncidentClient,
  loadDropeaV2IncidentStoreConfigs
} from '../autoconfirm/src/clients/dropea-v2-incidents.mjs';
import {
  getDropeaV2OrderById,
  listDropeaV2OrdersByStatus,
  normalizeDropeaV2Order
} from '../autoconfirm/src/clients/dropea-v2-orders.mjs';
import {
  collectActiveOrderSnapshot,
  findBlockingActivePriorOrder,
  normalizedCustomerPhone
} from '../autoconfirm/src/policies/active-order-duplicates.mjs';
import { isBlockedCustomerOrder } from '../autoconfirm/src/policies/blocked-customers.mjs';

export const TEMPLATE = 'es_ES dropea_pedido_nuevo_v1';
export const OWNERSHIP_FAILURE = 'Lifecycle template blocked: Chatby native automation is the configured single sender.';
const slug = 'dropea_pedido_nuevo_v1';
const fail = (code) => { throw new Error(code); };
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function canonicalOrderId(value) {
  const match = String(value || '').trim().match(/^(?:ES)?([1-9]\d*)$/i);
  return match ? match[1] : fail('INVALID_SINGLE_ORDER_ID');
}

export function messageTime(message) {
  const value = message?.ts ?? message?.timestamp ?? message?.created_at ?? message?.createdAt;
  const parsed = new Date(typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function currentAcceptedTemplate(messages, order) {
  const created = new Date(order.createdAt).getTime();
  if (!Number.isFinite(created)) fail('ORDER_CREATION_TIME_UNVERIFIABLE');
  return messages.find(message => {
    const at = messageTime(message);
    return at !== null && at >= created
      && String(message.mid || '').startsWith('wamid.')
      && JSON.stringify(message).includes(slug);
  }) || null;
}

export function assertRecoveryEligibility({ order, subscriber, ledger, blocking }) {
  if (!order || order.status !== 'PENDING' || String(order.raw?.status).toUpperCase() !== 'PENDING') fail('ORDER_NOT_PENDING');
  if (blocking) fail('ACTIVE_ORDER_BUSINESS_GUARD');
  if (isBlockedCustomerOrder(order)) fail('BLOCKED_CUSTOMER');
  if (normalizedCustomerPhone(order.customerPhone) !== normalizedCustomerPhone(subscriber?.phone || subscriber?.user_id)
    || !normalizedCustomerPhone(order.customerPhone)) fail('RECIPIENT_IDENTITY_MISMATCH');
  if (subscriber?.channel !== 'whatsapp_cloud') fail('WRONG_SUBSCRIBER_CHANNEL');
  if (subscriber?.subscribed === false || /blocked|unsubscribed|opt.?out/i.test(String(subscriber?.status || ''))) fail('SUBSCRIBER_OPTED_OUT');
  const ownershipFailure = ledger?.status === 'failed' && ledger?.last_error === OWNERSHIP_FAILURE;
  // This helper writes verification_failed only while requestStarted=false.
  // The narrow resume covers its proven empty-field validation error, never
  // an attempted/ambiguous template send or another worker's failure.
  const ownPreSendContextFailure = ledger?.status === 'verification_failed'
    && ledger?.last_error === 'CHATBY_HTTP_422'
    && ledger?.raw?.recovery === 'explicit_one_order_authorization'
    && ledger?.raw?.prior_pre_send_error === OWNERSHIP_FAILURE
    && ledger?.raw?.recovery_external_send_started !== true;
  if ((!ownershipFailure && !ownPreSendContextFailure) || ledger?.sent_at
    || ledger?.template_name !== TEMPLATE || String(ledger?.order_id) !== order.orderId) fail('NOT_A_PROVEN_PRE_SEND_OWNERSHIP_FAILURE');
}

export function recoveryContext(order, subscriber) {
  const address = order.raw.shipping_address || {};
  const names = (order.raw.line_items || []).map(item => item.product_name || item.external_name || item.variant_name).filter(Boolean);
  const product = names.join(', ');
  const amount = Number(order.orderAmount);
  const street = [address.address_line_1, address.address_line_2].filter(Boolean).join(' ');
  const params = {
    'BODY_{{1}}': `${String(order.customerName || '').trim().split(/\s+/)[0]}!`,
    'BODY_{{2}}': product,
    'BODY_{{3}}': Number.isFinite(amount) && amount > 0 ? `${amount.toFixed(2).replace('.', ',')} EUR` : '',
    'BODY_{{4}}': street,
    'BODY_{{5}}': address.city || '',
    'BODY_{{6}}': address.postal_code || ''
  };
  if (!order.customerName || Object.values(params).some(value => !String(value).trim())) fail('INITIAL_TEMPLATE_DATA_INCOMPLETE');
  const desired = {
    '#Pedido': order.orderId,
    'Precio Total': amount.toFixed(2),
    'Productos': product,
    'Producto Principal': names[0],
    'Dirección': address.address_line_1 || '',
    'Referencia/Barrio': address.address_line_2 || '',
    'Localidad/Ciudad': address.city || '',
    'Código Postal': address.postal_code || '',
    'Provincia/Departamento': address.state || '',
    'CON-Registrado': order.createdAt,
    'CON-Payload': '',
    'Método Pago': String(order.raw.payment_method || 'COD').toUpperCase(),
    'Moneda': order.currencyCode || 'EUR'
  };
  const fields = subscriber.user_fields || [];
  if (!fields.some(field => field.name === '#Pedido')) fail('ORDER_CONTEXT_FIELD_MISSING');
  // Only update existing order-context fields. No tags, lead status, event
  // status, subscriptions, flows, reminders, template definitions or timers.
  const updates = fields.filter(field => Object.hasOwn(desired, field.name)
    && String(field.value ?? '') !== String(desired[field.name] ?? ''))
    .map(field => ({ field_name: field.name, value: String(desired[field.name] ?? '') }))
    .sort((left, right) => Number(left.field_name === '#Pedido') - Number(right.field_name === '#Pedido'));
  return { params, updates };
}

function assertNoNewCustomerActivity(messages, order) {
  const since = new Date(order.createdAt).getTime();
  if (messages.some(message => (messageTime(message) ?? 0) >= since
    && ['in', 'inbound', 'incoming', 'customer', 'user'].includes(String(message.type || message.direction || message.role).toLowerCase()))) fail('NEW_CUSTOMER_ACTIVITY_REQUIRES_REVIEW');
  if (messages.some(message => (messageTime(message) ?? 0) >= since
    && String(message.mid || '').startsWith('wamid.')
    && !JSON.stringify(message).includes(slug))) fail('OTHER_CURRENT_MESSAGE_REQUIRES_REVIEW');
}

export async function recoverOneInitialTemplate({ orderId, authorizedOrderId, execute = false, api }) {
  const id = canonicalOrderId(orderId);
  if (execute && canonicalOrderId(authorizedOrderId) !== id) fail('EXACT_ORDER_AUTHORIZATION_REQUIRED');
  const snapshot = await api.preflight(id);
  const { order, subscriber, ledger, blocking, messages, template } = snapshot;
  if (currentAcceptedTemplate(messages, order)) return { ok: true, skipped: true, reason: 'CURRENT_TEMPLATE_ALREADY_ACCEPTED', sends: 0 };
  assertRecoveryEligibility(snapshot);
  assertNoNewCustomerActivity(messages, order);
  if (template?.name !== slug || template?.status !== 'APPROVED'
    || (template.default_values?.lang || template.language) !== 'es_ES') fail('APPROVED_INITIAL_TEMPLATE_REQUIRED');
  const oldReference = String((subscriber.user_fields || []).find(field => field.name === '#Pedido')?.value || '').replace(/\D/g, '');
  if (oldReference && oldReference !== id) {
    const oldOrder = await api.getOrder(oldReference);
    if (!oldOrder || oldOrder.raw?.status !== 'FINISH' || oldOrder.raw?.sub_status !== 'CANCELLED'
      || normalizedCustomerPhone(oldOrder.customerPhone) !== normalizedCustomerPhone(order.customerPhone)) fail('OLD_CONTACT_CONTEXT_NOT_SAFELY_TERMINAL');
  }
  const { params, updates } = recoveryContext(order, subscriber);
  if (!execute) return { ok: true, dry_run: true, eligible: true, context_updates: updates.map(update => update.field_name), sends: 0 };
  const claim = await api.claim(ledger);
  if (!claim) fail('ATOMIC_RECOVERY_CLAIM_NOT_ACQUIRED');
  let requestStarted = false;
  try {
    for (const update of updates) await api.updateField(subscriber.user_ns, update);
    const refreshedSubscriber = await api.getSubscriber(subscriber.user_ns);
    if (String((refreshedSubscriber.user_fields || []).find(field => field.name === '#Pedido')?.value) !== id) fail('ORDER_CONTEXT_BINDING_NOT_VERIFIED');
    const freshOrder = await api.getOrder(id);
    if (freshOrder?.status !== 'PENDING') fail('ORDER_CHANGED_BEFORE_SEND');
    if (api.getBlockingOrder && await api.getBlockingOrder(freshOrder)) fail('ACTIVE_ORDER_CHANGED_BEFORE_SEND');
    const before = await api.getMessages(subscriber.user_ns);
    const alreadyAccepted = currentAcceptedTemplate(before, order);
    if (alreadyAccepted) {
      await api.finish(claim, { status: 'already_seen', sent_at: new Date(messageTime(alreadyAccepted)).toISOString(), mid: alreadyAccepted.mid });
      return { ok: true, skipped: true, reason: 'NATIVE_DELIVERY_OBSERVED_AFTER_CONTEXT_REFRESH', sends: 0 };
    }
    assertNoNewCustomerActivity(before, order);
    await api.markAttempted(claim);
    requestStarted = true;
    // Exactly one external send, no network retry and no Meta fallback.
    const response = await api.send({ user_ns: subscriber.user_ns, user_id: order.customerPhone,
      content: { name: template.name, lang: 'es_ES', namespace: template.namespace,
        params: { ...Object.fromEntries(Object.entries(template.default_values?.params || {}).filter(([key]) => key.startsWith('QUICK_REPLY_'))), ...params } } });
    const beforeMids = new Set(before.map(message => message.mid));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const after = await api.getMessages(subscriber.user_ns);
      const proof = currentAcceptedTemplate(after.filter(message => !beforeMids.has(message.mid)), order);
      if (proof) {
        await api.finish(claim, { status: 'sent', sent_at: new Date(messageTime(proof)).toISOString(), mid: proof.mid, recovery_external_send_started: true });
        return { ok: true, sends: 1, accepted_by_whatsapp: true, sent_at: new Date(messageTime(proof)).toISOString(),
          delivery_confirmed: proof.is_delivered === true || proof.delivery_status === 'delivered', duplicate_current_templates: after.filter(message => String(message.mid || '').startsWith('wamid.') && (messageTime(message) ?? 0) >= new Date(order.createdAt).getTime() && JSON.stringify(message).includes(slug)).length,
          chatby_acknowledged: response !== null };
      }
    }
    await api.finish(claim, { status: 'delivery_unverified', last_error: 'ONE_REQUEST_SENT_NO_CURRENT_WAMID_OBSERVED_DO_NOT_RETRY', recovery_external_send_started: true });
    return { ok: false, sends: 1, reconciliation_required: true, reason: 'WHATSAPP_ACCEPTANCE_NOT_VERIFIED' };
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'RECOVERY_TRANSPORT_FAILURE';
    await api.finish(claim, { status: requestStarted ? 'delivery_unverified' : 'verification_failed',
      last_error: requestStarted ? `SEND_OUTCOME_REQUIRES_RECONCILIATION_${code}` : code,
      recovery_external_send_started: requestStarted }).catch(() => {});
    return { ok: false, sends: requestStarted ? 1 : 0, reconciliation_required: requestStarted, reason: code };
  }
}

export function liveApi(env = process.env) {
  const stores = loadDropeaV2IncidentStoreConfigs(env).filter(store => store.market === 'ES');
  if (!stores.length) fail('ES_READ_CONFIG_UNAVAILABLE');
  const configLoader = () => stores;
  const getOrder = id => getDropeaV2OrderById(id, { env, configLoader });
  const supabase = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const cb = String(env.CHATBY_BASE_URL || 'https://app.chatby.io/api').replace(/\/$/, '');
  if (new URL(cb).hostname !== 'app.chatby.io' || !key || !env.CHATBY_TOKEN) fail('TRUSTED_ENV_REQUIRED');
  const schema = env.SUPABASE_SCHEMA || 'public';
  const minIntervalMs = Math.max(3500, Number(env.CHATBY_REQUEST_MIN_INTERVAL_MS || 0));
  let nextChatbyAt = 0;
  async function sb(table, params, method = 'GET', body) {
    const response = await fetch(`${supabase}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': schema,
        'Content-Profile': schema, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail(`SUPABASE_HTTP_${response.status}`);
    return response.json();
  }
  async function chatby(path, method = 'GET', body) {
    await pause(Math.max(0, nextChatbyAt - Date.now()));
    nextChatbyAt = Date.now() + minIntervalMs;
    const response = await fetch(`${cb}${path}`, { method,
      headers: { Authorization: `Bearer ${env.CHATBY_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail(`CHATBY_HTTP_${response.status}`);
    const payload = await response.json();
    if (payload?.status === 'error' || payload?.success === false) fail('CHATBY_APPLICATION_ERROR');
    return payload?.data ?? payload;
  }
  const getMessages = async ns => {
    const messages = await chatby(`/subscriber/chat-messages?user_ns=${encodeURIComponent(ns)}`);
    if (!Array.isArray(messages)) fail('CHAT_MESSAGES_SCHEMA_INVALID');
    return messages;
  };
  const getSubscriber = ns => chatby(`/subscriber/get-info?user_ns=${encodeURIComponent(ns)}`);
  async function activeSnapshot() {
    const snapshot = await collectActiveOrderSnapshot({ listByStatus: opts => listDropeaV2OrdersByStatus({ ...opts, env, configLoader }), maxPagesPerStatus: 20 });
    for (const store of stores) {
      const client = createDropeaV2IncidentClient({ token: store.token, market: store.market });
      const issues = await client.listAll('listIssues', { only_pending_to_resolve: true });
      for (const issue of issues.items.filter(issue => issue.is_active === true && ['PENDING', 'MANAGING_WITH_CLIENT'].includes(issue.status))) {
        if (snapshot.some(item => item.orderId === String(issue.order_id))) continue;
        const detail = (await client.request('getOrder', { id: Number(issue.order_id) })).data;
        const normalized = normalizeDropeaV2Order(detail, { market: store.market });
        snapshot.push({ ...normalized, status: 'INCIDENCE', raw: { ...normalized.raw, issues: issue } });
      }
    }
    return snapshot;
  }
  async function updateClaim(claim, patch) {
    const rows = await sb('template_delivery_ledger', { template_key: `eq.${claim.template_key}`,
      'raw->>recovery_claim_id': `eq.${claim.raw.recovery_claim_id}` }, 'PATCH', { ...patch, updated_at: new Date().toISOString() });
    if (rows.length !== 1) fail('RECOVERY_CLAIM_OWNERSHIP_LOST');
    return rows[0];
  }
  return {
    getOrder, getMessages, getSubscriber,
    getBlockingOrder: async order => findBlockingActivePriorOrder(order, await activeSnapshot()),
    async preflight(id) {
      const order = await getOrder(id);
      if (!order) fail('ORDER_NOT_FOUND');
      const stored = (await sb('orders', { order_id: `eq.${id}`, select: 'order_id,store_id,status,raw' }))[0];
      if (!stored?.raw?.chatbyUserNs || stored.status !== 'PENDING') fail('CURRENT_RUNTIME_THREAD_NOT_PENDING');
      const rows = await sb('template_delivery_ledger', { order_id: `eq.${id}`, store_id: `eq.${stored.store_id}`, template_name: `eq.${TEMPLATE}` });
      if (rows.length !== 1) fail('EXACT_INITIAL_DELIVERY_ROW_REQUIRED');
      const snapshot = await activeSnapshot();
      const subscriber = await getSubscriber(stored.raw.chatbyUserNs);
      const messages = await getMessages(subscriber.user_ns);
      const templates = await chatby('/whatsapp-template/list', 'POST', { page: 1, limit: 200 });
      if (!Array.isArray(templates)) fail('TEMPLATE_LIST_SCHEMA_INVALID');
      return { order, subscriber, messages, ledger: rows[0], blocking: findBlockingActivePriorOrder(order, snapshot), template: templates.find(template => template.name === slug) };
    },
    async claim(ledger) {
      const rows = await sb('template_delivery_ledger', { template_key: `eq.${ledger.template_key}`, status: `eq.${ledger.status}`,
        last_error: `eq.${ledger.last_error}`, updated_at: `eq.${ledger.updated_at}`, sent_at: 'is.null' }, 'PATCH', {
        status: 'claimed', attempted_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
        raw: { ...(ledger.raw || {}), recovery_claim_id: randomUUID(), recovery: 'explicit_one_order_authorization',
          prior_pre_send_error: OWNERSHIP_FAILURE, recovery_prior_context_error: ledger.status === 'verification_failed' ? ledger.last_error : null,
          recovery_external_send_started: false, native_owner_configuration_unchanged: true } });
      return rows.length === 1 ? rows[0] : null;
    },
    updateField: (ns, update) => update.value === ''
      ? chatby('/subscriber/clear-user-field-by-name', 'DELETE', { user_ns: ns, field_name: update.field_name })
      : chatby('/subscriber/set-user-field-by-name', 'PUT', { user_ns: ns, ...update }),
    markAttempted: claim => updateClaim(claim, { status: 'attempted' }),
    send: payload => chatby('/subscriber/send-whatsapp-template', 'POST', payload),
    finish: (claim, { mid, recovery_external_send_started, ...patch }) => updateClaim(claim, { ...patch, raw: { ...claim.raw,
      ...(recovery_external_send_started !== undefined ? { recovery_external_send_started } : {}),
      ...(mid ? { verification: { mid, accepted_by_whatsapp: true } } : {}) } })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  try {
    const result = await recoverOneInitialTemplate({ orderId: arg('--order-id'),
      authorizedOrderId: arg('--authorized-order-id'), execute: process.argv.includes('--execute'), api: liveApi() });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, reason: /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'SANITIZED_RECOVERY_FAILURE' }));
    process.exitCode = 1;
  }
}
