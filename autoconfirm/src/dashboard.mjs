import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppConfig } from './config.mjs';
import { listOrders, loadState } from './storage.mjs';
import { getDropeaOrderById, listPendingDropeaOrders } from './clients/dropea.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { getSheetRows, upsertSimulationDecision } from './clients/sheets.mjs';

const config = getAppConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dashboardDataDir = path.resolve(root, process.env.DASHBOARD_DATA_DIR || 'data/dashboard');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function numberFrom(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function rowObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map((header) => String(header || ''));
  return rows.slice(1)
    .filter((row) => Array.isArray(row) && row.some(Boolean))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

async function readSheet(sheetTitle) {
  try {
    const rows = await getSheetRows(sheetTitle, 'A:Z');
    return { ok: true, rows, source: `Google Sheet - ${sheetTitle}` };
  } catch (error) {
    return { ok: false, rows: [], source: `Google Sheet - ${sheetTitle}`, error: error instanceof Error ? error.message : String(error) };
  }
}

function guessProduct(order) {
  const raw = JSON.stringify(order.raw || order || '').toLowerCase();
  if (raw.includes('colla') || raw.includes('gum')) return 'Collagum';
  if (raw.includes('nida')) return 'NIDA premium';
  return 'Producto';
}

function orderFromSheet(row) {
  const orderId = row.orderId || row.pedido || row.id || '';
  return {
    orderId: String(orderId),
    customer: row.nombre || row.cliente || '',
    phone: row.telefono || row.phone || '',
    createdAt: row.fecha_creacion || row.created_at || '',
    status: row.estado || row.status || '',
    amount: numberFrom(row.importe || row.total || row.amount),
    issue: row.en_incidencia || '',
    issueCode: row.codigo_incidencia || '',
    note: row.nota_operativa || '',
    confirmedAt: row.fecha_confirmacion || '',
    product: row.producto || guessProduct(row)
  };
}

function orderFromLocal(order) {
  return {
    orderId: String(order.orderId || order.id || ''),
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.raw?.created_at || order.raw?.createdAt || order.createdAt || '',
    status: order.status || '',
    amount: Number(order.orderAmount) || null,
    issue: order.raw?.issues ? 'Si' : 'No',
    issueCode: order.raw?.issues?.incidence_code || '',
    note: order.operationalNote || '',
    confirmedAt: order.confirmedAt || '',
    product: guessProduct(order)
  };
}

function orderFromDropea(order) {
  return {
    orderId: String(order.orderId || ''),
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.raw?.created_at || order.raw?.createdAt || '',
    status: order.status || '',
    amount: Number(order.orderAmount) || null,
    issue: order.raw?.issues ? 'Si' : 'No',
    issueCode: order.raw?.issues?.incidence_code || '',
    note: '',
    confirmedAt: '',
    product: guessProduct(order),
    liveSource: 'Dropea'
  };
}

function decisionFromSheet(row) {
  return {
    date: row.fecha || '',
    orderId: String(row.orderId || ''),
    action: row.accion || '',
    intent: row.intent || '',
    confidence: numberFrom(row.confianza),
    source: row.fuente || '',
    message: row.mensaje_cliente || '',
    reason: row.motivo || '',
    dryRun: String(row.dry_run || '').toLowerCase() === 'true'
  };
}

function mergeOrders(sheetOrders, localOrders, liveOrders, decisions, feedback) {
  const byId = new Map();
  for (const order of localOrders) byId.set(order.orderId, order);
  for (const order of liveOrders) byId.set(order.orderId, { ...(byId.get(order.orderId) || {}), ...order });
  for (const order of sheetOrders) byId.set(order.orderId, { ...(byId.get(order.orderId) || {}), ...order });
  for (const decision of decisions) {
    const current = byId.get(decision.orderId);
    if (!current) continue;
    byId.set(decision.orderId, {
      ...current,
      agentAction: decision.action,
      agentIntent: decision.intent,
      agentConfidence: decision.confidence,
      agentReason: decision.reason,
      dryRun: decision.dryRun
    });
  }
  for (const item of feedback) {
    const current = byId.get(String(item.orderId));
    if (!current) continue;
    byId.set(String(item.orderId), {
      ...current,
      feedbackVerdict: item.verdict,
      feedbackCorrection: item.correction,
      feedbackNote: item.note,
      feedbackAt: item.createdAt
    });
  }
  return [...byId.values()].filter((order) => order.orderId);
}

function isCancelled(order) {
  const status = normalize(order.status);
  const action = normalize(order.agentAction);
  return status.includes('cancel') || status.includes('reject') || action.includes('not_confirm');
}

function isRecognizedSale(order) {
  if (isCancelled(order)) return false;
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);
  const action = normalize(order.agentAction);
  return status.includes('confirm') || intent === 'confirm' || action === 'would_confirm' || Boolean(order.confirmedAt);
}

