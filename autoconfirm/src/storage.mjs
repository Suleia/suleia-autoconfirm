import path from 'node:path';
import { readJson, writeJson } from './lib/files.mjs';
import { getAppConfig } from './config.mjs';
import {
  appendWebhookEventToSupabase,
  syncAppStateToSupabase,
  syncOrdersToSupabase
} from './db/supabase-store.mjs';

const config = getAppConfig();
const orderMirrorQueue = new Map();
const ORDER_MIRROR_BATCH_SIZE = 50;
const ORDER_MIRROR_DEBOUNCE_MS = 300;
const ORDER_MIRROR_RETRY_MS = 5000;
let orderMirrorTimer = null;
let orderMirrorRunning = false;
let ordersMemory = null;
let ordersPersistTimer = null;
let ordersPersistDirty = false;

function ensureOrdersMemory() {
  if (!Array.isArray(ordersMemory)) {
    const stored = readJson(config.ordersPath, []);
    ordersMemory = Array.isArray(stored) ? stored : [];
  }
  return ordersMemory;
}

function flushOrdersToDisk() {
  ordersPersistTimer = null;
  if (!ordersPersistDirty || !Array.isArray(ordersMemory)) return;
  ordersPersistDirty = false;
  writeJson(config.ordersPath, ordersMemory);
}

function scheduleOrdersPersist(delayMs = 300) {
  ordersPersistDirty = true;
  if (ordersPersistTimer) return;
  ordersPersistTimer = setTimeout(flushOrdersToDisk, delayMs);
  ordersPersistTimer.unref?.();
}

function orderMirrorKey(order = {}) {
  return `${String(order.storeId || config.defaultStore.id || 'suleia')}|${String(order.orderId || '')}`;
}

function scheduleOrderMirrorFlush(delayMs = ORDER_MIRROR_DEBOUNCE_MS) {
  if (orderMirrorTimer || orderMirrorRunning || !orderMirrorQueue.size) return;
  orderMirrorTimer = setTimeout(() => {
    orderMirrorTimer = null;
    flushOrderMirrorQueue().catch((error) => {
      console.error('Supabase order mirror queue error:', error instanceof Error ? error.message : String(error));
    });
  }, delayMs);
  orderMirrorTimer.unref?.();
}

async function flushOrderMirrorQueue() {
  if (orderMirrorRunning || !orderMirrorQueue.size) return;
  orderMirrorRunning = true;

  const batch = [...orderMirrorQueue.entries()].slice(0, ORDER_MIRROR_BATCH_SIZE);
  for (const [key] of batch) orderMirrorQueue.delete(key);

  try {
    await syncOrdersToSupabase(batch.map(([, order]) => order));
  } catch (error) {
    // Keep a newer queued version if the same order changed while this batch
    // was in flight. Otherwise restore the failed version for a later retry.
    for (const [key, order] of batch) {
      if (!orderMirrorQueue.has(key)) orderMirrorQueue.set(key, order);
    }
    console.error(
      `Supabase order mirror batch error (${batch.length} orders):`,
      error instanceof Error ? error.message : String(error)
    );
    orderMirrorRunning = false;
    scheduleOrderMirrorFlush(ORDER_MIRROR_RETRY_MS);
    return;
  }

  orderMirrorRunning = false;
  scheduleOrderMirrorFlush(orderMirrorQueue.size ? 25 : ORDER_MIRROR_DEBOUNCE_MS);
}

function queueOrderMirror(order) {
  if (!order?.orderId) return;
  orderMirrorQueue.set(orderMirrorKey(order), order);
  scheduleOrderMirrorFlush();
}

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
  return ensureOrdersMemory();
}

export function saveOrders(orders) {
  ordersMemory = Array.isArray(orders) ? orders : [];
  writeJson(config.ordersPath, ordersMemory);
  ordersPersistDirty = false;
  if (ordersPersistTimer) {
    clearTimeout(ordersPersistTimer);
    ordersPersistTimer = null;
  }
  syncOrdersToSupabase(ordersMemory).catch((error) => {
    console.error('Supabase orders mirror error:', error instanceof Error ? error.message : String(error));
  });
}

