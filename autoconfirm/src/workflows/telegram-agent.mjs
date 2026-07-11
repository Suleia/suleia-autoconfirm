import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { sendTelegramMessage } from '../clients/telegram.mjs';
import { buildDashboard, saveAgentChat } from '../dashboard.mjs';
import { syncPendingIncidents } from './incidents.mjs';
import { syncOperationalOrders } from './operational-orders.mjs';
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
    'Puedes escribirme:',
    '/estado - resumen del sistema',
    '/pedidos - refresca pedidos operativos',
    '/incidencias - refresca incidencias pendientes',
    '/cancelaciones - resumen del automatismo 36h',
    '/barrido36 - ejecuta ahora el barrido real de 36h',
    '',
    'Tambien puedes hablar normal conmigo para preguntar, dar feedback o crear reglas.',
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

  if (clean === '/estado' || clean === 'estado' || clean === '/status' || clean.includes('estado del sistema')) {
    const dashboard = await buildSafeDashboard(health);
    return dashboardStatusText(dashboard, health);
  }

  if (clean === '/incidencias' || clean.includes('refresca incidencias') || clean.includes('sincroniza incidencias')) {
    const result = await syncPendingIncidents();
    const dashboard = await buildSafeDashboard(health);
    return incidentsText(result, dashboard);
  }

  if (clean === '/pedidos' || clean.includes('refresca pedidos') || clean.includes('sincroniza pedidos')) {
    const result = await syncOperationalOrders();
    const dashboard = await buildSafeDashboard(health);
    return ordersText(result, dashboard);
  }

  if (clean === '/cancelaciones' || clean.includes('cancelaciones automaticas') || clean.includes('automatismo 36')) {
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
    text: reply || helpText(chatId)
  });

  return { accepted: true, authorized: true };
}
