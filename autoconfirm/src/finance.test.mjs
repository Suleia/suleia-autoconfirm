import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFinanceReport, allocateExpenses, buildFinanceReport, classifyFinanceOrder, clearFinanceCache, loadFinanceSnapshot, moneyToCents, resolveFinancePeriod, saveFinanceSnapshot } from './finance.mjs';
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

test('P&L recognizes revenue on delivery event, not order creation', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ created_at: '2026-08-28T08:00:00Z', delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' })] });
  assert.equal(report.counts.created, 0);
  assert.equal(report.totals.realRevenue, 34.99);
  assert.equal(report.days.find((day) => day.day === '2026-09-05').realRevenue, 34.99);
});

test('return cost is recognized on return event with traceable tariff', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ created_at: '2026-08-28T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED' })] });
  assert.equal(report.totals.returnCost, 5.26);
  assert.equal(report.days.find((day) => day.day === '2026-09-06').returned, 1);
  assert.equal(report.costTraceability.return.tariffVersion, rules.version);
});

test('return logistics is exactly 5.26 per returned order for one, two or three units', () => {
  for (const quantity of [1, 2, 3]) {
    const report = aggregateFinanceReport({
      period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [],
      orders: [order({ id: 100 + quantity, created_at: '2026-08-28T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED', line_items: [{ product_id: 31547, variant_id: 31547, sku: 'CREMANIDA', quantity, unit_price: 10, wholesale_price: 0 }] })]
    });
    assert.equal(report.counts.returnedUnits, 0, 'cohort counters exclude orders created before the selected month');
    assert.equal(report.days.find((day) => day.day === '2026-09-06').returnedUnits, quantity);
    assert.equal(report.totals.returnCost, 5.26);
    assert.equal(report.products[0].returnCost, 5.26);
    assert.equal(report.costTraceability.return.basis, 'PER_RETURNED_ORDER');
  }
});

test('return rate remains 5.26 per order and fulfillment components are summed without COD on a return', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses: [], metaRows: [], orders: [order({
    id: 130, created_at: '2026-08-28T08:00:00Z', rejected_at: '2026-09-06T10:00:00Z', status: 'ERROR', sub_status: 'REJECTED',
    order_costs: { fulfillment_outbound: 0.80, fulfillment_quantity_cost: 0.40, return_cost: 99, cod_fee: 8 }
  })] });
  assert.equal(report.totals.outboundFulfillmentCost, 1.20);
  assert.equal(report.totals.returnCost, 5.26);
  assert.equal(report.totals.codCost, 0);
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

test('recurring expenses reconcile to exact monthly ledger total', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-10-02T12:00:00Z') });
  const allocations = allocateExpenses(period, expenses);
  assert.equal([...allocations.values()].reduce((sum, row) => sum + row.fixed, 0), 17639);
});

test('Meta daily spend sums exactly to monthly spend', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, orders: [], metaRows: [{ dateStart: '2026-09-01', spend: '0.01' }, { dateStart: '2026-09-02', spend: '10.09' }] });
  assert.equal(report.totals.metaSpend, 10.10);
  assert.equal(report.days.reduce((sum, day) => sum + moneyToCents(day.metaSpend), 0), 1010);
});

test('cohort rates use created orders while P&L uses event dates', () => {
  const report = aggregateFinanceReport({ period: resolveFinancePeriod('2026-09', { now }), rules, expenses, metaRows: [], orders: [order({ id: 1, delivered_at: '2026-09-05T10:00:00Z', status: 'FINISH', sub_status: 'DELIVERED' }), order({ id: 2, confirmed_at: null, processing_at: null, tracking_number: null, status: 'PENDING', sub_status: 'PENDING' })] });
  assert.equal(report.counts.created, 2);
  assert.equal(report.counts.confirmed, 1);
  assert.equal(report.counts.confirmationRatePercent, 50);
  assert.equal(report.counts.deliveryRatePercent, 100);
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
  assert.equal(report.statusLabel, 'MTD · realizado');
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
  assert.equal(report.costTraceability.return.amount, 5.26);
});

test('published May, August and September snapshots reconcile operational and economic totals', async () => {
  clearFinanceCache();
  const expected = {
    '2026-05': { delivered: 25, units: 43, net: -217.42 },
    '2026-08': { delivered: 150, units: 279, net: -125.01 },
    '2026-09': { delivered: 113, units: 215, net: 1253.25 }
  };
  for (const [month, values] of Object.entries(expected)) {
    const report = await loadFinanceSnapshot({ month, now });
    assert.equal(report.counts.delivered, values.delivered);
    assert.equal(report.counts.deliveredUnits, values.units);
    assert.equal(report.totals.exactNetProfit, values.net);
    assert.equal(report.controls.dailyRevenueReconciled, true);
    assert.equal(report.controls.dailyCostsReconciled, true);
    assert.equal(report.controls.profitReconciled, true);
    const returnedOrders = report.days.reduce((sum, day) => sum + day.returned, 0);
    assert.equal(moneyToCents(report.totals.returnCost), returnedOrders * 526);
  }
});
