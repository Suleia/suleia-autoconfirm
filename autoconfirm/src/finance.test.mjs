import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFinanceReport, allocateExpenses, applyFinanceExpenseLedger, buildFinanceReport, classifyFinanceOrder, clearFinanceCache, loadFinanceSnapshot, moneyToCents, resolveFinancePeriod, saveFinanceSnapshot } from './finance.mjs';
import { loadFinanceCostRules, loadFinanceExpenses } from './finance-data.mjs';

const now = new Date('2026-09-11T12:00:00.000Z');
const rules = loadFinanceCostRules();
const expenses = loadFinanceExpenses();

function order(overrides = {}) {
  return {
    id: overrides.id || Math.random(), created_at: '2026-09-01T08:00:00Z', confirmed_at: '2026-09-01T09:00:00Z',
    processing_at: '2026-09-02T09:00:00Z', tracking_number: 'safe-test-tracking', total_amount: 34.99,
    line_items: [{ product_id: 31547, variant_id: 31547, sku: 'CREMANIDA', product_name: 'Nida', quantity: 2, unit_price: 34.99, wholesale_price: 0 }],
    status: 'SHIPPING', sub_status: 'IN_TRANSIT', ...overrides
  };
}

test('uses complete Europe/Madrid boundaries including DST', () => {
  const august = resolveFinancePeriod('2026-08', { now });
  assert.equal(august.fromTimestamp, '2026-07-31T22:00:00.000Z');
  assert.equal(august.toTimestamp, '2026-08-31T21:59:59.999Z');
  assert.equal(resolveFinancePeriod('2026-03', { now }).toTimestamp, '2026-03-31T21:59:59.999Z');
});

test('returned timestamp wins over rejected lifecycle for regression order 1317117', () => {
  assert.equal(classifyFinanceOrder({ id: 1317117, lifecycle_status: 'REJECTED', returned_at_utc: '2026-07-29T11:05:05Z' }), 'returned');
  assert.equal(classifyFinanceOrder({ id: 1317117, status: 'ERROR', sub_status: 'REJECTED', rejected_at: '2026-07-29T11:05:05Z', tracking_number: 'x' }), 'returned');
});

test('pre-shipment rejection never double-counts as a return', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ id: 1, processing_at: null, tracking_number: null, confirmed_at: null, rejected_at: '2026-09-03T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED' })] });
  assert.equal(report.counts.rejected, 1);
  assert.equal(report.counts.returned, 0);
  assert.equal(report.days.reduce((sum, day) => sum + day.returned, 0), 0);
  assert.equal(report.controls.noReturnRejectionOverlap, true);
});

test('delivered wholesale zero uses verified SKU tariff for regression order 1400480', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ id: 1400480, delivered_at: '2026-09-11T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })] });
  assert.equal(report.totals.productCost, 2.88);
  assert.equal(report.coverage.productCostPercent, 100);
  assert.equal(report.quality.issues.some((issue) => issue.code === 'MISSING_COST'), false);
});

test('verified Dropea identities apply exact unit COGS for CollaGum, Nida and the May product', () => {
  const period = resolveFinancePeriod('2026-09', { now });
  const delivered = { delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' };
  const report = aggregateFinanceReport({ period, rules, expenses: [], metaRows: [], orders: [
    order({ id: 11, ...delivered, line_items: [{ product_id: 31666, variant_id: 31666, sku: 'COLLAGUM', product_name: 'CollaGum', quantity: 2, unit_price: 15, wholesale_price: 0 }] }),
    order({ id: 12, ...delivered, line_items: [{ product_id: 31547, variant_id: 31547, sku: 'CREMANIDA', product_name: 'Nida', quantity: 2, unit_price: 15, wholesale_price: 0 }] }),
    order({ id: 13, ...delivered, line_items: [{ product_id: 30133, variant_id: 30133, sku: '038_CREMAHIDRATANTE', product_name: 'Crema Hidratante Definitiva HOYGI 100G', quantity: 2, unit_price: 15, wholesale_price: 0 }] })
  ] });
  assert.equal(report.products.find((item) => item.productId === 31666).productCost, 2.02);
  assert.equal(report.products.find((item) => item.productId === 31547).productCost, 2.88);
  assert.equal(report.products.find((item) => item.productId === 30133).productCost, 8);
  assert.equal(report.totals.productCost, 12.90);
});

test('business-verified product identity overrides a contradictory historical wholesale field', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED',
    line_items: [{ product_id: 30133, variant_id: 30133, sku: '038_CREMAHIDRATANTE', product_name: 'Crema mayo', quantity: 2, unit_price: 15, wholesale_price: 3.70 }]
  })] });
  assert.equal(report.totals.productCost, 8);
});

