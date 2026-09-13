import { buildMonthlyFinanceReport } from './monthly-report.mjs';

const DATE_ONLY_FORMATTERS = new Map();
const DATE_ONLY_CACHE = new Map();
const MAX_DATE_ONLY_CACHE_ENTRIES = 50_000;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TERMINAL_BEFORE_CONFIRMATION = new Set(['CANCELLED', 'CANCELED', 'REJECTED']);
const IN_TRANSIT_STATES = new Set(['CONFIRMED', 'PROCESSING', 'PREPARING', 'PREPARED', 'SHIPPING', 'TRANSIT', 'IN_TRANSIT']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function dateOnly(value, timezone = 'Europe/Madrid') {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const key = `${timezone}\u0000${date.toISOString()}`;
  if (DATE_ONLY_CACHE.has(key)) return DATE_ONLY_CACHE.get(key);
  let formatter = DATE_ONLY_FORMATTERS.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    DATE_ONLY_FORMATTERS.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const result = `${map.year}-${map.month}-${map.day}`;
  if (DATE_ONLY_CACHE.size >= MAX_DATE_ONLY_CACHE_ENTRIES) DATE_ONLY_CACHE.clear();
  DATE_ONLY_CACHE.set(key, result);
  return result;
}

function previousMonth(month) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthDays(month) {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}

function sourceForMonth(supplementalReports, month) {
  return supplementalReports.find((report) => report?.period?.month === month) || null;
}

function supplementalOrdersById(reports) {
  const result = new Map();
  for (const report of reports) {
    for (const row of report?.orders || []) {
      const id = String(row?.orderId ?? '');
      if (/^\d{1,18}$/.test(id)) result.set(id, row);
    }
  }
  return result;
}

function enrichOrdersWithFinance(orders, reports) {
  const financeById = supplementalOrdersById(reports);
  return orders.map((order) => {
    const id = String(order.dropea_order_id ?? '');
    return financeById.has(id) ? { ...order, financial_order: financeById.get(id) } : order;
  });
}

function normalizedSupplementalInputs(month, source, fallbackAds = [], fallbackExpenses = []) {
  if (!source?.days?.length) return { adSpend: fallbackAds, fixedExpenses: fallbackExpenses, fixedExpensesComplete: fallbackExpenses.length > 0 };
  const adSpend = source.days.map((row) => ({
    business_date: row.day, platform: 'META', spend: number(row.metaSpend), currency: 'EUR', sync_status: 'COMPLETE'
  }));
  const ledger = Array.isArray(source.expenseLedger) ? source.expenseLedger : [];
  const fixedExpenses = ledger.length ? ledger.map((item) => {
    const oneOff = item.type === 'one_off';
    const other = item.type === 'other';
    return { expense_type: other ? 'OTHER' : oneOff ? 'ONE_OFF' : 'RECURRING', amount: number(item.amount), status: 'ACTIVE',
      start_date: item.startDate || item.date || `${month}-01`, end_date: item.endDate || null,
      occurred_on: oneOff || other ? (item.date || item.startDate || `${month}-01`) : null };
  }) : source.days.flatMap((row) => [
    { expense_type: 'RECURRING', amount: number(row.fixedCosts), status: 'ACTIVE', start_date: row.day, end_date: row.day, occurred_on: null },
    { expense_type: 'ONE_OFF', amount: number(row.oneOffCosts), status: 'ACTIVE', start_date: row.day, end_date: row.day, occurred_on: row.day },
    { expense_type: 'OTHER', amount: number(row.otherCosts), status: 'ACTIVE', start_date: row.day, end_date: row.day, occurred_on: row.day }
  ].filter((item) => item.amount !== 0));
  return { adSpend, fixedExpenses, fixedExpensesComplete: true };
}

function orderState(order) {
  return String(order.lifecycle_status || order.status || 'UNKNOWN').toUpperCase();
}

function validOrders(orders) {
  return orders.filter((order) => !order.test_order && String(order.duplicate_status || '').toUpperCase() !== 'DUPLICATE_ACTIVE_ORDER');
}

function cohortCounts(orders, month, timezone = 'Europe/Madrid') {
  const cohort = validOrders(orders).filter((order) => dateOnly(order.created_at_utc, timezone)?.startsWith(`${month}-`));
  const confirmed = cohort.filter((order) => Boolean(order.confirmed_at_utc));
  const returned = confirmed.filter((order) => Boolean(order.returned_at_utc));
  const delivered = confirmed.filter((order) => Boolean(order.delivered_at_utc) && !order.returned_at_utc);
  const terminalIds = new Set([...returned, ...delivered].map((order) => order.canonical_order_id));
  const unresolvedConfirmed = confirmed.filter((order) => !terminalIds.has(order.canonical_order_id));
  const inTransit = unresolvedConfirmed.filter((order) => IN_TRANSIT_STATES.has(orderState(order))).length;
  const otherOutcome = unresolvedConfirmed.length - inTransit;
  const unconfirmed = cohort.filter((order) => !order.confirmed_at_utc);
  const pendingConfirmation = unconfirmed.filter((order) => !TERMINAL_BEFORE_CONFIRMATION.has(orderState(order))).length;
  const cancelledBeforeConfirmation = unconfirmed.length - pendingConfirmation;
  const deliveredUnits = delivered.reduce((sum, order) => sum + number(order.product_summary?.total_units
    ?? order.product_summary?.products?.reduce((total, product) => total + number(product.quantity), 0)), 0);
  const returnedUnits = returned.reduce((sum, order) => sum + number(order.product_summary?.total_units
    ?? order.product_summary?.products?.reduce((total, product) => total + number(product.quantity), 0)), 0);
  const created = cohort.length; const sent = confirmed.length;
  return {
    created, validCreatedOrders: created, excludedInvalidOrders: orders.length - validOrders(orders).length,
    confirmed: sent, pendingConfirmation, cancelledBeforeConfirmation, sent,
    delivered: delivered.length, deliveredUnits, returned: returned.length, returnedUnits, inTransit, inAir: inTransit, otherOutcome,
    pendingShipment: created - sent, notSent: created - sent,
    incidentOrders: cohort.filter((order) => order.active_issue_id).length,
    confirmationRatePercent: created ? round(sent * 100 / created) : 0,
    deliveryRatePercent: sent ? round(delivered.length * 100 / sent) : 0,
    deliveryRateCreatedPercent: created ? round(delivered.length * 100 / created) : 0,
    returnRatePercent: sent ? round(returned.length * 100 / sent) : 0,
    globalConversionPercent: created ? round(delivered.length * 100 / created) : 0
  };
}

function asOfOrders(orders, cutoffDay, timezone = 'Europe/Madrid') {
  return orders.filter((order) => {
    const created = dateOnly(order.created_at_utc, timezone);
    return created && created <= cutoffDay;
  }).map((order) => {
    const confirmed = dateOnly(order.confirmed_at_utc, timezone) <= cutoffDay ? order.confirmed_at_utc : null;
    const delivered = dateOnly(order.delivered_at_utc, timezone) <= cutoffDay ? order.delivered_at_utc : null;
    const returned = dateOnly(order.returned_at_utc, timezone) <= cutoffDay ? order.returned_at_utc : null;
    return { ...order, confirmed_at_utc: confirmed, delivered_at_utc: delivered, returned_at_utc: returned,
      lifecycle_status: returned ? 'RETURNED' : delivered ? 'DELIVERED' : confirmed ? 'CONFIRMED' : 'PENDING' };
  });
}

function mapTotals(report, source) {
  const totals = report.totals;
  return {
    realRevenue: totals.real_revenue, revenue: totals.real_revenue,
    productCost: totals.costs.product, outboundShippingCost: totals.costs.outbound_shipping,
    codCost: totals.costs.cod, outboundFulfillmentCost: totals.costs.outbound_fulfillment,
    returnCost: totals.costs.returns, dropeaAdjustmentsCost: totals.costs.dropea_adjustments,
    logisticsCost: round(number(totals.costs.outbound_shipping) + number(totals.costs.cod)
      + number(totals.costs.outbound_fulfillment) + number(totals.costs.returns) + number(totals.costs.dropea_adjustments)),
    metaSpend: totals.costs.advertising, fixedCosts: totals.costs.fixed,
    oneOffCosts: totals.costs.one_off, otherCosts: totals.costs.other,
    totalCosts: totals.total_expenses, exactNetProfit: totals.net_profit,
    marginPercent: totals.margin === null ? null : round(totals.margin * 100),
    roiPercent: totals.roi === null ? null : round(totals.roi * 100),
    roas: totals.costs.advertising ? round(totals.real_revenue / totals.costs.advertising) : null,
    estimatedCpa: totals.estimated_cpa, realCpa: totals.real_cpa
  };
}

function mapDays(report, currentDay) {
  let cumulative = 0;
  return report.daily.filter((row) => row.quality !== 'FUTURE').map((row) => {
    if (row.net_profit !== null) cumulative += row.net_profit;
    return {
      day: row.day, created: row.orders_created, sent: row.orders_sent, delivered: row.delivered,
      deliveredUnits: row.delivered_units, returned: row.returned, returnedUnits: row.returned_units,
      realRevenue: row.real_revenue, productCost: row.costs.product,
      outboundShippingCost: row.costs.outbound_shipping, codCost: row.costs.cod,
      outboundFulfillmentCost: row.costs.outbound_fulfillment, returnCost: row.costs.returns,
      dropeaAdjustmentsCost: row.costs.dropea_adjustments, metaSpend: row.costs.advertising,
      fixedCosts: row.costs.fixed, oneOffCosts: row.costs.one_off, otherCosts: row.costs.other,
      totalCosts: row.total_expenses, netProfit: row.net_profit,
      cumulativeNetProfit: round(cumulative), marginPercent: row.margin === null ? null : round(row.margin * 100),
      roiPercent: row.roi === null ? null : round(row.roi * 100),
      roas: row.costs.advertising ? round(row.real_revenue / row.costs.advertising) : null,
      quality: row.quality, closeStatus: row.day === currentDay ? 'CURRENT_PARTIAL' : row.quality === 'COMPLETE' ? 'CLOSED' : 'PENDING',
      closeLabel: row.day === currentDay ? 'Día actual · parcial' : row.quality === 'COMPLETE' ? 'Cerrado' : 'Pendiente de cierre'
    };
  });
}

function monetaryDelta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return { absolute: null, percent: null };
  const absolute = round(current - previous);
  return { absolute, percent: Number(previous) === 0 ? null : round(absolute * 100 / Math.abs(previous)) };
}