function isManualReview(order) {
  return normalize(order.status).includes('manual_review') || normalize(order.status).includes('revision');
}

function latest(items, field, limit = 12) {
  return [...items]
    .sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')))
    .slice(0, limit);
}

function defaultFinanceSettings() {
  return {
    dropeaProfit: numberFrom(process.env.DROPEA_DASHBOARD_PROFIT) ?? 448.19,
    dropshipperId: process.env.DROPEA_DROPSHIPPER_ID || '17431',
    source: process.env.DROPEA_DASHBOARD_PROFIT ? 'env_dropea_dashboard_profit' : 'manual_dropea_dashboard',
    updatedAt: new Date().toISOString(),
    note: 'Beneficio neto indicado por Dropea, ya descontando transporte y stock.'
  };
}

async function loadFinanceSettings() {
  return readJson(path.join(dashboardDataDir, 'finance-settings.json'), defaultFinanceSettings());
}

function productCostForOrder(order) {
  const amount = Number(order.amount) || 0;
  if (amount === 24.99) return 8.5;
  if (amount === 34.99) return 12.5;
  if (amount === 29.99) return 10;
  return Number((amount * 0.35).toFixed(2));
}

function paymentCostForOrder(order) {
  const amount = Number(order.amount) || 0;
  return amount ? Number((amount * 0.014 + 0.25).toFixed(2)) : 0;
}

function calculateFinance({ orders, campaignRows, metaRows, financeSettings }) {
  const recognizedOrders = orders.filter(isRecognizedSale);
  const revenue = recognizedOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const productCost = recognizedOrders.reduce((sum, order) => sum + productCostForOrder(order), 0);
  const paymentFees = recognizedOrders.reduce((sum, order) => sum + paymentCostForOrder(order), 0);
  const spendRow = metaRows.find((row) => normalize(row.Metrica) === 'gasto meta');
  const metaSpend = numberFrom(spendRow?.Valor) || campaignRows.reduce((sum, row) => sum + (numberFrom(row.gasto) || 0), 0);
  const dropeaProfit = numberFrom(financeSettings?.dropeaProfit);
  const businessProfit = dropeaProfit !== null ? dropeaProfit - metaSpend : revenue - productCost - paymentFees - metaSpend;
  const attributedOrders = campaignRows.reduce((sum, row) => sum + (numberFrom(row.pedidos_dropea_atribuidos) || 0), 0);
  const warnings = [
    'El beneficio principal usa el beneficio neto marcado por Dropea y resta Meta.',
    !attributedOrders && metaSpend ? 'El gasto Meta no esta atribuido a pedidos concretos; se usa gasto del periodo disponible.' : null,
    dropeaProfit === null ? 'No hay beneficio Dropea disponible; se usa calculo alternativo.' : null
  ].filter(Boolean);

  return {
    recognizedOrders: recognizedOrders.length,
    revenue,
    productCost,
    paymentFees,
    metaSpend,
    dropeaProfit,
    businessProfit,
    netProfit: revenue - productCost - paymentFees - metaSpend,
    formula: 'Beneficio real = beneficio neto Dropea - gasto Meta',
    alternativeFormula: 'Alternativo = ingresos pedidos reconocidos - coste producto estimado - comisiones estimadas - gasto Meta',
    source: financeSettings?.source || 'unknown',
    sourceNote: financeSettings?.note || '',
    dropshipperId: financeSettings?.dropshipperId || '17431',
    warnings
  };
}

async function loadLiveDropeaOrders(knownOrderIds) {
  const source = { name: 'Dropea API - pedidos vivos', ok: true, error: null };
  const orders = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const pending = await listPendingDropeaOrders({ limit: 100, page });
      if (!Array.isArray(pending) || !pending.length) break;
      orders.push(...pending.map(orderFromDropea));
      if (pending.length < 100) break;
    }
    for (const orderId of [...new Set(knownOrderIds)].filter(Boolean).slice(0, 60)) {
      try {
        const order = await getDropeaOrderById(orderId);
        if (order) orders.push(orderFromDropea(order));
      } catch {
        // Keep dashboard available even if one old order cannot be hydrated.
      }
    }
  } catch (error) {
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
  }
  return { source, orders };
}