test('a reused SKU never inherits Nida cost when the real Dropea identity differs', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED',
    line_items: [{ product_id: 32412, variant_id: 32412, sku: 'CREMANIDA', product_name: 'Other Nida catalog entry', quantity: 1, unit_price: 20, wholesale_price: 0 }]
  })] });
  assert.equal(report.totals.exactNetProfit, null);
  assert.equal(report.quality.issues.some((issue) => issue.code === 'MISSING_COST'), true);
});

test('unknown wholesale zero is MISSING_ECONOMIC_DATA, never free product', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ delivered_at: '2026-09-10T10:00:00Z', line_items: [{ sku: 'UNKNOWN', quantity: 1, unit_price: 20, wholesale_price: 0 }] })] });
  assert.equal(report.totals.exactNetProfit, null);
  assert.equal(report.quality.issues.some((issue) => issue.code === 'MISSING_COST'), true);
});

test('P&L uses the selected creation cohort and attributes final economics to the order day', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ created_at: '2026-09-02T08:00:00Z', delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })] });
  assert.equal(report.counts.created, 1);
  assert.equal(report.totals.realRevenue, 34.99);
  assert.equal(report.days.find((day) => day.day === '2026-09-02').realRevenue, 34.99);
  const priorCohort = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({ created_at: '2026-08-28T08:00:00Z', delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })] });
  assert.equal(priorCohort.totals.realRevenue, 0);
});

test('return cost is recognized once in its creation cohort with traceable tariff', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ created_at: '2026-09-02T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED' })] });
  assert.equal(report.totals.returnCost, 5.26);
  assert.equal(report.days.find((day) => day.day === '2026-09-02').returned, 1);
  assert.equal(report.costTraceability.return.tariffVersion, rules.version);
});

test('return logistics is exactly 5.26 per returned order for one, two or three units', () => {
  for (const quantity of [1, 2, 3]) {
    const report = aggregateFinanceReport({
      period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [],
      orders: [order({ id: 100 + quantity, created_at: '2026-09-02T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED', line_items: [{ product_id: 31547, variant_id: 31547, sku: 'CREMANIDA', quantity, unit_price: 10, wholesale_price: 0 }] })]
    });
    assert.equal(report.counts.returnedUnits, quantity);
    assert.equal(report.days.find((day) => day.day === '2026-09-02').returnedUnits, quantity);
    assert.equal(report.totals.returnCost, 5.26);
    assert.equal(report.products[0].returnCost, 5.26);
    assert.equal(report.costTraceability.return.basis, 'PER_RETURNED_ORDER');
  }
});

test('return rate remains 5.26 per order and fulfillment components are summed without COD on a return', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    id: 130, created_at: '2026-09-02T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED',
    order_costs: { fulfillment_outbound: 0.80, fulfillment_quantity_cost: 0.40, return_cost: 99, cod_fee: 8 }
  })] });
  assert.equal(report.totals.outboundFulfillmentCost, 1.20);
  assert.equal(report.totals.returnCost, 5.26);
  assert.equal(report.totals.codCost, 0);
});