function pointDelta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return { absolute: null, percentagePoints: null, percent: null };
  const absolute = round(current - previous);
  return { absolute, percentagePoints: absolute, percent: null };
}

function comparison(current, previous, period) {
  if (!previous) return { available: false, period: null, summary: null, deltas: {} };
  return { available: true, period, summary: previous, deltas: {
    exactNetProfit: monetaryDelta(current.totals.exactNetProfit, previous.totals.exactNetProfit),
    realRevenue: monetaryDelta(current.totals.realRevenue, previous.totals.realRevenue),
    totalCosts: monetaryDelta(current.totals.totalCosts, previous.totals.totalCosts),
    roiPercent: pointDelta(current.totals.roiPercent, previous.totals.roiPercent),
    marginPercent: pointDelta(current.totals.marginPercent, previous.totals.marginPercent),
    confirmationRatePercent: pointDelta(current.counts.confirmationRatePercent, previous.counts.confirmationRatePercent),
    deliveryRatePercent: pointDelta(current.counts.deliveryRatePercent, previous.counts.deliveryRatePercent),
    roas: monetaryDelta(current.totals.roas, previous.totals.roas)
  } };
}

function mapReport(report, source, orders, month, currentDay, freshness) {
  const counts = cohortCounts(orders, month);
  const totals = mapTotals(report, source);
  const dataAvailability = source?.dataAvailability || (month === currentDay.slice(0, 7)
    ? { status: 'MTD', label: `MTD · día ${Number(currentDay.slice(-2))}` }
    : month === '2026-05' ? { status: 'PARTIAL_SOURCE', label: 'Datos desde 10/05', sourceSince: '2026-05-10' }
      : { status: 'FULL_MONTH', label: 'Mes completo' });
  const controls = Object.fromEntries(report.audit.checks.map((check) => [check.key, check.status === 'PASS']));
  controls.confirmationCohortReconciled = counts.confirmed + counts.pendingConfirmation + counts.cancelledBeforeConfirmation === counts.created;
  controls.deliveryOutcomeReconciled = counts.delivered + counts.inTransit + counts.returned + counts.otherOutcome === counts.sent;
  const issues = report.missing_sources;
  const ledger = (report.order_ledger || []).map((row) => ({
    orderId: row.order_id, economicDate: row.economic_date, eventType: row.event_type, status: row.status,
    units: row.units, revenue: row.revenue, productCost: row.costs.product,
    outboundShippingCost: row.costs.outbound_shipping, outboundFulfillmentCost: row.costs.outbound_fulfillment,
    codCost: row.costs.cod, returnCost: row.costs.returns, dropeaAdjustmentsCost: row.costs.dropea_adjustments,
    totalCost: row.total_cost, profit: row.profit, sources: row.sources,
    completeness: row.completeness, missing: row.missing
  }));
  const completeLedger = ledger.filter((row) => row.completeness === 'COMPLETE').length;
  const breakdownPercent = ledger.length ? round(completeLedger * 100 / ledger.length) : 100;
  return {
    period: { month, since: `${month}-01`, until: report.daily.filter((row) => row.quality !== 'FUTURE').at(-1)?.day || `${month}-${monthDays(month)}`,
      daysInMonth: monthDays(month), elapsedDays: report.daily.filter((row) => row.quality !== 'FUTURE').length,
      current: month === currentDay.slice(0, 7), timeZone: report.timezone },
    accounting: { closedThrough: report.accounting_closed_through,
      pendingDays: report.pending_accounting_days,
      currentDayPartial: month === currentDay.slice(0, 7) },
    status: month === currentDay.slice(0, 7) ? 'provisional' : 'reconstructed',
    statusLabel: month === currentDay.slice(0, 7) ? `MTD · día ${Number(currentDay.slice(-2))}` : 'Mes cerrado reconstruido',
    temporalModels: { pnl: 'REALIZED_EVENT_DATE', funnel: 'ORDER_CREATION_COHORT_CURRENT_STATUS' },
    dataAvailability, counts,
    eventCounts: { shipped: report.totals.orders_sent, delivered: report.totals.delivered,
      deliveredUnits: report.totals.delivered_units, returned: report.observed_snapshot.returned,
      returnedUnits: report.observed_snapshot.returned_units },
    totals, days: mapDays(report, currentDay), orderLedger: ledger,
    quality: { status: issues.length || Object.values(controls).some((value) => !value) ? 'REVIEW' : 'OK',
      score: Math.max(0, 100 - issues.length * 5), issues },
    controls, warnings: issues,
    coverage: { ...(source?.coverage || {}), orders: true, meta: report.totals.costs.advertising !== null,
      dropeaBreakdownPercent: breakdownPercent, reconciledOrders: completeLedger, settlementOrders: ledger.length,
      missingSettlementOrders: ledger.length - completeLedger, exactProfitAvailable: totals.exactNetProfit !== null },
    freshness, sources: { ...(source?.sources || {}), orders: 'Dropea V2 canónico + desglose financiero final por pedido',
      calculation: 'Motor canónico ORDER_SETTLEMENT_DATE del Operations Center' },
    definitions: { netProfit: 'Facturación entregada − producto − envío − COD − fulfillment − devolución − ajustes Dropea − Meta − gastos fijos/puntuales',
      returnCost: '5,26 € una sola vez por pedido con returned_at canónico',
      revenueDate: 'delivered_at_utc', returnDate: 'returned_at_utc',
      confirmationRate: 'Confirmados / pedidos válidos creados', deliveryRate: 'Entregados / enviados' },
    costTraceability: source?.costTraceability || {}, expenseLedger: source?.expenseLedger || [],
    generatedAt: new Date().toISOString(), currency: 'EUR', source: 'operations_canonical_finance_v3', productionWrites: 0
  };
}

