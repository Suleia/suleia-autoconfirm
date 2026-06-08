import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppConfig } from './config.mjs';
import { listOrders, loadState } from './storage.mjs';
import { getDropeaOrderById, listPendingDropeaOrders } from './clients/dropea.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { chatWithOperationsAgent } from './clients/openai.mjs';
import { appendAgentMemoryRule, getAgentMemoryRules, getSheetRows, upsertSimulationDecision } from './clients/sheets.mjs';

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

function guessProductFromCampaign(name) {
  const normalized = normalize(name);
  if (normalized.includes('colla') || normalized.includes('gum')) return 'Collagum';
  if (normalized.includes('nida')) return 'NIDA premium';
  return 'Sin producto detectado';
}

function guessProductFromMetaRow(...names) {
  return guessProductFromCampaign(names.filter(Boolean).join(' '));
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

function controlDecisionFromSheet(row) {
  return {
    date: row.actualizado_en || '',
    orderId: String(row.orderId || ''),
    decision: String(row.decision_simulacion || '').trim().toUpperCase(),
    reason: row.motivo || '',
    source: row.fuente || 'control_simulacion'
  };
}

function orderPatchFromControl(control) {
  const reason = control.reason || '';
  const addressChange = isAddressChangeFeedback(`${control.source} ${reason}`);
  if (['CONFIRM', 'CONFIRMAR', 'CONFIRMED', 'SI', 'SÍ', 'YES'].includes(control.decision)) {
    return {
      status: 'CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_confirm',
      agentIntent: 'CONFIRM',
      agentConfidence: 100,
      agentReason: reason || 'Confirmacion validada por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  if (['NO_CONFIRM', 'NO CONFIRM', 'NO_CONFIRMAR', 'NO', 'CANCEL', 'CANCELAR'].includes(control.decision)) {
    return {
      status: addressChange ? 'PENDING_ADDRESS_CHANGE' : 'NOT_CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_not_confirm',
      agentIntent: addressChange ? 'ADDRESS_CHANGE_REQUESTED' : 'NO_CONFIRM',
      agentConfidence: 100,
      agentReason: reason || 'No confirmado por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  if (['MANUAL_REVIEW', 'REVIEW', 'REVISION'].includes(control.decision)) {
    return {
      status: 'MANUAL_REVIEW',
      agentAction: 'manual_review',
      agentIntent: 'MANUAL_REVIEW',
      agentConfidence: 100,
      agentReason: reason || 'Revision manual indicada por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  return null;
}

function mergeOrders(sheetOrders, localOrders, liveOrders, decisions, controlDecisions, feedback) {
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
  for (const control of controlDecisions) {
    const current = byId.get(control.orderId);
    if (!current) continue;
    const patch = orderPatchFromControl(control);
    if (!patch) continue;
    byId.set(control.orderId, {
      ...current,
      ...patch
    });
  }
  for (const item of feedback) {
    const current = byId.get(String(item.orderId));
    if (!current) continue;
    const feedbackText = normalize([item.verdict, item.correction, item.note].filter(Boolean).join(' '));
    const addressChange = isAddressChangeFeedback(feedbackText);
    const feedbackPatch = {};
    if (item.verdict === 'should_confirm') {
      feedbackPatch.status = 'CONFIRMED_BY_CUSTOMER';
      feedbackPatch.agentAction = 'would_confirm';
      feedbackPatch.agentIntent = 'CONFIRM';
      feedbackPatch.agentConfidence = 100;
      feedbackPatch.agentReason = item.correction || item.note || 'Samuel corrigio el pedido como confirmado por el cliente.';
    } else if (addressChange) {
      feedbackPatch.status = 'PENDING_ADDRESS_CHANGE';
      feedbackPatch.agentAction = 'would_not_confirm';
      feedbackPatch.agentIntent = 'ADDRESS_CHANGE_REQUESTED';
      feedbackPatch.agentConfidence = 100;
      feedbackPatch.agentReason = item.correction || item.note || 'Samuel corrigio el pedido como cambio de direccion; no confirmar.';
    }
    byId.set(String(item.orderId), {
      ...current,
      ...feedbackPatch,
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

function parseDashboardDate(value) {
  if (!value) return 0;
  const text = String(value);
  const spanish = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (spanish) {
    const [, day, month, year, hour = '0', minute = '0'] = spanish;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortOrdersRecentFirst(orders) {
  return [...orders].sort((a, b) => {
    const dateDiff = parseDashboardDate(b.createdAt) - parseDashboardDate(a.createdAt);
    if (dateDiff) return dateDiff;
    return Number(String(b.orderId || '').replace(/\D/g, '')) - Number(String(a.orderId || '').replace(/\D/g, ''));
  });
}

function uniqueLessons(...groups) {
  const byText = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      if (!item?.text) continue;
      byText.set(normalize(item.text), item);
    }
  }
  return [...byText.values()];
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

function campaignNumber(row, ...fields) {
  for (const field of fields) {
    const value = numberFrom(row[field]);
    if (value !== null) return value;
  }
  return 0;
}

function normalizeCampaignRow(row) {
  const name = row.campana || row.campaign_name || row.Campana || row.name || row.campaign_id || 'Campana Meta';
  const adsetName = row.conjunto || row.adset_name || row.adsetName || '';
  const adName = row.anuncio || row.ad_name || row.adName || '';
  const product = row.producto || row.Producto || guessProductFromMetaRow(name, adsetName, adName);
  const spend = campaignNumber(row, 'gasto', 'spend', 'Gasto');
  const clicks = campaignNumber(row, 'clicks', 'Clicks');
  const impressions = campaignNumber(row, 'impresiones', 'impressions', 'Impresiones');
  const purchases = campaignNumber(row, 'compras_pixel', 'purchases', 'Compras Pixel');
  const purchaseValue = campaignNumber(row, 'valor_compra_pixel', 'purchaseValue', 'Valor Compra Pixel');
  const cpaPixel = campaignNumber(row, 'cpa_pixel', 'costPerPurchase', 'CPA Pixel') || (purchases ? spend / purchases : 0);
  const roasMeta = campaignNumber(row, 'roas_meta', 'roas', 'ROAS Meta') || (spend ? purchaseValue / spend : 0);

  return {
    campaignId: row.campaign_id || row.campaignId || row.id || '',
    name,
    adsetName,
    adName,
    product,
    status: row.estado || row.status || row.effective_status || '',
    periodStart: row.periodo_inicio || row.dateStart || '',
    periodEnd: row.periodo_fin || row.dateStop || '',
    spend,
    impressions,
    reach: campaignNumber(row, 'alcance', 'reach'),
    clicks,
    ctr: campaignNumber(row, 'ctr'),
    cpc: campaignNumber(row, 'cpc'),
    cpm: campaignNumber(row, 'cpm'),
    purchases,
    purchaseValue,
    cpaPixel,
    roasMeta,
    attributedOrders: campaignNumber(row, 'pedidos_dropea_atribuidos'),
    confirmedOrders: campaignNumber(row, 'confirmados_atribuidos'),
    confirmedRevenue: campaignNumber(row, 'ingresos_confirmados'),
    cpaConfirmed: campaignNumber(row, 'cpa_confirmado'),
    roasConfirmed: campaignNumber(row, 'roas_confirmado', 'roasConfirmado', 'ROAS Confirmado'),
    source: row.fuente || row.source || ''
  };
}

function buildCampaignAnalytics(campaignRows) {
  const campaigns = campaignRows.map(normalizeCampaignRow).sort((a, b) => b.spend - a.spend);
  const byProduct = new Map();

  for (const campaign of campaigns) {
    const product = campaign.product || 'Sin producto detectado';
    const current = byProduct.get(product) || {
      product,
      campaigns: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      attributedOrders: 0,
      confirmedOrders: 0,
      confirmedRevenue: 0
    };
    current.campaigns += 1;
    current.spend += campaign.spend;
    current.impressions += campaign.impressions;
    current.clicks += campaign.clicks;
    current.purchases += campaign.purchases;
    current.purchaseValue += campaign.purchaseValue;
    current.attributedOrders += campaign.attributedOrders;
    current.confirmedOrders += campaign.confirmedOrders;
    current.confirmedRevenue += campaign.confirmedRevenue;
    byProduct.set(product, current);
  }

  const products = [...byProduct.values()].map((item) => ({
    ...item,
    ctr: item.impressions ? item.clicks / item.impressions : 0,
    cpc: item.clicks ? item.spend / item.clicks : 0,
    cpaPixel: item.purchases ? item.spend / item.purchases : 0,
    roasMeta: item.spend ? item.purchaseValue / item.spend : 0,
    cpaConfirmed: item.confirmedOrders ? item.spend / item.confirmedOrders : 0,
    roasConfirmed: item.spend ? item.confirmedRevenue / item.spend : 0
  })).sort((a, b) => b.spend - a.spend);

  return { campaigns, products };
}

function calculateFinance({ orders, campaignRows, metaRows, financeSettings }) {
  const recognizedOrders = orders.filter(isRecognizedSale);
  const revenue = recognizedOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const productCost = recognizedOrders.reduce((sum, order) => sum + productCostForOrder(order), 0);
  const paymentFees = recognizedOrders.reduce((sum, order) => sum + paymentCostForOrder(order), 0);
  const campaignSpend = campaignRows.reduce((sum, row) => sum + normalizeCampaignRow(row).spend, 0);
  const spendRow = metaRows.find((row) => normalize(row.Metrica) === 'gasto meta');
  const metaSpend = campaignSpend || numberFrom(spendRow?.Valor) || 0;
  const dropeaProfit = numberFrom(financeSettings?.dropeaProfit);
  const businessProfit = dropeaProfit !== null ? dropeaProfit - metaSpend : revenue - productCost - paymentFees - metaSpend;
  const attributedOrders = campaignRows.reduce((sum, row) => sum + (numberFrom(row.pedidos_dropea_atribuidos) || 0), 0);
  const warnings = [
    'El beneficio principal usa el beneficio neto marcado por Dropea y resta Meta.',
    !attributedOrders && metaSpend ? 'El gasto Meta no esta atribuido a pedidos concretos; se usa gasto del periodo disponible.' : null,
    campaignSpend ? null : 'Meta no esta disponible en vivo; se usa el ultimo dato guardado en Sheets si existe.',
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
    const datePreset = process.env.META_DASHBOARD_DATE_PRESET || 'this_month';
    const insights = await getCampaignInsights({ datePreset, level: 'ad', limit: 200 });
    return {
      source: { ...source, period: datePreset },
      campaigns: insights.map((item) => ({
        campaign_id: item.campaignId,
        campana: item.campaignName,
        adset_id: item.adsetId,
        conjunto: item.adsetName,
        ad_id: item.adId,
        anuncio: item.adName,
        producto: guessProductFromMetaRow(item.campaignName, item.adsetName, item.adName),
        periodo_inicio: item.dateStart,
        periodo_fin: item.dateStop,
        gasto: item.spend,
        impresiones: item.impressions,
        alcance: item.reach,
        clicks: item.clicks,
        ctr: item.ctr,
        cpc: item.cpc,
        cpm: item.cpm,
        compras_pixel: item.purchases,
        valor_compra_pixel: item.purchaseValue,
        cpa_pixel: item.costPerPurchase,
        roas_meta: item.roas,
        roas_confirmado: '',
        fuente: 'Meta API en vivo'
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
    reply = 'Aprendido. Para confirmaciones, priorizare boton de Chatby, etiqueta CONFIRMADO o mensaje explicito. Si hay cambio de direccion o datos de entrega, lo dejare pendiente por direccion y no lo confirmare.';
  }
  const lesson = /aprende|recuerda|cuando|si el cliente|debes|deberias|deberia/i.test(text)
    ? { id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, createdAt: new Date().toISOString() }
    : null;
  return { reply, lesson };
}

function isAddressChangeFeedback(text) {
  const normalized = normalize(text);
  return normalized.includes('cambio de direccion')
    || normalized.includes('cambiar direccion')
    || normalized.includes('modificar direccion')
    || normalized.includes('corregir direccion')
    || normalized.includes('cambio direccion')
    || normalized.includes('cambiar datos')
    || normalized.includes('modificar datos')
    || normalized.includes('datos de entrega');
}

function learnedRuleFromFeedback(item) {
  const text = [item.verdict, item.correction, item.note].filter(Boolean).join(' ');
  if (item.verdict === 'should_confirm') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'confirmed_customer_signal',
      text: 'Si el cliente confirma claramente el pedido por boton de Chatby o por texto explicito, el agente debe marcarlo como confirmado por cliente y no dejarlo en revision manual.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (isAddressChangeFeedback(text)) {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'address_change_no_confirm',
      text: 'No confirmar pedidos cuando el cliente marca, solicita o menciona cambio de direccion/datos de entrega. Dejar el pedido pendiente por direccion hasta corregir direccion en Dropea.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.correction || item.note) {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'feedback_rule',
      text: [item.correction, item.note].filter(Boolean).join(' | '),
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  return null;
}

export async function buildDashboard({ health = null } = {}) {
  const localOrdersRaw = listOrders({ storeId: config.defaultStore.id });
  const localState = loadState();
  const pedidos = await readSheet('Pedidos');
  const decisiones = await readSheet('Decisiones Agente');
  const controlSimulacion = await readSheet('Control Simulacion');
  const metaDashboard = await readSheet('Meta Dashboard');
  const metaCampaigns = await readSheet('Meta Campanas');
  const feedback = await readJson(path.join(dashboardDataDir, 'agent-feedback.json'), []);
  const financeSettings = await loadFinanceSettings();
  const agentChat = await readJson(path.join(dashboardDataDir, 'agent-chat.json'), []);
  const localAgentMemory = await readJson(path.join(dashboardDataDir, 'agent-memory.json'), []);
  let sheetAgentMemory = [];
  try {
    sheetAgentMemory = await getAgentMemoryRules();
  } catch {
    sheetAgentMemory = [];
  }
  const agentMemory = uniqueLessons(sheetAgentMemory, localAgentMemory);

  const sheetOrders = rowObjects(pedidos.rows).map(orderFromSheet);
  const localOrders = localOrdersRaw.map(orderFromLocal);
  const decisions = rowObjects(decisiones.rows).map(decisionFromSheet);
  const controlDecisions = rowObjects(controlSimulacion.rows).map(controlDecisionFromSheet).filter((item) => item.orderId && item.decision);
  const knownOrderIds = [...sheetOrders, ...localOrders].map((order) => order.orderId);
  const liveDropea = await loadLiveDropeaOrders(knownOrderIds);
  const liveMeta = await loadLiveMetaCampaigns();
  const orders = mergeOrders(sheetOrders, localOrders, liveDropea.orders, decisions, controlDecisions, feedback);
  const confirmed = orders.filter(isRecognizedSale);
  const cancelled = orders.filter(isCancelled);
  const manualReview = orders.filter(isManualReview);
  const pending = orders.filter((order) => normalize(order.status).includes('pending'));
  const metaRows = rowObjects(metaDashboard.rows);
  const campaignRows = liveMeta.campaigns.length ? liveMeta.campaigns : rowObjects(metaCampaigns.rows);
  const campaignAnalytics = buildCampaignAnalytics(campaignRows);
  const finance = calculateFinance({
    orders,
    campaignRows,
    metaRows: liveMeta.campaigns.length ? [] : metaRows,
    financeSettings
  });

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
    orders: sortOrdersRecentFirst(orders),
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
    campaigns: campaignAnalytics.campaigns.slice(0, 50),
    campaignProducts: campaignAnalytics.products,
    meta: {
      period: liveMeta.source.period || process.env.META_DASHBOARD_DATE_PRESET || 'this_month',
      spendSource: liveMeta.campaigns.length ? 'Meta API en vivo' : 'Google Sheet - Meta Campanas',
      lastError: liveMeta.source.ok ? null : liveMeta.source.error
    },
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
  const memoryPath = path.join(dashboardDataDir, 'agent-memory.json');
  const feedback = await readJson(feedbackPath, []);
  const memory = await readJson(memoryPath, []);
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
  const lesson = learnedRuleFromFeedback(item);
  if (lesson && !memory.some((existing) => normalize(existing.text) === normalize(lesson.text))) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // Local memory is still available if Google Sheets is temporarily unavailable.
    }
  }
  const decision = item.verdict === 'should_confirm' ? 'CONFIRM' : item.verdict === 'should_not_confirm' ? 'NO_CONFIRM' : 'MANUAL_REVIEW';
  await upsertSimulationDecision({
    orderId: item.orderId,
    decision,
    reason: [item.correction, item.note].filter(Boolean).join(' | '),
    source: 'command_center_feedback'
  });
  return { ...item, learnedRule: lesson };
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
  const { reply: fallbackReply, lesson } = buildAgentReply({ message, dashboard });
  let reply = fallbackReply;
  let aiError = null;
  try {
    reply = await chatWithOperationsAgent({ message, dashboard, memory }) || fallbackReply;
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
  }
  const agentMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'agent',
    text: aiError ? `${reply}\n\nNota tecnica: no he podido usar IA avanzada ahora mismo (${aiError}). He aplicado respuesta segura basada en reglas.` : reply,
    createdAt: new Date().toISOString()
  };
  chat.push(userMessage, agentMessage);
  await writeJson(chatPath, chat);
  if (lesson) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // Keep the chat responsive even if the persistent memory sheet fails.
    }
  }
  return { reply: agentMessage, lesson };
}