test('final Dropea breakdown uses the exact Wallet-aligned return charges per order', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    id: 1384509, created_at: '2026-09-01T14:01:48Z', processing_at: '2026-09-01T14:32:11Z', rejected_at: '2026-09-09T10:33:49Z', status: 'ERROR', sub_status: 'REJECTED',
    expenses_breakdown: { product_price: 0, fulfillment_extra_unit_price: 0, fulfillment_outbound_price: 1, fulfillment_refused_price: 1, shipping_outbound_price: 4.06, shipping_refused_price: 4.06, cod_commission: 1.2, total_expenses: 10.12, is_estimate: false, calculated_at: '2026-09-09T10:33:49Z' }
  })] });
  assert.equal(report.totals.outboundShippingCost, 4.06);
  assert.equal(report.totals.outboundFulfillmentCost, 1);
  assert.equal(report.totals.returnCost, 5.06);
  assert.equal(report.totals.codCost, 0);
  assert.equal(report.totals.logisticsCost, 10.12);
  assert.equal(report.orders[0].breakdownStatus, 'DROPEA_FINAL');
  assert.equal(report.orders[0].contributionAfterProduct, -10.12);
});

test('final Dropea breakdown reconciles tax and adjustments without hiding business product COGS', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    id: 777, total_amount: 29.99, delivered_at: '2026-09-09T10:33:49Z', status: 'FINISH', sub_status: 'DELIVERED',
    line_items: [{ product_id: 31666, variant_id: 31666, sku: 'COLLAGUM', product_name: 'CollaGum', quantity: 2, unit_price: 29.99, wholesale_price: 0 }],
    expenses_breakdown: { product_price: 0, fulfillment_extra_unit_price: 0, fulfillment_outbound_price: 1, fulfillment_refused_price: 1, shipping_outbound_price: 4.06, shipping_refused_price: 4.06, cod_commission: 1.2, total_expenses: 7.39, is_estimate: false, calculated_at: '2026-09-09T10:33:49Z' }
  })] });
  assert.equal(report.totals.dropeaAdjustmentsCost, 1.13);
  assert.equal(report.totals.productCost, 2.02);
  assert.equal(report.orders[0].dropeaOrderProfit, 22.60);
  assert.equal(report.orders[0].contributionAfterProduct, 20.58);
  assert.equal(report.controls.dailyCostsReconciled, true);
});

test('duplicate order rows cannot duplicate economic charges', () => {
  const duplicate = order({ id: 500, delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' });
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [duplicate, structuredClone(duplicate)] });
  assert.equal(report.counts.created, 1);
  assert.equal(report.totals.productCost, 2.88);
  assert.equal(report.controls.costLedgerUnique, true);
});

test('daily revenue, costs and profit reconcile exactly to monthly cents', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [order({ delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' }), order({ id: 2, delivered_at: '2026-09-06T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })], metaRows: [{ dateStart: '2026-09-05', spend: '10.01' }, { dateStart: '2026-09-06', spend: '2.02' }] });
  assert.equal(report.days.reduce((sum, day) => sum + moneyToCents(day.realRevenue), 0), moneyToCents(report.totals.realRevenue));
  assert.equal(report.days.reduce((sum, day) => sum + moneyToCents(day.totalCosts), 0), moneyToCents(report.totals.totalCosts));
  assert.equal(moneyToCents(report.totals.realRevenue) - moneyToCents(report.totals.totalCosts), moneyToCents(report.totals.exactNetProfit));
});

test('ROI, ROAS and margin use canonical formulas and handle zero safely', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [], metaRows: [] });
  assert.equal(report.totals.roas, null);
  assert.equal(report.totals.marginPercent, null);
  assert.equal(report.totals.roiPercent, -100);
  const active = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [order({ delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })], metaRows: [{ dateStart: '2026-09-05', spend: 10 }] });
  assert.equal(active.totals.roas, Math.round(active.totals.realRevenue * 100 / active.totals.metaSpend) / 100);
  assert.equal(active.totals.roiPercent, Math.round(active.totals.exactNetProfit * 10000 / active.totals.totalCosts) / 100);
});

