import {
  createDropeaV2IncidentClient,
  loadDropeaV2IncidentStoreConfigs
} from './clients/dropea-v2-incidents.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { listShopifyOrdersByCreatedPeriod } from './clients/shopify.mjs';
import { FINANCE_COST_POLICY, getClosedFinanceActual } from './finance-actuals.mjs';

const MADRID_TIME_ZONE = 'Europe/Madrid';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function percent(numerator, denominator) {
  return denominator ? roundMoney((numerator / denominator) * 100) : 0;
}

function localDate(value, timeZone = MADRID_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function resolveFinancePeriod(month, { now = new Date(), timeZone = MADRID_TIME_ZONE } = {}) {
  const currentDay = localDate(now, timeZone);
  const currentMonth = currentDay?.slice(0, 7);
  const requested = month || currentMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(requested || ''))) throw new Error('FINANCE_MONTH_INVALID');
  if (requested > currentMonth) throw new Error('FINANCE_MONTH_IN_FUTURE');
  const [year, monthNumber] = requested.split('-').map(Number);
  const lastDay = requested === currentMonth ? Number(currentDay.slice(8, 10)) : daysInMonth(year, monthNumber);
  const until = `${requested}-${String(lastDay).padStart(2, '0')}`;
  return { month: requested, since: `${requested}-01`, until, current: requested === currentMonth, timeZone };
}

const DELIVERED_SUBSTATUSES = new Set(['DELIVERED', 'PAID']);
const RETURNED_SUBSTATUSES = new Set(['REFUSED', 'REJECTED', 'RETURNED', 'REFUSED_LOST_DAMAGED', 'LOST_DAMAGED', 'INDEMNIFIED']);
const CANCELLED_SUBSTATUSES = new Set(['CANCELLED', 'CANCELED']);
const DISPATCHED_STATUSES = new Set(['SHIPPING', 'SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY', 'OUT_FOR_DELIVERY']);

