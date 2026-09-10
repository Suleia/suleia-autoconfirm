import {
  createDropeaV2IncidentClient,
  loadDropeaV2IncidentStoreConfigs
} from './clients/dropea-v2-incidents.mjs';
import { getCampaignInsights } from './clients/meta.mjs';

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
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(requested || ''))) {
    throw new Error('FINANCE_MONTH_INVALID');
  }
  if (requested > currentMonth) throw new Error('FINANCE_MONTH_IN_FUTURE');
  const [year, monthNumber] = requested.split('-').map(Number);
  const lastDay = requested === currentMonth
    ? Number(currentDay.slice(8, 10))
    : daysInMonth(year, monthNumber);
  const until = `${requested}-${String(lastDay).padStart(2, '0')}`;
  return {
    month: requested,
    since: `${requested}-01`,
    until,
    current: requested === currentMonth,
    timeZone
  };
}

const DELIVERED_SUBSTATUSES = new Set(['DELIVERED', 'PAID']);
const RETURNED_SUBSTATUSES = new Set([
  'REFUSED',
  'REJECTED',
  'RETURNED',
  'REFUSED_LOST_DAMAGED',
  'LOST_DAMAGED',
  'INDEMNIFIED'
]);
const CANCELLED_SUBSTATUSES = new Set(['CANCELLED', 'CANCELED']);

export function classifyFinanceOrder(order = {}) {
  const status = String(order.status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  if (status === 'DELIVERED' || DELIVERED_SUBSTATUSES.has(subStatus)) return 'delivered';
  if (RETURNED_SUBSTATUSES.has(status) || RETURNED_SUBSTATUSES.has(subStatus)) return 'returned';
  if (CANCELLED_SUBSTATUSES.has(status) || CANCELLED_SUBSTATUSES.has(subStatus)) return 'cancelled';
  if (status === 'ERROR' || ['DELIVERY_EXCEPTION', 'INCIDENT', 'ISSUE'].includes(subStatus)) return 'incident';
  return 'active';
}

function lineItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items : [];
}

function orderRevenue(order, category) {
  return category === 'delivered' ? number(order.total_amount) : 0;
}

function orderKnownProductCost(order, category) {
  if (category !== 'delivered') return { amount: 0, known: true };
  const items = lineItems(order);
  if (!items.length) return { amount: 0, known: false };
  let known = true;
  const amount = items.reduce((sum, item) => {
    const wholesale = number(item.wholesale_price);
    const quantity = Math.max(1, number(item.quantity));
    if (wholesale <= 0) known = false;
    return sum + (wholesale > 0 ? wholesale * quantity : 0);
  }, 0);
  return { amount, known };
}

function orderKnownFulfillmentCost(order) {
  const costs = order?.order_costs;
  if (!costs || typeof costs !== 'object') return { amount: 0, known: false };
  const fields = ['fulfillment_outbound', 'fulfillment_quantity_cost', 'fulfillment_return'];
  const present = fields.filter((field) => costs[field] !== undefined && costs[field] !== null);
  if (!present.length) return { amount: 0, known: false };
  return {
    amount: present.reduce((sum, field) => sum + number(costs[field]), 0),
    known: true
  };
}

function productName(item = {}) {
  return String(item.product_name || item.external_name || item.variant_name || item.sku || 'Producto sin nombre');
}

function daySkeleton(day) {
  return {
    day,
    orders: 0,
    active: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
    incidents: 0,
    revenue: 0,
    knownProductCost: 0,
    knownFulfillmentCost: 0,
    metaSpend: 0,
    knownContribution: 0
  };
}

