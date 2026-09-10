import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateFinanceReport,
  classifyFinanceOrder,
  resolveFinancePeriod
} from './finance.mjs';

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

test('classifyFinanceOrder separates delivered, returned, cancelled and incidents', () => {
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'PAID' }), 'delivered');
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'REFUSED' }), 'returned');
  assert.equal(classifyFinanceOrder({ status: 'FINISH', sub_status: 'CANCELLED' }), 'cancelled');
  assert.equal(classifyFinanceOrder({ status: 'ERROR', sub_status: 'DELIVERY_EXCEPTION' }), 'incident');
  assert.equal(classifyFinanceOrder({ status: 'SHIPPING', sub_status: 'IN_TRANSIT' }), 'active');
});

test('aggregateFinanceReport uses only delivered revenue and never invents exact profit', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-09-10T12:00:00.000Z') });
  const orders = [
    {
      id: 1,
      created_at: '2026-09-01T08:00:00.000Z',
      status: 'FINISH',
      sub_status: 'DELIVERED',
      total_amount: 29.99,
      line_items: [{ product_name: 'Collagum', quantity: 1, unit_price: 29.99, wholesale_price: 3.7 }],
      order_costs: { fulfillment_outbound: 1.2, fulfillment_quantity_cost: 0.5 }
    },
    {
      id: 2,
      created_at: '2026-09-01T09:00:00.000Z',
      status: 'FINISH',
      sub_status: 'REFUSED',
      total_amount: 34.99,
      line_items: [{ product_name: 'Nida', quantity: 1, unit_price: 34.99, wholesale_price: 4 }],
      order_costs: { fulfillment_outbound: 1.2, fulfillment_return: 1.2 }
    },
    {
      id: 3,
      created_at: '2026-09-02T09:00:00.000Z',
      status: 'PENDING',
      sub_status: 'PENDING',
      total_amount: 29.99,
      line_items: [{ product_name: 'Collagum', quantity: 1, unit_price: 29.99, wholesale_price: 3.7 }]
    }
  ];
  const report = aggregateFinanceReport({
    orders,
    metaRows: [
      { dateStart: '2026-09-01', spend: 10 },
      { dateStart: '2026-09-02', spend: 5 }
    ],
    period
  });

  assert.deepEqual(report.counts, {
    total: 3,
    active: 1,
    delivered: 1,
    returned: 1,
    cancelled: 0,
    incidents: 0
  });
  assert.equal(report.totals.revenue, 29.99);
  assert.equal(report.totals.knownProductCost, 3.7);
  assert.equal(report.totals.knownFulfillmentCost, 4.1);
  assert.equal(report.totals.metaSpend, 15);
  assert.equal(report.totals.knownContribution, 7.19);
  assert.equal(report.totals.exactNetProfit, null);
  assert.equal(report.coverage.exactProfitAvailable, false);
  assert.equal(report.products[0].marginBeforeLogisticsAndAds, 26.29);
});

test('aggregateFinanceReport exposes missing wholesale cost instead of estimating it', () => {
  const period = resolveFinancePeriod('2026-09', { now: new Date('2026-09-10T12:00:00.000Z') });
  const report = aggregateFinanceReport({
    orders: [{
      id: 4,
      created_at: '2026-09-03T09:00:00.000Z',
      status: 'FINISH',
      sub_status: 'DELIVERED',
      total_amount: 29.99,
      line_items: [{ product_name: 'Producto', quantity: 1, unit_price: 29.99, wholesale_price: 0 }]
    }],
    metaRows: [],
    period
  });

  assert.equal(report.coverage.productCostPercent, 0);
  assert.equal(report.products[0].unknownCostUnits, 1);
  assert.equal(report.products[0].marginBeforeLogisticsAndAds, null);
});
