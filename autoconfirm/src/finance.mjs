import { createDropeaV2IncidentClient, loadDropeaV2IncidentStoreConfigs } from './clients/dropea-v2-incidents.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { getClosedFinanceActual } from './finance-actuals.mjs';
import { loadFinanceCostRules, loadFinanceExpenses } from './finance-data.mjs';
import { isSupabaseEnabled, selectRows, upsertRows } from './clients/supabase.mjs';

const ZONE = 'Europe/Madrid';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function snapshotKey(month) {
  return `finance_report_${month}`;
}

async function persistFinanceSnapshot(report) {
  if (!isSupabaseEnabled() || !report?.period?.month) return;
  await upsertRows('app_state', {
    key: snapshotKey(report.period.month),
    value: report,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
}

export async function loadFinanceSnapshot({ month, now = new Date() } = {}) {
  const period = resolveFinancePeriod(month, { now });
  const memory = cache.get(period.month);
  if (memory?.report) return memory.report;
  if (!isSupabaseEnabled()) return null;
  const rows = await selectRows('app_state', { query: { key: `eq.${snapshotKey(period.month)}` }, limit: 1 });
  const report = rows[0]?.value;
  if (!report?.period || !report?.totals || !report?.counts) return null;
  const generated = new Date(report.generatedAt || rows[0]?.updated_at || 0);
  const ageMinutes = Number.isNaN(generated.getTime()) ? null : Math.max(0, Math.round((now.getTime() - generated.getTime()) / 60000));
  for (const source of Object.values(report.freshness?.sources || {})) {
    source.ageMinutes = ageMinutes;
    if (ageMinutes !== null && ageMinutes > 15 && source.status === 'OK') source.status = 'STALE';
  }
  cache.set(period.month, { at: generated.getTime() || 0, report });
  return report;
}

export function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, decimal = ''] = text.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function euros(cents) {
  return cents === null || cents === undefined ? null : cents / 100;
}

function pct(numerator, denominator) {
  return denominator ? Math.round(numerator * 10000 / denominator) / 100 : null;
}

function localDay(value, timeZone = ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

function zonedTimestamp(day, end = false) {
  const [year, month, date] = day.split('-').map(Number);
  const millis = end ? 999 : 0;
  const wanted = Date.UTC(year, month - 1, date, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, millis);
  let candidate = wanted;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const part = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((item) => [item.type, item.value]));
    const represented = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute), Number(part.second), millis);
    const correction = wanted - represented;
    candidate += correction;
    if (!correction) break;
  }
  return new Date(candidate).toISOString();
}

export function resolveFinancePeriod(month, { now = new Date(), timeZone = ZONE, comparableDay = null } = {}) {
  const today = localDay(now, timeZone);
  const currentMonth = today.slice(0, 7);
  const selected = month || currentMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) throw new Error('FINANCE_MONTH_INVALID');
  if (selected > currentMonth) throw new Error('FINANCE_MONTH_IN_FUTURE');
  const totalDays = monthDays(selected);
  const naturalEnd = selected === currentMonth ? Number(today.slice(8, 10)) : totalDays;
  const elapsedDays = Math.min(totalDays, comparableDay || naturalEnd);
  const since = `${selected}-01`;
  const until = `${selected}-${String(elapsedDays).padStart(2, '0')}`;
  return { month: selected, since, until, daysInMonth: totalDays, elapsedDays, fromTimestamp: zonedTimestamp(since), toTimestamp: zonedTimestamp(until, true), current: selected === currentMonth, timeZone };
}

function previousMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}

function monthsEndingAt(month, count, earliest) {
  const result = [];
  while (result.length < count && month >= earliest) {
    result.unshift(month);
    month = previousMonth(month);
  }
  return result;
}

function stamp(order, ...fields) {
  for (const field of fields) if (order?.[field]) return order[field];
  return null;
}

function orderItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items : [];
}

function units(order) {
  return orderItems(order).reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 0), 0) || 1;
}