export function aggregateFinanceReport({ orders = [], metaRows = [], period }) {
  const days = new Map();
  const products = new Map();
  const counts = { total: 0, active: 0, delivered: 0, returned: 0, cancelled: 0, incidents: 0 };
  let revenue = 0;
  let knownProductCost = 0;
  let knownFulfillmentCost = 0;
  let productCostKnownOrders = 0;
  let fulfillmentCostKnownOrders = 0;

  for (const order of orders) {
    const day = localDate(order.created_at, period.timeZone);
    if (!day || day < period.since || day > period.until) continue;
    const category = classifyFinanceOrder(order);
    const daily = days.get(day) || daySkeleton(day);
    const productCost = orderKnownProductCost(order, category);
    const fulfillmentCost = orderKnownFulfillmentCost(order);
    const recognizedRevenue = orderRevenue(order, category);

    counts.total += 1;
    counts[category === 'incident' ? 'incidents' : category] += 1;
    daily.orders += 1;
    daily[category === 'incident' ? 'incidents' : category] += 1;
    revenue += recognizedRevenue;
    knownProductCost += productCost.amount;
    knownFulfillmentCost += fulfillmentCost.amount;
    daily.revenue += recognizedRevenue;
    daily.knownProductCost += productCost.amount;
    daily.knownFulfillmentCost += fulfillmentCost.amount;
    if (category === 'delivered' && productCost.known) productCostKnownOrders += 1;
    if (fulfillmentCost.known) fulfillmentCostKnownOrders += 1;
    days.set(day, daily);

    if (category === 'delivered') {
      for (const item of lineItems(order)) {
        const name = productName(item);
        const quantity = Math.max(1, number(item.quantity));
        const itemRevenue = number(item.unit_price) * quantity;
        const wholesale = number(item.wholesale_price);
        const current = products.get(name) || {
          name,
          deliveredOrders: 0,
          units: 0,
          revenue: 0,
          knownProductCost: 0,
          unknownCostUnits: 0
        };
        current.deliveredOrders += 1;
        current.units += quantity;
        current.revenue += itemRevenue;
        if (wholesale > 0) current.knownProductCost += wholesale * quantity;
        else current.unknownCostUnits += quantity;
        products.set(name, current);
      }
    }
  }

  let metaSpend = 0;
  for (const row of metaRows) {
    const day = String(row.dateStart || row.date_start || '').slice(0, 10);
    if (!day || day < period.since || day > period.until) continue;
    const spend = number(row.spend);
    metaSpend += spend;
    const daily = days.get(day) || daySkeleton(day);
    daily.metaSpend += spend;
    days.set(day, daily);
  }

  const knownContribution = revenue - knownProductCost - knownFulfillmentCost - metaSpend;
  const deliveredDenominator = counts.delivered || 0;
  const productCostCoverage = deliveredDenominator ? productCostKnownOrders / deliveredDenominator : 1;
  const fulfillmentCostCoverage = counts.total ? fulfillmentCostKnownOrders / counts.total : 1;
  // The public V2 contract explicitly describes order_costs as a narrow subset,
  // never the full cost breakdown. Even 100% field coverage cannot prove net profit.
  const exactProfitAvailable = false;

  const dailyRows = [...days.values()]
    .map((row) => ({
      ...row,
      revenue: roundMoney(row.revenue),
      knownProductCost: roundMoney(row.knownProductCost),
      knownFulfillmentCost: roundMoney(row.knownFulfillmentCost),
      metaSpend: roundMoney(row.metaSpend),
      knownContribution: roundMoney(row.revenue - row.knownProductCost - row.knownFulfillmentCost - row.metaSpend)
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  const productRows = [...products.values()]
    .map((row) => ({
      ...row,
      revenue: roundMoney(row.revenue),
      knownProductCost: roundMoney(row.knownProductCost),
      marginBeforeLogisticsAndAds: row.unknownCostUnits ? null : roundMoney(row.revenue - row.knownProductCost)
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    period,
    counts,
    totals: {
      revenue: roundMoney(revenue),
      knownProductCost: roundMoney(knownProductCost),
      knownFulfillmentCost: roundMoney(knownFulfillmentCost),
      metaSpend: roundMoney(metaSpend),
      knownContribution: roundMoney(knownContribution),
      exactNetProfit: exactProfitAvailable ? roundMoney(knownContribution) : null
    },
    coverage: {
      orders: true,
      meta: true,
      productCostPercent: Math.round(productCostCoverage * 100),
      fulfillmentCostPercent: Math.round(fulfillmentCostCoverage * 100),
      exactProfitAvailable,
      explanation: 'Dropea V2 pública omite parte del coste de producto y el desglose logístico completo. Se muestran los importes comprobables y el beneficio exacto queda sin calcular para evitar una cifra falsa.'
    },
    days: dailyRows,
    products: productRows
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
  metaLoader = getCampaignInsights
} = {}) {
  const period = resolveFinancePeriod(month, { now });
  const cached = cache.get(period.month);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.report;

  const [ordersResult, metaResult] = await Promise.allSettled([
    fetchOrders({ env, clientFactory, configLoader, period }),
    metaLoader({ since: period.since, until: period.until, level: 'campaign', limit: 500, timeIncrement: 1 })
  ]);
  if (ordersResult.status === 'rejected') throw ordersResult.reason;
  const report = aggregateFinanceReport({
    orders: ordersResult.value,
    metaRows: metaResult.status === 'fulfilled' ? metaResult.value : [],
    period
  });
  if (metaResult.status === 'rejected') {
    report.coverage.meta = false;
    report.coverage.exactProfitAvailable = false;
    report.coverage.explanation = `No se pudo obtener Meta Ads para el periodo: ${metaResult.reason instanceof Error ? metaResult.reason.message : String(metaResult.reason)}`;
    report.totals.exactNetProfit = null;
  }
  report.generatedAt = new Date().toISOString();
  report.sources = {
    orders: 'Dropea Public API V2',
    meta: report.coverage.meta ? 'Meta Marketing API' : 'No disponible',
    costs: 'Campos raw wholesale_price y order_costs publicados por Dropea V2'
  };
  cache.set(period.month, { cachedAt: Date.now(), report });
  return report;
}

export function clearFinanceCache() {
  cache.clear();
}
