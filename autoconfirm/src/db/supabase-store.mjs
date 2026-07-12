import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { ensureDir, readJson, writeJson } from '../lib/files.mjs';
import { insertRows, isSupabaseEnabled, selectRows, supabaseStatus, upsertRows } from '../clients/supabase.mjs';

const config = getAppConfig();

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, max = 1000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) : text;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === '') return null;
  return Boolean(value);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bestId(prefix = 'row') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(value) {
  if (value === undefined) return null;
  return value;
}

function logSupabaseMirrorError(scope, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Supabase mirror error (${scope}):`, message);
}

export function getSupabaseMirrorStatus() {
  return supabaseStatus();
}

export async function testSupabaseConnection() {
  const status = supabaseStatus();
  if (!status.configured) return { ok: false, ...status };
  try {
    await selectRows('app_state', { query: { select: 'key', limit: 1 }, limit: 1 });
    return { ok: true, ...status };
  } catch (error) {
    return { ok: false, ...status, error: error instanceof Error ? error.message : String(error) };
  }
}

function orderRow(order = {}) {
  const raw = order.raw || {};
  const createdAtSource = order.createdAtSource
    || order.created_at
    || order.createdAt
    || raw.created_at
    || raw.createdAt
    || raw.date
    || null;
  return {
    order_id: String(order.orderId || order.id || raw.id || raw.order_id || '').trim(),
    store_id: String(order.storeId || config.defaultStore.id || 'suleia'),
    status: cleanText(order.status || raw.status || raw.order_status || ''),
    customer_name: cleanText(order.customerName || order.customer || raw.customer?.full_name || raw.customer?.name || '', 250),
    customer_phone: cleanText(order.customerPhone || order.phone || raw.customer?.phone || '', 80),
    customer_email: cleanText(order.customerEmail || raw.customer?.email || '', 250),
    order_amount: numberOrNull(order.orderAmount ?? order.amount ?? raw.total ?? raw.total_price),
    currency_code: cleanText(order.currencyCode || raw.currency || 'EUR', 20),
    product: cleanText(order.product || raw.product || raw.product_name || '', 300),
    chatby_user_ns: cleanText(order.chatbyUserNs || raw.chatby_user_ns || '', 120),
    agent_intent: cleanText(order.aiIntent || order.agentIntent || '', 120),
    agent_confidence: numberOrNull(order.aiConfidence ?? order.agentConfidence),
    confirmation_source: cleanText(order.confirmationSource || '', 120),
    confirmed_at: isoOrNull(order.confirmedAt),
    cancelled_at: isoOrNull(order.cancelledAt),
    created_at_source: isoOrNull(createdAtSource),
    raw: safeJson(order),
    updated_at: nowIso()
  };
}

export async function syncOrderToSupabase(order) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const row = orderRow(order);
  if (!row.order_id) return { skipped: true, reason: 'missing_order_id' };
  return upsertRows('orders', row, { onConflict: 'order_id' });
}

export async function syncOrdersToSupabase(orders = []) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(orders) ? orders : [])
    .map(orderRow)
    .filter((row) => row.order_id);
  if (!rows.length) return { skipped: true, reason: 'no_orders' };
  return upsertRows('orders', rows, { onConflict: 'order_id' });
}

export async function syncAppStateToSupabase(state = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('app_state', {
    key: 'runtime_state',
    value: safeJson(state),
    updated_at: nowIso()
  }, { onConflict: 'key' });
}

export async function appendWebhookEventToSupabase(event = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('webhook_events', {
    id: event.id || bestId('evt'),
    source: cleanText(event.source || event.storeId || 'webhook', 120),
    event_id: cleanText(event.dedupeKey || event.eventId || event.id || '', 250),
    payload: safeJson(event),
    created_at: isoOrNull(event.createdAt) || nowIso()
  });
}

function deliveryKey({ storeId = 'suleia', orderId, templateName }) {
  const normalizedTemplate = String(templateName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${String(storeId || 'suleia')}|${String(orderId || '')}|${normalizedTemplate}`;
}

