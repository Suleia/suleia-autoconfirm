import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { sendTelegramMessage } from '../clients/telegram.mjs';
import { buildDashboard, saveAgentChat } from '../dashboard.mjs';
import { getAdAccountSummary, getCampaignInsights, getCampaigns } from '../clients/meta.mjs';
import { listDropeaOrdersByStatusWithPagination } from '../clients/dropea.mjs';
import { listRecentShopifyOrders } from '../clients/shopify.mjs';
import { syncPendingIncidents } from './incidents.mjs';
import { loadOperationalOrdersCache, syncOperationalOrders } from './operational-orders.mjs';
import { runUnansweredCancellationSweep } from './unanswered-cancellations.mjs';
import { loadState } from '../storage.mjs';

const config = getAppConfig();
const telegramLogPath = path.join(config.dataDir, 'dashboard', 'telegram-agent-log.json');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanReplyText(value) {
  return String(value || '')
    .replace(/\u00c3\u00b1/g, 'n')
    .replace(/\u00c3\u00a1/g, 'a')
    .replace(/\u00c3\u00a9/g, 'e')
    .replace(/\u00c3\u00ad/g, 'i')
    .replace(/\u00c3\u00b3/g, 'o')
    .replace(/\u00c3\u00ba/g, 'u')
    .replace(/\u00c3\u0091/g, 'N')
    .replace(/\u00c3\u0081/g, 'A')
    .replace(/\u00c3\u0089/g, 'E')
    .replace(/\u00c3\u008d/g, 'I')
    .replace(/\u00c3\u0093/g, 'O')
    .replace(/\u00c3\u009a/g, 'U');
}

function messageFromUpdate(update = {}) {
  return update.message || update.edited_message || null;
}

function senderFromMessage(message = {}) {
  return message.from || {};
}

function usernameAllowed(username) {
  const clean = normalize(username).replace(/^@/, '');
  if (!config.telegramAllowedUsernames?.length) return false;
  return config.telegramAllowedUsernames.map(normalize).includes(clean);
}

function chatAllowed(chatId) {
  if (!config.telegramAllowedChatIds?.length) return false;
  return config.telegramAllowedChatIds.map(String).includes(String(chatId));
}

function isAuthorizedTelegramMessage(message = {}) {
  const from = senderFromMessage(message);
  const chatId = message.chat?.id;
  return chatAllowed(chatId) || usernameAllowed(from.username);
}

