const DAY_MS = 86_400_000;
const SENT_STATES = new Set(['CONFIRMED', 'PROCESSING', 'PREPARING', 'PREPARED', 'SHIPPING', 'TRANSIT', 'IN_TRANSIT', 'DELIVERED', 'FINISHED', 'INCIDENCE', 'RETURNED']);
const DELIVERED_STATES = new Set(['DELIVERED', 'FINISHED']);
const TERMINAL_NOT_DELIVERED = new Set(['CANCELLED', 'REJECTED', 'RETURNED', 'INDEMNIFIED']);

function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function amount(value) {
  return value === null ? null : Number((value / 100).toFixed(2));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function auditCheck(key, actual, expected, tolerance = 0.01) {
  if (actual === null || expected === null || actual === undefined || expected === undefined) {
    return { key, status: 'BLOCKED', actual: actual ?? null, expected: expected ?? null, delta: null };
  }
  const delta = Number((Number(actual) - Number(expected)).toFixed(4));
  return { key, status: Math.abs(delta) <= tolerance ? 'PASS' : 'FAIL', actual, expected, delta };
}

function businessDate(value, timezone) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function monthDays(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('FINANCE_MONTH_INVALID');
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('FINANCE_MONTH_INVALID');
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function state(order) {
  return String(order.lifecycle_status || order.status || 'UNKNOWN').toUpperCase();
}

function normalizedProducts(order) {
  const rows = Array.isArray(order.product_summary?.products) ? order.product_summary.products : [];
  return rows.map((product) => ({
    product_id: product.product_id === null || product.product_id === undefined ? null : String(product.product_id),
    variant_id: product.variant_id === null || product.variant_id === undefined ? null : String(product.variant_id),
    name: String(product.name || 'Producto sin nombre'),
    quantity: Number.isFinite(Number(product.quantity)) ? Number(product.quantity) : 0,
    wholesale_price: product.wholesale_price === null || product.wholesale_price === undefined || product.wholesale_price === ''
      ? null : Number(product.wholesale_price)
  })).filter((product) => product.quantity > 0);
}

function applies(rate, day) {
  return (!rate.effective_from || rate.effective_from <= day) && (!rate.effective_to || rate.effective_to >= day);
}

function rateFor(rates, type, day, dimensions = {}) {
  const candidates = rates.filter((rate) => String(rate.cost_type).toUpperCase() === type && applies(rate, day))
    .filter((rate) => !rate.currency || String(rate.currency).toUpperCase() === String(dimensions.currency || 'EUR').toUpperCase())
    .filter((rate) => !rate.store_id || String(rate.store_id) === String(dimensions.store_id || ''))
    .filter((rate) => !rate.carrier || String(rate.carrier).toUpperCase() === String(dimensions.carrier || '').toUpperCase())
    .filter((rate) => !rate.product_id || String(rate.product_id) === String(dimensions.product_id || ''))
    .filter((rate) => !rate.variant_id || String(rate.variant_id) === String(dimensions.variant_id || ''))
    .map((rate) => ({ rate, specificity: ['carrier', 'product_id', 'variant_id'].filter((key) => rate[key]).length }))
    .sort((a, b) => b.specificity - a.specificity || String(b.rate.effective_from || '').localeCompare(String(a.rate.effective_from || '')));
  return candidates[0]?.rate || null;
}

function addKnown(values) {
  return values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
}

function productCost(product, rates, day, dimensions) {
  // A governed PRODUCT_COGS rate is an explicit accounting override confirmed
  // by the operator and therefore outranks a provider-side wholesale hint.
  const rate = rateFor(rates, 'PRODUCT_COGS', day, { ...product, ...dimensions });
  if (rate) return cents(rate.amount);
  // Dropea uses zero for legacy/unavailable wholesale prices. Treating that
  // sentinel as a free product inflates profit, so require a positive value.
  if (Number.isFinite(product.wholesale_price) && product.wholesale_price > 0) {
    return cents(product.wholesale_price);
  }
  return null;
}

function fixedDaily(expenses, days) {
  const result = new Map(days.map((day) => [day, 0]));
  for (const expense of expenses) {
    const expenseCents = cents(expense.amount);
    if (expenseCents === null || String(expense.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
    const eligible = days.filter((day) => (!expense.start_date || day >= expense.start_date) && (!expense.end_date || day <= expense.end_date));
    if (!eligible.length) continue;
    if (String(expense.expense_type).toUpperCase() === 'ONE_OFF') {
      const target = expense.occurred_on || expense.start_date;
      if (result.has(target)) result.set(target, result.get(target) + expenseCents);
      continue;
    }
    const base = Math.floor(expenseCents / eligible.length);
    let remainder = expenseCents - (base * eligible.length);
    for (const day of eligible) {
      result.set(day, result.get(day) + base + (remainder > 0 ? 1 : 0));
      remainder -= remainder > 0 ? 1 : 0;
    }
  }
  return result;
}

function sourceStatus(rows, day, currency) {
  const dayRows = rows.filter((item) => item.business_date === day);
  if (!dayRows.length || dayRows.some((row) => String(row.sync_status).toUpperCase() !== 'COMPLETE' || String(row.currency || currency).toUpperCase() !== String(currency).toUpperCase())) {
    return { value: null, status: dayRows[0]?.sync_status || 'MISSING' };
  }
  const values = dayRows.map((row) => cents(row.spend));
  return { value: values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0), status: 'COMPLETE' };
}

function orderFlags(order) {
  const lifecycle = state(order);
  const sent = Boolean(order.confirmed_at_utc) || SENT_STATES.has(lifecycle);
  const returned = Boolean(order.returned_at_utc) || lifecycle === 'RETURNED' || (lifecycle === 'REJECTED' && sent);
  const delivered = (Boolean(order.delivered_at_utc) || DELIVERED_STATES.has(lifecycle)) && !returned;
  return {
    sent, delivered, returned,
    in_air: sent && !delivered && !returned && !TERMINAL_NOT_DELIVERED.has(lifecycle)
  };
}

function eventDays(order, timezone) {
  return {
    created: businessDate(order.created_at_utc, timezone),
    sent: businessDate(order.confirmed_at_utc, timezone),
    delivered: businessDate(order.delivered_at_utc, timezone),
    returned: businessDate(order.returned_at_utc, timezone)
  };
}

function inMonth(day, month) {
  return Boolean(day && day.startsWith(`${month}-`));
}

function observedFulfillmentCost(order, type) {
  const costs = order.order_costs && typeof order.order_costs === 'object' ? order.order_costs : null;
  if (!costs) return null;
  if (type === 'OUTBOUND_FULFILLMENT') {
    const outbound = cents(costs.fulfillment_outbound);
    const quantity = cents(costs.fulfillment_quantity_cost);
    return outbound === null || quantity === null ? null : outbound + quantity;
  }
  if (type === 'RETURN_FULFILLMENT') return cents(costs.fulfillment_return);
  return null;
}

function exactOrderCost(order, rates, type, day, dimensions) {
  const observed = observedFulfillmentCost(order, type);
  if (observed !== null) return observed;
  const rate = rateFor(rates, type, day, dimensions);
  return rate ? cents(rate.amount) : null;
}

function productRollup(orders, rates, timezone, currency) {
  const products = new Map();
  for (const order of orders) {
    const flags = orderFlags(order); const day = businessDate(order.created_at_utc || order.source_updated_at || order.updated_at, timezone);
    const orderProducts = normalizedProducts(order); const orderAmount = String(order.currency || currency).toUpperCase() === currency ? cents(order.total_amount) : null;
    for (const product of orderProducts) {
      const key = product.variant_id || product.product_id || product.name;
      const row = products.get(key) || { product_id: product.product_id, variant_id: product.variant_id, name: product.name, orders: 0, units: 0, sent_units: 0, delivered_units: 0, in_air_units: 0, returned_units: 0, incidence_orders: 0, revenue_estimated_cents: 0, revenue_real_cents: 0, revenue_attribution_complete: true, product_cost_cents: 0, product_cost_complete: true, attributable_operational_cost_cents: 0, attributable_profit_complete: true };
      row.orders += 1; row.units += product.quantity;
      if (flags.sent) row.sent_units += product.quantity;
      if (flags.delivered) row.delivered_units += product.quantity;
      if (flags.in_air) row.in_air_units += product.quantity;
      if (flags.returned) row.returned_units += product.quantity;
      if (order.active_issue_id) row.incidence_orders += 1;
      if (orderProducts.length === 1 && orderAmount !== null) {
        if (flags.sent) row.revenue_estimated_cents += orderAmount;
        if (flags.delivered) row.revenue_real_cents += orderAmount;
      } else if (flags.sent || flags.delivered) row.revenue_attribution_complete = false;
      if (flags.delivered) {
        const unitCost = productCost(product, rates, day, { store_id: order.store_id, currency });
        if (unitCost === null) row.product_cost_complete = false;
        else row.product_cost_cents += unitCost * product.quantity;
      }
      if (orderProducts.length !== 1 && (flags.sent || flags.returned)) row.attributable_profit_complete = false;
      if (orderProducts.length === 1) {
        const dimensions = { carrier: order.carrier, store_id: order.store_id, currency };
        const needed = [
          ...(flags.sent ? ['OUTBOUND_SHIPPING', 'OUTBOUND_FULFILLMENT'] : []),
          ...(flags.delivered ? ['COD'] : []),
          ...(flags.returned ? ['RETURN_SHIPPING', 'RETURN_FULFILLMENT'] : [])
        ];
        for (const type of needed) {
          const value = exactOrderCost(order, rates, type, day, dimensions);
          if (value === null) row.attributable_profit_complete = false;
          else row.attributable_operational_cost_cents += value;
        }
        if (flags.delivered) {
          const unitCost = productCost(product, rates, day, { store_id: order.store_id, currency });
          if (unitCost === null) row.attributable_profit_complete = false;
          else row.attributable_operational_cost_cents += unitCost * product.quantity;
        }
      }
      products.set(key, row);
    }
  }
  return [...products.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)).map((row) => ({
    ...row,
    revenue_estimated: row.revenue_attribution_complete ? amount(row.revenue_estimated_cents) : null,
    revenue_real: row.revenue_attribution_complete ? amount(row.revenue_real_cents) : null,
    product_cost: row.product_cost_complete ? amount(row.product_cost_cents) : null,
    attributable_operational_cost: row.attributable_profit_complete ? amount(row.attributable_operational_cost_cents) : null,
    attributable_operational_profit: row.attributable_profit_complete && row.revenue_attribution_complete
      ? amount(row.revenue_real_cents - row.attributable_operational_cost_cents) : null
  }));
}

function logisticsRollup(orders, rates, timezone, currency) {
  const carriers = new Map();
  for (const order of orders) {
    const flags = orderFlags(order); if (!flags.sent && !flags.returned) continue;
    const carrier = String(order.carrier || 'SIN TRANSPORTISTA');
    const day = businessDate(order.created_at_utc || order.source_updated_at || order.updated_at, timezone);
    const row = carriers.get(carrier) || { carrier, orders_sent: 0, delivered: 0, returned: 0, in_air: 0, outbound_shipping_cents: 0, outbound_fulfillment_cents: 0, cod_cents: 0, returns_cents: 0, complete: true };
    row.orders_sent += flags.sent ? 1 : 0; row.delivered += flags.delivered ? 1 : 0; row.returned += flags.returned ? 1 : 0; row.in_air += flags.in_air ? 1 : 0;
    for (const [appliesTo, type, target] of [['sent', 'OUTBOUND_SHIPPING', 'outbound_shipping_cents'], ['sent', 'OUTBOUND_FULFILLMENT', 'outbound_fulfillment_cents'], ['delivered', 'COD', 'cod_cents'], ['returned', 'RETURN_SHIPPING', 'returns_cents'], ['returned', 'RETURN_FULFILLMENT', 'returns_cents']]) {
      if (!flags[appliesTo]) continue;
      const value = exactOrderCost(order, rates, type, day, { carrier, store_id: order.store_id, currency });
      if (value === null) row.complete = false; else row[target] += value;
    }
    carriers.set(carrier, row);
  }
  return [...carriers.values()].sort((a, b) => b.orders_sent - a.orders_sent).map((row) => {
    const total = row.complete ? row.outbound_shipping_cents + row.outbound_fulfillment_cents + row.cod_cents + row.returns_cents : null;
    return { carrier: row.carrier, orders_sent: row.orders_sent, delivered: row.delivered, returned: row.returned, in_air: row.in_air,
      outbound_shipping: row.complete ? amount(row.outbound_shipping_cents) : null,
      outbound_fulfillment: row.complete ? amount(row.outbound_fulfillment_cents) : null,
      cod: row.complete ? amount(row.cod_cents) : null, returns: row.complete ? amount(row.returns_cents) : null,
      total_cost: amount(total), cost_per_order: total === null || !row.orders_sent ? null : amount(Math.round(total / row.orders_sent)),
      delivery_rate: ratio(row.delivered, row.orders_sent), quality: row.complete ? 'COMPLETE' : 'INCOMPLETE' };
  });
}

function productEventRollup(orders, rates, month, timezone, currency, includeCurrentSnapshot) {
  const products = new Map();
  for (const order of orders) {
    const dates = eventDays(order, timezone); const flags = orderFlags(order);
    const created = inMonth(dates.created, month); const sent = inMonth(dates.sent, month);
    const delivered = inMonth(dates.delivered, month); const returned = inMonth(dates.returned, month);
    const currentInAir = includeCurrentSnapshot && flags.in_air && dates.created && dates.created <= `${month}-31`;
    if (!created && !sent && !delivered && !returned && !currentInAir) continue;
    const orderProducts = normalizedProducts(order);
    const orderAmount = String(order.currency || currency).toUpperCase() === currency ? cents(order.total_amount) : null;
    for (const product of orderProducts) {
      const key = product.variant_id || product.product_id || product.name;
      const row = products.get(key) || { product_id: product.product_id, variant_id: product.variant_id, name: product.name,
        orders: 0, units: 0, sent_units: 0, delivered_units: 0, in_air_units: 0, returned_units: 0,
        incidence_orders: 0, revenue_estimated_cents: 0, revenue_real_cents: 0,
        revenue_attribution_complete: true, product_cost_cents: 0, product_cost_complete: true,
        attributable_operational_cost_cents: 0, attributable_profit_complete: true };
      if (created) { row.orders += 1; row.units += product.quantity; if (order.active_issue_id) row.incidence_orders += 1; }
      if (sent) row.sent_units += product.quantity;
      if (delivered) row.delivered_units += product.quantity;
      if (currentInAir) row.in_air_units += product.quantity;
      if (returned) row.returned_units += product.quantity;
      if (orderProducts.length === 1 && orderAmount !== null) {
        if (sent) row.revenue_estimated_cents += orderAmount;
        if (delivered) row.revenue_real_cents += orderAmount;
      } else if (sent || delivered) row.revenue_attribution_complete = false;
      if (delivered) {
        const unitCost = productCost(product, rates, dates.delivered, { store_id: order.store_id, currency });
        if (unitCost === null) row.product_cost_complete = false;
        else row.product_cost_cents += unitCost * product.quantity;
      }
      if (orderProducts.length !== 1 && (sent || delivered || returned)) row.attributable_profit_complete = false;
      if (orderProducts.length === 1) {
        const dimensions = { carrier: order.carrier, store_id: order.store_id, currency };
        const needed = [
          ...(sent ? [['OUTBOUND_SHIPPING', dates.sent], ['OUTBOUND_FULFILLMENT', dates.sent]] : []),
          ...(delivered ? [['COD', dates.delivered]] : []),
          ...(returned ? [['RETURN_SHIPPING', dates.returned], ['RETURN_FULFILLMENT', dates.returned]] : [])
        ];
        for (const [type, day] of needed) {
          const value = exactOrderCost(order, rates, type, day, dimensions);
          if (value === null) row.attributable_profit_complete = false;
          else row.attributable_operational_cost_cents += value;
        }
        if (delivered) {
          const unitCost = productCost(product, rates, dates.delivered, { store_id: order.store_id, currency });
          if (unitCost === null) row.attributable_profit_complete = false;
          else row.attributable_operational_cost_cents += unitCost * product.quantity;
        }
      }
      products.set(key, row);
    }
  }
  return [...products.values()].sort((a, b) => b.units - a.units || b.delivered_units - a.delivered_units || a.name.localeCompare(b.name)).map((row) => ({
    ...row,
    revenue_estimated: row.revenue_attribution_complete ? amount(row.revenue_estimated_cents) : null,
    revenue_real: row.revenue_attribution_complete ? amount(row.revenue_real_cents) : null,
    product_cost: row.product_cost_complete ? amount(row.product_cost_cents) : null,
    attributable_operational_cost: row.attributable_profit_complete ? amount(row.attributable_operational_cost_cents) : null,
    attributable_operational_profit: row.attributable_profit_complete && row.revenue_attribution_complete
      ? amount(row.revenue_real_cents - row.attributable_operational_cost_cents) : null
  }));
}

function logisticsEventRollup(orders, rates, month, timezone, currency, includeCurrentSnapshot) {
  const carriers = new Map();
  for (const order of orders) {
    const dates = eventDays(order, timezone); const flags = orderFlags(order);
    const sent = inMonth(dates.sent, month); const delivered = inMonth(dates.delivered, month);
    const returned = inMonth(dates.returned, month); const currentInAir = includeCurrentSnapshot && flags.in_air && dates.created && dates.created <= `${month}-31`;
    if (!sent && !delivered && !returned && !currentInAir) continue;
    const carrier = String(order.carrier || 'SIN TRANSPORTISTA');
    const row = carriers.get(carrier) || { carrier, orders_sent: 0, delivered: 0, returned: 0, in_air: 0,
      outbound_shipping_cents: 0, outbound_fulfillment_cents: 0, cod_cents: 0, returns_cents: 0, complete: true };
    row.orders_sent += sent ? 1 : 0; row.delivered += delivered ? 1 : 0;
    row.returned += returned ? 1 : 0; row.in_air += currentInAir ? 1 : 0;
    const needed = [
      ...(sent ? [['OUTBOUND_SHIPPING', 'outbound_shipping_cents', dates.sent], ['OUTBOUND_FULFILLMENT', 'outbound_fulfillment_cents', dates.sent]] : []),
      ...(delivered ? [['COD', 'cod_cents', dates.delivered]] : []),
      ...(returned ? [['RETURN_SHIPPING', 'returns_cents', dates.returned], ['RETURN_FULFILLMENT', 'returns_cents', dates.returned]] : [])
    ];
    for (const [type, target, day] of needed) {
      const value = exactOrderCost(order, rates, type, day, { carrier, store_id: order.store_id, currency });
      if (value === null) row.complete = false; else row[target] += value;
    }
    carriers.set(carrier, row);
  }
  return [...carriers.values()].sort((a, b) => b.orders_sent - a.orders_sent || b.delivered - a.delivered).map((row) => {
    const total = row.complete ? row.outbound_shipping_cents + row.outbound_fulfillment_cents + row.cod_cents + row.returns_cents : null;
    return { carrier: row.carrier, orders_sent: row.orders_sent, delivered: row.delivered, returned: row.returned, in_air: row.in_air,
      outbound_shipping: row.complete ? amount(row.outbound_shipping_cents) : null,
      outbound_fulfillment: row.complete ? amount(row.outbound_fulfillment_cents) : null,
      cod: row.complete ? amount(row.cod_cents) : null, returns: row.complete ? amount(row.returns_cents) : null,
      total_cost: amount(total), cost_per_order: total === null || !row.orders_sent ? null : amount(Math.round(total / row.orders_sent)),
      delivery_rate: ratio(row.delivered, row.orders_sent), quality: row.complete ? 'COMPLETE' : 'INCOMPLETE' };
  });
}

export function buildMonthlyFinanceReport({ month, orders = [], rates = [], fixedExpenses = [], fixedExpensesComplete = fixedExpenses.length > 0, adSpend = [], now = new Date(), timezone = 'Europe/Madrid', currency = 'EUR' }) {
  const days = monthDays(month); const today = businessDate(now, timezone);
  const requiredDays = days.filter((day) => month < today.slice(0, 7) || day <= today);
  const eventsByDay = new Map(days.map((day) => [day, []]));
  const fixed = fixedDaily(fixedExpenses, days); const missing = new Set();
  if (!fixedExpensesComplete) missing.add(`FIXED_EXPENSES:${month}`);
  for (const order of orders) {
    const flags = orderFlags(order); const dates = eventDays(order, timezone);
    for (const [type, day] of Object.entries(dates)) if (eventsByDay.has(day)) eventsByDay.get(day).push({ type, order });
    if (flags.sent && !dates.sent) missing.add(`EVENT_DATE:CONFIRMED:${order.canonical_order_id || 'UNKNOWN'}`);
    if (flags.delivered && !dates.delivered) missing.add(`EVENT_DATE:DELIVERED:${order.canonical_order_id || 'UNKNOWN'}`);
    if (flags.returned && !dates.returned) missing.add(`EVENT_DATE:RETURNED:${order.canonical_order_id || 'UNKNOWN'}`);
    if (dates.delivered && dates.returned) missing.add(`REFUND_VALUE:${order.canonical_order_id || 'UNKNOWN'}`);
  }
  const daily = days.map((day) => {
    const events = eventsByDay.get(day); const relevant = day <= today; const ad = relevant ? sourceStatus(adSpend, day, currency) : { value: 0, status: 'FUTURE' };
    const counts = { orders_created: 0, orders_sent: 0, delivered: 0, in_air: 0, returned: 0, incidences: 0 };
    let estimatedRevenue = 0; let realRevenue = 0; let estimatedRevenueComplete = true; let realRevenueComplete = true;
    const components = { product: 0, outbound_shipping: 0, cod: 0, outbound_fulfillment: 0, returns: 0, advertising: ad.value, fixed: fixedExpensesComplete ? fixed.get(day) || 0 : null };
    for (const { type: eventType, order } of events) {
      const orderAmount = String(order.currency || currency).toUpperCase() === currency ? cents(order.total_amount) : null; const carrier = order.carrier;
      if (eventType === 'created') { counts.orders_created += 1; counts.incidences += order.active_issue_id ? 1 : 0; continue; }
      if (eventType === 'sent') {
        counts.orders_sent += 1;
        if (orderAmount !== null) estimatedRevenue += orderAmount;
        else { estimatedRevenueComplete = false; missing.add(`ORDER_AMOUNT:${order.canonical_order_id || 'UNKNOWN'}`); }
      }
      if (eventType === 'delivered') {
        counts.delivered += 1;
        if (order.returned_at_utc) realRevenueComplete = false;
        else if (orderAmount !== null) realRevenue += orderAmount;
        else { realRevenueComplete = false; missing.add(`ORDER_AMOUNT:${order.canonical_order_id || 'UNKNOWN'}`); }
      }
      if (eventType === 'returned') {
        counts.returned += 1;
        if (order.delivered_at_utc) realRevenueComplete = false;
      }
      const neededTypes = eventType === 'sent' ? ['OUTBOUND_SHIPPING', 'OUTBOUND_FULFILLMENT']
        : eventType === 'delivered' ? ['COD'] : eventType === 'returned' ? ['RETURN_SHIPPING', 'RETURN_FULFILLMENT'] : [];
      for (const type of neededTypes) {
        const rateCents = exactOrderCost(order, rates, type, day, { carrier, store_id: order.store_id, currency });
        const target = type === 'OUTBOUND_SHIPPING' ? 'outbound_shipping' : type === 'OUTBOUND_FULFILLMENT' ? 'outbound_fulfillment' : type === 'COD' ? 'cod' : 'returns';
        if (rateCents === null) { components[target] = null; missing.add(`${type}:${carrier || 'SIN_TRANSPORTISTA'}`); }
        else if (components[target] !== null) components[target] += rateCents;
      }
      if (eventType === 'delivered') {
        const products = normalizedProducts(order);
        if (!products.length) { components.product = null; missing.add('PRODUCT_COGS:ORDER_ITEMS_MISSING'); }
        for (const product of products) {
          const rateCents = productCost(product, rates, day, { store_id: order.store_id, currency });
          if (rateCents === null) { components.product = null; missing.add(`PRODUCT_COGS:${product.variant_id || product.product_id || product.name}`); }
          else if (components.product !== null) components.product += rateCents * product.quantity;
        }
      }
    }
    if (relevant && ad.value === null) missing.add(`ADVERTISING:${day}`);
    const operationalExpenseCents = addKnown([
      components.product, components.outbound_shipping, components.cod,
      components.outbound_fulfillment, components.returns, components.fixed
    ]);
    // Dropea Statistics uses this perimeter: realised income minus delivery,
    // COD, fulfilment and rejection/return logistics. Product acquisition,
    // fixed expenses and Meta remain separate and explicit.
    const dropeaExpenseCents = addKnown([
      components.outbound_shipping, components.cod,
      components.outbound_fulfillment, components.returns
    ]);
    const dropeaProfitCents = dropeaExpenseCents === null || !realRevenueComplete
      ? null : realRevenue - dropeaExpenseCents;
    const dropeaAfterMetaCents = dropeaProfitCents === null || ad.value === null
      ? null : dropeaProfitCents - ad.value;
    const operationalProfitCents = operationalExpenseCents === null || !realRevenueComplete
      ? null : realRevenue - operationalExpenseCents;
    const expenseCents = addKnown(Object.values(components));
    const profitCents = expenseCents === null || !realRevenueComplete ? null : realRevenue - expenseCents;
    return {
      day, ...counts, estimated_revenue: estimatedRevenueComplete ? amount(estimatedRevenue) : null, real_revenue: realRevenueComplete ? amount(realRevenue) : null,
      costs: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, amount(value)])),
      dropea_expenses: amount(dropeaExpenseCents), dropea_profit: amount(dropeaProfitCents),
      dropea_margin: realRevenue && dropeaProfitCents !== null ? ratio(dropeaProfitCents, realRevenue) : null,
      dropea_profit_after_meta: amount(dropeaAfterMetaCents),
      operational_expenses: amount(operationalExpenseCents), operational_profit: amount(operationalProfitCents),
      operational_margin: realRevenue && operationalProfitCents !== null ? ratio(operationalProfitCents, realRevenue) : null,
      total_expenses: amount(expenseCents), net_profit: amount(profitCents), roi: expenseCents && profitCents !== null ? ratio(profitCents, expenseCents) : null,
      margin: realRevenue && profitCents !== null ? ratio(profitCents, realRevenue) : null,
      estimated_cpa: counts.orders_sent && ad.value !== null ? amount(Math.round(ad.value / counts.orders_sent)) : null,
      real_cpa: counts.delivered && ad.value !== null ? amount(Math.round(ad.value / counts.delivered)) : null,
      confirmation_rate: ratio(counts.orders_sent, counts.orders_created), delivery_rate: ratio(counts.delivered, counts.orders_sent),
      quality: relevant && (expenseCents === null || !estimatedRevenueComplete || !realRevenueComplete) ? 'INCOMPLETE' : relevant ? 'COMPLETE' : 'FUTURE', advertising_status: ad.status
    };
  });
  // Current-month headline values are genuinely month-to-date. Future shares
  // of recurring expenses remain visible as a commitment, but never distort a
  // daily realised result before their calendar day arrives.
  const included = daily.filter((row) => row.day <= today);
  const sumField = (field) => Number(included.reduce((sum, row) => sum + Number(row[field] || 0), 0).toFixed(2));
  const sumCost = (field) => included.some((row) => row.costs[field] === null) ? null : Number(included.reduce((sum, row) => sum + Number(row.costs[field] || 0), 0).toFixed(2));
  const sumNullableField = (field) => included.some((row) => row[field] === null) ? null : sumField(field);
  const totalExpenses = sumNullableField('total_expenses');
  const operationalExpenses = sumNullableField('operational_expenses');
  const dropeaExpenses = sumNullableField('dropea_expenses');
  const realRevenue = sumNullableField('real_revenue'); const estimatedRevenue = sumNullableField('estimated_revenue');
  const dropeaProfit = dropeaExpenses === null || realRevenue === null
    ? null : Number((realRevenue - dropeaExpenses).toFixed(2));
  const advertising = sumCost('advertising');
  const dropeaProfitAfterMeta = dropeaProfit === null || advertising === null
    ? null : Number((dropeaProfit - advertising).toFixed(2));
  const operationalProfit = operationalExpenses === null || realRevenue === null
    ? null : Number((realRevenue - operationalExpenses).toFixed(2));
  const profit = totalExpenses === null || realRevenue === null ? null : Number((realRevenue - totalExpenses).toFixed(2));
  const ordersCreated = sumField('orders_created'); const ordersSent = sumField('orders_sent'); const delivered = sumField('delivered');
  const estimatedCpa = ordersSent && advertising !== null ? Number((advertising / ordersSent).toFixed(2)) : null;
  const realCpa = delivered && advertising !== null ? Number((advertising / delivered).toFixed(2)) : null;
  const cohortOrders = orders.filter((order) => inMonth(eventDays(order, timezone).created, month));
  const cohortSent = cohortOrders.filter((order) => orderFlags(order).sent).length;
  const cohortDelivered = cohortOrders.filter((order) => orderFlags(order).delivered).length;
  const currentMonth = month === today.slice(0, 7);
  const currentInAir = currentMonth ? orders.filter((order) => {
    const created = eventDays(order, timezone).created;
    return orderFlags(order).in_air && created && created <= today;
  }).length : null;
  const fixedCommitted = fixedExpensesComplete
    ? amount([...fixed.values()].reduce((sum, value) => sum + value, 0)) : null;
  const totals = {
    orders_created: ordersCreated, orders_sent: ordersSent, delivered, in_air: currentInAir, returned: sumField('returned'), incidences: sumField('incidences'),
    cohort: { orders_created: cohortOrders.length, orders_sent: cohortSent, delivered: cohortDelivered },
    estimated_revenue: estimatedRevenue, real_revenue: realRevenue,
    costs: { product: sumCost('product'), outbound_shipping: sumCost('outbound_shipping'), cod: sumCost('cod'), outbound_fulfillment: sumCost('outbound_fulfillment'), returns: sumCost('returns'), advertising: sumCost('advertising'), fixed: sumCost('fixed') },
    fixed_expenses_committed: fixedCommitted,
    fixed_expenses_remaining: fixedCommitted === null || sumCost('fixed') === null ? null : Number((fixedCommitted - sumCost('fixed')).toFixed(2)),
    operational_expenses: operationalExpenses, operational_profit: operationalProfit,
    dropea_expenses: dropeaExpenses, dropea_profit: dropeaProfit,
    dropea_margin: realRevenue && dropeaProfit !== null
      ? ratio(Math.round(dropeaProfit * 100), Math.round(realRevenue * 100)) : null,
    dropea_profit_after_meta: dropeaProfitAfterMeta,
    operational_margin: realRevenue && operationalProfit !== null
      ? ratio(Math.round(operationalProfit * 100), Math.round(realRevenue * 100)) : null,
    total_expenses: totalExpenses, net_profit: profit,
    roi: totalExpenses && profit !== null ? ratio(Math.round(profit * 100), Math.round(totalExpenses * 100)) : null,
    margin: realRevenue && profit !== null ? ratio(Math.round(profit * 100), Math.round(realRevenue * 100)) : null,
    estimated_cpa: estimatedCpa, real_cpa: realCpa,
    confirmation_rate: ratio(cohortSent, cohortOrders.length), delivery_rate: ratio(cohortDelivered, cohortSent)
  };
  const expenseComponents = [
    totals.costs.product, totals.costs.outbound_shipping, totals.costs.cod,
    totals.costs.outbound_fulfillment, totals.costs.returns,
    totals.costs.advertising, totals.costs.fixed
  ];
  const expectedExpenses = expenseComponents.some((value) => value === null)
    ? null : Number(expenseComponents.reduce((sum, value) => sum + Number(value), 0).toFixed(2));
  const expectedProfit = totals.real_revenue === null || expectedExpenses === null
    ? null : Number((totals.real_revenue - expectedExpenses).toFixed(2));
  const audit = {
    formula_version: 'FINANCE_REALIZED_DAILY_V2',
    definitions: {
      perspective: 'Ingresos y costes se imputan en la fecha real del evento económico',
      total_expenses: 'PRODUCT + OUTBOUND_SHIPPING + COD + OUTBOUND_FULFILLMENT + RETURNS + ADVERTISING + FIXED',
      net_profit: 'REAL_REVENUE - TOTAL_EXPENSES',
      roi: 'NET_PROFIT / TOTAL_EXPENSES',
      margin: 'NET_PROFIT / REAL_REVENUE',
      estimated_cpa: 'ADVERTISING / ORDERS_SENT',
      real_cpa: 'ADVERTISING / DELIVERED',
      confirmation_rate: 'COHORT_ORDERS_SENT / COHORT_ORDERS_CREATED',
      delivery_rate: 'COHORT_DELIVERED / COHORT_ORDERS_SENT'
    },
    checks: [
      auditCheck('TOTAL_EXPENSES_EQUALS_COMPONENTS', totals.total_expenses, expectedExpenses),
      auditCheck('NET_PROFIT_EQUALS_REVENUE_MINUS_EXPENSES', totals.net_profit, expectedProfit),
      auditCheck('ROI_EQUALS_PROFIT_OVER_EXPENSES', totals.roi, totals.total_expenses && totals.net_profit !== null ? ratio(Math.round(totals.net_profit * 100), Math.round(totals.total_expenses * 100)) : null, 0.0001),
      auditCheck('MARGIN_EQUALS_PROFIT_OVER_REVENUE', totals.margin, totals.real_revenue && totals.net_profit !== null ? ratio(Math.round(totals.net_profit * 100), Math.round(totals.real_revenue * 100)) : null, 0.0001),
      auditCheck('ESTIMATED_CPA_EQUALS_ADS_OVER_SENT', totals.estimated_cpa, ordersSent && advertising !== null ? Number((advertising / ordersSent).toFixed(2)) : null),
      auditCheck('REAL_CPA_EQUALS_ADS_OVER_DELIVERED', totals.real_cpa, delivered && advertising !== null ? Number((advertising / delivered).toFixed(2)) : null),
      auditCheck('CONFIRMATION_RATE_EQUALS_COHORT_SENT_OVER_CREATED', totals.confirmation_rate, ratio(cohortSent, cohortOrders.length), 0.0001),
      auditCheck('DELIVERY_RATE_EQUALS_COHORT_DELIVERED_OVER_SENT', totals.delivery_rate, ratio(cohortDelivered, cohortSent), 0.0001),
      auditCheck('DAILY_PROFIT_SUM_EQUALS_MONTH_PROFIT', totals.net_profit,
        included.some((row) => row.net_profit === null) ? null : Number(included.reduce((sum, row) => sum + Number(row.net_profit), 0).toFixed(2)))
    ]
  };
  audit.model_status = missing.size || audit.checks.some((check) => check.status !== 'PASS') ? 'PARTIAL' : 'PASS';
  return Object.freeze({
    month, timezone, currency, generated_at: now.toISOString(), provisional: month >= today.slice(0, 7), perspective: 'REALIZED_EVENT_DATE',
    exactness: missing.size ? 'PARTIAL' : 'COMPLETE', totals, daily, audit,
    products: productEventRollup(orders, rates, month, timezone, currency, currentMonth), logistics: logisticsEventRollup(orders, rates, month, timezone, currency, currentMonth),
    advertising_by_platform: Object.entries(adSpend.reduce((totals, row) => {
      if (row.business_date < `${month}-01` || row.business_date > days.at(-1) || String(row.sync_status).toUpperCase() !== 'COMPLETE') return totals;
      const key = String(row.platform || 'OTHER').toUpperCase(); const value = cents(row.spend);
      if (value !== null) totals[key] = (totals[key] || 0) + value;
      return totals;
    }, {})).map(([platform, value]) => ({ platform, spend: amount(value) })).sort((a, b) => b.spend - a.spend),
    missing_sources: [...missing].sort(),
    quality: { required_days: requiredDays.length, advertising_days_complete: included.filter((row) => row.advertising_status === 'COMPLETE').length, actions_executed: 0, production_writes: 0 }
  });
}
