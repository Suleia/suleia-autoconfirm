import { getAppConfig } from '../config.mjs';
import { getAdAccountSummary, getCampaignInsights, getCampaigns } from '../clients/meta.mjs';
import { getSheetRows, replaceSheetValues } from '../clients/sheets.mjs';
import { listOrders, loadState, saveState } from '../storage.mjs';
import { syncMetaInsightsToSupabase } from '../db/supabase-store.mjs';

const config = getAppConfig();
let dashboardRunning = false;

async function runStage(name, task) {
  try {
    return await task();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${detail}`, { cause: error });
  }
}

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  const spanish = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (spanish) {
    const [, day, month, year, hour = '0', minute = '0'] = spanish;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderCreatedAt(order) {
  return parseDate(order.raw?.created_at || order.raw?.createdAt || order.createdAt);
}

function metric(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return Number(number.toFixed(digits));
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${metric(number * 100, 1)}%`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return metric(number, 2);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function productFromCampaignName(name) {
  const normalized = normalizeText(name);
  if (normalized.includes('colla') || normalized.includes('gum')) return 'Collagum';
  if (normalized.includes('nida')) return 'NIDA premium';
  return 'Sin producto detectado';
}

function deepFind(raw, targetKeys) {
  if (!raw || typeof raw !== 'object') return null;
  const stack = [raw];
  const keys = new Set(targetKeys.map((key) => normalizeText(key)));

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    for (const [key, value] of Object.entries(current)) {
      if (keys.has(normalizeText(key)) && value !== undefined && value !== null && value !== '') {
        return String(value);
      }
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

function campaignKeyForOrder(order) {
  const raw = order.raw || {};
  const configured = deepFind(raw, config.metaAttributionFields || []);
  if (configured) return normalizeText(configured);

  const generic = deepFind(raw, [
    'campaign',
    'campaignName',
    'campaign_name',
    'utm_campaign',
    'fb_campaign_id',
    'meta_campaign_id'
  ]);
  return generic ? normalizeText(generic) : '';
}

function sheetOrdersFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map((header) => normalizeText(header));
  const indexOf = (...names) => {
    const normalized = names.map((name) => normalizeText(name));
    return headers.findIndex((header) => normalized.includes(header));
  };

  const orderIdIndex = indexOf('orderId', 'orderid', 'pedido', 'id');
  if (orderIdIndex < 0) return [];

  const nameIndex = indexOf('nombre', 'cliente');
  const phoneIndex = indexOf('telefono', 'phone');
  const createdIndex = indexOf('fecha_creacion', 'fecha creacion', 'created_at');
  const statusIndex = indexOf('estado', 'status');
  const amountIndex = indexOf('importe', 'total', 'amount');
  const confirmedIndex = indexOf('fecha_confirmacion', 'fecha confirmacion', 'confirmed_at');

  return rows.slice(1)
    .filter((row) => row?.[orderIdIndex])
    .map((row) => ({
      id: `sheet_${row[orderIdIndex]}`,
      storeId: config.defaultStore.id,
      orderId: String(row[orderIdIndex]),
      status: row[statusIndex] || '',
      customerName: row[nameIndex] || '',
      customerPhone: row[phoneIndex] || '',
      orderAmount: Number(String(row[amountIndex] || '').replace(',', '.')) || null,
      confirmedAt: row[confirmedIndex] || null,
      raw: {
        source: 'google_sheet',
        created_at: row[createdIndex] || '',
        sheet_row: row
      },
      createdAt: row[createdIndex] || null
    }));
}

async function loadDashboardOrders(store) {
  const byId = new Map();
  const sheetRows = await getSheetRows(config.googleSheetName || 'Pedidos');

  for (const order of sheetOrdersFromRows(sheetRows)) {
    byId.set(String(order.orderId), order);
  }

  for (const order of listOrders({ storeId: store.id })) {
    const existing = byId.get(String(order.orderId)) || {};
    byId.set(String(order.orderId), {
      ...existing,
      ...order,
      raw: {
        ...(existing.raw || {}),
        ...(order.raw || {})
      }
    });
  }

  return [...byId.values()];
}

function isConfirmed(order) {
  const status = normalizeText(order.status);
  const intent = normalizeText(order.aiIntent);
  return ['confirmed', 'confirmado', 'charged', 'delivered'].includes(status)
    || intent === 'confirm'
    || Boolean(order.confirmedAt);
}

function isCancelled(order) {
  const status = normalizeText(order.status);
  const intent = normalizeText(order.aiIntent);
  return ['cancelled', 'canceled', 'rejected', 'returned', 'lost'].includes(status)
    || ['cancel', 'no_confirm'].includes(intent);
}

function isManualReview(order) {
  return normalizeText(order.status) === 'manual_review';
}

function summarizeOrders(orders) {
  const total = orders.length;
  const confirmed = orders.filter(isConfirmed).length;
  const cancelled = orders.filter(isCancelled).length;
  const manualReview = orders.filter(isManualReview).length;
  const pending = orders.filter((order) => normalizeText(order.status) === 'pending').length;
  const revenue = orders.filter(isConfirmed).reduce((sum, order) => sum + (Number(order.orderAmount) || 0), 0);

  return {
    total,
    confirmed,
    cancelled,
    manualReview,
    pending,
    revenue,
    confirmRate: total ? confirmed / total : null,
    cancelRate: total ? cancelled / total : null
  };
}

function matchCampaignOrders(orders, insight) {
  const id = normalizeText(insight.campaignId);
  const name = normalizeText(insight.campaignName);
  return orders.filter((order) => {
    const key = campaignKeyForOrder(order);
    return key && (key === id || key === name || key.includes(id) || key.includes(name));
  });
}

function dashboardRows({ account, insights, orders, since, until, generatedAt }) {
  const orderSummary = summarizeOrders(orders);
  const spend = insights.reduce((sum, item) => sum + item.spend, 0);
  const impressions = insights.reduce((sum, item) => sum + item.impressions, 0);
  const reach = insights.reduce((sum, item) => sum + item.reach, 0);
  const clicks = insights.reduce((sum, item) => sum + item.clicks, 0);
  const purchases = insights.reduce((sum, item) => sum + item.purchases, 0);

  const rows = [
    ['Suleia Meta x Dropea Dashboard', '', '', 'Actualizado', generatedAt],
    ['Periodo', since, until, 'Cuenta Meta', account?.name || account?.id || ''],
    [],
    ['Metrica', 'Valor', 'Lectura de negocio'],
    ['Gasto Meta', money(spend), 'Inversion publicitaria del periodo'],
    ['Pedidos Dropea', orderSummary.total, 'Pedidos reales capturados por el flujo'],
    ['Pedidos confirmados/agente', orderSummary.confirmed, 'Pedidos con confirmacion detectada o estado confirmado'],
    ['Pendientes', orderSummary.pending, 'Pedidos todavia sin decision final'],
    ['Revision manual', orderSummary.manualReview, 'Pedidos que no conviene confirmar automaticamente'],
    ['Cancelados/no confirmados', orderSummary.cancelled, 'Senal de calidad negativa'],
    ['Ingresos confirmados estimados', money(orderSummary.revenue), 'Suma de importes de pedidos confirmados'],
    ['CPA real por pedido', orderSummary.total ? money(spend / orderSummary.total) : '', 'Coste por pedido Dropea, no solo pixel'],
    ['CPA real por confirmado', orderSummary.confirmed ? money(spend / orderSummary.confirmed) : '', 'La metrica clave para escalar COD'],
    ['ROAS confirmado estimado', spend ? metric(orderSummary.revenue / spend, 2) : '', 'Ingresos confirmados / gasto Meta'],
    ['Tasa confirmacion', orderSummary.confirmRate === null ? '' : percent(orderSummary.confirmRate), 'Calidad comercial del trafico'],
    ['Tasa cancelacion/no confirmacion', orderSummary.cancelRate === null ? '' : percent(orderSummary.cancelRate), 'Riesgo de trafico malo o promesa debil'],
    ['Compras pixel Meta', purchases, 'Lo que Meta atribuye como purchase'],
    ['Diferencia pixel vs confirmado', purchases || orderSummary.confirmed ? orderSummary.confirmed - purchases : '', 'Positivo si Dropea confirma mas que el pixel; negativo si el pixel sobrecuenta'],
    ['Impresiones', impressions, 'Volumen'],
    ['Alcance', reach, 'Personas alcanzadas'],
    ['Clicks', clicks, 'Trafico generado'],
    ['CTR', impressions ? percent(clicks / impressions) : '', 'Atraccion del anuncio'],
    ['CPC', clicks ? money(spend / clicks) : '', 'Coste de trafico'],
    ['CPM', impressions ? money((spend / impressions) * 1000) : '', 'Coste de exposicion']
  ];

  return rows;
}

function campaignRows({ campaigns, insights, orders }) {
  const statusById = new Map(campaigns.map((campaign) => [String(campaign.id), campaign]));
  const rows = [[
    'campaign_id',
    'campana',
    'producto',
    'estado',
    'gasto',
    'impresiones',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'compras_pixel',
    'valor_compra_pixel',
    'cpa_pixel',
    'roas_meta',
    'pedidos_dropea_atribuidos',
    'confirmados_atribuidos',
    'tasa_confirmacion',
    'ingresos_confirmados',
    'cpa_confirmado',
    'roas_confirmado',
    'lectura'
  ]];

  for (const insight of insights.sort((a, b) => b.spend - a.spend)) {
    const matchedOrders = matchCampaignOrders(orders, insight);
    const orderSummary = summarizeOrders(matchedOrders);
    const campaign = statusById.get(String(insight.campaignId));
    const cpaConfirmed = orderSummary.confirmed ? insight.spend / orderSummary.confirmed : null;
    const roas = insight.spend ? orderSummary.revenue / insight.spend : null;
    const reading = orderSummary.total
      ? `Atribucion local detectada: ${orderSummary.confirmed}/${orderSummary.total} confirmados`
      : 'Sin atribucion local todavia: revisar UTMs en anuncios/landing';

    rows.push([
      insight.campaignId,
      insight.campaignName,
      productFromCampaignName(insight.campaignName),
      campaign?.effective_status || campaign?.status || '',
      money(insight.spend),
      insight.impressions,
      insight.clicks,
      `${metric(insight.ctr, 2)}%`,
      money(insight.cpc),
      money(insight.cpm),
      insight.purchases,
      money(insight.purchaseValue),
      insight.costPerPurchase === null ? '' : money(insight.costPerPurchase),
      insight.roas === null ? '' : metric(insight.roas, 2),
      orderSummary.total,
      orderSummary.confirmed,
      orderSummary.confirmRate === null ? '' : percent(orderSummary.confirmRate),
      money(orderSummary.revenue),
      cpaConfirmed === null ? '' : money(cpaConfirmed),
      roas === null ? '' : metric(roas, 2),
      reading
    ]);
  }

  return rows;
}

function diagnosticRows({ account, campaigns, insights, orders, since, until, generatedAt, warnings }) {
  return [
    ['check', 'valor', 'detalle'],
    ['actualizado', generatedAt, 'Hora en que se genero el dashboard'],
    ['periodo', `${since} a ${until}`, `${config.metaDashboardLookbackDays} dias de ventana`],
    ['cuenta_meta', account?.id || '', account?.name || ''],
    ['estado_cuenta_meta', account?.account_status ?? '', account?.disable_reason ? `disable_reason=${account.disable_reason}` : 'Sin bloqueo detectado por API'],
    ['campanas_leidas', campaigns.length, 'Campanas disponibles en la cuenta'],
    ['campanas_con_gasto', insights.filter((item) => item.spend > 0).length, 'Campanas con inversion en el periodo'],
    ['pedidos_locales_periodo', orders.length, 'Pedidos guardados por AutoConfirm en la ventana'],
    ['pedidos_con_atribucion_meta', orders.filter((order) => campaignKeyForOrder(order)).length, 'Si es bajo, falta capturar UTMs/campaign_id en la landing/pedido'],
    ['advertencias', warnings.length ? warnings.join(' | ') : 'Ninguna', 'No bloquea automatismos']
  ];
}

export async function syncMetaDashboard({ store = config.defaultStore } = {}) {
  if (!config.metaDashboardEnabled) {
    return { skipped: true, reason: 'meta_dashboard_disabled' };
  }

  if (dashboardRunning) {
    return { skipped: true, reason: 'dashboard_running' };
  }

  dashboardRunning = true;
  try {
    const generatedAt = new Date().toISOString();
    const since = isoDate(config.metaDashboardLookbackDays || 30);
    const until = isoDate(0);
    const sinceDate = new Date(`${since}T00:00:00.000Z`);
    const warnings = [];

    const [account, campaigns, insights] = await Promise.all([
      runStage('Meta cuenta publicitaria', () => getAdAccountSummary()),
      runStage('Meta campanas', () => getCampaigns()),
      // Finance needs one authoritative observation per Madrid business day.
      // A rolling-period aggregate cannot be split across days without
      // inventing spend, so request Meta's native daily breakdown here.
      runStage('Meta metricas', () => getCampaignInsights({ since, until, timeIncrement: 1 }))
    ]);

    const dashboardOrders = await runStage('Pedidos del dashboard', () => loadDashboardOrders(store));
    const orders = dashboardOrders.filter((order) => {
      const createdAt = orderCreatedAt(order);
      return createdAt ? createdAt >= sinceDate : true;
    });

    if (!orders.some((order) => campaignKeyForOrder(order))) {
      warnings.push('No hay atribucion Meta en pedidos locales; anadir UTMs/campaign_id para ver CPA por campana real.');
    }

    const prefix = config.metaDashboardSheetPrefix || 'Meta';
    const sheetResults = [];
    sheetResults.push(await runStage('Google Sheets dashboard', () => replaceSheetValues(`${prefix} Dashboard`, dashboardRows({ account, insights, orders, since, until, generatedAt }), { frozenRows: 4 })));
    sheetResults.push(await runStage('Google Sheets campanas', () => replaceSheetValues(`${prefix} Campanas`, campaignRows({ campaigns, insights, orders }), { frozenRows: 1 })));
    sheetResults.push(await runStage('Google Sheets diagnostico', () => replaceSheetValues(`${prefix} Diagnostico`, diagnosticRows({ account, campaigns, insights, orders, since, until, generatedAt, warnings }), { frozenRows: 1 })));

    const state = {
      ...loadState(),
      lastMetaDashboardAt: generatedAt,
      lastMetaDashboardError: null
    };
    saveState(state);
    syncMetaInsightsToSupabase({ account, campaigns, insights, coverage: { since, until } }).catch((error) => {
      console.error('Supabase Meta mirror error:', error instanceof Error ? error.message : String(error));
    });

    return {
      ok: true,
      generatedAt,
      since,
      until,
      campaigns: campaigns.length,
      insights: insights.length,
      orders: orders.length,
      warnings,
      sheetResults
    };
  } catch (error) {
    const state = {
      ...loadState(),
      lastMetaDashboardError: error instanceof Error ? error.message : String(error)
    };
    saveState(state);
    return { ok: false, error: state.lastMetaDashboardError };
  } finally {
    dashboardRunning = false;
  }
}