function formatEuros(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(2).replace('.', ',')} EUR`;
}

function moneyFromMetaCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num / 100;
}

function shortDate(value) {
  if (!value) return 'sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return todayKey(date);
}

function orderCreatedAt(order) {
  return order.raw?.created_at || order.raw?.createdAt || order.createdAt || order.created_at || order.date || order.updatedAt || null;
}

function orderStatusLabel(status) {
  const clean = normalize(status);
  if (clean.includes('pending')) return 'pendiente';
  if (clean.includes('incid')) return 'con incidencia';
  if (clean.includes('confirm')) return 'confirmado';
  if (clean.includes('paid') || clean.includes('pagado')) return 'pagado';
  if (clean.includes('fulfilled')) return 'preparado/enviado';
  if (clean.includes('cancel') || clean.includes('reject')) return 'cancelado/rechazado';
  return status || 'sin estado';
}

function telegramKeyboard() {
  return {
    keyboard: [
      [{ text: 'Estado' }, { text: 'Pedidos de hoy' }],
      [{ text: 'Incidencias' }, { text: 'Meta hoy' }],
      [{ text: 'Cancelaciones 36h' }, { text: 'Ideas para escalar' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function appendTelegramLog(item) {
  const log = await readJson(telegramLogPath, []);
  log.push({
    ...item,
    createdAt: new Date().toISOString()
  });
  await writeJson(telegramLogPath, log.slice(-500));
}

function helpText(chatId) {
  return [
    'Suleia Command Center por Telegram.',
    '',
    'Puedes hablarme normal. Ejemplos:',
    'Como va el negocio hoy?',
    'Cuantos pedidos han entrado hoy?',
    'Como van las campanas de Meta hoy?',
    'Que incidencias necesitan accion?',
    'Ha cancelado algo el automatismo de 36h?',
    '',
    'Tambien tienes botones rapidos abajo. Si pides una accion critica, la ejecutare solo si la intencion es clara.',
    `Chat ID seguro: ${chatId}`
  ].join('\n');
}

function dashboardStatusText(dashboard, health = {}) {
  const finance = dashboard.finance || {};
  const operational = dashboard.operationalOrders || {};
  const incidents = dashboard.incidents || {};
  const meta = dashboard.meta || {};
  return [
    'Estado Suleia',
    '',
    `Pedidos operativos: ${operational.count ?? 0}`,
    `Confirmados por cliente: ${operational.confirmedByCustomer ?? 0}`,
    `Incidencias pendientes: ${incidents.count ?? incidents.incidents?.length ?? 0}`,
    `Beneficio final: ${formatEuros(finance.finalProfit)}`,
    `Meta: ${meta.status || health.metaStatus || 'sin dato'}`,
    '',
    `Ultima sync incidencias: ${shortDate(health.lastIncidentsSyncAt || incidents.updatedAt)}`,
    `Ultima sync pedidos: ${shortDate(health.lastOperationalOrdersSyncAt || operational.updatedAt)}`
  ].join('\n');
}

function incidentsText(result, dashboard) {
  const incidents = dashboard.incidents || {};
  const rows = Array.isArray(incidents.incidents) ? incidents.incidents : [];
  const withResponse = rows.filter((item) => item.customerResponded || Number(item.customerMessages) > 0).length;
  const absent = rows.filter((item) => normalize(item.issueType || item.reason).includes('ausente')).length;
  const address = rows.filter((item) => normalize(item.issueType || item.reason).includes('direccion') || normalize(item.issueType || item.reason).includes('datos')).length;
  const rejected = rows.filter((item) => normalize(item.issueType || item.reason).includes('no acepta')).length;
  const top = rows.slice(0, 5).map((item) => `#${item.orderId} / inc ${item.incidenceId || '-'} / ${item.issueType || item.reason || '-'} / ${item.customerName || '-'}`);
  return [
    'Incidencias sincronizadas',
    '',
    `Resultado: ${result?.count ?? rows.length} pendientes`,
    `Con respuesta del cliente: ${withResponse}`,
    `Ausente: ${absent}`,
    `Direccion/datos: ${address}`,
    `No acepta mercancia: ${rejected}`,
    '',
    'Primeras incidencias:',
    ...(top.length ? top : ['Sin incidencias para mostrar.'])
  ].join('\n');
}

function ordersText(result, dashboard) {
  const operational = dashboard.operationalOrders || {};
  const orders = Array.isArray(operational.orders) ? operational.orders : [];
  const confirmed = orders.filter((item) => item.customerConfirmed).length;
  const replied = orders.filter((item) => Number(item.customerMessages) > 0).length;
  const top = orders.slice(0, 6).map((item) => {
    const signal = item.customerActionLabel || item.customerSignalLabel || item.customerSignal || 'sin senal';
    return `#${item.orderId} / ${item.customerName || '-'} / ${signal} / ${item.agentUsefulConfidence ?? item.agentConfidence ?? '-'}%`;
  });
  return [
    'Pedidos operativos sincronizados',
    '',
    `Resultado: ${result?.count ?? orders.length} pedidos`,
    `Confirmados por cliente: ${confirmed}`,
    `Con respuesta/accion en Chatby: ${replied}`,
    '',
    'Primeros pedidos:',
    ...(top.length ? top : ['Sin pedidos operativos para mostrar.'])
  ].join('\n');
}

function normalizeInternalOrder(order = {}) {
  return {
    orderId: String(order.orderId || order.name || order.id || ''),
    status: order.status || order.financialStatus || order.dropeaStatus || 'sin estado',
    orderAmount: Number(order.orderAmount ?? order.totalAmount ?? order.amount ?? 0) || null,
    customerName: order.customerName || order.customer || '',
    createdAt: order.createdAt || order.raw?.created_at || order.updatedAt || null,
    source: order.raw?.source || order.source || 'Historico interno',
    raw: order.raw || order
  };
}