export async function claimTemplateDelivery({
  storeId = 'suleia',
  orderId,
  customerPhone = '',
  templateName,
  provider = '',
  chatbyUserNs = ''
} = {}) {
  if (!isSupabaseEnabled()) return { acquired: true, persistent: false, reason: 'supabase_not_configured' };
  const templateKey = deliveryKey({ storeId, orderId, templateName });
  const row = {
    template_key: templateKey,
    store_id: String(storeId || 'suleia'),
    order_id: String(orderId || ''),
    customer_phone: cleanText(customerPhone, 80),
    template_name: cleanText(templateName, 250),
    provider: cleanText(provider, 80),
    chatby_user_ns: cleanText(chatbyUserNs, 120),
    status: 'claimed',
    attempted_at: nowIso(),
    updated_at: nowIso()
  };

  try {
    const inserted = await insertRows('template_delivery_ledger', row, { returning: 'representation' });
    return { acquired: true, persistent: true, templateKey, row: Array.isArray(inserted) ? inserted[0] : inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/409|23505|duplicate key|unique constraint/i.test(message)) {
      const existing = await selectRows('template_delivery_ledger', {
        query: { template_key: `eq.${templateKey}`, limit: 1 },
        limit: 1
      });
      return { acquired: false, persistent: true, templateKey, existing: existing[0] || null, reason: 'already_claimed' };
    }
    throw error;
  }
}

export async function finishTemplateDelivery({
  storeId = 'suleia',
  orderId,
  customerPhone = '',
  templateName,
  provider = '',
  chatbyUserNs = '',
  status,
  attemptedAt,
  sentAt = null,
  lastError = null,
  raw = null
} = {}) {
  if (!isSupabaseEnabled()) return { skipped: true, reason: 'supabase_not_configured' };
  const templateKey = deliveryKey({ storeId, orderId, templateName });
  return upsertRows('template_delivery_ledger', {
    template_key: templateKey,
    store_id: String(storeId || 'suleia'),
    order_id: String(orderId || ''),
    customer_phone: cleanText(customerPhone, 80),
    template_name: cleanText(templateName, 250),
    provider: cleanText(provider, 80),
    chatby_user_ns: cleanText(chatbyUserNs, 120),
    status: cleanText(status || 'attempted', 80),
    attempted_at: isoOrNull(attemptedAt) || nowIso(),
    sent_at: isoOrNull(sentAt),
    last_error: cleanText(lastError || '', 1400) || null,
    raw: safeJson(raw),
    updated_at: nowIso()
  }, { onConflict: 'template_key' });
}

function operationalOrderRow(order = {}) {
  return {
    order_id: String(order.orderId || '').trim(),
    customer_name: cleanText(order.customer || order.customerName || '', 250),
    customer_phone: cleanText(order.phone || order.customerPhone || '', 80),
    created_at_source: isoOrNull(order.createdAt),
    dropea_status: cleanText(order.dropeaStatus || order.status || '', 120),
    customer_confirmed: boolOrNull(order.customerConfirmed),
    customer_messages: numberOrNull(order.customerMessages) || 0,
    customer_action_label: cleanText(order.customerActionLabel || '', 250),
    agent_action: cleanText(order.agentAction || '', 120),
    agent_intent: cleanText(order.agentIntent || '', 120),
    agent_confidence: numberOrNull(order.agentConfidence),
    raw: safeJson(order),
    updated_at: nowIso()
  };
}

