import fs from 'node:fs';
import { aggregateFinanceReport, resolveFinancePeriod } from '../autoconfirm/src/finance.mjs';
import { loadFinanceCostRules, loadFinanceExpenses } from '../autoconfirm/src/finance-data.mjs';

const DEFAULT_ENV = new URL('../../private-secrets/dropea-v2.env', import.meta.url);
const HOSTS = { ES: 'es.public-api.dropea.com', IT: 'it.public-api.dropea.com', PT: 'pt.public-api.dropea.com' };

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
}

function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function euros(value) {
  return Math.round(value) / 100;
}

function component(breakdown, name) {
  return cents(breakdown?.[name]) || 0;
}

function classify(order) {
  const status = String(order.status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  if (status === 'FINISH' && ['PAID', 'DELIVERED'].includes(subStatus)) return 'delivered';
  if (status === 'ERROR' && subStatus === 'REJECTED') return 'returned';
  if (subStatus === 'CANCELLED' || status === 'CANCELLED') return 'cancelled';
  if (status === 'ERROR' && subStatus === 'DELIVERY_EXCEPTION') return 'inAir';
  if (order.tracking_number || order.processing_at) return 'inAir';
  if (['SHIPPING', 'SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY', 'OUT_FOR_DELIVERY', 'PROCESSING'].includes(status)) return 'inAir';
  return 'pending';
}

function madridBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2026-05') throw new Error(`MONTH_NOT_ALLOWED:${month}`);
  const period = resolveFinancePeriod(month);
  return { from: period.fromTimestamp, to: period.toTimestamp };
}

async function request(url, token) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success === true) return payload.data;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 6) throw new Error(`DROPEA_HTTP_${response.status}`);
    const delay = Math.min(30_000, 1_000 * (2 ** attempt));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error('DROPEA_RETRY_EXHAUSTED');
}

async function listMonth({ host, token, storeId, month }) {
  const bounds = madridBounds(month);
  const result = [];
  const seen = new Set();
  for (let page = 1; page <= 30; page += 1) {
    const url = new URL(`https://${host}/dropshipper/orders`);
    for (const [key, value] of Object.entries({
      store_id: storeId,
      date_from: bounds.from,
      date_to: bounds.to,
      date_type: 'created_at',
      sort_by: 'created_at',
      sort_order: 'asc',
      page,
      limit: 100
    })) url.searchParams.set(key, String(value));
    const data = await request(url, token);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const order of items) {
      const key = String(order.id);
      if (seen.has(key)) throw new Error(`DROPEA_DUPLICATE_ORDER:${key}`);
      seen.add(key);
      result.push(order);
    }
    if (items.length < 100) return result;
  }
  throw new Error(`DROPEA_PAGE_LIMIT:${month}`);
}