async function loadLiveMetaCampaigns() {
  const source = { name: 'Meta API - campanas en vivo', ok: true, error: null };
  try {
    const until = new Date().toISOString().slice(0, 10);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 7);
    const insights = await getCampaignInsights({ since: sinceDate.toISOString().slice(0, 10), until, limit: 100 });
    return {
      source,
      campaigns: insights.map((item) => ({
        campaign_id: item.campaignId,
        campana: item.campaignName,
        gasto: item.spend,
        impresiones: item.impressions,
        clicks: item.clicks,
        compras_pixel: item.purchases,
        roas_confirmado: ''
      }))
    };
  } catch (error) {
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
    return { source, campaigns: [] };
  }
}

function buildProducts(orders) {
  const products = new Map([
    ['NIDA premium', { name: 'NIDA premium', price: 34.99, cost: 12.5, status: 'Activo', orders: 0, revenue: 0 }],
    ['Collagum', { name: 'Collagum', price: 24.99, cost: 8.5, status: 'Test', orders: 0, revenue: 0 }]
  ]);
  for (const order of orders) {
    const name = order.product || 'Producto';
    const product = products.get(name) || { name, price: order.amount || 0, cost: 0, status: 'Detectado', orders: 0, revenue: 0 };
    product.orders += 1;
    product.revenue += Number(order.amount) || 0;
    products.set(name, product);
  }
  return [...products.values()].map((product) => ({
    ...product,
    margin: product.price ? Math.round(((product.price - product.cost) / product.price) * 100) : null
  }));
}

function moneyText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'sin dato';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(number);
}

function buildAgentReply({ message, dashboard }) {
  const text = String(message || '').trim();
  const lower = normalize(text);
  const finance = dashboard.finance || {};
  let reply = 'He guardado tu mensaje como aprendizaje operativo. Lo tendre en cuenta junto con el feedback por pedido.';
  if (lower.includes('beneficio') || lower.includes('meta') || lower.includes('dropea')) {
    reply = `Estoy usando beneficio Dropea (${moneyText(finance.dropeaProfit)}) menos Meta (${moneyText(finance.metaSpend)}). Beneficio final actual: ${moneyText(finance.businessProfit)}.`;
  } else if (lower.includes('confirm') || lower.includes('pedido')) {
    reply = 'Aprendido. Para confirmaciones, priorizare boton de Chatby, etiqueta CONFIRMADO o mensaje explicito. Si hay duda de direccion, cancelacion o cambio de datos, lo mandare a revision.';
  }
  const lesson = /aprende|recuerda|cuando|si el cliente|debes|deberias|deberia/i.test(text)
    ? { id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, createdAt: new Date().toISOString() }
    : null;
  return { reply, lesson };
}