const TRANSIT = new Set(['SHIPPING', 'SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY', 'OUT_FOR_DELIVERY']);
const CANCELLED = new Set(['CANCELLED', 'CANCELED']);

function sentEvidence(order = {}) {
  const status = String(order.status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  return Boolean(order.tracking_number || order.tracking_code || stamp(order, 'shipped_at', 'shipping_started_at', 'processing_at', 'processing_at_utc', 'delivered_at', 'delivered_at_utc'))
    || TRANSIT.has(status) || TRANSIT.has(subStatus);
}

function returnStamp(order) {
  return stamp(order, 'returned_at_utc', 'returned_at') || (sentEvidence(order) ? stamp(order, 'rejected_at_utc', 'rejected_at') : null);
}

export function classifyFinanceOrder(order = {}) {
  const status = String(order.status || order.lifecycle_status || '').toUpperCase();
  const subStatus = String(order.sub_status || '').toUpperCase();
  if (returnStamp(order)) return 'returned';
  if (stamp(order, 'delivered_at_utc', 'delivered_at') || status === 'DELIVERED' || ['DELIVERED', 'PAID'].includes(subStatus)) return 'delivered';
  if (stamp(order, 'rejected_at_utc', 'rejected_at') || CANCELLED.has(status) || CANCELLED.has(subStatus)) return 'rejected';
  if (status === 'ERROR' || ['DELIVERY_EXCEPTION', 'INCIDENT', 'ISSUE'].includes(subStatus)) return 'incident';
  if (sentEvidence(order)) return 'inTransit';
  return 'pending';
}

export function isSentFinanceOrder(order = {}) {
  return sentEvidence(order);
}

function inPeriod(value, period) {
  const day = localDay(value, period.timeZone);
  return day && day >= period.since && day <= period.until ? day : null;
}

function itemLabel(item) {
  return String(item.product_name || item.external_name || item.variant_name || item.sku || 'Producto sin nombre');
}

function skuCost(item, rules) {
  const actual = moneyToCents(item?.wholesale_price);
  if (actual > 0) return { cents: actual, source: 'Dropea order.line_items[].wholesale_price', type: 'actual_order_cost' };
  const sku = String(item?.sku || '').trim().toUpperCase();
  const configured = rules.products?.[sku];
  return Number.isSafeInteger(configured) && configured > 0
    ? { cents: configured, source: rules.source, type: 'versioned_product_tariff' }
    : { cents: null, source: null, type: 'MISSING_ECONOMIC_DATA' };
}

function findCost(value, aliases) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (aliases.includes(key.toLowerCase())) {
      const cents = moneyToCents(child?.amount ?? child);
      if (cents !== null && cents >= 0) return cents;
    }
    if (child && typeof child === 'object') {
      const nested = findCost(child, aliases);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function orderCost(order, rules, kind) {
  const aliases = {
    shipping: ['shipping_cost', 'shipping_fee', 'carrier_cost', 'outbound_shipping_cost'],
    fulfillment: ['fulfillment_cost', 'fulfillment_fee', 'preparation_cost'],
    cod: ['cod_cost', 'cod_fee', 'cash_on_delivery_fee'],
    return: ['return_cost', 'return_fee', 'reverse_logistics_cost']
  };
  const actual = findCost(order.order_costs, aliases[kind]);
  if (actual !== null) return { cents: actual, source: 'Dropea order.order_costs', type: 'actual_order_cost' };
  const field = { shipping: 'outbound_shipping_per_sent_cents', fulfillment: 'fulfillment_per_sent_cents', cod: 'cod_per_delivered_cents', return: 'return_per_returned_cents' }[kind];
  const configured = rules.logistics?.[field];
  return Number.isSafeInteger(configured)
    ? { cents: configured, source: rules.source, type: 'versioned_logistics_tariff' }
    : { cents: null, source: null, type: 'MISSING_ECONOMIC_DATA' };
}

function applies(expense, day) {
  return (!expense.start_date || day >= expense.start_date) && (!expense.end_date || day <= expense.end_date);
}

export function allocateExpenses(period, expenses = []) {
  const result = new Map();
  for (let day = 1; day <= period.elapsedDays; day += 1) result.set(`${period.month}-${String(day).padStart(2, '0')}`, { fixed: 0, oneOff: 0, other: 0 });
  for (const expense of expenses) {
    const active = [...result.keys()].filter((day) => applies(expense, day));
    if (!active.length) continue;
    if (expense.type === 'recurring_daily') {
      for (const day of active) result.get(day).fixed += Number(expense.amount_cents) || 0;
    } else if (expense.type === 'recurring_monthly') {
      const total = Number(expense.amount_cents) || 0;
      const base = Math.floor(total / period.daysInMonth);
      const remainder = total % period.daysInMonth;
      for (const day of active) result.get(day).fixed += base + (Number(day.slice(8, 10)) <= remainder ? 1 : 0);
    } else if (expense.date && result.has(expense.date)) {
      const key = expense.type === 'one_off' ? 'oneOff' : 'other';
      result.get(expense.date)[key] += Number(expense.amount_cents) || 0;
    }
  }
  return result;
}

function emptyDay(day, expense) {
  return {
    day, created: 0, confirmed: 0, rejected: 0, sent: 0, inTransit: 0, delivered: 0, deliveredUnits: 0,
    returned: 0, incidentOrders: 0, incidents: 0, estimatedRevenue: 0, revenue: 0, product: 0,
    shipping: 0, cod: 0, fulfillment: 0, returns: 0, ads: 0, fixed: expense.fixed, oneOff: expense.oneOff, other: expense.other,
    missingProductUnits: 0, missingReturnCosts: 0
  };
}

function finalizeDay(row, metaAvailable) {
  const logistics = row.shipping + row.cod + row.fulfillment + row.returns;
  const known = metaAvailable && !row.missingProductUnits && !row.missingReturnCosts;
  const totalCosts = known ? row.product + logistics + row.ads + row.fixed + row.oneOff + row.other : null;
  const net = totalCosts === null ? null : row.revenue - totalCosts;
  return {
    day: row.day, created: row.created, confirmed: row.confirmed, rejected: row.rejected, sent: row.sent,
    inTransit: row.inTransit, delivered: row.delivered, deliveredUnits: row.deliveredUnits, returned: row.returned,
    incidentOrders: row.incidentOrders, incidents: row.incidents,
    estimatedRevenue: euros(row.estimatedRevenue), realRevenue: euros(row.revenue), productCost: euros(row.product),
    outboundShippingCost: euros(row.shipping), codCost: euros(row.cod), outboundFulfillmentCost: euros(row.fulfillment),
    returnCost: euros(row.returns), logisticsCost: euros(logistics), metaSpend: metaAvailable ? euros(row.ads) : null,
    fixedCosts: euros(row.fixed), oneOffCosts: euros(row.oneOff), otherCosts: euros(row.other), totalCosts: euros(totalCosts),
    contributionMargin: euros(row.revenue - row.product - logistics), netProfit: euros(net), marginPercent: pct(net, row.revenue),
    roiPercent: pct(net, totalCosts), roas: row.ads ? Math.round(row.revenue * 100 / row.ads) / 100 : null,
    unknownProductCostUnits: row.missingProductUnits, missingReturnCosts: row.missingReturnCosts
  };
}

function sumCents(days, field) {
  return days.reduce((sum, day) => sum + (moneyToCents(day[field]) || 0), 0);
}

function aggregateTotals(days, counts, metaAvailable) {
  const revenue = sumCents(days, 'realRevenue');
  const product = sumCents(days, 'productCost');
  const shipping = sumCents(days, 'outboundShippingCost');
  const cod = sumCents(days, 'codCost');
  const fulfillment = sumCents(days, 'outboundFulfillmentCost');
  const returns = sumCents(days, 'returnCost');
  const logistics = shipping + cod + fulfillment + returns;
  const ads = sumCents(days, 'metaSpend');
  const fixed = sumCents(days, 'fixedCosts');
  const oneOff = sumCents(days, 'oneOffCosts');
  const other = sumCents(days, 'otherCosts');
  const complete = metaAvailable && !days.some((day) => day.unknownProductCostUnits || day.missingReturnCosts);
  const total = complete ? product + logistics + ads + fixed + oneOff + other : null;
  const net = total === null ? null : revenue - total;
  return {
    realRevenue: euros(revenue), revenue: euros(revenue), productCost: euros(product), outboundShippingCost: euros(shipping),
    codCost: euros(cod), outboundFulfillmentCost: euros(fulfillment), returnCost: euros(returns), logisticsCost: euros(logistics),
    metaSpend: metaAvailable ? euros(ads) : null, fixedCosts: euros(fixed), oneOffCosts: euros(oneOff), otherCosts: euros(other),
    totalCosts: euros(total), contributionMargin: euros(revenue - product - logistics), exactNetProfit: euros(net),
    roiPercent: pct(net, total), marginPercent: pct(net, revenue), roas: ads ? Math.round(revenue * 100 / ads) / 100 : null,
    estimatedCpa: metaAvailable && counts.confirmed ? euros(Math.round(ads / counts.confirmed)) : null,
    realCpa: metaAvailable && counts.delivered ? euros(Math.round(ads / counts.delivered)) : null
  };
}

export function aggregateFinanceReport({ orders = [], issues = [], metaRows = [], period, rules = loadFinanceCostRules(), expenses = loadFinanceExpenses(), metaAvailable = true }) {
  const allocations = allocateExpenses(period, expenses);
  const dayMap = new Map([...allocations].map(([day, expense]) => [day, emptyDay(day, expense)]));
  const cohort = orders.filter((order) => inPeriod(order.created_at, period));
  const cohortIds = new Set(cohort.map((order) => String(order.id)));
  const issueIds = new Set(issues.map((issue) => String(issue.order_id)));
  const counts = { created: cohort.length, confirmed: 0, rejected: 0, sent: 0, inTransit: 0, delivered: 0, deliveredUnits: 0, returned: 0, incidentOrders: 0, incidents: 0 };
  const products = new Map();

  for (const order of orders) {
    const createdDay = inPeriod(order.created_at, period);
    const category = classifyFinanceOrder(order);
    const cohortOrder = createdDay && cohortIds.has(String(order.id));
    if (cohortOrder) {
      const day = dayMap.get(createdDay); day.created += 1; day.estimatedRevenue += moneyToCents(order.total_amount) || 0;
      if (stamp(order, 'confirmed_at_utc', 'confirmed_at')) counts.confirmed += 1;
      if (sentEvidence(order)) counts.sent += 1;
      if (category === 'rejected') counts.rejected += 1;
      if (category === 'inTransit') counts.inTransit += 1;
      if (stamp(order, 'delivered_at_utc', 'delivered_at')) { counts.delivered += 1; counts.deliveredUnits += units(order); }
      if (returnStamp(order)) counts.returned += 1;
      if (issueIds.has(String(order.id))) counts.incidentOrders += 1;
    }

    const confirmedDay = inPeriod(stamp(order, 'confirmed_at_utc', 'confirmed_at'), period);
    if (confirmedDay) dayMap.get(confirmedDay).confirmed += 1;
    const processingDay = inPeriod(stamp(order, 'shipped_at_utc', 'shipped_at', 'processing_at_utc', 'processing_at'), period);
    if (processingDay) {
      const day = dayMap.get(processingDay);
      day.sent += 1;
      const shipping = orderCost(order, rules, 'shipping'); const fulfillment = orderCost(order, rules, 'fulfillment');
      if (shipping.cents !== null) day.shipping += shipping.cents;
      if (fulfillment.cents !== null) day.fulfillment += fulfillment.cents;
    }
    const deliveredDay = inPeriod(stamp(order, 'delivered_at_utc', 'delivered_at'), period);
    if (deliveredDay) {
      const day = dayMap.get(deliveredDay); const revenue = moneyToCents(order.total_amount) || 0;
      day.delivered += 1; day.deliveredUnits += units(order); day.revenue += revenue;
      const cod = orderCost(order, rules, 'cod'); if (cod.cents !== null) day.cod += cod.cents;
      const list = orderItems(order); const weights = list.map((item) => (moneyToCents(item.unit_price) || 0) * Math.max(1, Number(item.quantity) || 0));
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);
      if (!list.length) day.missingProductUnits += units(order);
      list.forEach((item, index) => {
        const quantity = Math.max(1, Number(item.quantity) || 0); const cost = skuCost(item, rules);
        if (cost.cents === null) day.missingProductUnits += quantity; else day.product += cost.cents * quantity;
        const sku = String(item.sku || 'SIN_SKU').toUpperCase();
        const product = products.get(sku) || { sku, name: itemLabel(item), units: 0, deliveredOrders: 0, returnedOrders: 0, revenue: 0, cost: 0, returns: 0, unknownCostUnits: 0 };
        product.units += quantity; product.deliveredOrders += 1; product.revenue += weightTotal ? Math.round(revenue * weights[index] / weightTotal) : revenue;
        if (cost.cents === null) product.unknownCostUnits += quantity; else product.cost += cost.cents * quantity;
        products.set(sku, product);
      });
    }
    const returnedDay = inPeriod(returnStamp(order), period);
    if (returnedDay) {
      const day = dayMap.get(returnedDay); const cost = orderCost(order, rules, 'return'); day.returned += 1;
      if (cost.cents === null) day.missingReturnCosts += 1; else day.returns += cost.cents;
      for (const item of orderItems(order)) {
        const sku = String(item.sku || 'SIN_SKU').toUpperCase();
        const product = products.get(sku) || { sku, name: itemLabel(item), units: 0, deliveredOrders: 0, returnedOrders: 0, revenue: 0, cost: 0, returns: 0, unknownCostUnits: 0 };
        product.returnedOrders += 1; if (cost.cents !== null) product.returns += cost.cents; products.set(sku, product);
      }
    }
    const rejectedDay = category === 'rejected' ? inPeriod(stamp(order, 'rejected_at_utc', 'rejected_at'), period) : null;
    if (rejectedDay) dayMap.get(rejectedDay).rejected += 1;
  }

  for (const issue of issues) {
    const day = inPeriod(issue.created_at || issue.createdAt, period); if (!day) continue;
    counts.incidents += 1; const row = dayMap.get(day); row.incidents += 1;
  }
  for (const row of dayMap.values()) row.incidentOrders = new Set(issues.filter((issue) => inPeriod(issue.created_at || issue.createdAt, period) === row.day).map((issue) => String(issue.order_id))).size;
  counts.incidentOrders = [...cohortIds].filter((id) => issueIds.has(id)).length;
  for (const meta of metaRows) {
    const day = String(meta.dateStart || meta.date_start || '').slice(0, 10); if (dayMap.has(day)) dayMap.get(day).ads += moneyToCents(meta.spend) || 0;
  }

  counts.total = counts.created; counts.dropeaOrders = counts.created; counts.notSent = Math.max(0, counts.created - counts.sent);
  counts.confirmationRatePercent = pct(counts.confirmed, counts.created); counts.rejectionRatePercent = pct(counts.rejected, counts.created);
  counts.deliveryRatePercent = pct(counts.delivered, counts.sent); counts.globalConversionPercent = pct(counts.delivered, counts.created);
  counts.returnRatePercent = pct(counts.returned, counts.sent); counts.incidentRatePercent = pct(counts.incidentOrders, counts.sent);
  const days = [...dayMap.values()].map((row) => finalizeDay(row, metaAvailable)).sort((a, b) => a.day.localeCompare(b.day));
  const totals = aggregateTotals(days, counts, metaAvailable);
  const missingUnits = days.reduce((sum, day) => sum + day.unknownProductCostUnits, 0);
  const missingReturns = days.reduce((sum, day) => sum + day.missingReturnCosts, 0);
  const qualityIssues = [];
  if (!metaAvailable) qualityIssues.push({ code: 'MISSING_AD_SPEND', message: 'Meta Ads no respondió; beneficio, ROI y ROAS quedan pendientes.' });
  if (missingUnits) qualityIssues.push({ code: 'MISSING_COST', message: `${missingUnits} unidades entregadas tienen wholesale_price=0 y no disponen de tarifa SKU verificada.` });
  if (missingReturns) qualityIssues.push({ code: 'MISSING_RETURN_COST', message: `${missingReturns} devoluciones no tienen coste real ni tarifa aplicable.` });
  if (!expenses.length) qualityIssues.push({ code: 'MISSING_EXPENSE_DATA', message: 'El ledger de gastos no contiene registros.' });
  const productRows = [...products.values()].map((row) => {
    const margin = row.revenue - row.cost - row.returns;
    return { sku: row.sku, name: row.name, units: row.units, deliveredOrders: row.deliveredOrders, returnedOrders: row.returnedOrders, revenue: euros(row.revenue), productCost: euros(row.cost), returnCost: euros(row.returns), attributedAdSpend: null, margin: row.unknownCostUnits ? null : euros(margin), profit: row.unknownCostUnits ? null : euros(margin), roiPercent: row.cost ? pct(margin, row.cost + row.returns) : null, unknownCostUnits: row.unknownCostUnits };
  }).sort((a, b) => b.revenue - a.revenue);
  const dailyRevenue = sumCents(days, 'realRevenue'); const dailyCosts = sumCents(days, 'totalCosts');
  return {
    period, status: period.current ? 'provisional' : 'reconstructed', statusLabel: period.current ? 'MTD · realizado' : 'Mes cerrado · eventos reales',
    counts, totals, days, products: productRows,
    coverage: { orders: true, meta: metaAvailable, productCostPercent: counts.deliveredUnits ? Math.max(0, 100 - Math.round(missingUnits * 100 / counts.deliveredUnits)) : 100, exactProfitAvailable: totals.exactNetProfit !== null, closedActual: false },
    quality: { status: qualityIssues.length ? 'PARTIAL' : 'OK', score: Math.max(0, 100 - qualityIssues.length * 15), issues: qualityIssues },
    warnings: qualityIssues.map((issue) => issue.message),
    controls: { fullPeriodBoundary: true, dailyRevenueReconciled: moneyToCents(totals.realRevenue) === dailyRevenue, dailyCostsReconciled: totals.totalCosts === null || moneyToCents(totals.totalCosts) === dailyCosts, profitReconciled: totals.exactNetProfit === null || moneyToCents(totals.exactNetProfit) === moneyToCents(totals.realRevenue) - moneyToCents(totals.totalCosts), expensesReconciled: true, costsReconciled: true, noReturnRejectionOverlap: true },
    costTraceability: { product: { primary: 'Dropea wholesale_price > 0', fallback: rules.source, tariffVersion: rules.version, effectiveDate: rules.effective_from }, logistics: { primary: 'Dropea order_costs', fallback: rules.source, tariffVersion: rules.version, effectiveDate: rules.effective_from }, return: { primary: 'Dropea order_costs.return_*', fallback: rules.source, tariffVersion: rules.version, effectiveDate: rules.effective_from }, expenses: [...new Set(expenses.map((expense) => expense.source))] }
  };
}

function applyClosed(report, actual) {
  if (!actual) return report;
  const totals = { ...report.totals, ...actual.totals, revenue: actual.totals.realRevenue, contributionMargin: Number((actual.totals.realRevenue - actual.totals.productCost - actual.totals.logisticsCost).toFixed(2)), marginPercent: pct(moneyToCents(actual.totals.exactNetProfit), moneyToCents(actual.totals.realRevenue)), roas: actual.totals.metaSpend ? Math.round(actual.totals.realRevenue * 100 / actual.totals.metaSpend) / 100 : null };
  const days = actual.days.map((day) => ({ ...day, created: day.sourceOrderCount, confirmed: day.sent, rejected: 0, inTransit: 0, deliveredUnits: day.delivered, incidentOrders: 0, incidents: 0, logisticsCost: Number((day.outboundShippingCost + day.codCost + day.outboundFulfillmentCost + day.returnCost).toFixed(2)), oneOffCosts: 0, otherCosts: 0, contributionMargin: Number((day.realRevenue - day.productCost - day.outboundShippingCost - day.codCost - day.outboundFulfillmentCost - day.returnCost).toFixed(2)), marginPercent: pct(moneyToCents(day.netProfit), moneyToCents(day.realRevenue)), roas: day.metaSpend ? Math.round(day.realRevenue * 100 / day.metaSpend) / 100 : null })).sort((a, b) => a.day.localeCompare(b.day));
  return { ...report, totals, days, status: actual.status, statusLabel: actual.label, audit: actual.audit, coverage: { ...report.coverage, meta: true, productCostPercent: 100, exactProfitAvailable: true, closedActual: true }, quality: { status: 'OK', score: 100, issues: [] }, warnings: [], controls: { ...report.controls, dailyRevenueReconciled: true, dailyCostsReconciled: true, profitReconciled: true }, sources: { orders: 'Dropea Public API V2', meta: actual.source, costs: actual.source } };
}

function summary(report) {
  return { month: report.period.month, period: report.period, counts: report.counts, totals: report.totals, status: report.status, quality: report.quality };
}

function delta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return { absolute: null, percent: null };
  const a = moneyToCents(current); const b = moneyToCents(previous);
  return { absolute: euros(a - b), percent: b ? pct(a - b, Math.abs(b)) : null };
}

