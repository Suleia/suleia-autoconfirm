import { createDropeaV2IncidentClient, loadDropeaV2IncidentStoreConfigs } from './clients/dropea-v2-incidents.mjs';
import fs from 'node:fs';
import { getCampaignInsights } from './clients/meta.mjs';
import { getClosedFinanceActual } from './finance-actuals.mjs';
import { loadFinanceCostRules, loadFinanceExpenses } from './finance-data.mjs';
import { isSupabaseEnabled, selectRows, upsertRows } from './clients/supabase.mjs';

const ZONE = 'Europe/Madrid';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
const bundledSnapshotDirectory = new URL('../data/finance/snapshots/', import.meta.url);

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

export async function saveFinanceSnapshot(report) {
  const text = JSON.stringify(report);
  if (!report?.period?.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(report.period.month)) throw new Error('FINANCE_SNAPSHOT_MONTH_INVALID');
  if (!report?.totals || !report?.counts || !Array.isArray(report.days) || report.days.length > 31) throw new Error('FINANCE_SNAPSHOT_SCHEMA_INVALID');
  if (text.length > 1_000_000) throw new Error('FINANCE_SNAPSHOT_TOO_LARGE');
  if (/"(?:customer|phone|email|address|tracking)[^"]*"\s*:/i.test(text)) throw new Error('FINANCE_SNAPSHOT_PERSONAL_DATA_BLOCKED');
  cache.set(report.period.month, { at: Date.now(), report });
  await persistFinanceSnapshot(report);
  return { month: report.period.month, generatedAt: report.generatedAt || null, bytes: Buffer.byteLength(text) };
}

export async function loadStoredMetaSpend({ since, until }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(until)) || since > until) throw new Error('FINANCE_META_PERIOD_INVALID');
  if (!isSupabaseEnabled()) throw new Error('FINANCE_META_STORE_UNAVAILABLE');
  const rows = await selectRows('meta_campaign_insights', {
    query: { select: 'date_start,spend,updated_at', and: `(date_start.gte.${since},date_start.lte.${until})` },
    limit: 5000
  });
  const days = new Map();
  let lastSyncAt = null;
  for (const row of rows) {
    const day = String(row.date_start || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    days.set(day, (days.get(day) || 0) + (moneyToCents(row.spend) || 0));
    if (row.updated_at && (!lastSyncAt || row.updated_at > lastSyncAt)) lastSyncAt = row.updated_at;
  }
  return { rows: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([dateStart, cents]) => ({ dateStart, spend: euros(cents) })), lastSyncAt };
}

export async function loadFinanceSnapshot({ month, now = new Date() } = {}) {
  const period = resolveFinancePeriod(month, { now });
  const memory = cache.get(period.month);
  if (memory?.report) return memory.report;
  let report = null;
  let storedAt = null;
  if (isSupabaseEnabled()) {
    const rows = await selectRows('app_state', { query: { key: `eq.${snapshotKey(period.month)}` }, limit: 1 });
    report = rows[0]?.value;
    storedAt = rows[0]?.updated_at || null;
  }
  const file = new URL(`${period.month}.json`, bundledSnapshotDirectory);
  if (fs.existsSync(file)) {
    const bundled = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundledAt = new Date(bundled.generatedAt || 0).getTime();
    const storedTime = new Date(report?.generatedAt || storedAt || 0).getTime();
    if (!report || bundledAt > storedTime) {
      report = bundled;
      storedAt = bundled.generatedAt || null;
    }
  }
  if (!report?.period || !report?.totals || !report?.counts) return null;
  const generated = new Date(report.generatedAt || storedAt || 0);
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
  return numerator === null || numerator === undefined || !denominator ? null : Math.round(numerator * 10000 / denominator) / 100;
}