export async function syncOperationalOrdersCacheToSupabase(payload = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(payload.orders) ? payload.orders : [])
    .map(operationalOrderRow)
    .filter((row) => row.order_id);
  const appState = upsertRows('app_state', {
    key: 'operational_orders_cache',
    value: safeJson(payload),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  return upsertRows('operational_orders', rows, { onConflict: 'order_id' });
}

function incidentRow(incident = {}) {
  return {
    incidence_id: String(incident.incidenceId || `${incident.orderId || 'order'}_${incident.reasonCode || incident.reason || 'incident'}`).trim(),
    order_id: String(incident.orderId || '').trim(),
    issue_type: cleanText(incident.incidentTypeLabel || incident.reason || incident.issueType || '', 250),
    issue_code: cleanText(incident.reasonCode || incident.rawReason || '', 80),
    status: cleanText(incident.issueStatus || '', 120),
    order_status: cleanText(incident.orderStatus || '', 120),
    customer_name: cleanText(incident.customerName || '', 250),
    customer_phone: cleanText(incident.phone || '', 80),
    created_at_source: isoOrNull(incident.incidenceDate),
    last_response_at: isoOrNull(incident.lastCustomerAt),
    customer_responded: boolOrNull(incident.customerResponded),
    customer_messages: numberOrNull(incident.customerMessages) || 0,
    context_summary: cleanText(incident.chatbySummary || incident.customerSignalDetail || '', 1200),
    proposed_solution: cleanText(incident.proposedSolution || incident.recommendedNextStep || '', 1400),
    operational_instruction: cleanText(incident.operationalInstruction || '', 1400),
    confidence: numberOrNull(incident.contextConfidence),
    priority: cleanText(incident.priority || '', 80),
    chatby_user_ns: cleanText(incident.chatbyUserNs || '', 120),
    raw: safeJson(incident),
    updated_at: nowIso()
  };
}

export async function syncIncidentsCacheToSupabase(payload = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(payload.incidents) ? payload.incidents : [])
    .map(incidentRow)
    .filter((row) => row.incidence_id && row.order_id);
  const appState = upsertRows('app_state', {
    key: 'incidents_cache',
    value: safeJson(payload),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  return upsertRows('incidents', rows, { onConflict: 'incidence_id' });
}

export async function syncAgentFeedbackToSupabase(item = {}, scope = 'order') {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('agent_feedback', {
    id: item.id || bestId('fb'),
    scope,
    entity_id: cleanText(item.orderId || item.incidenceId || item.entityId || '', 120),
    order_id: cleanText(item.orderId || '', 120),
    incidence_id: cleanText(item.incidenceId || '', 120),
    verdict: cleanText(item.verdict || '', 120),
    correction: cleanText(item.correction || '', 1400),
    note: cleanText(item.note || '', 1400),
    raw: safeJson(item),
    created_at: isoOrNull(item.createdAt) || nowIso()
  }, { onConflict: 'id' });
}

export async function syncAgentMemoryRuleToSupabase(rule = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('agent_memory_events', {
    id: rule.id || bestId('mem'),
    type: cleanText(rule.type || 'memory_rule', 120),
    source: cleanText(rule.source || '', 250),
    entity_id: cleanText(rule.orderId || rule.incidenceId || '', 120),
    content: cleanText(rule.text || rule.content || rule.note || '', 2000),
    raw: safeJson(rule),
    created_at: isoOrNull(rule.createdAt) || nowIso()
  }, { onConflict: 'id' });
}

const coreAgentMemoryRules = [
  {
    id: 'core_order_post_confirmation_cancel',
    type: 'order_operational_rule',
    source: 'suleia_core_logic',
    content: 'Una confirmacion inicial no prevalece si despues el cliente comunica que no quiere el pedido, quiere cancelarlo, anularlo o que se equivoco. Durante la espera operativa se debe cancelar en Dropea.'
  },
  {
    id: 'core_order_post_confirmation_promotion_change',
    type: 'order_operational_rule',
    source: 'suleia_core_logic',
    content: 'Si despues de confirmar el cliente solicita otra oferta, promocion o pack, se cancela el pedido actual y se le indica que realice una nueva compra mediante la URL del producto correspondiente.'
  },
  {
    id: 'core_incident_agent_training_only',
    type: 'incident_agent_guardrail',
    source: 'suleia_core_logic',
    content: 'El Agente de incidencias esta en modo entrenamiento y solo analiza Chatby, datos de Dropea, transportista y feedback. No resuelve incidencias ni envia mensajes automaticamente hasta autorizacion expresa.'
  }
];

export async function ensureCoreAgentMemory() {
  if (!isSupabaseEnabled()) return { skipped: true };
  const createdAt = nowIso();
  const rows = coreAgentMemoryRules.map((rule) => ({
    ...rule,
    entity_id: '',
    raw: rule,
    created_at: createdAt
  }));
  await upsertRows('agent_memory_events', rows, { onConflict: 'id' });
  return { ok: true, count: rows.length };
}

export async function syncAgentChatToSupabase(message = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('agent_memory_events', {
    id: message.id || bestId('chat'),
    type: 'agent_chat',
    source: cleanText(message.role || 'agent', 120),
    entity_id: '',
    content: cleanText(message.text || '', 3000),
    raw: safeJson(message),
    created_at: isoOrNull(message.createdAt) || nowIso()
  });
}

export async function syncTelegramLogToSupabase(item = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('telegram_messages', {
    id: item.id || bestId('tg'),
    chat_id: cleanText(item.chatId || '', 120),
    username: cleanText(item.username || '', 120),
    direction: cleanText(item.direction || 'inbound_outbound', 80),
    text: cleanText(item.text || '', 3000),
    reply: cleanText(item.reply || '', 3000),
    authorized: boolOrNull(item.authorized),
    raw: safeJson(item),
    created_at: isoOrNull(item.createdAt) || nowIso()
  });
}

function metaInsightRow(insight = {}, campaign = {}) {
  const dateStart = insight.date_start || insight.dateStart || insight.since || null;
  const campaignId = String(insight.campaignId || insight.campaign_id || campaign.id || '').trim();
  const adsetId = String(insight.adsetId || insight.adset_id || '').trim();
  const adId = String(insight.adId || insight.ad_id || '').trim();
  return {
    meta_row_id: [dateStart || 'unknown', campaignId || 'campaign', adsetId || 'adset', adId || 'ad'].join('|'),
    date_start: dateStart,
    date_stop: insight.date_stop || insight.dateStop || insight.until || dateStart,
    campaign_id: campaignId,
    campaign_name: cleanText(insight.campaignName || insight.campaign_name || campaign.name || '', 300),
    adset_id: adsetId || null,
    ad_id: adId || null,
    spend: numberOrNull(insight.spend),
    impressions: numberOrNull(insight.impressions),
    clicks: numberOrNull(insight.clicks),
    purchases: numberOrNull(insight.purchases),
    purchase_value: numberOrNull(insight.purchaseValue ?? insight.purchase_value),
    roas: numberOrNull(insight.roas),
    cpa: numberOrNull(insight.costPerPurchase ?? insight.cpa),
    raw: safeJson({ insight, campaign }),
    updated_at: nowIso()
  };
}

export async function syncMetaInsightsToSupabase({ insights = [], campaigns = [], account = null } = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const campaignById = new Map((Array.isArray(campaigns) ? campaigns : []).map((campaign) => [String(campaign.id), campaign]));
  const rows = (Array.isArray(insights) ? insights : [])
    .map((insight) => metaInsightRow(insight, campaignById.get(String(insight.campaignId || insight.campaign_id)) || {}))
    .filter((row) => row.campaign_id || row.campaign_name);
  const appState = upsertRows('app_state', {
    key: 'meta_dashboard_last_sync',
    value: safeJson({ account, insights: rows.length, updatedAt: nowIso() }),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  return upsertRows('meta_campaign_insights', rows, { onConflict: 'meta_row_id' });
}

export async function backfillSupabaseFromLocal() {
  if (!isSupabaseEnabled()) return { ok: false, skipped: true, status: supabaseStatus() };
  const dashboardDir = path.join(config.dataDir, 'dashboard');
  const result = {
    ok: true,
    startedAt: nowIso(),
    status: supabaseStatus(),
    mirrored: {}
  };

  try {
    const orders = readJson(config.ordersPath, []);
    await syncOrdersToSupabase(Array.isArray(orders) ? orders : []);
    result.mirrored.orders = Array.isArray(orders) ? orders.length : 0;
    let templateDeliveries = 0;
    for (const order of Array.isArray(orders) ? orders : []) {
      if (!order?.orderId || !order?.chatbyTemplateName || !order?.chatbyTemplateAttemptedAt) continue;
      await finishTemplateDelivery({
        storeId: order.storeId || config.defaultStore.id || 'suleia',
        orderId: order.orderId,
        customerPhone: order.customerPhone || '',
        templateName: order.chatbyTemplateName,
        provider: order.chatbyLastSendResponse?.provider || '',
        chatbyUserNs: order.chatbyUserNs || '',
        status: order.chatbyTemplateSendStatus || (order.chatbyTemplateSentAt ? 'sent' : 'attempted'),
        attemptedAt: order.chatbyTemplateAttemptedAt,
        sentAt: order.chatbyTemplateSentAt || null,
        lastError: order.chatbyTemplateLastError || null,
        raw: order.chatbyLastSendResponse || null
      });
      templateDeliveries += 1;
    }
    result.mirrored.templateDeliveries = templateDeliveries;
  } catch (error) {
    logSupabaseMirrorError('backfill_orders', error);
    result.mirrored.ordersError = error instanceof Error ? error.message : String(error);
  }

  try {
    const state = readJson(config.statePath, {});
    await syncAppStateToSupabase(state || {});
    result.mirrored.state = true;
  } catch (error) {
    logSupabaseMirrorError('backfill_state', error);
    result.mirrored.stateError = error instanceof Error ? error.message : String(error);
  }

  try {
    const operational = readJson(path.join(dashboardDir, 'operational-orders-cache.json'), {});
    await syncOperationalOrdersCacheToSupabase(operational || {});
    result.mirrored.operationalOrders = Array.isArray(operational?.orders) ? operational.orders.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_operational_orders', error);
    result.mirrored.operationalOrdersError = error instanceof Error ? error.message : String(error);
  }

  try {
    const incidents = readJson(path.join(dashboardDir, 'incidents-cache.json'), {});
    await syncIncidentsCacheToSupabase(incidents || {});
    result.mirrored.incidents = Array.isArray(incidents?.incidents) ? incidents.incidents.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_incidents', error);
    result.mirrored.incidentsError = error instanceof Error ? error.message : String(error);
  }

  try {
    const feedback = readJson(path.join(dashboardDir, 'agent-feedback.json'), []);
    for (const item of Array.isArray(feedback) ? feedback : []) {
      await syncAgentFeedbackToSupabase(item, 'order');
    }
    result.mirrored.agentFeedback = Array.isArray(feedback) ? feedback.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_agent_feedback', error);
    result.mirrored.agentFeedbackError = error instanceof Error ? error.message : String(error);
  }

  try {
    const feedback = readJson(path.join(dashboardDir, 'incident-feedback.json'), []);
    for (const item of Array.isArray(feedback) ? feedback : []) {
      await syncAgentFeedbackToSupabase(item, 'incident');
    }
    result.mirrored.incidentFeedback = Array.isArray(feedback) ? feedback.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_incident_feedback', error);
    result.mirrored.incidentFeedbackError = error instanceof Error ? error.message : String(error);
  }

  try {
    const memory = readJson(path.join(dashboardDir, 'agent-memory.json'), []);
    for (const item of Array.isArray(memory) ? memory : []) {
      await syncAgentMemoryRuleToSupabase(item);
    }
    result.mirrored.agentMemory = Array.isArray(memory) ? memory.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_agent_memory', error);
    result.mirrored.agentMemoryError = error instanceof Error ? error.message : String(error);
  }

  result.finishedAt = nowIso();
  return result;
}

function rowRaw(row, fallback = {}) {
  return row?.raw && typeof row.raw === 'object' ? row.raw : fallback;
}

function mergeById(localRows, remoteRows, idOf) {
  const merged = new Map();
  for (const row of Array.isArray(localRows) ? localRows : []) {
    const id = idOf(row);
    if (id) merged.set(String(id), row);
  }
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    const id = idOf(row);
    if (id) merged.set(String(id), row);
  }
  return [...merged.values()];
}

export async function hydrateLocalStateFromSupabase() {
  if (!isSupabaseEnabled()) return { ok: false, skipped: true, status: supabaseStatus() };

  const dashboardDir = path.join(config.dataDir, 'dashboard');
  ensureDir(dashboardDir);
  const result = { ok: true, startedAt: nowIso(), restored: {} };

  const [orderRows, stateRows, feedbackRows, memoryRows] = await Promise.all([
    selectRows('orders', { query: { order: 'updated_at.asc' }, limit: 5000 }),
    selectRows('app_state', { limit: 20 }),
    selectRows('agent_feedback', { query: { order: 'created_at.asc' }, limit: 5000 }),
    selectRows('agent_memory_events', { query: { order: 'created_at.asc' }, limit: 5000 })
  ]);

  if (orderRows.length) {
    const localOrders = readJson(config.ordersPath, []);
    const remoteOrders = orderRows.map((row) => ({
      ...rowRaw(row),
      orderId: String(row.order_id || rowRaw(row).orderId || ''),
      storeId: row.store_id || rowRaw(row).storeId || config.defaultStore.id,
      status: row.status || rowRaw(row).status || 'PENDING',
      customerName: row.customer_name || rowRaw(row).customerName || null,
      customerPhone: row.customer_phone || rowRaw(row).customerPhone || null,
      customerEmail: row.customer_email || rowRaw(row).customerEmail || null,
      chatbyUserNs: row.chatby_user_ns || rowRaw(row).chatbyUserNs || null
    }));
    const mergedOrders = mergeById(localOrders, remoteOrders, (item) => item.orderId);
    writeJson(config.ordersPath, mergedOrders);
    result.restored.orders = mergedOrders.length;
  }

  const stateByKey = new Map(stateRows.map((row) => [String(row.key), row.value]));
  const remoteRuntimeState = stateByKey.get('runtime_state');
  if (remoteRuntimeState && typeof remoteRuntimeState === 'object') {
    const localState = readJson(config.statePath, {});
    writeJson(config.statePath, { ...localState, ...remoteRuntimeState, hydratedFromSupabaseAt: nowIso() });
    result.restored.runtimeState = true;
  }

  for (const [key, filename] of [
    ['operational_orders_cache', 'operational-orders-cache.json'],
    ['incidents_cache', 'incidents-cache.json']
  ]) {
    const value = stateByKey.get(key);
    if (!value || typeof value !== 'object') continue;
    writeJson(path.join(dashboardDir, filename), value);
    result.restored[key] = true;
  }

  if (feedbackRows.length) {
    const orderFeedback = feedbackRows.filter((row) => row.scope === 'order').map((row) => rowRaw(row, row));
    const incidentFeedback = feedbackRows.filter((row) => row.scope === 'incident').map((row) => rowRaw(row, row));
    writeJson(path.join(dashboardDir, 'agent-feedback.json'), orderFeedback);
    writeJson(path.join(dashboardDir, 'incident-feedback.json'), incidentFeedback);
    result.restored.orderFeedback = orderFeedback.length;
    result.restored.incidentFeedback = incidentFeedback.length;
  }

  const learnedMemory = memoryRows
    .filter((row) => String(row.type || '') !== 'agent_chat')
    .map((row) => rowRaw(row, row));
  if (learnedMemory.length) {
    const localMemory = readJson(path.join(dashboardDir, 'agent-memory.json'), []);
    const mergedMemory = mergeById(localMemory, learnedMemory, (item) => item.id);
    writeJson(path.join(dashboardDir, 'agent-memory.json'), mergedMemory);
    result.restored.agentMemory = mergedMemory.length;
  }

  result.finishedAt = nowIso();
  return result;
}
