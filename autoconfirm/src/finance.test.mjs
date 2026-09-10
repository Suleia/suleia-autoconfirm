import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateFinanceReport,
  buildFinanceReport,
  classifyFinanceOrder,
  isSentFinanceOrder,
  resolveFinancePeriod
} from './finance.mjs';
import { FINANCE_COST_POLICY, getClosedFinanceActual } from './finance-actuals.mjs';

test('resolveFinancePeriod closes past months and stops current month today', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.deepEqual(resolveFinancePeriod('2026-08', { now }), {
    month: '2026-08',
    since: '2026-08-01',
    until: '2026-08-31',
    current: false,
    timeZone: 'Europe/Madrid'
  });
  assert.equal(resolveFinancePeriod('2026-09', { now }).until, '2026-09-10');
  assert.throws(() => resolveFinancePeriod('2026-10', { now }), /FINANCE_MONTH_IN_FUTURE/);
});

test('classifies final states and only counts dispatched orders as sent', () => {
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'PAID' }), 'delivered');
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'REFUSED' }), 'returned');
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'CANCELLED' }), 'cancelled');
  assert.equal(classifyFinanceOrder({ status: 'ERROR', sub_status: 'DELIVERY_EXCEPTION' }), 'incident');
  assert.equal(isSentFinanceOrder({ status: 'PENDING', sub_status: 'PENDING' }), false);
  assert.equal(isSentFinanceOrder({ status: 'SHIPPING', sub_status: 'IN_TRANSIT' }), true);
});

test('calculates every cost component and exact provisional profit when coverage is complete', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-09-10T12:00:00.000Z') });
  const report = aggregateFinanceReport({
    period,
    shopifyOrders: [
      { createdAt: '2026-09-01T08:00:00.000Z' },
      { createdAt: '2026-09-01T09:00:00.000Z' },
      { createdAt: '2026-09-02T09:00:00.000Z' }
    ],
    orders: [
      {
        id: 1,
        created_at: '2026-09-01T08:00:00.000Z',
        status: 'FINISH',
        sub_status: 'DELIVERED',
        total_amount: 29.99,
        line_items: [{ sku: '1969_COLLAGUM', product_name: 'Collagum', quantity: 1, unit_price: 29.99 }]
      },
      {
        id: 2,
        created_at: '2026-09-01T09:00:00.000Z',
        status: 'FINISH',
        sub_status: 'REFUSED',
        total_amount: 34.99,
        line_items: [{ sku: '1969_CREMANIDA', product_name: 'Nida', quantity: 1, unit_price: 34.99 }]
      },
      {
        id: 3,
        created_at: '2026-09-02T09:00:00.000Z',
        status: 'PENDING',
        sub_status: 'PENDING',
        total_amount: 29.99,
        line_items: [{ sku: '1969_COLLAGUM', product_name: 'Collagum', quantity: 1, unit_price: 29.99 }]
      }
    ],
    metaRows: [{ dateStart: '2026-09-01', spend: 10 }, { dateStart: '2026-09-02', spend: 5 }]
  });

  assert.equal(report.counts.shopifyOrders, 3);
  assert.equal(report.counts.dropeaOrders, 3);
  assert.equal(report.counts.sent, 2);
  assert.equal(report.counts.delivered, 1);
  assert.equal(report.counts.returned, 1);
  assert.equal(report.counts.confirmationRatePercent, 66.67);
  assert.equal(report.totals.realRevenue, 29.99);
  assert.equal(report.totals.productCost, 1.01);
  assert.equal(report.totals.outboundShippingCost, 8.12);
  assert.equal(report.totals.codCost, 1);
  assert.equal(report.totals.outboundFulfillmentCost, 2.4);
  assert.equal(report.totals.returnCost, 5.26);
  assert.equal(report.totals.fixedCosts, 89.7);
  assert.equal(report.totals.metaSpend, 15);
  assert.equal(report.totals.totalCosts, 122.49);
  assert.equal(report.totals.exactNetProfit, -92.5);
  assert.equal(report.coverage.exactProfitAvailable, true);
});