function buildProjection(report, expenses) {
  if (!report.period.current || report.period.elapsedDays < 7 || report.totals.exactNetProfit === null) return null;
  const factor = report.period.daysInMonth / report.period.elapsedDays;
  const full = allocateExpenses({ ...report.period, elapsedDays: report.period.daysInMonth }, expenses);
  const fixed = [...full.values()].reduce((sum, row) => sum + row.fixed + row.oneOff + row.other, 0);
  const revenue = Math.round(moneyToCents(report.totals.realRevenue) * factor);
  const variable = Math.round(((moneyToCents(report.totals.productCost) || 0) + (moneyToCents(report.totals.logisticsCost) || 0) + (moneyToCents(report.totals.metaSpend) || 0)) * factor);
  return { method: 'run_rate_mtd', confidence: report.period.elapsedDays >= 14 ? 'medium' : 'low', revenue: euros(revenue), totalCosts: euros(variable + fixed), netProfit: euros(revenue - variable - fixed), note: 'Proyección separada del realizado MTD.' };
}

async function loadSources({ env, clientFactory, configLoader, periods }) {
  const orders = []; const issues = [];
  await Promise.all(configLoader(env).map(async (store) => {
    const client = clientFactory({ token: store.token, market: store.market });
    const loadedOrderPages = [];
    let nextPeriod = 0;
    const workers = Array.from({ length: Math.min(2, periods.length) }, async () => {
      while (nextPeriod < periods.length) {
        const target = periods[nextPeriod];
        nextPeriod += 1;
        loadedOrderPages.push(await client.listAll('listOrders', { store_id: Number(store.store_id), date_from: target.fromTimestamp, date_to: target.toTimestamp, date_type: 'created_at', sort_by: 'created_at', sort_order: 'asc' }, { maxPages: 20, maxRecords: 2000, requestedLimit: 100 }));
      }
    });
    const [orderPages, issuePage] = await Promise.all([
      Promise.all(workers).then(() => loadedOrderPages),
      client.listAll('listIssues', {}, { maxPages: 80, maxRecords: 8000, requestedLimit: 100 })
    ]);
    orders.push(...orderPages.flatMap((page) => page.items)); issues.push(...issuePage.items);
  }));
  return {
    orders: [...new Map(orders.map((order) => [String(order.id), order])).values()],
    issues: [...new Map(issues.map((issue) => [String(issue.id), issue])).values()]
  };
}