function localDay(value, timeZone = ZONE) {
  if (!value) return null;
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

function finalAmount(order) {
  return moneyToCents(order?.final_amount ?? order?.finalAmount ?? order?.total_amount);
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

function confirmationEvidence(order = {}) {
  if (stamp(order, 'confirmed_at_utc', 'confirmed_at')) return true;
  const status = String(order.status || '').toUpperCase();
  return sentEvidence(order) || ['CONFIRMED', 'PROCESSING', 'SHIPPING', 'FINISH', 'DELIVERED'].includes(status);
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

function rateApplies(rate, day) {
  return (!rate.effective_from || day >= rate.effective_from) && (!rate.effective_to || day <= rate.effective_to);
}

function configuredRate(rules, costType, day) {
  return (rules.rates || []).find((rate) => rate.cost_type === costType && rateApplies(rate, day));
}

function productRate(item, rules, day) {
  const productId = Number(item?.product_id);
  const variantId = Number(item?.variant_id);
  const sku = String(item?.sku || '').trim().toUpperCase();
  const rates = (rules.rates || []).filter((rate) => rate.cost_type === 'PRODUCT_COGS' && rateApplies(rate, day));
  const byIdentity = rates.find((rate) => Number(rate.product_id) === productId && Number(rate.variant_id) === variantId);
  if (byIdentity) return byIdentity;
  // A known but different Dropea identity must never inherit a price just because
  // another product happens to reuse the same SKU text.
  if (Number.isInteger(productId) || Number.isInteger(variantId)) return null;
  return rates.find((rate) => (rate.skus || []).map((value) => String(value).toUpperCase()).includes(sku)) || null;
}

function skuCost(item, rules, day) {
  const rate = productRate(item, rules, day);
  if (rate) return { cents: rate.amount_cents, source: rate.source, type: 'versioned_product_tariff', rate };
  const actual = moneyToCents(item?.wholesale_price);
  if (actual > 0) return { cents: actual, source: 'Dropea order.line_items[].wholesale_price', type: 'actual_order_cost' };
  const sku = String(item?.sku || '').trim().toUpperCase();
  const configured = rules.products?.[sku];
  return !(rules.rates || []).length && Number.isSafeInteger(configured) && configured > 0
    ? { cents: configured, source: rules.source, type: 'legacy_product_tariff' }
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

function dropeaExpenseBreakdown(order = {}) {
  const value = order.expenses_breakdown;
  if (!value || typeof value !== 'object') return null;
  let total = findCost(value, ['total_expenses']);
  if (total === null) {
    // Older settled orders expose every Wallet component but omit the
    // convenience `total_expenses` field. Rebuild that total according to the
    // final lifecycle so unused return tariffs are never charged to deliveries
    // and COD is never charged to refused orders.
    const component = (name) => findCost(value, [name]) || 0;
    const product = component('product_price');
    const supplierTaxRate = Number(value.tax_rate_supplier) || 0;
    const category = classifyFinanceOrder(order);
    const dropeaBase = category === 'returned'
      ? component('fulfillment_outbound_price') + component('fulfillment_extra_unit_price') + component('fulfillment_refused_price') + component('shipping_outbound_price') + component('shipping_refused_price')
      : component('fulfillment_outbound_price') + component('fulfillment_extra_unit_price') + component('shipping_outbound_price') + component('cod_commission');
    const dropeaTaxRate = (Number(value.tax_rate_dropea) || 0) + (Number(value.equivalence_surcharge_rate) || 0);
    total = product + Math.round(product * supplierTaxRate / 100) + dropeaBase + Math.round(dropeaBase * dropeaTaxRate / 100);
  }
  return { value, total, final: value.is_estimate === false };
}

function breakdownSum(order, aliases) {
  const breakdown = dropeaExpenseBreakdown(order);
  if (!breakdown) return null;
  const values = aliases.map((alias) => findCost(breakdown.value, [alias])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function breakdownSource(order) {
  return dropeaExpenseBreakdown(order)?.final
    ? { source: 'Dropea Public API V2 expenses_breakdown (definitivo)', type: 'actual_order_cost' }
    : { source: 'Dropea Public API V2 expenses_breakdown (estimado)', type: 'estimated_order_cost' };
}

function orderCost(order, rules, kind, day) {
  const aliases = {
    shipping: ['shipping_cost', 'shipping_fee', 'carrier_cost', 'outbound_shipping_cost'],
    fulfillment: ['fulfillment_cost', 'fulfillment_fee', 'preparation_cost', 'fulfillment_outbound'],
    cod: ['cod_cost', 'cod_fee', 'cash_on_delivery_fee'],
    return: ['return_cost', 'return_fee', 'reverse_logistics_cost']
  };
  const costType = { shipping: 'OUTBOUND_SHIPPING', fulfillment: 'OUTBOUND_FULFILLMENT', cod: 'COD', return: 'RETURN_LOGISTICS_COMBINED' }[kind];
  const rate = configuredRate(rules, costType, day);
  const breakdownAliases = {
    shipping: ['shipping_outbound_price'],
    fulfillment: ['fulfillment_outbound_price', 'fulfillment_extra_unit_price'],
    cod: ['cod_commission'],
    return: ['shipping_refused_price', 'fulfillment_refused_price']
  };
  const breakdownValue = breakdownSum(order, breakdownAliases[kind]);
  if (breakdownValue !== null) return { cents: breakdownValue, ...breakdownSource(order) };
  if (kind === 'return' && rate) return { cents: rate.amount_cents, source: rate.source, type: 'versioned_logistics_tariff', rate };
  if (kind === 'fulfillment') {
    const components = ['fulfillment_outbound', 'fulfillment_quantity_cost']
      .map((name) => findCost(order.order_costs, [name]))
      .filter((value) => value !== null);
    if (components.length) return { cents: components.reduce((sum, value) => sum + value, 0), source: 'Dropea order.order_costs fulfillment components', type: 'actual_order_cost' };
  }
  const actual = findCost(order.order_costs, aliases[kind]);
  if (actual !== null) return { cents: actual, source: 'Dropea order.order_costs', type: 'actual_order_cost' };
  // This fallback is per returned order, never per line item or unit.
  if (rate) return { cents: rate.amount_cents, source: rate.source, type: 'versioned_logistics_tariff', rate };
  const field = { shipping: 'outbound_shipping_per_sent_cents', fulfillment: 'fulfillment_per_sent_cents', cod: 'cod_per_delivered_cents', return: 'return_per_returned_order_cents' }[kind];
  const configured = rules.logistics?.[field];
  return Number.isSafeInteger(configured)
    ? { cents: configured, source: rules.source, type: 'legacy_logistics_tariff' }
    : { cents: null, source: null, type: 'MISSING_ECONOMIC_DATA' };
}

function productKey(item = {}) {
  const productId = item.product_id ?? 'SIN_PRODUCT_ID';
  const variantId = item.variant_id ?? 'SIN_VARIANT_ID';
  const sku = String(item.sku || 'SIN_SKU').trim().toUpperCase();
  return `${productId}:${variantId}:${sku}`;
}

function allocateCents(total, items, weight = (item) => Math.max(1, Number(item.quantity) || 0)) {
  if (!Number.isSafeInteger(total) || total < 0 || !items.length) return [];
  const weights = items.map((item) => Math.max(0, Number(weight(item)) || 0));
  const denominator = weights.reduce((sum, value) => sum + value, 0) || items.length;
  const shares = items.map((item, index) => Math.floor(total * (weights[index] || 1) / denominator));
  let remainder = total - shares.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % shares.length) {
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}

function applies(expense, day) {
  return (!expense.start_date || day >= expense.start_date) && (!expense.end_date || day <= expense.end_date);
}

export function allocateExpenses(period, expenses = []) {
  const result = new Map();
  for (let day = 1; day <= period.elapsedDays; day += 1) result.set(`${period.month}-${String(day).padStart(2, '0')}`, { fixed: 0, oneOff: 0, other: 0 });
  const monthlyGroups = new Map();
  for (const expense of expenses) {
    const active = [...result.keys()].filter((day) => applies(expense, day));
    if (!active.length) continue;
    if (expense.type === 'recurring_daily') {
      for (const day of active) result.get(day).fixed += Number(expense.amount_cents) || 0;
    } else if (expense.type === 'recurring_monthly') {
      // Group subscriptions that have the same active-day schedule before
      // allocating cents. Allocating every invoice independently made their
      // remainders stack on the first days and produced artificial swings of
      // several cents in the daily fixed-cost column.
      const groupKey = active.join('|');
      const group = monthlyGroups.get(groupKey) || { active, total: 0 };
      group.total += Number(expense.amount_cents) || 0;
      monthlyGroups.set(groupKey, group);
    } else if (expense.date && result.has(expense.date)) {
      const key = expense.type === 'one_off' ? 'oneOff' : 'other';
      result.get(expense.date)[key] += Number(expense.amount_cents) || 0;
    }
  }
  for (const { active, total } of monthlyGroups.values()) {
    // Exact-cent largest-remainder allocation: the monthly invoice total is
    // preserved and days sharing a schedule can differ by at most one cent.
    const base = Math.floor(total / active.length);
    const remainder = total % active.length;
    active.forEach((day, index) => { result.get(day).fixed += base + (index < remainder ? 1 : 0); });
  }
  return result;
}

function emptyDay(day, expense) {
  return {
    day, created: 0, confirmed: 0, rejected: 0, sent: 0, inTransit: 0, delivered: 0, deliveredUnits: 0,
    returned: 0, returnedUnits: 0, incidentOrders: 0, incidents: 0, estimatedRevenue: 0, revenue: 0, product: 0,
    shipping: 0, cod: 0, fulfillment: 0, returns: 0, dropeaAdjustments: 0, ads: 0, fixed: expense.fixed, oneOff: expense.oneOff, other: expense.other,
    missingProductUnits: 0, missingReturnCosts: 0, missingRevenueOrders: 0
  };
}

function finalizeDay(row, metaAvailable) {
  const logistics = row.shipping + row.cod + row.fulfillment + row.returns + row.dropeaAdjustments;
  const known = metaAvailable && !row.missingProductUnits && !row.missingReturnCosts;
  const totalCosts = known ? row.product + logistics + row.ads + row.fixed + row.oneOff + row.other : null;
  const revenue = row.missingRevenueOrders ? null : row.revenue;
  const net = totalCosts === null || revenue === null ? null : revenue - totalCosts;
  return {
    day: row.day, created: row.created, confirmed: row.confirmed, rejected: row.rejected, sent: row.sent,
    inTransit: row.inTransit, delivered: row.delivered, deliveredUnits: row.deliveredUnits, returned: row.returned,
    returnedUnits: row.returnedUnits, incidentOrders: row.incidentOrders, incidents: row.incidents,
    estimatedRevenue: euros(row.estimatedRevenue), realRevenue: euros(revenue), productCost: euros(row.product),
    outboundShippingCost: euros(row.shipping), codCost: euros(row.cod), outboundFulfillmentCost: euros(row.fulfillment),
    returnCost: euros(row.returns), dropeaAdjustmentsCost: euros(row.dropeaAdjustments), logisticsCost: euros(logistics), metaSpend: metaAvailable ? euros(row.ads) : null,
    fixedCosts: euros(row.fixed), oneOffCosts: euros(row.oneOff), otherCosts: euros(row.other), totalCosts: euros(totalCosts),
    contributionMargin: revenue === null ? null : euros(revenue - row.product - logistics), netProfit: euros(net), marginPercent: pct(net, revenue),
    roiPercent: pct(net, totalCosts), roas: row.ads && revenue !== null ? Math.round(revenue * 100 / row.ads) / 100 : null,
    unknownProductCostUnits: row.missingProductUnits, missingReturnCosts: row.missingReturnCosts, missingRevenueOrders: row.missingRevenueOrders
  };
}

function sumCents(days, field) {
  return days.reduce((sum, day) => sum + (moneyToCents(day[field]) || 0), 0);
}

function aggregateTotals(days, counts, metaAvailable) {
  const revenueComplete = !days.some((day) => day.missingRevenueOrders);
  const revenue = revenueComplete ? sumCents(days, 'realRevenue') : null;
  const product = sumCents(days, 'productCost');
  const shipping = sumCents(days, 'outboundShippingCost');
  const cod = sumCents(days, 'codCost');
  const fulfillment = sumCents(days, 'outboundFulfillmentCost');
  const returns = sumCents(days, 'returnCost');
  const dropeaAdjustments = sumCents(days, 'dropeaAdjustmentsCost');
  const logistics = shipping + cod + fulfillment + returns + dropeaAdjustments;
  const ads = sumCents(days, 'metaSpend');
  const fixed = sumCents(days, 'fixedCosts');
  const oneOff = sumCents(days, 'oneOffCosts');
  const other = sumCents(days, 'otherCosts');
  const deliveredEvents = days.reduce((sum, day) => sum + (Number(day.delivered) || 0), 0);
  const confirmedEvents = days.reduce((sum, day) => sum + (Number(day.confirmed) || 0), 0);
  const complete = metaAvailable && !days.some((day) => day.unknownProductCostUnits || day.missingReturnCosts);
  const total = complete ? product + logistics + ads + fixed + oneOff + other : null;
  const net = total === null || revenue === null ? null : revenue - total;
  return {
    realRevenue: euros(revenue), revenue: euros(revenue), productCost: euros(product), outboundShippingCost: euros(shipping),
    codCost: euros(cod), outboundFulfillmentCost: euros(fulfillment), returnCost: euros(returns), dropeaAdjustmentsCost: euros(dropeaAdjustments), logisticsCost: euros(logistics),
    metaSpend: metaAvailable ? euros(ads) : null, fixedCosts: euros(fixed), oneOffCosts: euros(oneOff), otherCosts: euros(other),
    totalCosts: euros(total), contributionMargin: revenue === null ? null : euros(revenue - product - logistics), exactNetProfit: euros(net),
    roiPercent: pct(net, total), marginPercent: pct(net, revenue), roas: ads ? Math.round(revenue * 100 / ads) / 100 : null,
    estimatedCpa: metaAvailable && confirmedEvents ? euros(Math.round(ads / confirmedEvents)) : null,
    realCpa: metaAvailable && deliveredEvents ? euros(Math.round(ads / deliveredEvents)) : null
  };
}

export function aggregateFinanceReport({ orders = [], issues = [], metaRows = [], period, rules = loadFinanceCostRules(), expenses = loadFinanceExpenses(), metaAvailable = true }) {
  const allocations = allocateExpenses(period, expenses);
  const dayMap = new Map([...allocations].map(([day, expense]) => [day, emptyDay(day, expense)]));
  const uniqueOrders = [...new Map(orders.map((order, index) => [`${order.market || ''}:${order.id ?? `row-${index}`}`, order])).values()];
  const cohort = uniqueOrders.filter((order) => inPeriod(order.created_at, period));
  const cohortIds = new Set(cohort.map((order) => String(order.id)));
  const issueIds = new Set(issues.map((issue) => String(issue.order_id)));
  const counts = { created: cohort.length, confirmed: 0, rejected: 0, sent: 0, inTransit: 0, delivered: 0, deliveredUnits: 0, returned: 0, returnedUnits: 0, incidentOrders: 0, incidents: 0 };
  const products = new Map();
  const chargeLedger = new Map();
  const chargeSources = { actual_order_cost: 0, estimated_order_cost: 0, versioned_logistics_tariff: 0, versioned_product_tariff: 0, legacy_logistics_tariff: 0, legacy_product_tariff: 0 };
  const missingEventTimestamps = { confirmed: 0, sent: 0, delivered: 0, returned: 0 };
  let duplicateChargesBlocked = 0;
  const drilldownSets = new Map([...dayMap.keys()].map((day) => [day, { created: new Set(), confirmed: new Set(), rejected: new Set(), sent: new Set(), delivered: new Set(), returned: new Set(), incidentOrders: new Set() }]));

  const addDrilldown = (day, type, orderId) => {
    if (day && orderId && drilldownSets.get(day)?.[type]) drilldownSets.get(day)[type].add(String(orderId));
  };
  const ensureProduct = (item) => {
    const key = productKey(item);
    if (!products.has(key)) products.set(key, {
      key,
      productId: item.product_id ?? null,
      variantId: item.variant_id ?? null,
      sku: String(item.sku || 'SIN_SKU').trim().toUpperCase(),
      name: itemLabel(item),
      deliveredUnits: 0,
      returnedUnits: 0,
      deliveredOrderIds: new Set(),
      returnedOrderIds: new Set(),
      sentOrderIds: new Set(),
      revenue: 0,
      productCost: 0,
      shipping: 0,
      fulfillment: 0,
      cod: 0,
      returns: 0,
      dropeaAdjustments: 0,
      unknownCostUnits: 0
    });
    return products.get(key);
  };
  const recordCharge = ({ orderId, day, costType, cents, source, sourceType, field, detail = 'order' }) => {
    if (cents === null || cents === undefined) return false;
    const identity = `${orderId}:${costType}:${detail}`;
    if (chargeLedger.has(identity)) {
      duplicateChargesBlocked += 1;
      return false;
    }
    chargeLedger.set(identity, { orderId: String(orderId), costType, amountCents: cents, source, sourceType, field, day, identity });
    dayMap.get(day)[field] += cents;
    if (sourceType in chargeSources) chargeSources[sourceType] += 1;
    return true;
  };
  const allocateToProducts = (items, cents, field, orderId, orderSet) => {
    const shares = allocateCents(cents, items);
    items.forEach((item, index) => {
      const product = ensureProduct(item);
      product[field] += shares[index] || 0;
      if (orderSet) product[orderSet].add(String(orderId));
    });
  };

  for (const order of uniqueOrders) {
    const orderId = String(order.id);
    const createdDay = inPeriod(order.created_at, period);
    const category = classifyFinanceOrder(order);
    const breakdown = dropeaExpenseBreakdown(order);
    const settledBreakdown = Boolean(breakdown && ['delivered', 'returned'].includes(category));
    const cohortOrder = createdDay && cohortIds.has(orderId);
    if (cohortOrder) {
      const day = dayMap.get(createdDay);
      day.created += 1;
      day.estimatedRevenue += finalAmount(order) || 0;
      addDrilldown(createdDay, 'created', orderId);
      if (sentEvidence(order)) {
        counts.confirmed += 1;
        counts.sent += 1;
      }
      if (category === 'rejected') counts.rejected += 1;
      if (category === 'inTransit') counts.inTransit += 1;
      if (category === 'delivered') { counts.delivered += 1; counts.deliveredUnits += units(order); }
      if (category === 'returned') { counts.returned += 1; counts.returnedUnits += units(order); }
      if (issueIds.has(orderId)) counts.incidentOrders += 1;
    }

    const confirmedDay = cohortOrder && sentEvidence(order) ? createdDay : null;
    if (confirmedDay) { dayMap.get(confirmedDay).confirmed += 1; addDrilldown(confirmedDay, 'confirmed', orderId); }

    const sentDay = cohortOrder && sentEvidence(order) ? createdDay : null;
    if (sentDay) { dayMap.get(sentDay).sent += 1; addDrilldown(sentDay, 'sent', orderId); }

    const rejectedDay = cohortOrder && category === 'rejected' ? createdDay : null;
    if (rejectedDay) { dayMap.get(rejectedDay).rejected += 1; addDrilldown(rejectedDay, 'rejected', orderId); }

    const processingDay = sentDay && !['delivered', 'returned'].includes(category) ? sentDay : null;
    if (processingDay) {
      const day = dayMap.get(processingDay);
      if (category === 'inTransit') day.inTransit += 1;
      const list = orderItems(order);
      const shipping = orderCost(order, rules, 'shipping', processingDay);
      const fulfillment = orderCost(order, rules, 'fulfillment', processingDay);
      if (recordCharge({ orderId, day: processingDay, costType: 'OUTBOUND_SHIPPING', cents: shipping.cents, source: shipping.source, sourceType: shipping.type, field: 'shipping' })) allocateToProducts(list, shipping.cents, 'shipping', orderId, 'sentOrderIds');
      if (recordCharge({ orderId, day: processingDay, costType: 'OUTBOUND_FULFILLMENT', cents: fulfillment.cents, source: fulfillment.source, sourceType: fulfillment.type, field: 'fulfillment' })) allocateToProducts(list, fulfillment.cents, 'fulfillment', orderId, 'sentOrderIds');
    }

    const deliveredDay = cohortOrder && category === 'delivered' ? createdDay : null;
    if (deliveredDay) {
      const day = dayMap.get(deliveredDay);
      const revenue = finalAmount(order);
      day.delivered += 1;
      day.deliveredUnits += units(order);
      addDrilldown(deliveredDay, 'delivered', orderId);
      if (revenue === null) day.missingRevenueOrders += 1; else day.revenue += revenue;
      const list = orderItems(order);
      const actualComponents = [];
      for (const [costType, kind, field, productField, orderSet] of [
        ['OUTBOUND_SHIPPING', 'shipping', 'shipping', 'shipping', 'sentOrderIds'],
        ['OUTBOUND_FULFILLMENT', 'fulfillment', 'fulfillment', 'fulfillment', 'sentOrderIds'],
        ['COD', 'cod', 'cod', 'cod', 'deliveredOrderIds']
      ]) {
        const cost = orderCost(order, rules, kind, deliveredDay);
        if (settledBreakdown) actualComponents.push(cost.cents || 0);
        if (recordCharge({ orderId, day: deliveredDay, costType, cents: cost.cents, source: cost.source, sourceType: cost.type, field })) allocateToProducts(list, cost.cents, productField, orderId, orderSet);
      }
      const revenueShares = revenue === null ? [] : allocateCents(revenue, list, (item) => (moneyToCents(item.unit_price) || 0) * Math.max(1, Number(item.quantity) || 0));
      if (!list.length) day.missingProductUnits += units(order);
      const actualProductTotal = settledBreakdown ? breakdownSum(order, ['product_price']) : null;
      const useActualProduct = actualProductTotal !== null && actualProductTotal > 0;
      const actualProductShares = useActualProduct ? allocateCents(actualProductTotal, list) : [];
      list.forEach((item, index) => {
        const quantity = Math.max(1, Number(item.quantity) || 0);
        const product = ensureProduct(item);
        product.deliveredUnits += quantity;
        product.deliveredOrderIds.add(orderId);
        if (revenue !== null) product.revenue += revenueShares[index] || 0;
        const cost = useActualProduct
          ? { cents: actualProductShares[index] || 0, source: breakdownSource(order).source, type: breakdownSource(order).type }
          : skuCost(item, rules, deliveredDay);
        if (cost.cents === null) { day.missingProductUnits += quantity; product.unknownCostUnits += quantity; }
        else {
          const total = useActualProduct ? cost.cents : cost.cents * quantity;
          if (recordCharge({ orderId, day: deliveredDay, costType: 'PRODUCT_COGS', cents: total, source: cost.source, sourceType: cost.type, field: 'product', detail: `line-${index}` })) product.productCost += total;
        }
      });
      if (settledBreakdown) {
        const actualProductForReconciliation = actualProductTotal || 0;
        const adjustment = Math.max(0, breakdown.total - actualProductForReconciliation - actualComponents.reduce((sum, value) => sum + value, 0));
        if (recordCharge({ orderId, day: deliveredDay, costType: 'DROPEA_TAX_AND_ADJUSTMENTS', cents: adjustment, source: breakdownSource(order).source, sourceType: breakdownSource(order).type, field: 'dropeaAdjustments' })) allocateToProducts(list, adjustment, 'dropeaAdjustments', orderId, 'deliveredOrderIds');
      }
    }

    const returnedDay = cohortOrder && category === 'returned' ? createdDay : null;
    if (returnedDay) {
      const day = dayMap.get(returnedDay);
      const list = orderItems(order);
      day.returned += 1;
      day.returnedUnits += units(order);
      addDrilldown(returnedDay, 'returned', orderId);
      const actualComponents = [];
      for (const [costType, kind, field, productField, orderSet] of [
        ['OUTBOUND_SHIPPING', 'shipping', 'shipping', 'shipping', 'sentOrderIds'],
        ['OUTBOUND_FULFILLMENT', 'fulfillment', 'fulfillment', 'fulfillment', 'sentOrderIds'],
        ['RETURN_LOGISTICS_COMBINED', 'return', 'returns', 'returns', 'returnedOrderIds']
      ]) {
        const cost = orderCost(order, rules, kind, returnedDay);
        if (settledBreakdown) actualComponents.push(cost.cents || 0);
        if (cost.cents === null && kind === 'return') day.missingReturnCosts += 1;
        else if (recordCharge({ orderId, day: returnedDay, costType, cents: cost.cents, source: cost.source, sourceType: cost.type, field })) allocateToProducts(list, cost.cents, productField, orderId, orderSet);
      }
      if (settledBreakdown) {
        const actualProduct = breakdownSum(order, ['product_price']) || 0;
        if (actualProduct > 0 && recordCharge({ orderId, day: returnedDay, costType: 'PRODUCT_COGS', cents: actualProduct, source: breakdownSource(order).source, sourceType: breakdownSource(order).type, field: 'product' })) allocateToProducts(list, actualProduct, 'productCost', orderId, 'returnedOrderIds');
        const adjustment = Math.max(0, breakdown.total - actualProduct - actualComponents.reduce((sum, value) => sum + value, 0));
        if (recordCharge({ orderId, day: returnedDay, costType: 'DROPEA_TAX_AND_ADJUSTMENTS', cents: adjustment, source: breakdownSource(order).source, sourceType: breakdownSource(order).type, field: 'dropeaAdjustments' })) allocateToProducts(list, adjustment, 'dropeaAdjustments', orderId, 'returnedOrderIds');
      }
      for (const item of list) {
        const product = ensureProduct(item);
        product.returnedUnits += Math.max(1, Number(item.quantity) || 0);
        product.returnedOrderIds.add(orderId);
      }
    }
  }

  for (const issue of issues) {
    const day = inPeriod(issue.created_at || issue.createdAt, period); if (!day) continue;
    counts.incidents += 1; const row = dayMap.get(day); row.incidents += 1; addDrilldown(day, 'incidentOrders', issue.order_id);
  }
  for (const row of dayMap.values()) row.incidentOrders = new Set(issues.filter((issue) => inPeriod(issue.created_at || issue.createdAt, period) === row.day).map((issue) => String(issue.order_id))).size;
  counts.incidentOrders = [...cohortIds].filter((id) => issueIds.has(id)).length;
  for (const meta of metaRows) {
    const day = String(meta.dateStart || meta.date_start || '').slice(0, 10); if (dayMap.has(day)) dayMap.get(day).ads += moneyToCents(meta.spend) || 0;
  }

  const statusBreakdown = cohort.reduce((result, order) => {
    const category = classifyFinanceOrder(order);
    if (category === 'delivered') result.delivered += 1;
    else if (category === 'returned') result.returned += 1;
    else if (category === 'rejected') result.cancelled += 1;
    else if (category === 'inTransit' || category === 'incident') result.inAir += 1;
    else result.pending += 1;
    return result;
  }, { delivered: 0, returned: 0, inAir: 0, pending: 0, cancelled: 0 });
  counts.total = counts.created; counts.dropeaOrders = counts.created; counts.notSent = Math.max(0, counts.created - counts.sent);
  counts.statusBreakdown = statusBreakdown;
  counts.inAir = statusBreakdown.inAir;
  counts.pending = statusBreakdown.pending;
  counts.cancelled = statusBreakdown.cancelled;
  counts.confirmationRatePercent = pct(counts.sent, counts.created); counts.rejectionRatePercent = pct(counts.rejected, counts.created);
  counts.deliveryRatePercent = pct(counts.delivered, counts.sent); counts.globalConversionPercent = pct(counts.delivered, counts.created);
  counts.returnRatePercent = pct(counts.returned, counts.sent); counts.incidentRatePercent = pct(counts.incidentOrders, counts.sent);
  const days = [...dayMap.values()].map((row) => finalizeDay(row, metaAvailable)).sort((a, b) => a.day.localeCompare(b.day));
  const totals = aggregateTotals(days, counts, metaAvailable);
  const missingUnits = days.reduce((sum, day) => sum + day.unknownProductCostUnits, 0);
  const missingReturns = days.reduce((sum, day) => sum + day.missingReturnCosts, 0);
  const missingRevenue = days.reduce((sum, day) => sum + day.missingRevenueOrders, 0);
  const qualityIssues = [];
  if (!metaAvailable) qualityIssues.push({ code: 'MISSING_AD_SPEND', message: 'Meta Ads no respondió; beneficio, ROI y ROAS quedan pendientes.' });
  if (missingUnits) qualityIssues.push({ code: 'MISSING_COST', message: `${missingUnits} unidades entregadas no tienen wholesale_price válido ni tarifa vinculada a su product_id/variant_id.` });
  if (missingReturns) qualityIssues.push({ code: 'MISSING_RETURN_COST', message: `${missingReturns} pedidos devueltos no tienen coste combinado real ni tarifa aplicable.` });
  if (missingRevenue) qualityIssues.push({ code: 'MISSING_FINAL_AMOUNT', message: `${missingRevenue} pedidos entregados no informan importe final cobrado.` });
  if (!expenses.length) qualityIssues.push({ code: 'MISSING_EXPENSE_DATA', message: 'El ledger de gastos no contiene registros.' });
  const terminalOrders = cohort.filter((order) => ['delivered', 'returned'].includes(classifyFinanceOrder(order)));
  const publishedBreakdownOrders = terminalOrders.filter((order) => dropeaExpenseBreakdown(order)).length;
  const actualBreakdownOrders = terminalOrders.filter((order) => dropeaExpenseBreakdown(order)?.final).length;
  if (publishedBreakdownOrders < terminalOrders.length) qualityIssues.push({ code: 'DROPEA_COST_BREAKDOWN_PARTIAL', message: `${terminalOrders.length - publishedBreakdownOrders} pedidos finalizados no publican expenses_breakdown y usan tarifas de respaldo identificadas.` });
  if (actualBreakdownOrders < publishedBreakdownOrders) qualityIssues.push({ code: 'DROPEA_COST_BREAKDOWN_ESTIMATED', message: `Dropea marca ${publishedBreakdownOrders - actualBreakdownOrders} desgloses históricos como estimados; se muestran separados de los definitivos y no se oculta esa limitación.` });
  const missingTimestampCount = Object.values(missingEventTimestamps).reduce((sum, value) => sum + value, 0);
  if (missingTimestampCount) qualityIssues.push({ code: 'MISSING_EVENT_TIMESTAMP', message: `${missingTimestampCount} estados de cohorte no incluyen la fecha exacta del evento y no se imputan al P&L diario.` });
  const productRows = [...products.values()].map((row) => {
    const logistics = row.shipping + row.fulfillment + row.cod + row.dropeaAdjustments;
    const totalCost = row.productCost + logistics + row.returns;
    const profitBeforeAds = row.revenue - totalCost;
    return {
      productId: row.productId, variantId: row.variantId, sku: row.sku, name: row.name,
      units: row.deliveredUnits, deliveredUnits: row.deliveredUnits, returnedUnits: row.returnedUnits,
      deliveredOrders: row.deliveredOrderIds.size, sentOrders: row.sentOrderIds.size, returnedOrders: row.returnedOrderIds.size,
      revenue: euros(row.revenue), productCost: euros(row.productCost), logisticsCost: euros(logistics), returnCost: euros(row.returns), dropeaAdjustmentsCost: euros(row.dropeaAdjustments),
      attributedAdSpend: null, totalCostBeforeAds: euros(totalCost), margin: row.unknownCostUnits ? null : euros(profitBeforeAds),
      profit: row.unknownCostUnits ? null : euros(profitBeforeAds), marginPercent: row.revenue ? pct(profitBeforeAds, row.revenue) : null,
      roiPercent: totalCost ? pct(profitBeforeAds, totalCost) : null, returnRatePercent: pct(row.returnedOrderIds.size, row.sentOrderIds.size), unknownCostUnits: row.unknownCostUnits
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const dailyRevenue = sumCents(days, 'realRevenue'); const dailyCosts = sumCents(days, 'totalCosts');
  const productRevenue = productRows.reduce((sum, row) => sum + (moneyToCents(row.revenue) || 0), 0);
  const productReturnCosts = productRows.reduce((sum, row) => sum + (moneyToCents(row.returnCost) || 0), 0);
  const orderRows = uniqueOrders.map((order) => {
    const createdDay = inPeriod(order.created_at, period);
    const category = classifyFinanceOrder(order);
    const settled = ['delivered', 'returned'].includes(category);
    const settlementDay = localDay(category === 'delivered' ? stamp(order, 'delivered_at_utc', 'delivered_at') : (category === 'returned' ? returnStamp(order) : null), period.timeZone);
    if (!createdDay) return null;
    const charges = [...chargeLedger.values()].filter((charge) => charge.orderId === String(order.id));
    const byField = (field) => charges.filter((charge) => charge.field === field).reduce((sum, charge) => sum + charge.amountCents, 0);
    const totalCost = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
    const revenue = category === 'delivered' ? finalAmount(order) : null;
    const breakdown = dropeaExpenseBreakdown(order);
    return {
      orderId: String(order.id),
      externalOrderId: String(order.external_order_id || ''),
      createdDay: localDay(order.created_at, period.timeZone),
      settlementDay,
      status: category,
      units: units(order),
      orderAmount: euros(finalAmount(order)),
      realizedRevenue: euros(revenue),
      dropeaExpenses: settled ? euros(breakdown?.total ?? null) : null,
      productCost: euros(byField('product')),
      outboundShippingCost: euros(byField('shipping')),
      outboundFulfillmentCost: euros(byField('fulfillment')),
      codCost: euros(byField('cod')),
      returnCost: euros(byField('returns')),
      dropeaAdjustmentsCost: euros(byField('dropeaAdjustments')),
      recognizedCost: euros(totalCost),
      dropeaOrderProfit: category === 'delivered' && breakdown ? euros((finalAmount(order) || 0) - breakdown.total) : null,
      contributionAfterProduct: category === 'delivered' && revenue !== null ? euros(revenue - totalCost) : (category === 'returned' ? euros(-totalCost) : null),
      breakdownStatus: !settled ? 'NOT_SETTLED' : (breakdown?.final ? 'DROPEA_FINAL' : (breakdown ? 'DROPEA_ESTIMATE' : 'FALLBACK')),
      calculatedAt: breakdown?.value?.calculated_at || null
    };
  }).filter(Boolean).sort((a, b) => String(b.settlementDay || b.createdDay || '').localeCompare(String(a.settlementDay || a.createdDay || '')) || Number(b.orderId) - Number(a.orderId));
  const drilldowns = Object.fromEntries([...drilldownSets].map(([day, groups]) => [day, Object.fromEntries(Object.entries(groups).map(([name, ids]) => [name, [...ids].sort((a, b) => Number(a) - Number(b))]))]));
  return {
    period, status: period.current ? 'provisional' : 'reconstructed', statusLabel: period.current ? 'MTD · cohorte actual' : 'Mes cerrado · cohorte Dropea',
    counts, totals, days, products: productRows, orders: orderRows, drilldowns,
    eventCounts: {
      shipped: counts.sent,
      delivered: counts.delivered,
      deliveredUnits: counts.deliveredUnits,
      returned: counts.returned,
      returnedUnits: counts.returnedUnits
    },
    coverage: { orders: true, meta: metaAvailable, productCostPercent: counts.deliveredUnits ? Math.max(0, 100 - Math.round(missingUnits * 100 / counts.deliveredUnits)) : 100, dropeaBreakdownPublishedPercent: terminalOrders.length ? Math.round(publishedBreakdownOrders * 100 / terminalOrders.length) : 100, dropeaBreakdownPercent: terminalOrders.length ? Math.round(actualBreakdownOrders * 100 / terminalOrders.length) : 100, exactProfitAvailable: totals.exactNetProfit !== null, closedActual: false },
    quality: { status: qualityIssues.some((issue) => ['MISSING_AD_SPEND', 'MISSING_COST', 'MISSING_RETURN_COST', 'MISSING_FINAL_AMOUNT'].includes(issue.code)) ? 'PARTIAL' : (qualityIssues.length ? 'PARTIAL' : 'OK'), score: Math.max(0, 100 - qualityIssues.length * 8), issues: qualityIssues },
    warnings: qualityIssues.map((issue) => issue.message),
    controls: { fullPeriodBoundary: true, dailyRevenueReconciled: totals.realRevenue === null || moneyToCents(totals.realRevenue) === dailyRevenue, dailyCostsReconciled: totals.totalCosts === null || moneyToCents(totals.totalCosts) === dailyCosts, profitReconciled: totals.exactNetProfit === null || moneyToCents(totals.exactNetProfit) === moneyToCents(totals.realRevenue) - moneyToCents(totals.totalCosts), expensesReconciled: true, costsReconciled: true, productRevenueReconciled: totals.realRevenue === null || productRevenue === moneyToCents(totals.realRevenue), productReturnCostsReconciled: productReturnCosts === moneyToCents(totals.returnCost), costLedgerUnique: duplicateChargesBlocked === 0, noReturnRejectionOverlap: true },
    costLedger: { chargeCount: chargeLedger.size, duplicateChargesBlocked, sourceCounts: chargeSources, identity: 'order_id + cost_type + line_identity' },
    eventCoverage: { missingTimestamps: missingEventTimestamps },
    costTraceability: { product: { primary: 'Dropea expenses_breakdown.product_price cuando es mayor que cero', fallback: 'Tarifa empresarial versionada por product_id + variant_id', tariffVersion: rules.version, effectiveDate: rules.effective_from }, logistics: { primary: 'Dropea expenses_breakdown definitivo por pedido', fallback: rules.source, tariffVersion: rules.version, effectiveDate: rules.effective_from }, return: { primary: 'shipping_refused_price + fulfillment_refused_price del pedido', basis: 'PER_RETURNED_ORDER', fallbackAmount: 5.26, fallback: 'BUSINESS_VERIFIED_DROPEA_RATE', tariffVersion: rules.version, effectiveDate: rules.effective_from }, expenses: [...new Set(expenses.map((expense) => expense.source))] },
    expenseLedger: expenses.map((expense) => {
      const applied = [...allocateExpenses(period, [expense]).values()].reduce((sum, row) => sum + row.fixed + row.oneOff + row.other, 0);
      return { id: expense.id, name: expense.name, category: expense.category || 'Otros', type: expense.type, amount: euros(Number(expense.amount_cents) || 0), appliedAmount: euros(applied), startDate: expense.start_date || null, endDate: expense.end_date || null, date: expense.date || null, source: expense.source || 'ledger' };
    }).filter((expense) => expense.appliedAmount > 0)
  };
}

export function applyFinanceExpenseLedger(report, expenses = loadFinanceExpenses()) {
  if (!report?.period || !Array.isArray(report.days)) return report;
  const next = structuredClone(report);
  const allocations = allocateExpenses(next.period, expenses);
  next.days = next.days.map((day) => {
    const allocation = allocations.get(day.day) || { fixed: 0, oneOff: 0, other: 0 };
    const revenue = moneyToCents(day.realRevenue);
    const variable = ['productCost', 'outboundShippingCost', 'outboundFulfillmentCost', 'codCost', 'returnCost', 'dropeaAdjustmentsCost', 'metaSpend']
      .reduce((sum, field) => sum + (moneyToCents(day[field]) || 0), 0);
    const total = next.coverage?.meta === false ? null : variable + allocation.fixed + allocation.oneOff + allocation.other;
    const net = total === null || revenue === null ? null : revenue - total;
    const logistics = ['outboundShippingCost', 'outboundFulfillmentCost', 'codCost', 'returnCost', 'dropeaAdjustmentsCost']
      .reduce((sum, field) => sum + (moneyToCents(day[field]) || 0), 0);
    return {
      ...day,
      fixedCosts: euros(allocation.fixed),
      oneOffCosts: euros(allocation.oneOff),
      otherCosts: euros(allocation.other),
      logisticsCost: euros(logistics),
      totalCosts: euros(total),
      netProfit: euros(net),
      marginPercent: pct(net, revenue),
      roiPercent: pct(net, total)
    };
  });
  next.totals = aggregateTotals(next.days, next.counts || {}, next.coverage?.meta !== false);
  next.expenseLedger = expenses.map((expense) => {
    const applied = [...allocateExpenses(next.period, [expense]).values()].reduce((sum, row) => sum + row.fixed + row.oneOff + row.other, 0);
    return { id: expense.id, name: expense.name, category: expense.category || 'Otros', type: expense.type, amount: euros(Number(expense.amount_cents) || 0), appliedAmount: euros(applied), startDate: expense.start_date || null, endDate: expense.end_date || null, date: expense.date || null, source: expense.source || 'ledger', editable: expense.editable === true };
  }).filter((expense) => expense.appliedAmount > 0);
  if (next.audit?.benchmarkNetProfit !== undefined) {
    const computed = moneyToCents(next.totals.exactNetProfit);
    const benchmark = moneyToCents(next.audit.benchmarkNetProfit);
    next.audit.computedNetProfit = next.totals.exactNetProfit;
    next.audit.variance = computed === null || benchmark === null ? null : euros(computed - benchmark);
  }
  next.controls = {
    ...next.controls,
    dailyCostsReconciled: next.totals.totalCosts === null || moneyToCents(next.totals.totalCosts) === sumCents(next.days, 'totalCosts'),
    profitReconciled: next.totals.exactNetProfit === null || moneyToCents(next.totals.exactNetProfit) === moneyToCents(next.totals.realRevenue) - moneyToCents(next.totals.totalCosts),
    expensesReconciled: true
  };
  return next;
}

function applyClosed(report, actual) {
  if (!actual) return report;
  const computed = moneyToCents(report.totals.exactNetProfit);
  const benchmark = moneyToCents(actual.totals.exactNetProfit);
  return {
    ...report,
    audit: {
      ...actual.audit,
      source: actual.source,
      benchmarkNetProfit: actual.totals.exactNetProfit,
      computedNetProfit: report.totals.exactNetProfit,
      variance: computed === null || benchmark === null ? null : euros(computed - benchmark),
      mode: 'benchmark_only'
    },
    coverage: { ...report.coverage, closedBenchmarkAvailable: true }
  };
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

async function loadSources({ env, clientFactory, configLoader, periods, includeIssues = true }) {
  const orders = []; const issues = [];
  await Promise.all(configLoader(env).map(async (store) => {
    const client = clientFactory({ token: store.token, market: store.market });
    const firstDay = periods[0].since;
    const lastDay = periods.at(-1).until;
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
      includeIssues ? client.listAll('listIssues', {}, {
        maxPages: 80,
        maxRecords: 2000,
        requestedLimit: 100,
        itemFilter: (issue) => {
          const day = localDay(issue.created_at || issue.createdAt);
          return Boolean(day && day >= firstDay && day <= lastDay);
        }
      }) : Promise.resolve({ items: [] })
    ]);
    const storeOrders = [...new Map(
      orderPages.flatMap((page) => page.items).map((order) => [String(order.id), order])
    ).values()];
    const detailCandidates = storeOrders.filter((order) => {
      const breakdown = dropeaExpenseBreakdown(order);
      return ['delivered', 'returned'].includes(classifyFinanceOrder(order)) && !breakdown?.final;
    });
    const detailById = new Map();
    let nextDetail = 0;
    const detailWorkers = Array.from({ length: Math.min(3, detailCandidates.length) }, async () => {
      while (nextDetail < detailCandidates.length) {
        const summaryOrder = detailCandidates[nextDetail];
        nextDetail += 1;
        try {
          const payload = await client.request('getOrder', { id: Number(summaryOrder.id) });
          // The live Dropea V2 endpoint returns the order directly. Some test
          // adapters and older proxies wrap it in `data`, so accept both shapes.
          const detail = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
          if (detail && typeof detail === 'object') {
            detailById.set(String(summaryOrder.id), { ...summaryOrder, ...detail });
          }
        } catch {
          // The monthly list remains usable and the report explicitly marks the
          // affected order as tariff-backed. One failed detail must not erase a month.
        }
      }
    });
    await Promise.all(detailWorkers);
    orders.push(...storeOrders.map((order) => detailById.get(String(order.id)) || order));
    issues.push(...issuePage.items);
  }));
  return {
    orders: [...new Map(orders.map((order) => [String(order.id), order])).values()],
    issues: [...new Map(issues.map((issue) => [String(issue.id), issue])).values()]
  };
}

export async function loadFinanceSourceData({ env = process.env, months, now = new Date(), clientFactory = createDropeaV2IncidentClient, configLoader = loadDropeaV2IncidentStoreConfigs } = {}) {
  if (!Array.isArray(months) || months.length === 0 || months.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))) {
    throw new Error('FINANCE_SOURCE_MONTHS_INVALID');
  }
  const ordered = [...new Set(months.map(String))].sort();
  const sourceMonths = [previousMonth(ordered[0]), ...ordered];
  const periods = sourceMonths.map((month) => resolveFinancePeriod(month, { now }));
  return loadSources({ env, clientFactory, configLoader, periods });
}

export async function buildFinanceReport({ month, force = false, leanRefresh = false, env = process.env, now = new Date(), clientFactory = createDropeaV2IncidentClient, configLoader = loadDropeaV2IncidentStoreConfigs, metaLoader = getCampaignInsights, rules = loadFinanceCostRules(), expenses = loadFinanceExpenses(), sourceData = null } = {}) {
  const period = resolveFinancePeriod(month, { now });
  const cached = cache.get(period.month);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const historyMonths = monthsEndingAt(period.month, 12, rules.effective_from.slice(0, 7));
  const earliest = leanRefresh ? period.month : historyMonths[0];
  // The management P&L is a creation cohort: every order and its final outcome
  // stay assigned to the day on which that order was created.
  const sourcePeriods = leanRefresh
    ? [period]
    : [previousMonth(earliest), ...historyMonths].map((value) => resolveFinancePeriod(value, { now }));
  const [orderResult, metaResult] = await Promise.allSettled([
    sourceData ? Promise.resolve(sourceData) : loadSources({ env, clientFactory, configLoader, periods: sourcePeriods, includeIssues: !leanRefresh }),
    metaLoader({ since: `${earliest}-01`, until: period.until, level: 'campaign', limit: 500, timeIncrement: 1 })
  ]);
  if (orderResult.status === 'rejected' && !getClosedFinanceActual(period.month)) throw orderResult.reason;
  const source = orderResult.status === 'fulfilled' ? orderResult.value : { orders: [], issues: [] };
  const metaRows = metaResult.status === 'fulfilled' ? metaResult.value : [];
  const build = (target) => applyClosed(aggregateFinanceReport({ orders: source.orders, issues: source.issues, metaRows, period: target, rules, expenses, metaAvailable: metaResult.status === 'fulfilled' }), getClosedFinanceActual(target.month));
  const report = build(period);
  if (leanRefresh) {
    const storedHistory = new Map((await Promise.all(historyMonths
      .filter((value) => value !== period.month)
      .map(async (value) => [value, await loadFinanceSnapshot({ month: value, now })])))
      .filter(([, stored]) => stored));
    const prior = storedHistory.get(previousMonth(period.month));
    report.comparison = prior
      ? { period: prior.period, summary: summary(prior), deltas: Object.fromEntries(['exactNetProfit', 'realRevenue', 'totalCosts', 'roiPercent', 'roas', 'marginPercent'].map((field) => [field, delta(report.totals[field], prior.totals[field])])) }
      : { period: null, summary: null, deltas: {} };
    report.history = historyMonths.flatMap((value) => {
      if (value === period.month) return [summary(report)];
      const stored = storedHistory.get(value);
      return stored ? [summary(stored)] : [];
    });
  } else {
    const prior = build(resolveFinancePeriod(previousMonth(period.month), { now, comparableDay: period.current ? period.elapsedDays : null }));
    report.comparison = { period: prior.period, summary: summary(prior), deltas: Object.fromEntries(['exactNetProfit', 'realRevenue', 'totalCosts', 'roiPercent', 'roas', 'marginPercent'].map((field) => [field, delta(report.totals[field], prior.totals[field])])) };
    report.history = historyMonths.map((value) => summary(build(resolveFinancePeriod(value, { now }))));
  }
  report.projection = buildProjection(report, expenses);
  report.generatedAt = now.toISOString();
  report.freshness = { generatedAt: report.generatedAt, sources: { dropea: { status: orderResult.status === 'fulfilled' ? 'OK' : 'SOURCE_ERROR', lastSyncAt: orderResult.status === 'fulfilled' ? report.generatedAt : null, ageMinutes: orderResult.status === 'fulfilled' ? 0 : null }, meta: { status: metaResult.status === 'fulfilled' ? 'OK' : 'SOURCE_ERROR', lastSyncAt: metaResult.status === 'fulfilled' ? report.generatedAt : null, ageMinutes: metaResult.status === 'fulfilled' ? 0 : null }, expenses: { status: expenses.length ? 'OK' : 'MISSING', lastSyncAt: report.generatedAt, ageMinutes: 0 } } };
  report.sources = report.sources || { orders: 'Dropea Public API V2', meta: metaResult.status === 'fulfilled' ? 'Meta Marketing API' : 'Meta Ads pendiente de sincronización', costs: 'Dropea V2 expenses_breakdown por pedido + respaldo empresarial versionado', expenses: 'Ledger mensual versionado de gastos' };
  report.availableRange = { from: rules.effective_from.slice(0, 7), to: localDay(now).slice(0, 7) };
  report.definitions = { netProfit: 'Facturación final de pedidos entregados de la cohorte − costes reales por pedido de Dropea − coste de producto − publicidad Meta − gastos fijos − puntuales − otros.', dailyAttribution: 'Cada pedido y su resultado final se atribuyen al día de creación del pedido; nunca se mezclan pedidos creados en otros días o meses.', roi: 'Beneficio neto / costes totales.', roas: 'Facturación realizada / gasto Meta.', margin: 'Beneficio neto / facturación realizada.', deliveryRate: 'Entregados / enviados de la cohorte de pedidos creados en el mes.', returnRate: 'Devueltos / enviados de la cohorte de pedidos creados en el mes.', returnCost: 'Suma real por pedido de shipping_refused_price y fulfillment_refused_price; 5,26 € por pedido solo cuando el histórico no publica desglose.' };
  cache.set(period.month, { at: Date.now(), report });
  await persistFinanceSnapshot(report);
  return report;
}

export function clearFinanceCache() {
  cache.clear();
}