function authoritativeSourceAvailable(source) {
  return Boolean(source?.period?.month && Array.isArray(source.days) && source?.totals
    && source.days.length > 0 && source.totals.exactNetProfit !== null
    && source.totals.exactNetProfit !== undefined && Number.isFinite(Number(source.totals.exactNetProfit)));
}

function sourceCounts(source) {
  const input = source?.counts || {};
  const created = number(input.created ?? input.total);
  const sent = number(input.sent);
  const confirmed = sent;
  const delivered = number(input.delivered);
  const returned = number(input.returned);
  const inTransit = number(input.inTransit ?? input.inAir);
  const cancelledBeforeConfirmation = number(input.cancelled ?? input.rejected);
  const pendingConfirmation = number(input.pending ?? Math.max(0, created - sent - cancelledBeforeConfirmation));
  const otherOutcome = Math.max(0, sent - delivered - returned - inTransit);
  return {
    ...input,
    created,
    validCreatedOrders: number(input.dropeaOrders ?? input.total ?? created),
    excludedInvalidOrders: Math.max(0, created - number(input.dropeaOrders ?? created)),
    confirmed,
    pendingConfirmation,
    cancelledBeforeConfirmation,
    sent,
    delivered,
    deliveredUnits: number(input.deliveredUnits),
    returned,
    returnedUnits: number(input.returnedUnits),
    inTransit,
    inAir: number(input.inAir ?? inTransit),
    otherOutcome,
    pendingShipment: number(input.notSent ?? Math.max(0, created - sent)),
    notSent: number(input.notSent ?? Math.max(0, created - sent)),
    incidentOrders: number(input.incidentOrders),
    confirmationRatePercent: round(created ? sent * 100 / created : 0),
    deliveryRatePercent: round(input.deliveryRatePercent ?? (sent ? delivered * 100 / sent : 0)),
    deliveryRateCreatedPercent: round(input.globalConversionPercent ?? (created ? delivered * 100 / created : 0)),
    returnRatePercent: round(input.returnRatePercent ?? (sent ? returned * 100 / sent : 0)),
    globalConversionPercent: round(input.globalConversionPercent ?? (created ? delivered * 100 / created : 0))
  };
}