function normalizeShopifyTodayOrder(order = {}) {
  return {
    orderId: String(order.name || order.id || ''),
    status: order.financialStatus || order.fulfillmentStatus || 'Shopify',
    orderAmount: Number(order.totalAmount ?? 0) || null,
    customerName: order.customerName || '',
    createdAt: order.createdAt || null,
    source: 'Shopify',
    raw: order.raw || order
  };
}

function normalizeDropeaTodayOrder(order = {}) {
  return {
    ...order,
    source: 'Dropea'
  };
}

const todayDropeaStatuses = [
  'PENDING',
  'REVIEW',
  'CONFIRMED',
  'PREPARING',
  'PREPARED',
  'CHARGED',
  'INCIDENCE',
  'TRANSIT',
  'SHIPPED',
  'CANCELLED',
  'REJECTED'
];

function filterTodayOrders(orders = [], key = todayKey()) {
  const byId = new Map();
  for (const order of orders) {
    if (dateKey(orderCreatedAt(order)) === key && order.orderId) {
      byId.set(String(order.orderId), order);
    }
  }
  return [...byId.values()]
    .sort((a, b) => String(b.orderId).localeCompare(String(a.orderId), undefined, { numeric: true }));
}

async function collectTodayDropeaOrders({ key, limit = 100 } = {}) {
  const byId = new Map();

  for (const status of todayDropeaStatuses) {
    try {
      const firstPage = await listDropeaOrdersByStatusWithPagination({ status, limit, page: 1 });
      const pages = new Set([1]);
      const lastPage = Number(firstPage.pagination?.lastPage || 1);
      for (let page = Math.max(1, lastPage - 2); page <= lastPage; page += 1) {
        pages.add(page);
      }

      for (const page of pages) {
        const payload = page === 1 ? firstPage : await listDropeaOrdersByStatusWithPagination({ status, limit, page });
        for (const order of filterTodayOrders(payload.orders.map(normalizeDropeaTodayOrder), key)) {
          byId.set(String(order.orderId), order);
        }
      }
    } catch {
      // Dropea may hide empty/unused states depending on the account. Other states remain useful.
    }
  }

  return [...byId.values()]
    .sort((a, b) => String(b.orderId).localeCompare(String(a.orderId), undefined, { numeric: true }));
}