test('fixed-expense ledger reconciles the owner-provided monthly totals exactly', () => {
  const expected = { '2026-05': 0, '2026-06': 4411, '2026-07': 27811, '2026-08': 17639, '2026-09': 17639 };
  for (const [month, cents] of Object.entries(expected)) {
    const period = resolveFinancePeriod(month, { now: new Date('2026-10-02T12:00:00Z') });
    const allocations = allocateExpenses(period, expenses);
    assert.equal([...allocations.values()].reduce((sum, row) => sum + row.fixed + row.oneOff + row.other, 0), cents, month);
  }
});

test('monthly fixed expenses are grouped before cent allocation so daily rounding cannot stack', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-09-12T12:00:00Z') });
  const allocations = allocateExpenses(period, expenses);
  const dailyFixed = [...allocations.values()].map((row) => row.fixed);
  assert.equal(dailyFixed.reduce((sum, value) => sum + value, 0), 17639);
  assert.equal(Math.max(...dailyFixed) - Math.min(...dailyFixed), 1);
  assert.deepEqual(dailyFixed, [1470, 1470, 1470, 1470, 1470, 1470, 1470, 1470, 1470, 1470, 1470, 1469]);
});

test('a manually added expense immediately recalculates daily and monthly profit', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({ delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })] });
  const updated = applyFinanceExpenseLedger(report, [{ id: 'manual', name: 'Extra', category: 'Otros', type: 'one_off', amount_cents: 1000, date: '2026-09-01', start_date: '2026-09-01', end_date: '2026-09-01', editable: true }]);
  assert.equal(moneyToCents(report.totals.exactNetProfit) - moneyToCents(updated.totals.exactNetProfit), 1000);
  assert.equal(updated.totals.oneOffCosts, 10);
  assert.equal(updated.expenseLedger[0].editable, true);
  assert.equal(updated.controls.profitReconciled, true);
});

test('Meta daily spend sums exactly to monthly spend', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [], metaRows: [{ dateStart: '2026-09-01', spend: '0.01' }, { dateStart: '2026-09-02', spend: '10.09' }] });
  assert.equal(report.totals.metaSpend, 10.10);
  assert.equal(report.days.reduce((sum, day) => sum + moneyToCents(day.metaSpend), 0), 1010);
});

test('cohort rates consistently use the created-order population', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ id: 1, delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' }), order({ id: 2, confirmed_at: null, processing_at: null, tracking_number: null, status: 'PENDING', sub_status: 'PENDING' })] });
  assert.equal(report.counts.created, 2);
  assert.equal(report.counts.confirmed, 1);
  assert.equal(report.counts.confirmationRatePercent, 50);
  assert.equal(report.counts.deliveryRatePercent, 100);
});

test('confirmation rate excludes orders cancelled before shipment even when they retain stale confirmation evidence', () => {
  const accepted = Array.from({ length: 452 }, (_, index) => order({
    id: index + 1,
    created_at: '2026-07-01T10:00:00Z',
    status: 'SHIPPING',
    sub_status: 'SHIPPING',
    processing_at: '2026-07-02T10:00:00Z'
  }));
  const cancelled = Array.from({ length: 161 }, (_, index) => order({
    id: index + 453,
    created_at: '2026-07-01T10:00:00Z',
    confirmed_at: '2026-07-02T09:00:00Z',
    processing_at: null,
    tracking_number: null,
    status: 'CANCELLED',
    sub_status: 'CANCELLED'
  }));
  const report = aggregateFinanceReport({
    period: resolveFinancePeriod('2026-07', { now: new Date('2026-09-13T12:00:00Z') }),
    rules,
    expenses: [],
    metaRows: [],
    orders: [...accepted, ...cancelled]
  });
  assert.equal(report.counts.created, 613);
  assert.equal(report.counts.confirmed, 452);
  assert.equal(report.counts.sent, 452);
  assert.equal(report.counts.cancelled, 161);
  assert.equal(report.counts.confirmationRatePercent, 73.74);
});