function sourceFixedAccrual(source) {
  const days = (source.days || []).map((row) => row.day).filter(Boolean);
  const recurring = (source.expenseLedger || []).filter((item) => item.type === 'recurring_monthly');
  if (!days.length || !recurring.length) return null;
  const result = new Map(days.map((day) => [day, 0]));
  for (const item of recurring) {
    const eligible = days.filter((day) => (!item.startDate || day >= item.startDate) && (!item.endDate || day <= item.endDate));
    if (!eligible.length) continue;
    const applied = number(item.appliedAmount ?? item.amount);
    const daily = applied / eligible.length;
    for (const day of eligible) result.set(day, result.get(day) + daily);
  }
  return result;
}

function sourceDays(source, currentDay) {
  const fixed = sourceFixedAccrual(source); let cumulative = 0;
  return (source.days || []).map((row) => {
    const fixedCosts = fixed ? round(fixed.get(row.day) || 0, 6) : row.fixedCosts;
    const componentValues = [row.productCost, row.outboundShippingCost, row.codCost, row.outboundFulfillmentCost,
      row.returnCost, row.dropeaAdjustmentsCost, row.metaSpend, fixedCosts, row.oneOffCosts, row.otherCosts];
    const complete = componentValues.every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    const totalCosts = complete ? round(componentValues.reduce((sum, value) => sum + Number(value), 0), 6) : null;
    const realRevenue = row.realRevenue === null || row.realRevenue === undefined ? null : number(row.realRevenue);
    const netProfit = totalCosts === null || realRevenue === null ? null : round(realRevenue - totalCosts, 6);
    if (netProfit !== null) cumulative += netProfit;
    return {
      ...row,
      fixedCosts,
      totalCosts,
      netProfit,
      cumulativeNetProfit: round(cumulative),
      marginPercent: realRevenue && netProfit !== null ? round(netProfit * 100 / realRevenue) : null,
      roiPercent: totalCosts && netProfit !== null ? round(netProfit * 100 / totalCosts) : null,
      roas: number(row.metaSpend) ? round(number(realRevenue) / number(row.metaSpend)) : null,
      quality: row.quality || 'COMPLETE',
      closeStatus: row.day === currentDay ? 'CURRENT_PARTIAL' : 'CLOSED',
      closeLabel: row.day === currentDay ? 'Día actual · parcial' : 'Cerrado'
    };
  });
}

