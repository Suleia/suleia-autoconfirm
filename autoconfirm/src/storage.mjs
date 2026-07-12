import path from 'node:path';
import { readJson, writeJson } from './lib/files.mjs';
import { getAppConfig } from './config.mjs';
import { appendWebhookEventToSupabase, syncAppStateToSupabase, syncOrdersToSupabase } from './db/supabase-store.mjs';

const config = getAppConfig();

function defaultState() {
  return {
    lastPollAt: null,
    lastAutoConfirmAt: null,
    lastSheetSyncAt: null,
    lastAutomationCycleAt: null,
    lastWebhookAt: null,
    lastWebhookError: null,
    chatbyInitialTemplateLedger: {}
  };
}

export function loadState() {
  return readJson(config.statePath, defaultState());
}

export function saveState(state) {
  writeJson(config.statePath, state);
  syncAppStateToSupabase(state).catch((error) => {
    console.error('Supabase state mirror error:', error instanceof Error ? error.message : String(error));
  });
}

export function loadWebhookEvents() {
  return readJson(config.webhookEventsPath, []);
}

export function saveWebhookEvents(events) {
  writeJson(config.webhookEventsPath, events);
}

export function loadOrders() {
  return readJson(config.ordersPath, []);
}

export function saveOrders(orders) {
  writeJson(config.ordersPath, orders);
  syncOrdersToSupabase(orders).catch((error) => {
    console.error('Supabase orders mirror error:', error instanceof Error ? error.message : String(error));
  });
}

export function getStoreByWebhookToken(token) {
  return config.stores.find((store) => store.webhookToken === token) || null;
}

export function upsertOrder(storeId, order, extras = {}) {
  const orders = loadOrders();
  const index = orders.findIndex((item) => item.storeId === storeId && item.orderId === order.orderId);
  const previous = index >= 0 ? orders[index] : {};
  const now = new Date().toISOString();
  const next = {
    id: index >= 0 ? orders[index].id : `order_${Math.random().toString(36).slice(2, 10)}`,
    storeId,
    orderId: order.orderId,
    status: order.status || 'PENDING',
    customerName: order.customerName || null,
    customerPhone: order.customerPhone || null,
    customerEmail: order.customerEmail || null,
    orderAmount: order.orderAmount ?? null,
    currencyCode: order.currencyCode || 'EUR',
    chatbyUserNs: order.chatbyUserNs || previous.chatbyUserNs || null,
    aiConfidence: order.aiConfidence ?? null,
    aiIntent: order.aiIntent || null,
    confirmationDelayStartedAt: order.confirmationDelayStartedAt || null,
    confirmationDueAt: order.confirmationDueAt || null,
    confirmationSource: order.confirmationSource || null,
    assistantCheckedAt: order.assistantCheckedAt || null,
    confirmedAt: order.confirmedAt || null,
    cancelledAt: order.cancelledAt || null,
    timeoutCancellationEvaluatedAt: order.timeoutCancellationEvaluatedAt || null,
    lastAgentErrorAt: order.lastAgentErrorAt || null,
    lastAgentError: order.lastAgentError || null,
    chatbyTemplateSentAt: order.chatbyTemplateSentAt || previous.chatbyTemplateSentAt || null,
    chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || previous.chatbyTemplateAttemptedAt || null,
    chatbyTemplateName: order.chatbyTemplateName || previous.chatbyTemplateName || null,
    chatbyTemplateSendStatus: order.chatbyTemplateSendStatus || previous.chatbyTemplateSendStatus || null,
    chatbyTemplateLastError: order.chatbyTemplateLastError || previous.chatbyTemplateLastError || null,
    chatbyLastSendResponse: order.chatbyLastSendResponse || previous.chatbyLastSendResponse || null,
    preparedTemplateSentAt: order.preparedTemplateSentAt || previous.preparedTemplateSentAt || null,
    preparedTemplateAttemptedAt: order.preparedTemplateAttemptedAt || previous.preparedTemplateAttemptedAt || null,
    preparedTemplateName: order.preparedTemplateName || previous.preparedTemplateName || null,
    preparedTemplateSendStatus: order.preparedTemplateSendStatus || previous.preparedTemplateSendStatus || null,
    preparedTemplateLastError: order.preparedTemplateLastError || previous.preparedTemplateLastError || null,
    preparedTemplateLastResponse: order.preparedTemplateLastResponse || previous.preparedTemplateLastResponse || null,
    operationalNote: order.operationalNote || null,
    raw: order.raw || null,
    updatedAt: now,
    createdAt: index >= 0 ? orders[index].createdAt : now,
    ...extras
  };

  if (index >= 0) {
    orders[index] = next;
  } else {
    orders.push(next);
  }

  saveOrders(orders);
  return next;
}

export function listOrders(filter = {}) {
  const orders = loadOrders();
  return orders.filter((order) => {
    if (filter.storeId && order.storeId !== filter.storeId) return false;
    if (filter.status && order.status !== filter.status) return false;
    if (filter.after && order.createdAt < filter.after) return false;
    return true;
  });
}

export function listPendingOrders(storeId) {
  return listOrders({ storeId, status: 'PENDING' });
}

export function findOrder(storeId, orderId) {
  return loadOrders().find((order) => order.storeId === storeId && order.orderId === orderId) || null;
}

export function recordWebhookEvent(storeId, dedupeKey, outcome) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const events = loadWebhookEvents().filter((event) => {
    const createdAt = new Date(event.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
  const existing = events.find((event) => event.storeId === storeId && event.dedupeKey === dedupeKey);
  if (existing) return existing;
  const event = {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    storeId,
    dedupeKey,
    outcome,
    createdAt: new Date().toISOString()
  };
  events.push(event);
  saveWebhookEvents(events);
  appendWebhookEventToSupabase(event).catch((error) => {
    console.error('Supabase webhook mirror error:', error instanceof Error ? error.message : String(error));
  });
  return event;
}

export function hasWebhookEvent(storeId, dedupeKey) {
  return loadWebhookEvents().some((event) => event.storeId === storeId && event.dedupeKey === dedupeKey);
}

export function hasRecentWebhookEvent(storeId, dedupeKey, windowMs = 60000) {
  const cutoff = Date.now() - windowMs;
  return loadWebhookEvents().some((event) => {
    if (event.storeId !== storeId || event.dedupeKey !== dedupeKey) return false;
    const createdAt = new Date(event.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}