test('incident rate counts unique orders and preserves total incidents', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ id: 7 })], issues: [{ order_id: 7, created_at: '2026-09-03T10:00:00Z' }, { order_id: 7, created_at: '2026-09-04T10:00:00Z' }] });
  assert.equal(report.counts.incidentOrders, 1);
  assert.equal(report.counts.incidents, 2);
});

test('current month builds equivalent prior comparison and separate projection', async () => {
  const fakeOrders = [order({ delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' }), order({ id: 2, created_at: '2026-08-02T08:00:00Z', confirmed_at: '2026-08-02T09:00:00Z', processing_at: '2026-08-03T09:00:00Z', delivered_at: '2026-08-06T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })];
  const report = await buildFinanceReport({ month: '2026-09', force: true, now, rules, expenses, configLoader: () => [{ store_id: '1', market: 'ES', token: 'test' }], clientFactory: () => ({ listAll: async (name) => ({ items: name === 'listOrders' ? fakeOrders : [] }) }), metaLoader: async () => [{ dateStart: '2026-09-05', spend: 10 }, { dateStart: '2026-08-05', spend: 8 }] });
  assert.equal(report.comparison.period.until, '2026-08-11');
  assert.ok(report.projection);
  assert.equal(report.statusLabel, 'MTD · cohorte actual');
  assert.notEqual(report.projection.netProfit, report.totals.exactNetProfit);
});

test('month selector input changes the complete report period', async () => {
  const calls = [];
  const result = await buildFinanceReport({ month: '2026-08', force: true, now, rules, expenses, configLoader: () => [{ store_id: '1', market: 'ES', token: 'test' }], clientFactory: () => ({ listAll: async (name, params) => { calls.push({ name, params }); return { items: [] }; } }), metaLoader: async () => [] });
  assert.equal(result.period.month, '2026-08');
  assert.equal(result.comparison.period.month, '2026-07');
  const selectedMonthCall = calls.find((call) => call.name === 'listOrders' && call.params.date_to === '2026-08-31T21:59:59.999Z');
  assert.ok(selectedMonthCall, 'the selected month must be loaded through its complete Madrid boundary');
});