function closeEnough(actual, expected, tolerance = 0.01) {
  return actual !== null && actual !== undefined && expected !== null && expected !== undefined
    && Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function sumRows(rows, field) {
  return round((rows || []).reduce((sum, row) => sum + number(row?.[field]), 0));
}

function authoritativeControls(source, days) {
  const totals = source.totals || {}; const orders = source.orders || [];
  const controls = { ...(source.controls || {}) };
  controls.sourceDailyRevenueReconciled = closeEnough(sumRows(days, 'realRevenue'), totals.realRevenue);
  controls.sourceDailyCostsReconciled = closeEnough(sumRows(days, 'totalCosts'), totals.totalCosts);
  controls.sourceDailyProfitReconciled = closeEnough(sumRows(days, 'netProfit'), totals.exactNetProfit);
  controls.sourceProfitFormulaReconciled = closeEnough(round(number(totals.realRevenue) - number(totals.totalCosts)), totals.exactNetProfit);
  if (orders.length) {
    const pairs = [
      ['realizedRevenue', 'realRevenue'], ['productCost', 'productCost'], ['outboundShippingCost', 'outboundShippingCost'],
      ['outboundFulfillmentCost', 'outboundFulfillmentCost'], ['codCost', 'codCost'], ['returnCost', 'returnCost'],
      ['dropeaAdjustmentsCost', 'dropeaAdjustmentsCost']
    ];
    controls.sourceOrderIdsUnique = new Set(orders.map((row) => row.orderId)).size === orders.length;
    for (const [field, total] of pairs) controls[`sourceOrder${total[0].toUpperCase()}${total.slice(1)}Reconciled`] = closeEnough(sumRows(orders, field), totals[total]);
  }
  return controls;
}

function mapAuthoritativeSource(source, month, currentDay, freshness) {
  const counts = sourceCounts(source); const days = sourceDays(source, currentDay); const controls = authoritativeControls(source, days);
  const failed = Object.entries(controls).filter(([, value]) => value !== true).map(([key]) => key);
  const current = month === currentDay.slice(0, 7); const lastDay = days.at(-1)?.day || source.period?.until || `${month}-${monthDays(month)}`;
  const pendingDays = current ? Math.max(0, Number(currentDay.slice(-2)) - Number(lastDay.slice(-2))) : 0;
  const sourceIssues = Array.isArray(source.quality?.issues) ? source.quality.issues : [];
  const issues = [...new Set([...sourceIssues, ...failed.map((key) => `RECONCILIATION:${key}`)])];
  const settlementOrders = number(source.orders?.length);
  const breakdownPercent = round(source.coverage?.dropeaBreakdownPercent ?? source.coverage?.dropeaBreakdownPublishedPercent ?? 0);
  const reconciledOrders = settlementOrders ? Math.round(settlementOrders * number(breakdownPercent) / 100) : 0;
  return {
    period: { ...source.period, month, since: source.period?.since || `${month}-01`, until: lastDay,
      daysInMonth: source.period?.daysInMonth || monthDays(month), elapsedDays: days.length, current,
      timeZone: source.period?.timeZone || 'Europe/Madrid' },
    accounting: { closedThrough: lastDay, pendingDays, currentDayPartial: current },
    status: source.status || (current ? 'provisional' : 'reconstructed'),
    statusLabel: source.statusLabel || (current ? `MTD · día ${Number(lastDay.slice(-2))}` : 'Mes cerrado'),
    temporalModels: { pnl: 'DROPEA_ORDER_MONTH_FINAL_BREAKDOWN', funnel: 'DROPEA_ORDER_MONTH_CURRENT_STATUS' },
    dataAvailability: source.dataAvailability || (current
      ? { status: 'MTD', label: `MTD · cierre hasta día ${Number(lastDay.slice(-2))}` }
      : { status: 'FULL_MONTH', label: 'Mes cerrado' }),
    counts,
    eventCounts: {
      shipped: number(source.eventCounts?.shipped ?? counts.sent),
      delivered: number(source.eventCounts?.delivered ?? counts.delivered),
      deliveredUnits: number(source.eventCounts?.deliveredUnits ?? counts.deliveredUnits),
      returned: number(source.eventCounts?.returned ?? counts.returned),
      returnedUnits: number(source.eventCounts?.returnedUnits ?? counts.returnedUnits)
    },
    totals: { ...source.totals }, days,
    quality: { ...(source.quality || {}), status: issues.length ? 'REVIEW' : 'OK', issues,
      score: Math.max(0, 100 - issues.length * 5) },
    controls, warnings: [...new Set([...(source.warnings || []), ...issues])],
    coverage: { ...(source.coverage || {}), orders: true, meta: source.totals?.metaSpend !== null,
      dropeaBreakdownPercent: breakdownPercent, reconciledOrders,
      settlementOrders, missingSettlementOrders: settlementOrders - reconciledOrders,
      exactProfitAvailable: source.totals?.exactNetProfit !== null && source.totals?.exactNetProfit !== undefined },
    freshness,
    sources: { ...(source.sources || {}), orders: 'Dropea V2 · desglose financiero final por pedido',
      calculation: 'Suma conciliada de pedidos del mes en Dropea' },
    definitions: { ...(source.definitions || {}),
      netProfit: 'Facturación entregada − costes reales por pedido de Dropea − Meta − gastos fijos/puntuales',
      returnCost: 'Coste real expuesto por Dropea para cada pedido devuelto; 5,26 € solo como respaldo si falta',
      period: 'Pedidos creados en el mes, valorados con su estado y desglose financiero final verificado' },
    costTraceability: source.costTraceability || {}, expenseLedger: source.expenseLedger || [],
    generatedAt: source.generatedAt || new Date().toISOString(), currency: source.currency || 'EUR',
    source: 'dropea_order_finance_v4', productionWrites: 0
  };
}

function oldTotals(source) {
  const totals = source?.totals || {};
  return {
    revenue: round(totals.realRevenue ?? totals.revenue), product: round(totals.productCost),
    outboundShipping: round(totals.outboundShippingCost), outboundFulfillment: round(totals.outboundFulfillmentCost),
    cod: round(totals.codCost), returns: round(totals.returnCost), adjustments: round(totals.dropeaAdjustmentsCost),
    meta: round(totals.metaSpend), fixed: round(totals.fixedCosts), oneOff: round(totals.oneOffCosts),
    other: round(totals.otherCosts), totalCosts: round(totals.totalCosts), profit: round(totals.exactNetProfit)
  };
}

function newTotals(report) {
  const totals = report?.totals || {};
  return { revenue: totals.realRevenue, product: totals.productCost, outboundShipping: totals.outboundShippingCost,
    outboundFulfillment: totals.outboundFulfillmentCost, cod: totals.codCost, returns: totals.returnCost,
    adjustments: totals.dropeaAdjustmentsCost, meta: totals.metaSpend, fixed: totals.fixedCosts,
    oneOff: totals.oneOffCosts, other: totals.otherCosts, totalCosts: totals.totalCosts, profit: totals.exactNetProfit };
}

function reconciliationBridge(month, source, report) {
  const old = oldTotals(source); const corrected = newTotals(report);
  const keys = ['revenue', 'product', 'outboundShipping', 'outboundFulfillment', 'cod', 'returns', 'adjustments', 'meta', 'fixed', 'oneOff', 'other', 'totalCosts', 'profit'];
  const deltas = Object.fromEntries(keys.map((key) => [key, old[key] === null || corrected[key] === null ? null : round(corrected[key] - old[key])]));
  const bridgeCheck = old.profit === null || corrected.profit === null || deltas.revenue === null
    || keys.slice(1, 11).some((key) => deltas[key] === null) ? null
    : round(old.profit + deltas.revenue - keys.slice(1, 11).reduce((sum, key) => sum + deltas[key], 0));
  return { month, old, corrected, deltas,
    profitOverstatement: old.profit === null || corrected.profit === null ? null : round(old.profit - corrected.profit),
    reconciles: bridgeCheck === null ? false : Math.abs(bridgeCheck - corrected.profit) <= 0.01 };
}

function orderDifferences(orders, reports, selected) {
  const financeById = supplementalOrdersById(reports);
  const ledgerById = new Map((selected.orderLedger || []).map((row) => [String(row.orderId), row]));
  return orders.flatMap((order) => {
    const id = String(order.dropea_order_id ?? ''); const old = financeById.get(id); const corrected = ledgerById.get(id);
    if (!old && !corrected) return [];
    const oldProfit = old?.contributionAfterProduct ?? old?.dropeaOrderProfit ?? null;
    const correctedProfit = corrected?.profit ?? null;
    const reasons = [];
    if (old?.createdDay && corrected?.economicDate && old.createdDay.slice(0, 7) !== corrected.economicDate.slice(0, 7)) reasons.push('WRONG_EVENT_MONTH');
    if (corrected?.eventType === 'RETURNED' && old?.returnCost !== 5.26) reasons.push('RETURN_COST_PER_ORDER');
    if (old && old.dropeaAdjustmentsCost !== null && corrected?.dropeaAdjustmentsCost !== old.dropeaAdjustmentsCost) reasons.push('DROPEA_ADJUSTMENT');
    const delta = oldProfit === null || correctedProfit === null ? null : round(correctedProfit - oldProfit);
    if (!reasons.length && (delta === null || Math.abs(delta) < 0.01)) return [];
    return [{ orderId: id, oldMonth: old?.createdDay?.slice(0, 7) || null, economicMonth: corrected?.economicDate?.slice(0, 7) || null,
      eventType: corrected?.eventType || null, oldProfit, correctedProfit, delta, reasons }];
  }).sort((a, b) => Math.abs(number(b.delta)) - Math.abs(number(a.delta))).slice(0, 20);
}

export function buildResultsFinanceReport({ month, orders = [], rates = [], supplementalReports = [],
  localAdSpend = [], localFixedExpenses = [], availableMonths = [], now = new Date(), dropeaLastSyncAt = null } = {}) {
  if (!MONTH.test(String(month))) throw new Error('FINANCE_MONTH_INVALID');
  const currentDay = dateOnly(now); const allOrders = validOrders(enrichOrdersWithFinance(orders, supplementalReports));
  const sourceMonths = supplementalReports.map((item) => item?.period?.month).filter((item) => MONTH.test(String(item)));
  const months = [...new Set(sourceMonths.length ? sourceMonths : availableMonths)]
    .filter((item) => MONTH.test(String(item))).sort();
  const mapped = new Map();
  for (const candidate of months) {
    const source = sourceForMonth(supplementalReports, candidate);
    const sourceFreshness = source?.freshness || {};
    const freshness = { ...sourceFreshness, sources: { ...(sourceFreshness.sources || {}),
      dropea: { status: dropeaLastSyncAt ? 'OK' : 'UNAVAILABLE', lastSyncAt: dropeaLastSyncAt, ageMinutes: dropeaLastSyncAt
        ? Math.max(0, Math.round((now - new Date(dropeaLastSyncAt)) / 60000)) : null } } };
    if (authoritativeSourceAvailable(source)) {
      mapped.set(candidate, mapAuthoritativeSource(source, candidate, currentDay, freshness));
      continue;
    }
    const inputs = normalizedSupplementalInputs(candidate, source,
      localAdSpend.filter((row) => String(row.business_date).startsWith(`${candidate}-`)), localFixedExpenses);
    const result = buildMonthlyFinanceReport({ month: candidate, orders: allOrders, rates,
      fixedExpenses: inputs.fixedExpenses, fixedExpensesComplete: inputs.fixedExpensesComplete,
      adSpend: inputs.adSpend, now });
    mapped.set(candidate, mapReport(result, source, allOrders, candidate, currentDay, freshness));
  }
  if (!mapped.has(month)) {
    const source = sourceForMonth(supplementalReports, month);
    const inputs = normalizedSupplementalInputs(month, source, localAdSpend, localFixedExpenses);
    mapped.set(month, mapReport(buildMonthlyFinanceReport({ month, orders: allOrders, rates,
      fixedExpenses: inputs.fixedExpenses, fixedExpensesComplete: inputs.fixedExpensesComplete,
      adSpend: inputs.adSpend, now }), source, allOrders, month, currentDay, source?.freshness || {}));
  }
  const selected = mapped.get(month);
  const priorMonth = previousMonth(month); let prior = mapped.get(priorMonth) || null; let comparisonPeriod = prior?.period || null;
  if (selected.period.current && sourceForMonth(supplementalReports, priorMonth) && selected.source !== 'dropea_order_finance_v4') {
    const elapsed = selected.period.elapsedDays; const cutoff = `${priorMonth}-${String(Math.min(elapsed, monthDays(priorMonth))).padStart(2, '0')}`;
    const source = sourceForMonth(supplementalReports, priorMonth); const inputs = normalizedSupplementalInputs(priorMonth, source);
    const priorNow = new Date(`${cutoff}T12:00:00+02:00`); const priorOrders = asOfOrders(allOrders, cutoff);
    const priorReport = buildMonthlyFinanceReport({ month: priorMonth, orders: priorOrders, rates,
      fixedExpenses: inputs.fixedExpenses, fixedExpensesComplete: true, adSpend: inputs.adSpend, now: priorNow });
    prior = mapReport(priorReport, source, priorOrders, priorMonth, cutoff, source.freshness || {});
    comparisonPeriod = { ...prior.period, until: cutoff, elapsedDays: elapsed, comparable: true };
  }
  selected.history = [...mapped.values()].sort((a, b) => a.period.month.localeCompare(b.period.month)).map((item) => ({
    month: item.period.month, period: item.period, counts: item.counts, eventCounts: item.eventCounts,
    totals: item.totals, status: item.status, statusLabel: item.statusLabel, quality: item.quality,
    dataAvailability: item.dataAvailability
  }));
  selected.comparison = comparison(selected, prior, comparisonPeriod);
  selected.oldVsNew = [...mapped.entries()].map(([candidate, report]) => reconciliationBridge(candidate, sourceForMonth(supplementalReports, candidate), report));
  selected.topOrderDifferences = orderDifferences(allOrders, supplementalReports, selected);
  selected.availableMonths = months.slice().reverse();
  selected.availableRange = months.length ? { from: months[0], to: months.at(-1) } : { from: month, to: month };
  return selected;
}