export function getStoreByWebhookToken(token) {
  return config.stores.find((store) => store.webhookToken === token) || null;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeRawRecords(previous, incoming) {
  if (incoming === undefined || incoming === null) return previous ?? null;
  if (!isPlainRecord(previous) || !isPlainRecord(incoming)) return incoming;

  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') {
      if (!(key in merged)) merged[key] = value;
      continue;
    }
    merged[key] = isPlainRecord(value) && isPlainRecord(previous[key])
      ? mergeRawRecords(previous[key], value)
      : value;
  }
  return merged;
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
    status: order.status || previous.status || 'PENDING',
    customerName: order.customerName || previous.customerName || null,
    customerPhone: order.customerPhone || previous.customerPhone || null,
    customerEmail: order.customerEmail || previous.customerEmail || null,
    orderAmount: order.orderAmount ?? previous.orderAmount ?? null,
    currencyCode: order.currencyCode || previous.currencyCode || 'EUR',
    chatbyUserNs: order.chatbyUserNs || previous.chatbyUserNs || null,
    aiConfidence: order.aiConfidence ?? previous.aiConfidence ?? null,
    aiIntent: order.aiIntent || previous.aiIntent || null,
    confirmationDelayStartedAt: order.confirmationDelayStartedAt || previous.confirmationDelayStartedAt || null,
    confirmationDueAt: order.confirmationDueAt || previous.confirmationDueAt || null,
    confirmationSource: order.confirmationSource || previous.confirmationSource || null,
    assistantCheckedAt: order.assistantCheckedAt || previous.assistantCheckedAt || null,
    confirmedAt: order.confirmedAt || previous.confirmedAt || null,
    cancelledAt: order.cancelledAt || previous.cancelledAt || null,
    timeoutCancellationEvaluatedAt: order.timeoutCancellationEvaluatedAt || previous.timeoutCancellationEvaluatedAt || null,
    lastAgentErrorAt: order.lastAgentErrorAt || previous.lastAgentErrorAt || null,
    lastAgentError: order.lastAgentError || previous.lastAgentError || null,
    chatbyTemplateSentAt: order.chatbyTemplateSentAt || previous.chatbyTemplateSentAt || null,
    chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || previous.chatbyTemplateAttemptedAt || null,
    chatbyTemplateName: order.chatbyTemplateName || previous.chatbyTemplateName || null,
    chatbyTemplateSendStatus: order.chatbyTemplateSendStatus || previous.chatbyTemplateSendStatus || null,
    chatbyTemplateLastError: order.chatbyTemplateLastError || previous.chatbyTemplateLastError || null,
    chatbyLastSendResponse: order.chatbyLastSendResponse || previous.chatbyLastSendResponse || null,
    chatbyConfirmationStateResetAt: order.chatbyConfirmationStateResetAt || previous.chatbyConfirmationStateResetAt || null,
    chatbyConfirmationStateResetError: order.chatbyConfirmationStateResetError ?? previous.chatbyConfirmationStateResetError ?? null,
    preparedTemplateSentAt: order.preparedTemplateSentAt || previous.preparedTemplateSentAt || null,
    preparedTemplateAttemptedAt: order.preparedTemplateAttemptedAt || previous.preparedTemplateAttemptedAt || null,
    preparedTemplateName: order.preparedTemplateName || previous.preparedTemplateName || null,
    preparedTemplateSendStatus: order.preparedTemplateSendStatus || previous.preparedTemplateSendStatus || null,
    preparedTemplateLastError: order.preparedTemplateLastError || previous.preparedTemplateLastError || null,
    preparedTemplateLastResponse: order.preparedTemplateLastResponse || previous.preparedTemplateLastResponse || null,
    operationalNote: order.operationalNote || previous.operationalNote || null,
    raw: mergeRawRecords(previous.raw, order.raw),
    updatedAt: now,
    createdAt: index >= 0 ? orders[index].createdAt : now,
    ...extras
  };

  if (index >= 0) {
    orders[index] = next;
  } else {
    orders.push(next);
  }

  // Keep the live process state immediately consistent while coalescing disk
  // and Supabase writes. Rewriting 500+ orders for every single upsert can
  // block Render's health endpoint during large reconciliation sweeps.
  scheduleOrdersPersist();
  queueOrderMirror(next);
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