function buildTodayOrdersSummaryPayload({ key, orders, sources, primarySource }) {
  const statuses = orders.reduce((acc, order) => {
    const label = orderStatusLabel(order.status);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  return {
    date: key,
    count: orders.length,
    totalAmount: orders.reduce((sum, order) => sum + (Number(order.orderAmount) || 0), 0),
    statuses,
    orders,
    sources,
    primarySource
  };
}

async function todayOrdersSummary({ maxPages = 4 } = {}) {
  const key = todayKey();
  const sources = [];

  try {
    const rows = await listRecentShopifyOrders({ first: 100 });
    const shopifyOrders = filterTodayOrders(rows.map(normalizeShopifyTodayOrder), key);
    sources.push({ name: 'Shopify', ok: true, count: shopifyOrders.length });
    if (shopifyOrders.length) {
      return buildTodayOrdersSummaryPayload({ key, orders: shopifyOrders, sources, primarySource: 'Shopify' });
    }
  } catch (error) {
    sources.push({ name: 'Shopify', ok: false, count: null, error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const rows = readJson(config.ordersPath, []);
    const internalOrders = filterTodayOrders((Array.isArray(rows) ? rows : []).map(normalizeInternalOrder), key);
    sources.push({ name: 'Historico interno', ok: true, count: internalOrders.length });
    if (internalOrders.length) {
      return buildTodayOrdersSummaryPayload({ key, orders: internalOrders, sources, primarySource: 'Historico interno' });
    }
  } catch (error) {
    sources.push({ name: 'Historico interno', ok: false, count: null, error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const dropeaOrders = await collectTodayDropeaOrders({ key, limit: 100, maxPages });
    sources.push({ name: 'Dropea por estados', ok: true, count: dropeaOrders.length });
    return buildTodayOrdersSummaryPayload({ key, orders: dropeaOrders, sources, primarySource: 'Dropea por estados' });
  } catch (error) {
    sources.push({ name: 'Dropea por estados', ok: false, count: null, error: error instanceof Error ? error.message : String(error) });
    return buildTodayOrdersSummaryPayload({ key, orders: [], sources, primarySource: 'sin fuente disponible' });
  }
}

function todayOrdersText(summary, operational = null) {
  const statusLines = Object.entries(summary.statuses || {})
    .map(([status, count]) => `${status}: ${count}`);
  const sourceLines = (summary.sources || []).map((source) => {
    if (source.ok) return `${source.name}: ${source.count}`;
    return `${source.name}: no disponible`;
  });
  const top = summary.orders.slice(0, 8).map((order) => `#${order.orderId} / ${order.customerName || '-'} / ${formatEuros(order.orderAmount)} / ${orderStatusLabel(order.status)} / ${order.source || summary.primarySource}`);
  return [
    `Pedidos de hoy (${summary.date})`,
    '',
    `Total ventas hoy: ${summary.count}`,
    `Fuente usada: ${summary.primarySource}`,
    `Importe bruto: ${formatEuros(summary.totalAmount)}`,
    ...(sourceLines.length ? ['Fuentes revisadas:', ...sourceLines] : []),
    ...(statusLines.length ? ['Estados:', ...statusLines] : []),
    '',
    operational ? `Cola operativa del agente: ${operational.count ?? 0} pedidos pendientes/incidencia` : '',
    operational ? 'Nota: la cola operativa no es el total de ventas de hoy; son pedidos donde el agente puede actuar.' : '',
    '',
    'Ultimos pedidos de hoy:',
    ...(top.length ? top : ['Todavia no veo pedidos de hoy en las fuentes conectadas.'])
  ].filter(Boolean).join('\n');
}

function campaignBudget(campaign = {}) {
  const daily = moneyFromMetaCents(campaign.daily_budget);
  if (daily !== null) return daily;
  const lifetime = moneyFromMetaCents(campaign.lifetime_budget);
  if (lifetime !== null) return lifetime;
  return null;
}

async function metaTodaySummary() {
  if (!config.metaDashboardEnabled) {
    return { ok: false, error: 'Meta no esta configurado en Render.' };
  }
  const today = todayKey();
  const [account, campaignsResult, insights] = await Promise.all([
    getAdAccountSummary(),
    getCampaigns({ limit: 200, includeBudgetFields: true })
      .catch(() => getCampaigns({ limit: 200 })),
    getCampaignInsights({ since: today, until: today, level: 'campaign', limit: 200 })
  ]);
  const campaigns = Array.isArray(campaignsResult) ? campaignsResult : [];
  const campaignById = new Map(campaigns.map((campaign) => [String(campaign.id), campaign]));
  const activeCampaigns = campaigns.filter((campaign) => ['ACTIVE', 'IN_PROCESS'].includes(String(campaign.effective_status || campaign.status || '').toUpperCase()));
  const rows = insights
    .map((insight) => {
      const campaign = campaignById.get(String(insight.campaignId)) || {};
      return {
        ...insight,
        status: campaign.effective_status || campaign.status || 'sin estado',
        budget: campaignBudget(campaign),
        budgetRemaining: moneyFromMetaCents(campaign.budget_remaining),
        objective: campaign.objective || ''
      };
    })
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  return {
    ok: true,
    date: today,
    account,
    campaigns,
    activeCampaigns,
    rows,
    totals: {
      spend: rows.reduce((sum, item) => sum + (Number(item.spend) || 0), 0),
      purchases: rows.reduce((sum, item) => sum + (Number(item.purchases) || 0), 0),
      purchaseValue: rows.reduce((sum, item) => sum + (Number(item.purchaseValue) || 0), 0)
    }
  };
}

function metaTodayText(summary) {
  if (!summary.ok) return `No puedo leer Meta ahora mismo: ${summary.error}`;
  const rows = summary.rows.filter((row) => Number(row.spend || 0) > 0 || ['ACTIVE', 'IN_PROCESS'].includes(String(row.status).toUpperCase()));
  const top = rows.slice(0, 10).map((row) => {
    const roas = Number.isFinite(Number(row.roas)) ? `${Number(row.roas).toFixed(2)}x` : '-';
    const cpa = row.costPerPurchase === null || row.costPerPurchase === undefined ? '-' : formatEuros(row.costPerPurchase);
    const budget = row.budget === null || row.budget === undefined ? 'sin presupuesto campaña' : `${formatEuros(row.budget)}/dia`;
    return [
      row.campaignName,
      `Estado: ${row.status}`,
      `Gasto hoy: ${formatEuros(row.spend)} / Presupuesto: ${budget}`,
      `Compras: ${row.purchases || 0} / ROAS: ${roas} / CPA: ${cpa}`
    ].join('\n');
  });
  const roasTotal = summary.totals.spend ? summary.totals.purchaseValue / summary.totals.spend : 0;
  return [
    `Meta Ads hoy (${summary.date})`,
    '',
    `Cuenta: ${summary.account?.name || summary.account?.id || '-'}`,
    `Campanas activas: ${summary.activeCampaigns.length}`,
    `Gasto total hoy: ${formatEuros(summary.totals.spend)}`,
    `Compras Meta hoy: ${summary.totals.purchases}`,
    `ROAS Meta total: ${roasTotal ? `${roasTotal.toFixed(2)}x` : '-'}`,
    '',
    'Campanas:',
    ...(top.length ? top.flatMap((item, index) => [`${index + 1}. ${item}`, '']) : ['Sin gasto ni campañas activas detectadas hoy.'])
  ].join('\n').trim();
}

function scalingIdeasText() {
  return [
    'Ideas para escalar Suleia',
    '',
    '1. Bot Telegram como copiloto diario: resumen automatico cada manana con pedidos, incidencias, Meta y caja.',
    '2. Alertas proactivas: avisarme si una campana gasta mas de X sin compras o si ROAS cae por debajo de objetivo.',
    '3. Agente de incidencias: primero propone resolucion, luego con tu aprobacion podra escribir en Dropea.',
    '4. Base de datos Supabase: guardar historico de pedidos, conversaciones, feedback, decisiones y metricas Meta sin depender de cache de Render.',
    '5. Panel de rentabilidad por producto: Meta + Dropea + coste producto + incidencias + tasa de confirmacion.',
    '6. Radar de productos: Meta Ads Library + Alibaba + margen estimado + saturacion del mercado espanol.',
    '7. Alertas de duplicados/fraude: telefonos repetidos, clientes vetados, patrones de rechazo o no entrega.',
    '',
    'Mi recomendacion: siguiente paso, Supabase como fuente historica central. Render ejecuta, Supabase recuerda.'
  ].join('\n');
}

function cancellationsText() {
  const state = loadState();
  const summary = state.lastUnansweredCancellationSweepSummary || {};
  const automatic = Array.isArray(state.automaticUnansweredCancellations)
    ? state.automaticUnansweredCancellations.slice(-10)
    : [];
  const blocked = Array.isArray(state.automaticBlockedCustomerCancellations)
    ? state.automaticBlockedCustomerCancellations.slice(-10)
    : [];
  return [
    'Automatismo 36h',
    '',
    `Ultimo barrido: ${shortDate(state.lastUnansweredCancellationSweepAt)}`,
    `Error: ${state.lastUnansweredCancellationSweepError || 'ninguno'}`,
    `Revisados: ${summary.checked ?? 0}`,
    `Cancelados 36h: ${summary.cancelled ?? 0}`,
    `Saltados: ${summary.skipped ?? 0}`,
    '',
    'Ultimas cancelaciones 36h:',
    ...(automatic.length ? automatic.map((item) => `#${item.orderId} / ${shortDate(item.cancelledAt)} / ${item.elapsedHours ?? '-'}h`) : ['Sin cancelaciones automaticas 36h registradas.']),
    '',
    'Clientes bloqueados:',
    ...(blocked.length ? blocked.map((item) => `#${item.orderId} / ${shortDate(item.cancelledAt)}`) : ['Sin cancelaciones por cliente bloqueado registradas.'])
  ].join('\n');
}

async function buildSafeDashboard(health) {
  try {
    return await buildDashboard({ health });
  } catch {
    return {};
  }
}

async function replyForText(text, health = {}) {
  const clean = normalize(text);
  if (!clean || clean === '/start' || clean === '/ayuda' || clean === '/help') return null;

  if (clean === '/estado' || clean === 'estado' || clean === '/status' || clean.includes('estado del sistema') || clean.includes('como va el negocio')) {
    const dashboard = await buildSafeDashboard(health);
    return dashboardStatusText(dashboard, health);
  }

  if (clean === '/incidencias' || clean === 'incidencias' || clean.includes('refresca incidencias') || clean.includes('sincroniza incidencias') || clean.includes('incidencias pendientes')) {
    const result = await syncPendingIncidents();
    const dashboard = await buildSafeDashboard(health);
    return incidentsText(result, dashboard);
  }

  if (clean === '/pedidos' || clean === 'pedidos' || clean.includes('pedidos de hoy') || clean.includes('cuantos pedidos') || clean.includes('pedido hoy') || clean.includes('han entrado hoy') || clean.includes('ventas hoy') || clean.includes('ventas de hoy') || clean.includes('hasta ahora')) {
    const summary = await todayOrdersSummary();
    return todayOrdersText(summary, loadOperationalOrdersCache());
  }

  if (clean.includes('cola operativa') || clean.includes('pendientes de confirmar') || clean.includes('pedidos operativos') || clean.includes('sincroniza pedidos')) {
    const result = await syncOperationalOrders();
    const dashboard = await buildSafeDashboard(health);
    return ordersText(result, dashboard);
  }

  if (clean === '/meta' || clean === 'meta hoy' || clean.includes('campanas') || clean.includes('campaña') || clean.includes('campana activa') || clean.includes('campanas activas') || clean.includes('roas') || clean.includes('gasto meta') || clean.includes('presupuesto') || clean.includes('compras meta')) {
    return metaTodayText(await metaTodaySummary());
  }

  if (clean === '/cancelaciones' || clean === 'cancelaciones 36h' || clean.includes('cancelaciones automaticas') || clean.includes('automatismo 36')) {
    return cancellationsText();
  }

  if (clean === '/barrido36' || clean === '/barrido_36' || clean.includes('ejecuta barrido 36')) {
    const result = await runUnansweredCancellationSweep({ store: config.defaultStore });
    const cancelled = result.results?.filter((item) => item.action === 'cancelled_unanswered' || item.action === 'cancelled_blocked_customer') || [];
    return [
      'Barrido 36h ejecutado.',
      '',
      `Pedidos revisados: ${result.processed ?? result.results?.length ?? 0}`,
      `Cancelados: ${cancelled.length}`,
      ...(cancelled.length ? cancelled.map((item) => `#${item.orderId} / ${item.action}`) : ['No habia pedidos cancelables segun la regla.'])
    ].join('\n');
  }

  if (clean.includes('ideas') || clean.includes('escalar') || clean.includes('mejoras') || clean.includes('supabase')) {
    return scalingIdeasText();
  }

  const chat = await saveAgentChat(`[Telegram] ${text}`, health);
  return chat.reply?.text || 'He guardado tu mensaje, pero no he podido generar respuesta.';
}

export async function handleTelegramUpdate(update, { health = {} } = {}) {
  const message = messageFromUpdate(update);
  if (!message?.chat?.id) return { accepted: true, ignored: true, reason: 'no_message' };

  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  const from = senderFromMessage(message);

  if (!isAuthorizedTelegramMessage(message)) {
    await appendTelegramLog({
      chatId,
      username: from.username || null,
      authorized: false,
      text
    });
    await sendTelegramMessage({
      chatId,
      replyToMessageId: message.message_id,
      text: 'Acceso no autorizado. Este bot esta restringido a Samuel.'
    });
    return { accepted: true, authorized: false };
  }

  let reply;
  if (!text || text === '/start' || normalize(text) === '/ayuda' || normalize(text) === '/help') {
    reply = helpText(chatId);
  } else {
    reply = await replyForText(text, health);
  }

  await appendTelegramLog({
    chatId,
    username: from.username || null,
    authorized: true,
    text,
    reply
  });

  await sendTelegramMessage({
    chatId,
    replyToMessageId: message.message_id,
    text: cleanReplyText(reply || helpText(chatId)),
    replyMarkup: telegramKeyboard()
  });

  return { accepted: true, authorized: true };
}