export function classifyFinanceOrder(order = {}) {
  const status = String(order.status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  if (status === 'DELIVERED' || DELIVERED_SUBSTATUSES.has(subStatus)) return 'delivered';
  if (RETURNED_SUBSTATUSES.has(status) || RETURNED_SUBSTATUSES.has(subStatus)) return 'returned';
  if (CANCELLED_SUBSTATUSES.has(status) || CANCELLED_SUBSTATUSES.has(subStatus)) return 'cancelled';
  if (status === 'ERROR' || ['DELIVERY_EXCEPTION', 'INCIDENT', 'ISSUE'].includes(subStatus)) return 'incident';
  return 'active';
}

export function isSentFinanceOrder(order = {}, category = classifyFinanceOrder(order)) {
  if (category === 'delivered' || category === 'returned') return true;
  if (category === 'cancelled') return false;
  const status = String(order.status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  return DISPATCHED_STATUSES.has(status)
    || DISPATCHED_STATUSES.has(subStatus)
    || Boolean(order.tracking_number || order.tracking_code || order.shipped_at || order.shipping_started_at);
}

function lineItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items : [];
}

function productName(item = {}) {
  return String(item.product_name || item.external_name || item.variant_name || item.sku || 'Producto sin nombre');
}

function productUnitCost(item, policy) {
  const sku = String(item?.sku || '').trim().toUpperCase();
  const configured = policy.productUnitCostsBySku?.[sku];
  return Number.isFinite(Number(configured)) && Number(configured) >= 0
    ? { known: true, amount: Number(configured) }
    : { known: false, amount: 0 };
}

function daySkeleton(day, policy) {
  return {
    day,
    shopifyOrders: 0,
    dropeaOrders: 0,
    sent: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
    active: 0,
    incidents: 0,
    estimatedRevenue: 0,
    realRevenue: 0,
    productCost: 0,
    outboundShippingCost: 0,
    codCost: 0,
    outboundFulfillmentCost: 0,
    returnCost: 0,
    metaSpend: 0,
    fixedCosts: policy.fixedCostPerCalendarDay,
    unknownProductCostUnits: 0
  };
}

function inclusiveDays(period, policy) {
  const rows = [];
  const cursor = new Date(`${period.since}T12:00:00.000Z`);
  const end = new Date(`${period.until}T12:00:00.000Z`);
  while (cursor <= end) {
    rows.push(daySkeleton(cursor.toISOString().slice(0, 10), policy));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function finalizeDay(row, { metaAvailable, shopifyAvailable }) {
  const logisticsCost = roundMoney(row.outboundShippingCost + row.codCost + row.outboundFulfillmentCost + row.returnCost);
  const totalCosts = metaAvailable ? roundMoney(row.productCost + logisticsCost + row.metaSpend + row.fixedCosts) : null;
  const netProfit = totalCosts === null || row.unknownProductCostUnits ? null : roundMoney(row.realRevenue - totalCosts);
  return {
    ...row,
    estimatedRevenue: roundMoney(row.estimatedRevenue),
    realRevenue: roundMoney(row.realRevenue),
    productCost: roundMoney(row.productCost),
    outboundShippingCost: roundMoney(row.outboundShippingCost),
    codCost: roundMoney(row.codCost),
    outboundFulfillmentCost: roundMoney(row.outboundFulfillmentCost),
    returnCost: roundMoney(row.returnCost),
    logisticsCost,
    metaSpend: metaAvailable ? roundMoney(row.metaSpend) : null,
    fixedCosts: roundMoney(row.fixedCosts),
    totalCosts,
    netProfit,
    roiPercent: netProfit === null ? null : percent(netProfit, totalCosts),
    estimatedCpa: metaAvailable ? (row.sent ? roundMoney(row.metaSpend / row.sent) : 0) : null,
    realCpa: metaAvailable ? (row.delivered ? roundMoney(row.metaSpend / row.delivered) : 0) : null,
    shopifyOrders: shopifyAvailable ? row.shopifyOrders : null,
    confirmationRatePercent: shopifyAvailable ? percent(row.sent, row.shopifyOrders) : null,
    deliveryRatePercent: percent(row.delivered, row.sent)
  };
}

export function aggregateFinanceReport({
  orders = [],
  shopifyOrders = null,
  metaRows = [],
  period,
  policy = FINANCE_COST_POLICY,
  metaAvailable = true
}) {
  const days = new Map(inclusiveDays(period, policy).map((row) => [row.day, row]));
  const products = new Map();
  const counts = { total: 0, shopifyOrders: 0, dropeaOrders: 0, sent: 0, active: 0, delivered: 0, returned: 0, cancelled: 0, incidents: 0 };
  let knownProductCostUnits = 0;
  let unknownProductCostUnits = 0;
  const shopifyHistoricalGap = Array.isArray(shopifyOrders) && shopifyOrders.length === 0 && orders.length > 0;
  const shopifyAvailable = Array.isArray(shopifyOrders) && !shopifyHistoricalGap;

  if (shopifyAvailable) {
    for (const order of shopifyOrders) {
      const day = localDate(order.createdAt || order.created_at, period.timeZone);
      if (!day || day < period.since || day > period.until) continue;
      counts.shopifyOrders += 1;
      const daily = days.get(day) || daySkeleton(day, policy);
      daily.shopifyOrders += 1;
      days.set(day, daily);
    }
  }

  for (const order of orders) {
    const day = localDate(order.created_at, period.timeZone);
    if (!day || day < period.since || day > period.until) continue;
    const category = classifyFinanceOrder(order);
    const sent = isSentFinanceOrder(order, category);
    const daily = days.get(day) || daySkeleton(day, policy);
    const orderTotal = number(order.total_amount);

    counts.dropeaOrders += 1;
    counts[category === 'incident' ? 'incidents' : category] += 1;
    daily.dropeaOrders += 1;
    daily[category === 'incident' ? 'incidents' : category] += 1;
    if (sent) {
      counts.sent += 1;
      daily.sent += 1;
      daily.estimatedRevenue += orderTotal;
      daily.outboundShippingCost += policy.outboundShippingPerSent;
      daily.outboundFulfillmentCost += policy.outboundFulfillmentPerSent;
    }
    if (category === 'delivered') {
      daily.realRevenue += orderTotal;
      daily.codCost += policy.codPerDelivered;
    }
    if (category === 'returned') daily.returnCost += policy.returnPerReturned;

    if (category === 'delivered') {
      for (const item of lineItems(order)) {
        const name = productName(item);
        const quantity = Math.max(1, number(item.quantity));
        const unitCost = productUnitCost(item, policy);
        const current = products.get(name) || { name, deliveredOrders: 0, units: 0, revenue: 0, productCost: 0, unknownCostUnits: 0 };
        current.deliveredOrders += 1;
        current.units += quantity;
        current.revenue += number(item.unit_price) * quantity;
        if (unitCost.known) {
          const amount = unitCost.amount * quantity;
          current.productCost += amount;
          daily.productCost += amount;
          knownProductCostUnits += quantity;
        } else {
          current.unknownCostUnits += quantity;
          daily.unknownProductCostUnits += quantity;
          unknownProductCostUnits += quantity;
        }
        products.set(name, current);
      }
    }
    days.set(day, daily);
  }

  for (const row of metaRows) {
    const day = String(row.dateStart || row.date_start || '').slice(0, 10);
    if (!day || day < period.since || day > period.until) continue;
    const daily = days.get(day) || daySkeleton(day, policy);
    daily.metaSpend += number(row.spend);
    days.set(day, daily);
  }

  counts.total = shopifyAvailable ? counts.shopifyOrders : counts.dropeaOrders;
  counts.notSent = shopifyAvailable ? Math.max(0, counts.shopifyOrders - counts.sent) : null;
  counts.confirmationRatePercent = shopifyAvailable ? percent(counts.sent, counts.shopifyOrders) : null;
  counts.deliveryRatePercent = percent(counts.delivered, counts.sent);
  if (!shopifyAvailable) counts.shopifyOrders = null;
  const dailyRows = [...days.values()].map((row) => finalizeDay(row, { metaAvailable, shopifyAvailable })).sort((a, b) => b.day.localeCompare(a.day));
  const sum = (field) => roundMoney(dailyRows.reduce((total, row) => total + number(row[field]), 0));
  const productCostCoverage = (knownProductCostUnits + unknownProductCostUnits)
    ? knownProductCostUnits / (knownProductCostUnits + unknownProductCostUnits)
    : 1;
  const policyApplicable = period.since >= policy.effectiveFrom;
  const exactProfitAvailable = metaAvailable && unknownProductCostUnits === 0 && policyApplicable;
  const totals = {
    estimatedRevenue: sum('estimatedRevenue'),
    realRevenue: sum('realRevenue'),
    revenue: sum('realRevenue'),
    productCost: sum('productCost'),
    knownProductCost: sum('productCost'),
    outboundShippingCost: sum('outboundShippingCost'),
    codCost: sum('codCost'),
    outboundFulfillmentCost: sum('outboundFulfillmentCost'),
    returnCost: sum('returnCost'),
    logisticsCost: sum('logisticsCost'),
    knownFulfillmentCost: sum('logisticsCost'),
    metaSpend: metaAvailable ? sum('metaSpend') : null,
    fixedCosts: sum('fixedCosts')
  };
  totals.totalCosts = exactProfitAvailable ? roundMoney(totals.productCost + totals.logisticsCost + totals.metaSpend + totals.fixedCosts) : null;
  totals.exactNetProfit = totals.totalCosts === null ? null : roundMoney(totals.realRevenue - totals.totalCosts);
  totals.knownContribution = totals.exactNetProfit;
  totals.roiPercent = totals.exactNetProfit === null ? null : percent(totals.exactNetProfit, totals.totalCosts);
  totals.estimatedCpa = metaAvailable ? (counts.sent ? roundMoney(totals.metaSpend / counts.sent) : 0) : null;
  totals.realCpa = metaAvailable ? (counts.delivered ? roundMoney(totals.metaSpend / counts.delivered) : 0) : null;

  const productRows = [...products.values()].map((row) => ({
    ...row,
    revenue: roundMoney(row.revenue),
    productCost: roundMoney(row.productCost),
    knownProductCost: roundMoney(row.productCost),
    marginBeforeLogisticsAndAds: row.unknownCostUnits ? null : roundMoney(row.revenue - row.productCost)
  })).sort((a, b) => b.revenue - a.revenue);

  const warnings = [];
  if (!Array.isArray(shopifyOrders)) warnings.push('No se pudo leer Shopify; la tasa de confirmación queda pendiente.');
  if (shopifyHistoricalGap) warnings.push('Shopify devolvió 0 pedidos para un periodo con actividad en Dropea; el historial de pedidos y la tasa de confirmación quedan pendientes, no se contabilizan como cero.');
  if (!metaAvailable) warnings.push('No se pudo leer Meta Ads; beneficio, ROI y CPA quedan pendientes.');
  if (unknownProductCostUnits) warnings.push(`${unknownProductCostUnits} unidades entregadas no tienen coste unitario configurado; el beneficio queda pendiente.`);
  if (!policyApplicable) warnings.push(`Las tarifas configuradas solo son válidas desde ${policy.effectiveFrom}; el beneficio anterior queda pendiente.`);

  return {
    period,
    status: period.current ? 'provisional' : 'reconstructed',
    statusLabel: period.current ? 'Mes abierto · provisional' : 'Reconstrucción con APIs actuales',
    counts,
    totals,
    coverage: {
      orders: true,
      shopify: shopifyAvailable,
      meta: metaAvailable,
      productCostPercent: Math.round(productCostCoverage * 100),
      fulfillmentCostPercent: 100,
      exactProfitAvailable,
      closedActual: false,
      explanation: exactProfitAvailable
        ? 'Beneficio calculado con ventas entregadas, costes unitarios configurados, tarifas logísticas, Meta Ads y coste fijo devengado.'
        : 'No se muestra beneficio hasta disponer de todas las fuentes y costes necesarios.'
    },
    warnings,
    days: dailyRows,
    products: productRows,
    policy
  };
}

function applyClosedActual(report, actual) {
  const live = report || null;
  const counts = {
    ...(live?.counts || {}),
    ...actual.counts,
    total: actual.counts.shopifyOrders,
    notSent: actual.counts.shopifyOrders - actual.counts.sent
  };
  const totals = {
    ...(live?.totals || {}),
    ...actual.totals,
    revenue: actual.totals.realRevenue,
    knownProductCost: actual.totals.productCost,
    knownFulfillmentCost: actual.totals.logisticsCost,
    knownContribution: actual.totals.exactNetProfit
  };
  const warnings = [...(report?.warnings || [])];
  const differences = {};
  if (live) {
    differences.returned = live.coverage?.orders ? (live.counts?.returned ?? 0) - actual.counts.returned : null;
    differences.metaSpend = live.coverage?.meta ? roundMoney((live.totals?.metaSpend ?? 0) - actual.totals.metaSpend) : null;
    differences.shopifyOrders = live.coverage?.shopify ? (live.counts?.shopifyOrders ?? 0) - actual.counts.shopifyOrders : null;
    if (differences.returned) warnings.push(`La API actual muestra ${Math.abs(differences.returned)} devolución${Math.abs(differences.returned) === 1 ? '' : 'es'} ${differences.returned > 0 ? 'más' : 'menos'} que el cierre; julio conserva el valor contable cerrado.`);
    if (differences.metaSpend) warnings.push(`Meta Ads ha variado ${roundMoney(Math.abs(differences.metaSpend)).toFixed(2)} € después del cierre; julio conserva el gasto validado.`);
    if (differences.shopifyOrders) warnings.push('Shopify no coincide hoy con el cierre de julio; se conserva el recuento validado del libro contable.');
  }
  return {
    ...report,
    status: actual.status,
    statusLabel: actual.label,
    counts,
    totals,
    coverage: {
      orders: true,
      shopify: true,
      meta: true,
      productCostPercent: 100,
      fulfillmentCostPercent: 100,
      exactProfitAvailable: true,
      closedActual: true,
      explanation: 'Cierre contable verificado: todas las partidas cuadran al céntimo con el libro de julio y no se reescriben con cambios posteriores de las APIs.'
    },
    warnings,
    audit: actual.audit,
    days: actual.days,
    liveComparison: live ? { differences, generatedAt: new Date().toISOString() } : null,
    sources: { orders: actual.source, shopify: actual.source, meta: actual.source, costs: actual.source }
  };
}

async function fetchOrders({ env, clientFactory, configLoader, period }) {
  const stores = configLoader(env);
  const byId = new Map();
  for (const store of stores) {
    const client = clientFactory({ token: store.token, market: store.market });
    const result = await client.listAll('listOrders', {
      store_id: Number(store.store_id),
      date_from: period.since,
      date_to: period.until,
      date_type: 'created_at',
      sort_by: 'created_at',
      sort_order: 'asc'
    }, { maxPages: 50, maxRecords: 5_000, requestedLimit: 100 });
    for (const order of result.items) byId.set(`${store.market}:${order.id}`, order);
  }
  return [...byId.values()];
}

export async function buildFinanceReport({
  month,
  force = false,
  env = process.env,
  now = new Date(),
  clientFactory = createDropeaV2IncidentClient,
  configLoader = loadDropeaV2IncidentStoreConfigs,
  metaLoader = getCampaignInsights,
  shopifyLoader = listShopifyOrdersByCreatedPeriod
} = {}) {
  const period = resolveFinancePeriod(month, { now });
  const cached = cache.get(period.month);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.report;
  const closedActual = getClosedFinanceActual(period.month);
  const [ordersResult, metaResult, shopifyResult] = await Promise.allSettled([
    fetchOrders({ env, clientFactory, configLoader, period }),
    metaLoader({ since: period.since, until: period.until, level: 'campaign', limit: 500, timeIncrement: 1 }),
    shopifyLoader({ since: period.since, until: period.until })
  ]);
  if (ordersResult.status === 'rejected' && !closedActual) throw ordersResult.reason;

  const report = aggregateFinanceReport({
    orders: ordersResult.status === 'fulfilled' ? ordersResult.value : [],
    shopifyOrders: shopifyResult.status === 'fulfilled' ? shopifyResult.value : null,
    metaRows: metaResult.status === 'fulfilled' ? metaResult.value : [],
    metaAvailable: metaResult.status === 'fulfilled',
    period
  });
  report.coverage.orders = ordersResult.status === 'fulfilled';
  report.generatedAt = new Date().toISOString();
  report.sources = {
    orders: ordersResult.status === 'fulfilled' ? 'Dropea Public API V2' : 'No disponible',
    shopify: shopifyResult.status === 'fulfilled' && report.coverage.shopify
      ? 'Shopify Admin API'
      : 'No disponible para este periodo',
    meta: metaResult.status === 'fulfilled' ? 'Meta Marketing API' : 'No disponible',
    costs: 'Tarifas contables efectivas desde 2026-05-01 y coste unitario por SKU'
  };
  if (ordersResult.status === 'rejected') report.warnings.push(`Dropea no disponible: ${ordersResult.reason instanceof Error ? ordersResult.reason.message : String(ordersResult.reason)}`);
  if (shopifyResult.status === 'rejected') report.warnings.push(`Shopify no disponible: ${shopifyResult.reason instanceof Error ? shopifyResult.reason.message : String(shopifyResult.reason)}`);
  if (metaResult.status === 'rejected') report.warnings.push(`Meta Ads no disponible: ${metaResult.reason instanceof Error ? metaResult.reason.message : String(metaResult.reason)}`);
  const finalReport = closedActual ? applyClosedActual(report, closedActual) : report;
  cache.set(period.month, { cachedAt: Date.now(), report: finalReport });
  return finalReport;
}

export function clearFinanceCache() {
  cache.clear();
}