function auditMonth(month, orders) {
  const statusCounts = { delivered: 0, returned: 0, cancelled: 0, inAir: 0, pending: 0 };
  const sums = {
    deliveredRevenue: 0,
    product: 0,
    outboundShipping: 0,
    outboundFulfillment: 0,
    cod: 0,
    returnShipping: 0,
    returnFulfillment: 0,
    returnCombined: 0,
    publishedTotalExpenses: 0,
    reconstructedExpenses: 0,
    publishedTotalResidual: 0,
    estimatedProfit: 0
  };
  const controls = {
    missingBreakdown: 0,
    estimatedBreakdown: 0,
    finalBreakdown: 0,
    missingFinalAmount: 0,
    totalMismatchOrders: 0,
    profitMismatchOrders: 0,
    returnedWithoutExact526: 0,
    returnedExact526: 0
  };
  const totalMismatchSample = [];
  const profitMismatchSample = [];
  const returnedCostDistribution = new Map();

  for (const order of orders) {
    const category = classify(order);
    statusCounts[category] += 1;
    if (!['delivered', 'returned'].includes(category)) continue;
    const breakdown = order.expenses_breakdown;
    if (!breakdown || typeof breakdown !== 'object') {
      controls.missingBreakdown += 1;
      continue;
    }
    if (breakdown.is_estimate === false) controls.finalBreakdown += 1;
    else controls.estimatedBreakdown += 1;

    const product = component(breakdown, 'product_price');
    const outboundShipping = component(breakdown, 'shipping_outbound_price');
    const outboundFulfillment = component(breakdown, 'fulfillment_outbound_price') + component(breakdown, 'fulfillment_extra_unit_price');
    const cod = category === 'delivered' ? component(breakdown, 'cod_commission') : 0;
    const returnShipping = category === 'returned' ? component(breakdown, 'shipping_refused_price') : 0;
    const returnFulfillment = category === 'returned' ? component(breakdown, 'fulfillment_refused_price') : 0;
    const reconstructed = product + outboundShipping + outboundFulfillment + cod + returnShipping + returnFulfillment;
    const direct = cents(breakdown.total_expenses);
    const residual = direct === null ? 0 : direct - reconstructed;

    sums.product += product;
    sums.outboundShipping += outboundShipping;
    sums.outboundFulfillment += outboundFulfillment;
    sums.cod += cod;
    sums.returnShipping += returnShipping;
    sums.returnFulfillment += returnFulfillment;
    sums.returnCombined += returnShipping + returnFulfillment;
    sums.publishedTotalExpenses += direct || 0;
    sums.reconstructedExpenses += reconstructed;
    sums.publishedTotalResidual += residual;

    if (direct !== null && direct !== reconstructed + residual) throw new Error('ARITHMETIC_CONTROL_FAILED');
    if (direct !== null && Math.abs(direct - reconstructed) > 0) {
      controls.totalMismatchOrders += 1;
      if (totalMismatchSample.length < 20) totalMismatchSample.push({ orderId: String(order.id), direct: euros(direct), components: euros(reconstructed), residual: euros(residual) });
    }

    if (category === 'delivered') {
      const revenue = cents(order.final_amount ?? order.total_amount);
      if (revenue === null) controls.missingFinalAmount += 1;
      else sums.deliveredRevenue += revenue;
      const estimated = cents(order.estimated_profit);
      if (estimated !== null) sums.estimatedProfit += estimated;
      if (direct !== null && revenue !== null && estimated !== null && Math.abs((revenue - direct) - estimated) > 1) {
        controls.profitMismatchOrders += 1;
        if (profitMismatchSample.length < 20) profitMismatchSample.push({ orderId: String(order.id), apiEstimatedProfit: euros(estimated), revenueLessExpenses: euros(revenue - direct) });
      }
    } else {
      const returnCombined = returnShipping + returnFulfillment;
      returnedCostDistribution.set(returnCombined, (returnedCostDistribution.get(returnCombined) || 0) + 1);
      if (returnCombined === 526) controls.returnedExact526 += 1;
      else controls.returnedWithoutExact526 += 1;
    }
  }

  return {
    month,
    orderCount: orders.length,
    statusCounts,
    sums: Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, euros(value)])),
    controls,
    returnedCostDistribution: Object.fromEntries([...returnedCostDistribution.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => [euros(value).toFixed(2), count])),
    totalMismatchSample,
    profitMismatchSample
  };
}

const envPath = process.env.DROPEA_AUDIT_ENV_FILE || DEFAULT_ENV;
const env = readEnv(envPath);
const market = String(env.DROPEA_PUBLIC_API_MARKET || 'ES').toUpperCase();
const host = HOSTS[market];
const token = env.DROPEA_PUBLIC_API_TOKEN;
const storeId = process.env.DROPEA_AUDIT_STORE_ID || '16088';
if (!host || !token) throw new Error('DROPEA_AUDIT_CONFIG_MISSING');

const months = (process.argv.slice(2).length ? process.argv.slice(2) : ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
const results = [];
for (const month of months) {
  const orders = await listMonth({ host, token, storeId, month });
  const independent = auditMonth(month, orders);
  const canonical = aggregateFinanceReport({
    orders,
    period: resolveFinancePeriod(month),
    rules: loadFinanceCostRules(),
    expenses: loadFinanceExpenses(),
    metaRows: [],
    metaAvailable: true
  });
  results.push({
    ...independent,
    canonicalBeforeMeta: {
      counts: canonical.counts,
      totals: canonical.totals,
      controls: canonical.controls,
      quality: canonical.quality
    }
  });
}
process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Dropea Public API V2 /dropshipper/orders (read-only)', results })}\n`);