export async function buildDashboard({ health = null } = {}) {
  const localOrdersRaw = listOrders({ storeId: config.defaultStore.id });
  const localState = loadState();
  const pedidos = await readSheet('Pedidos');
  const decisiones = await readSheet('Decisiones Agente');
  const metaDashboard = await readSheet('Meta Dashboard');
  const metaCampaigns = await readSheet('Meta Campanas');
  const feedback = await readJson(path.join(dashboardDataDir, 'agent-feedback.json'), []);
  const financeSettings = await loadFinanceSettings();
  const agentChat = await readJson(path.join(dashboardDataDir, 'agent-chat.json'), []);
  const agentMemory = await readJson(path.join(dashboardDataDir, 'agent-memory.json'), []);

  const sheetOrders = rowObjects(pedidos.rows).map(orderFromSheet);
  const localOrders = localOrdersRaw.map(orderFromLocal);
  const decisions = rowObjects(decisiones.rows).map(decisionFromSheet);
  const knownOrderIds = [...sheetOrders, ...localOrders].map((order) => order.orderId);
  const liveDropea = await loadLiveDropeaOrders(knownOrderIds);
  const liveMeta = await loadLiveMetaCampaigns();
  const orders = mergeOrders(sheetOrders, localOrders, liveDropea.orders, decisions, feedback);
  const confirmed = orders.filter(isRecognizedSale);
  const cancelled = orders.filter(isCancelled);
  const manualReview = orders.filter(isManualReview);
  const pending = orders.filter((order) => normalize(order.status).includes('pending'));
  const metaRows = rowObjects(metaDashboard.rows);
  const campaignRows = liveMeta.campaigns.length ? liveMeta.campaigns : rowObjects(metaCampaigns.rows);
  const finance = calculateFinance({ orders, campaignRows, metaRows, financeSettings });

  return {
    generatedAt: new Date().toISOString(),
    sources: [
      { name: pedidos.source, ok: pedidos.ok, error: pedidos.error || null },
      { name: decisiones.source, ok: decisiones.ok, error: decisiones.error || null },
      { name: metaDashboard.source, ok: metaDashboard.ok, error: metaDashboard.error || null },
      { name: metaCampaigns.source, ok: metaCampaigns.ok, error: metaCampaigns.error || null },
      liveDropea.source,
      liveMeta.source,
      { name: 'Render - AutoConfirm', ok: Boolean(health), error: null }
    ],
    system: { render: health, localState, store: config.defaultStore },
    kpis: {
      orders: orders.length,
      confirmed: confirmed.length,
      pending: pending.length,
      manualReview: manualReview.length,
      cancelled: cancelled.length,
      revenue: finance.revenue,
      spend: finance.metaSpend,
      estimatedProfit: finance.businessProfit,
      confirmRate: orders.length ? confirmed.length / orders.length : null
    },
    finance,
    orders: latest(orders, 'createdAt', 120),
    decisions: latest(decisions, 'date', 40),
    feedback: latest(feedback, 'createdAt', 40),
    learning: {
      feedbackCount: feedback.length,
      memoryCount: agentMemory.length,
      controlSheet: 'Control Simulacion',
      mode: 'El feedback por pedido se usa como override en simulacion. La memoria general queda guardada para convertirla en reglas validadas.',
      lastFeedbackAt: latest(feedback, 'createdAt', 1)[0]?.createdAt || null
    },
    agentChat: latest(agentChat, 'createdAt', 30).reverse(),
    agentMemory: latest(agentMemory, 'createdAt', 40),
    campaigns: campaignRows.slice(0, 20),
    products: buildProducts(orders),
    research: [
      { name: 'Kit sonrisa premium', score: 91, basis: 'Hipotesis manual', note: 'Complementa Collagum y permite packs de mayor ticket.' },
      { name: 'Serum efecto lifting', score: 86, basis: 'Hipotesis manual', note: 'Buen angulo visual para anuncios y landing directa.' },
      { name: 'Parches drenantes', score: 74, basis: 'Hipotesis manual', note: 'Requiere validar proveedor, devoluciones y margen real.' }
    ]
  };
}

export async function saveAgentFeedback({ orderId, verdict = 'manual_review', correction = '', note = '' }) {
  if (!orderId) throw new Error('orderId_required');
  const feedbackPath = path.join(dashboardDataDir, 'agent-feedback.json');
  const feedback = await readJson(feedbackPath, []);
  const item = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orderId: String(orderId),
    verdict: String(verdict),
    correction: String(correction || ''),
    note: String(note || ''),
    createdAt: new Date().toISOString()
  };
  feedback.push(item);
  await writeJson(feedbackPath, feedback);
  const decision = item.verdict === 'should_confirm' ? 'CONFIRM' : item.verdict === 'should_not_confirm' ? 'NO_CONFIRM' : 'MANUAL_REVIEW';
  await upsertSimulationDecision({
    orderId: item.orderId,
    decision,
    reason: [item.correction, item.note].filter(Boolean).join(' | '),
    source: 'command_center_feedback'
  });
  return item;
}

export async function saveFinanceSettings({ dropeaProfit, note = '' }) {
  const parsed = numberFrom(dropeaProfit);
  if (parsed === null) throw new Error('dropeaProfit_required');
  const settings = {
    dropeaProfit: parsed,
    dropshipperId: process.env.DROPEA_DROPSHIPPER_ID || '17431',
    source: 'manual_dropea_dashboard',
    updatedAt: new Date().toISOString(),
    note: String(note || 'Beneficio neto indicado por Dropea, ya descontando transporte y stock.').trim()
  };
  await writeJson(path.join(dashboardDataDir, 'finance-settings.json'), settings);
  return settings;
}

export async function saveAgentChat(message, health) {
  if (!String(message || '').trim()) throw new Error('message_required');
  const chatPath = path.join(dashboardDataDir, 'agent-chat.json');
  const memoryPath = path.join(dashboardDataDir, 'agent-memory.json');
  const chat = await readJson(chatPath, []);
  const memory = await readJson(memoryPath, []);
  const dashboard = await buildDashboard({ health });
  const userMessage = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'user', text: String(message).trim(), createdAt: new Date().toISOString() };
  const { reply, lesson } = buildAgentReply({ message, dashboard });
  const agentMessage = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'agent', text: reply, createdAt: new Date().toISOString() };
  chat.push(userMessage, agentMessage);
  await writeJson(chatPath, chat);
  if (lesson) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
  }
  return { reply: agentMessage, lesson };
}