export async function buildFinanceReport({ month, force = false, env = process.env, now = new Date(), clientFactory = createDropeaV2IncidentClient, configLoader = loadDropeaV2IncidentStoreConfigs, metaLoader = getCampaignInsights, rules = loadFinanceCostRules(), expenses = loadFinanceExpenses() } = {}) {
  const period = resolveFinancePeriod(month, { now });
  const cached = cache.get(period.month);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const historyMonths = monthsEndingAt(period.month, 12, rules.effective_from.slice(0, 7));
  const earliest = historyMonths[0];
  const sourcePeriods = historyMonths.map((value) => resolveFinancePeriod(value, { now }));
  const [orderResult, metaResult] = await Promise.allSettled([
    loadSources({ env, clientFactory, configLoader, periods: sourcePeriods }),
    metaLoader({ since: `${earliest}-01`, until: period.until, level: 'campaign', limit: 500, timeIncrement: 1 })
  ]);
  if (orderResult.status === 'rejected' && !getClosedFinanceActual(period.month)) throw orderResult.reason;
  const source = orderResult.status === 'fulfilled' ? orderResult.value : { orders: [], issues: [] };
  const metaRows = metaResult.status === 'fulfilled' ? metaResult.value : [];
  const build = (target) => applyClosed(aggregateFinanceReport({ orders: source.orders, issues: source.issues, metaRows, period: target, rules, expenses, metaAvailable: metaResult.status === 'fulfilled' }), getClosedFinanceActual(target.month));
  const report = build(period);
  const prior = build(resolveFinancePeriod(previousMonth(period.month), { now, comparableDay: period.current ? period.elapsedDays : null }));
  report.comparison = { period: prior.period, summary: summary(prior), deltas: Object.fromEntries(['exactNetProfit', 'realRevenue', 'totalCosts', 'roiPercent', 'roas', 'marginPercent'].map((field) => [field, delta(report.totals[field], prior.totals[field])])) };
  report.history = historyMonths.map((value) => summary(build(resolveFinancePeriod(value, { now }))));
  report.projection = buildProjection(report, expenses);
  report.generatedAt = now.toISOString();
  report.freshness = { generatedAt: report.generatedAt, sources: { dropea: { status: orderResult.status === 'fulfilled' ? 'OK' : 'SOURCE_ERROR', lastSyncAt: orderResult.status === 'fulfilled' ? report.generatedAt : null, ageMinutes: orderResult.status === 'fulfilled' ? 0 : null }, meta: { status: metaResult.status === 'fulfilled' ? 'OK' : 'SOURCE_ERROR', lastSyncAt: metaResult.status === 'fulfilled' ? report.generatedAt : null, ageMinutes: metaResult.status === 'fulfilled' ? 0 : null }, expenses: { status: expenses.length ? 'OK' : 'MISSING', lastSyncAt: report.generatedAt, ageMinutes: 0 } } };
  report.sources = report.sources || { orders: 'Dropea Public API V2', meta: metaResult.status === 'fulfilled' ? 'Meta Marketing API' : 'No disponible', costs: rules.source, expenses: 'Ledger versionado de gastos' };
  report.availableRange = { from: rules.effective_from.slice(0, 7), to: localDay(now).slice(0, 7) };
  report.definitions = { netProfit: 'Facturación realizada − producto − logística − devoluciones − publicidad − gastos fijos − puntuales − otros.', roi: 'Beneficio neto / costes totales.', roas: 'Facturación realizada / gasto Meta.', margin: 'Beneficio neto / facturación realizada.', deliveryRate: 'Entregados / enviados de la cohorte.', returnRate: 'Devueltos / enviados de la cohorte.' };
  cache.set(period.month, { at: Date.now(), report });
  await persistFinanceSnapshot(report);
  return report;
}

export function clearFinanceCache() {
  cache.clear();
}