test('terminal orders missing economics in the list are enriched from Dropea order detail', async () => {
  const calls = [];
  const summaryOrder = order({ id: 1400480, delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' });
  const result = await buildFinanceReport({
    month: '2026-09', force: true, now, rules, expenses: [],
    configLoader: () => [{ store_id: '1', market: 'ES', token: 'test' }],
    clientFactory: () => ({
      listAll: async (name, params) => ({ items: name === 'listOrders' && params.date_from.startsWith('2026-08-31') ? [summaryOrder] : [] }),
      request: async (name, params) => {
        calls.push({ name, params });
        return { data: { expenses_breakdown: { product_price: 0, fulfillment_outbound_price: 1, fulfillment_extra_unit_price: 0, shipping_outbound_price: 4.06, cod_commission: 1.20, total_expenses: 6.26, is_estimate: false } } };
      }
    }),
    metaLoader: async () => []
  });
  assert.deepEqual(calls, [{ name: 'getOrder', params: { id: 1400480 } }]);
  assert.equal(result.coverage.dropeaBreakdownPublishedPercent, 100);
  assert.equal(result.coverage.dropeaBreakdownPercent, 100);
  assert.equal(result.totals.logisticsCost, 6.26);
});

test('live Dropea order detail can be returned without a data wrapper', async () => {
  const summaryOrder = order({
    id: 9002,
    created_at: '2026-07-02T08:00:00.000Z',
    status: 'FINISH',
    sub_status: 'PAID',
    delivered_at_utc: '2026-07-10T12:00:00.000Z'
  });
  delete summaryOrder.expenses_breakdown;
  const detail = {
    ...summaryOrder,
    expenses_breakdown: {
      product_price: 1.01,
      fulfillment_outbound_price: 1,
      fulfillment_refused_price: 0,
      shipping_outbound_price: 4.06,
      shipping_refused_price: 0,
      cod_commission: 1.2,
      tax_rate_supplier: 0,
      tax_rate_dropea: 18,
      equivalence_surcharge_rate: 0,
      is_estimate: false,
      calculated_at: '2026-07-10T13:00:00.000Z'
    }
  };
  const report = await buildFinanceReport({
    month: '2026-07',
    force: true,
    now: new Date('2026-09-12T12:00:00.000Z'),
    clientFactory: () => ({
      listAll: async (operation) => ({ items: operation === 'listOrders' ? [summaryOrder] : [] }),
      request: async () => detail
    }),
    configLoader: () => [{ store_id: '16088', market: 'ES', token: 'fixture' }],
    metaLoader: async () => []
  });
  const enriched = report.orders.find((item) => item.orderId === '9002');
  assert.equal(enriched.breakdownStatus, 'DROPEA_FINAL');
  assert.equal(enriched.dropeaExpenses, 8.40);
  assert.equal(enriched.productCost, 1.01);
  assert.equal(enriched.dropeaAdjustmentsCost, 1.13);
});

test('all monetary parsing is exact to integer cents', () => {
  assert.equal(moneyToCents('0.10'), 10);
  assert.equal(moneyToCents('176,39'), 17639);
  assert.equal(moneyToCents('34.99'), 3499);
  assert.equal(moneyToCents('34.999'), null);
});

test('snapshot publisher accepts only bounded finance data without personal fields', async () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [], issues: [], metaRows: [] });
  report.generatedAt = now.toISOString();
  const saved = await saveFinanceSnapshot(report);
  assert.equal(saved.month, '2026-09');
  await assert.rejects(() => saveFinanceSnapshot({ ...report, customerEmail: 'blocked@example.test' }), /PERSONAL_DATA_BLOCKED/);
});

test('bundled snapshots survive a service restart without Supabase', async () => {
  const report = await loadFinanceSnapshot({ month: '2026-05', now });
  assert.equal(report.period.month, '2026-05');
  assert.equal(report.costTraceability.return.basis, 'PER_RETURNED_ORDER');
  assert.equal(report.costTraceability.return.fallbackAmount, 5.26);
});

test('a newer bundled snapshot is eligible to supersede stale external persistence', async () => {
  clearFinanceCache();
  const report = await loadFinanceSnapshot({ month: '2026-09', now: new Date('2026-09-12T12:00:00Z') });
  assert.equal(report.generatedAt.slice(0, 10), '2026-09-12');
  assert.equal(report.totals.exactNetProfit, 286.36);
  assert.equal(report.coverage.dropeaBreakdownPercent, 100);
});

test('published May, August and September snapshots reconcile operational and economic totals', async () => {
  clearFinanceCache();
  const expected = {
    '2026-05': { delivered: 25, units: 43, net: 60.31 },
    '2026-08': { delivered: 150, units: 279, net: 797.17 },
    '2026-09': { delivered: 113, units: 215, net: 286.36 }
  };
  for (const [month, values] of Object.entries(expected)) {
    const report = await loadFinanceSnapshot({ month, now });
    assert.equal(report.counts.delivered, values.delivered);
    assert.equal(report.counts.deliveredUnits, values.units);
    assert.equal(report.totals.exactNetProfit, values.net);
    assert.equal(report.coverage.dropeaBreakdownPercent, 100);
    assert.equal(report.controls.dailyRevenueReconciled, true);
    assert.equal(report.controls.dailyCostsReconciled, true);
    assert.equal(report.controls.profitReconciled, true);
    assert.ok(report.coverage.dropeaBreakdownPercent >= 0);
    assert.equal(report.orders.every((order) => !('customer' in order) && !('phone' in order)), true);
  }
});