test('never treats a missing SKU cost or missing Meta as zero profit expense', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-09-03T12:00:00.000Z') });
  const report = aggregateFinanceReport({
    period,
    shopifyOrders: [{ createdAt: '2026-09-03T09:00:00.000Z' }],
    orders: [{
      created_at: '2026-09-03T09:00:00.000Z',
      status: 'FINISH',
      sub_status: 'DELIVERED',
      total_amount: 29.99,
      line_items: [{ sku: 'SKU_NUEVO', product_name: 'Producto', quantity: 1, unit_price: 29.99 }]
    }],
    metaRows: [],
    metaAvailable: false
  });
  assert.equal(report.coverage.productCostPercent, 0);
  assert.equal(report.totals.metaSpend, null);
  assert.equal(report.totals.totalCosts, null);
  assert.equal(report.totals.exactNetProfit, null);
  assert.match(report.warnings.join(' '), /no tienen coste unitario/i);
});

test('July 2026 closed actual reconciles every spreadsheet total to the cent', () => {
  const actual = getClosedFinanceActual('2026-07');
  assert.equal(actual.days.length, 31);
  assert.deepEqual(actual.audit, {
    previousPanelAmount: 5859.53,
    correctedNetProfit: 1537.91,
    overstatement: 4321.62,
    missingProductCost: 642.89,
    missingLogisticsCost: 3412.14,
    missingFixedCosts: 278.07,
    lateMetaDifference: 11.48
  });
  assert.deepEqual(actual.counts, {
    shopifyOrders: 620,
    sent: 452,
    delivered: 314,
    returned: 137,
    confirmationRatePercent: 72.9,
    deliveryRatePercent: 69.47
  });
  assert.deepEqual(actual.totals, {
    estimatedRevenue: 13708.94,
    realRevenue: 9616.5,
    productCost: 655.34,
    outboundShippingCost: 1835.12,
    codCost: 314,
    outboundFulfillmentCost: 542.4,
    returnCost: 720.62,
    metaSpend: 3733.04,
    fixedCosts: 278.07,
    logisticsCost: 3412.14,
    totalCosts: 8078.59,
    exactNetProfit: 1537.91,
    roiPercent: 19.04,
    estimatedCpa: 8.26,
    realCpa: 11.89
  });
  assert.equal(actual.totals.totalCosts,
    actual.totals.productCost + actual.totals.logisticsCost + actual.totals.metaSpend + actual.totals.fixedCosts);
  assert.equal(actual.totals.exactNetProfit, Number((actual.totals.realRevenue - actual.totals.totalCosts).toFixed(2)));
});

test('July remains available as a closed actual even if live providers are unavailable', async () => {
  const fail = async () => { throw new Error('provider unavailable'); };
  const report = await buildFinanceReport({
    month: '2026-07',
    force: true,
    now: new Date('2026-09-10T12:00:00.000Z'),
    configLoader: () => { throw new Error('Dropea unavailable'); },
    metaLoader: fail,
    shopifyLoader: fail
  });
  assert.equal(report.status, 'closed_actual');
  assert.equal(report.coverage.closedActual, true);
  assert.equal(report.coverage.exactProfitAvailable, true);
  assert.equal(report.totals.exactNetProfit, 1537.91);
});

test('cost policy documents all rates used for future months', () => {
  assert.deepEqual({
    shipping: FINANCE_COST_POLICY.outboundShippingPerSent,
    fulfillment: FINANCE_COST_POLICY.outboundFulfillmentPerSent,
    cod: FINANCE_COST_POLICY.codPerDelivered,
    returned: FINANCE_COST_POLICY.returnPerReturned,
    fixedDaily: FINANCE_COST_POLICY.fixedCostPerCalendarDay
  }, { shipping: 4.06, fulfillment: 1.2, cod: 1, returned: 5.26, fixedDaily: 8.97 });
});
